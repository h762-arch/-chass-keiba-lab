import { isFrozenSignalRaceId } from './signal-rule-cohort-audit.mjs';
import { stableHash } from '../prediction/precomputed-snapshot.mjs';
import { auditSignalSourceBindings } from './signal-source-binding-audit.mjs';
import { auditFrozenSignalRules } from './signal-rule-audit.mjs';

export const SIGNAL_BINDING_READ_SQL='SELECT race_id,model_version,market_json FROM races WHERE race_id=? AND model_version=? LIMIT 1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=160&&!/[\r\n\0]/.test(v);

// Exact saved app Original Signals only. Source Registry captures must already
// exist; this reader never constructs a manifest, hashes to excuse edits, or marks.
export async function readSignalSourceBindingCohort({DB,selections,cryptoImpl=globalThis.crypto}={}){
 const result=(status,reason,rows=[],readQueryCount=0)=>freeze({status,reason,mode:'research',
  authenticity:'NOT_VERIFIED',adopted:false,formalKpiEligible:false,productionActivationReady:false,
  readQueryCount,rows,reasonCounts:rows.reduce((out,r)=>{
   if(r.reason)out[r.reason]=(out[r.reason]??0)+1;return out;
  },{})});
 if(typeof DB?.prepare!=='function')return result('REJECTED','D1_UNAVAILABLE');
 if(!Array.isArray(selections)||selections.length<1||selections.length>100||selections.some(s=>
  !isFrozenSignalRaceId(s?.raceId)||!text(s.modelVersion)))return result('REJECTED','INVALID_SELECTIONS');
 const unique=new Set(selections.map(s=>JSON.stringify([s.raceId,s.modelVersion])));
 if(unique.size!==selections.length)return result('REJECTED','DUPLICATE_SELECTION');
 let selected;try{selected=structuredClone(selections);}catch{return result('REJECTED','CAPTURE_COPY_FAILED');}
 const rows=[];let reads=0;
 for(const selection of selected.sort((a,b)=>a.raceId.localeCompare(b.raceId)||a.modelVersion.localeCompare(b.modelVersion))){
  const {raceId,modelVersion,capture}=selection;
  const row=(status,reason,audit=null)=>({raceId,modelVersion,status,reason,audit});
  let saved;
  try{reads++;saved=await DB.prepare(SIGNAL_BINDING_READ_SQL).bind(raceId,modelVersion).first();}
  catch{return result('BLOCKED','D1_READ_FAILED',rows,reads);}
  if(!saved){rows.push(row('UNVERIFIED','SAVED_RACE_MISSING'));continue;}
  if(saved.race_id!==raceId||saved.model_version!==modelVersion){rows.push(row('REJECTED','SAVED_IDENTITY_MISMATCH'));continue;}
  if(saved.market_json==null){rows.push(row('UNVERIFIED','SIGNAL_SNAPSHOT_MISSING'));continue;}
  let market;
  try{
   if(typeof saved.market_json!=='string'||saved.market_json.length>2*1024*1024)throw Error('invalid_json');
   market=JSON.parse(saved.market_json);
   if(!market||typeof market!=='object'||Array.isArray(market))throw Error('invalid_market');
  }catch{rows.push(row('REJECTED','SAVED_MARKET_INVALID'));continue;}
  if(market.raceId!=null&&market.raceId!==raceId){rows.push(row('REJECTED','SIGNAL_RACE_IDENTITY_MISMATCH'));continue;}
  const signal=market.signalSnapshot;
  if(!signal){rows.push(row('UNVERIFIED','SIGNAL_SNAPSHOT_MISSING'));continue;}
  if(signal.status!=='frozen'){rows.push(row('UNVERIFIED','SIGNAL_NOT_FROZEN'));continue;}
  if(auditFrozenSignalRules(signal).status!=='READY'){
   rows.push(row('REJECTED','SAVED_SIGNAL_INVALID'));continue;
  }
  if(!capture){rows.push(row('UNVERIFIED','BINDING_CAPTURE_MISSING'));continue;}
  if(capture.scope?.raceId!==raceId||capture.storage?.raceId!==raceId||
   capture.storage?.modelVersion!==modelVersion){rows.push(row('REJECTED','CAPTURE_STORAGE_IDENTITY_MISMATCH'));continue;}
  let savedHash;
  try{savedHash=await stableHash(signal,{cryptoImpl});}
  catch{rows.push(row('REJECTED','SAVED_SIGNAL_HASH_FAILED'));continue;}
  if(savedHash!==capture.manifest?.snapshotHash){rows.push(row('REJECTED','SAVED_SIGNAL_CAPTURE_MISMATCH'));continue;}
  // Phase111 checks the supplied snapshot against the SAME pinned manifest.
  // Replacing it with the current DB signal and minting new hashes is forbidden.
  let audit;try{audit=await auditSignalSourceBindings(capture,{cryptoImpl});}
  catch{rows.push(row('REJECTED','CAPTURE_AUDIT_FAILED'));continue;}
  const signalRows=audit.audit?.rows||[];
  const status=audit.status!=='READY'?audit.status:signalRows.some(r=>r.status==='VIOLATION')?'VIOLATION':
   signalRows.some(r=>r.status==='UNVERIFIED')?'UNVERIFIED':'STRUCTURAL_PASS';
  const reason=audit.reason||(status==='VIOLATION'?'SIGNAL_RULE_VIOLATION':
   status==='UNVERIFIED'?'SIGNAL_EVIDENCE_UNVERIFIED':null);
  rows.push(row(status,reason,audit));
 }
 return result('OBSERVED',null,rows,reads);
}
