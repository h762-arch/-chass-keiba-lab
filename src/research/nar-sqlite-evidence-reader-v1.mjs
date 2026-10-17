import {DatabaseSync} from 'node:sqlite';
import {lstatSync,existsSync,openSync,readSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {auditNarInitialEvidenceV1} from './nar-initial-evidence-audit-v1.mjs';

export const VERSION='CHASS_NAR_SQLITE_EVIDENCE_READER_V1';
const tables=['research_nar_early_snapshots','research_nar_initial_bundles','research_nar_commit_observations'];
const hash=raw=>createHash('sha256').update(raw,'utf8').digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sidecars=path=>['-wal','-shm','-journal'].some(s=>existsSync(path+s));
function output(status,reason,extra={}){return Object.freeze({version:VERSION,status,reason,...extra,
 researchOnly:true,formalReadiness:'HOLD',formalKpiEligible:false,adopted:false,
 productionEvidenceVerified:false,externalAnchorAuthenticated:false,trustedDurableTime:false,
 probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',freezeMutation:'NONE'});}
function parse(raw,max){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>max)throw Error();
 const x=JSON.parse(raw);let nodes=0;
 function walk(v,d=0){if(++nodes>30000||d>32)throw Error();if(typeof v==='number'&&!Number.isFinite(v))throw Error();if(v&&typeof v==='object')for(const c of Object.values(v))walk(c,d+1);}
 walk(x);if(!x||typeof x!=='object'||Array.isArray(x))throw Error();return x;
}
function config(raw){
 const x=parse(raw,4096);
 if(typeof x.dbPath!=='string'||!x.dbPath||x.dbPath.length>2048||/[\x00-\x1f\x7f]/.test(x.dbPath)||/^[a-z][a-z0-9+.-]*:/i.test(x.dbPath))throw Error();
 if(typeof x.raceId!=='string'||x.raceId.length>160||/[\x00-\x1f\x7f]/.test(x.raceId))throw Error();
 const m=x.raceId.match(/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|([1-9]\d?)$/);
 if(!m||m[2]!==m[2].trim()||!Number.isFinite(Date.parse(m[1]+'T00:00:00Z'))||new Date(m[1]+'T00:00:00Z').toISOString().slice(0,10)!==m[1])throw Error();
 return {path:resolve(x.dbPath),raceId:x.raceId};
}

// Explicit local, quiescent SQLite copies only. No auto-discovery, default DB,
// writer, schema repair, URL access, D1 binding or acquisition callback.
export async function readNarSqliteEvidenceV1(configJson){
 let c;try{c=config(configJson);}catch{return output('HOLD','INVALID_READER_CONFIG');}
 let db,evidence;
 try{
  if(!existsSync(c.path))return output('HOLD','SQLITE_FILE_MISSING');
  if(!lstatSync(c.path).isFile())return output('HOLD','SQLITE_REGULAR_FILE_REQUIRED');
  if(sidecars(c.path))return output('HOLD','QUIESCENT_SQLITE_COPY_REQUIRED');
  const fd=openSync(c.path,'r'),header=Buffer.alloc(20);let count;
  try{count=readSync(fd,header,0,20,0);}finally{closeSync(fd);}
  if(count!==20||header.subarray(0,16).toString('binary')!=='SQLite format 3\x00')return output('HOLD','SQLITE_HEADER_INVALID');
  if(header[18]!==1||header[19]!==1)return output('HOLD','QUIESCENT_SQLITE_COPY_REQUIRED');
  db=new DatabaseSync(c.path,{readOnly:true});
  db.exec('PRAGMA query_only=ON');db.exec('BEGIN');
  const types=db.prepare("SELECT name,type FROM sqlite_schema WHERE name IN (?,?,?)").all(...tables);
  if(types.length!==3||types.some(t=>t.type!=='table'))return output('HOLD','EVIDENCE_TABLES_REQUIRED');
  const legacy=db.prepare('SELECT 1 AS present FROM research_nar_early_snapshots WHERE storage_key=?').get('nar-early:v1:'+c.raceId);
  if(legacy)return output('HOLD','LEGACY_EARLY_REQUIRES_SEPARATE_AUDIT');
  // CASE bounds the materialized row text; no caller table/column interpolation.
  const bundleKey='nar-initial-research:v1:'+c.raceId;
  const row=db.prepare('SELECT CASE WHEN length(CAST(snapshot_json AS BLOB)) BETWEEN 1 AND 300000 THEN snapshot_json END AS raw FROM research_nar_initial_bundles WHERE storage_key=?').get(bundleKey);
  if(!row)return output('HOLD','INITIAL_BUNDLE_MISSING');
  if(typeof row.raw!=='string')return output('HOLD','BUNDLE_TEXT_OUT_OF_BOUNDS');
  const bundle=parse(row.raw,300000);
  if(bundle.raceId!==c.raceId||!hex(bundle.contentSha256))return output('HOLD','BUNDLE_IDENTITY_INVALID');
  const receiptKey=`nar-commit-observation:v1:${c.raceId}:${bundle.contentSha256}`;
  const receiptRow=db.prepare('SELECT CASE WHEN length(CAST(snapshot_json AS BLOB)) BETWEEN 1 AND 300000 THEN snapshot_json END AS raw FROM research_nar_commit_observations WHERE storage_key=?').get(receiptKey);
  if(receiptRow&&typeof receiptRow.raw!=='string')return output('HOLD','RECEIPT_TEXT_OUT_OF_BOUNDS');
  const receiptRawJson=receiptRow?.raw??null,receipt=receiptRawJson===null?null:parse(receiptRawJson,300000);
  evidence={schemaVersion:'CHASS_NAR_INITIAL_EVIDENCE_V1',evidenceKind:'UNSPECIFIED',bundleKey,
   bundleRawJson:row.raw,bundleUtf8Sha256:hash(row.raw),bundle,receiptKey:receiptRawJson===null?null:receiptKey,
   receiptRawJson,receiptUtf8Sha256:receiptRawJson===null?null:hash(receiptRawJson),receipt};
  // Release the read transaction before potentially longer semantic hashing.
  db.exec('ROLLBACK');db.close();db=null;
  if(sidecars(c.path))return output('HOLD','QUIESCENT_SQLITE_COPY_REQUIRED');
  const audit=await auditNarInitialEvidenceV1(JSON.stringify(evidence));
  return output(audit.status==='CONTENT_AND_OBSERVED_TIME_MATCH'?'CONTENT_READ_AND_MATCHED':'HOLD',audit.reason,{
   source:'EXPLICIT_LOCAL_SQLITE_READ_ONLY',storeReadPerformed:true,evidence,audit});
 }catch{return output('HOLD','SQLITE_EVIDENCE_READ_FAILED');}
 finally{if(db){try{db.exec('ROLLBACK');}catch{}try{db.close();}catch{}}}
}
