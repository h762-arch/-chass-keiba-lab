import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runNarInitialShadowSession} from '../src/research/nar-initial-shadow-session.mjs';
import {NAR_EARLY_RESEARCH_SCHEMA_SQL} from '../src/research/nar-early-sql-store.mjs';
import {NAR_INITIAL_RESEARCH_SCHEMA_SQL} from '../src/research/nar-initial-sql-store.mjs';

export const SCENARIOS=Object.freeze(['baseline','late_ack','lost_ack','missing_receipt','tampered_bundle']);
const schemaVersion='CHASS_NAR_INITIAL_EVIDENCE_REHEARSAL_V1';
const now=Date.parse('2026-10-07T03:00:00Z'),at=new Date(now).toISOString(),raceId='2026-10-07|園田|7';
const bundleKey='nar-initial-research:v1:'+raceId;
const context={schemaVersion,evidenceKind:'SYNTHETIC_REHEARSAL',productionEvidence:false,
 researchOnly:true,formalKpiEligible:false,adopted:false,trustedDurableTime:false,
 probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function fingerprint(v){let h=2166136261;const s=canonical(v);for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return 'fnv1a32:'+(h>>>0).toString(16).padStart(8,'0');}
function acquisition(){
 const race={raceDate:'2026-10-07',track:'園田',raceNo:7,raceType:'NAR',postTime:'13:50',narSourceAcquiredAt:at};
 const horses=Array.from({length:9},(_,i)=>({horseNo:i+1,horseName:`合成馬${i+1}`,runningStyle:'先行・好位',predictedTime:'1:33.5',predictedTimeConfidence:90,features:{distanceFit:90,courseFit:88,evidence:{sameDistance:2,sameTrack:2}}}));
 const predictionSnapshot={race,createdAt:at,generatedAt:at,horses};
 const marketSnapshot={createdAt:at,acquiredAt:at,horses:horses.map(h=>({horseNo:h.horseNo})),signalSnapshot:{status:'frozen',horses:horses.map(h=>({horseNo:h.horseNo,popularityAtFreeze:h.horseNo,oddsAtFreeze:30,valueMark:'',warningMark:''}))}};
 const finalSnapshot={createdAt:at,generatedAt:at,top3:[{horseNo:1}]};
 const record={race,predictionSnapshot,marketSnapshot,finalSnapshot,snapshotIntegrity:{algorithm:'FNV-1a-32/canonical-json',sealedAt:at,hashes:Object.fromEntries(Object.entries({predictionSnapshot,marketSnapshot,finalSnapshot}).map(([k,v])=>[k,fingerprint(v)]))}};
 return {record,acquiredAt:at,acquisitionKind:'fresh'};
}

// No DB path, URL, fetcher, real acquisition, production binding or external
// clock is accepted. All writes are inside one freshly created temporary folder.
export async function runNarInitialEvidenceRehearsalV1(scenario='baseline'){
 if(!SCENARIOS.includes(scenario))return {...context,status:'REJECTED',reason:'SCENARIO_UNSUPPORTED'};
 let directory,sql;
 try{
  directory=mkdtempSync(join(tmpdir(),'chass-initial-evidence-'));
  const path=join(directory,'research.sqlite');sql=new DatabaseSync(path);
  sql.exec(NAR_EARLY_RESEARCH_SCHEMA_SQL);sql.exec(NAR_INITIAL_RESEARCH_SCHEMA_SQL);
  sql.exec('CREATE TABLE research_nar_commit_observations (storage_key TEXT PRIMARY KEY NOT NULL,snapshot_json TEXT NOT NULL)');
  let tick=now,acquisitions=0,readOnly=false;const calls=[];
  const db={
   async exec(query){if(readOnly)throw Error('READ_ONLY');calls.push(query);sql.exec(query);if(query==='COMMIT'){if(scenario==='late_ack')tick=now+60001;if(scenario==='lost_ack')throw Error('SIMULATED_ACK_LOSS');}},
   async first(query,args=[]){if(!/^SELECT\b/.test(query))throw Error('SELECT_ONLY');calls.push(query);return sql.prepare(query).get(...args)||null;},
   async run(query,args=[]){if(readOnly)throw Error('READ_ONLY');calls.push(query);const r=sql.prepare(query).run(...args);return {changes:Number(r.changes)};}
  };
  const receiptStore={
   async get(key){return (await db.first('SELECT snapshot_json FROM research_nar_commit_observations WHERE storage_key=?',[key]))?.snapshot_json??null;},
   async insertIfAbsent(key,raw){return (await db.run('INSERT OR IGNORE INTO research_nar_commit_observations VALUES (?,?)',[key,raw])).changes===1;}
  };
  const first=await runNarInitialShadowSession({enabled:true,db,receiptStore,raceId,clock:()=>tick,acquire:async()=>{acquisitions++;return acquisition();}});
  const readRows=()=>({bundles:sql.prepare('SELECT * FROM research_nar_initial_bundles ORDER BY storage_key').all(),receipts:sql.prepare('SELECT * FROM research_nar_commit_observations ORDER BY storage_key').all()});
  const original=readRows();
  if(scenario==='missing_receipt')sql.exec('DELETE FROM research_nar_commit_observations');
  if(scenario==='tampered_bundle'){
   const changed=JSON.parse(original.bundles[0].snapshot_json);changed.candidateSignal.reason='SIMULATED_TAMPER';
   sql.prepare('UPDATE research_nar_initial_bundles SET snapshot_json=? WHERE storage_key=?').run(JSON.stringify(changed),bundleKey);
  }
  const beforeReopen=readRows(),bytesBefore=JSON.stringify(beforeReopen);
  sql.close();sql=new DatabaseSync(path,{readOnly:true});readOnly=true;calls.length=0;
  const reopened=await runNarInitialShadowSession({enabled:true,db,receiptStore,raceId,clock:()=>now+12*3600000,acquire:async()=>{acquisitions++;throw Error('REACQUISITION_FORBIDDEN');}});
  const after=readRows(),expectedReason=scenario==='late_ack'?'COMMIT_OBSERVED_LATE':scenario==='lost_ack'?'COMMIT_TIMING_UNCONFIRMED':scenario==='missing_receipt'?'COMMIT_EVIDENCE_MISSING':scenario==='tampered_bundle'?'BUNDLE_CONTENT_OR_SCHEMA_INVALID':'DURABLE_TIME_AND_FORMAL_POLICY_UNVERIFIED';
  const bundle=JSON.parse(beforeReopen.bundles[0].snapshot_json),receipt=beforeReopen.receipts.length?JSON.parse(beforeReopen.receipts[0].snapshot_json):null;
  const checks={firstCaptureObserved:first.commitObservationCount===1,oneInitialBundle:after.bundles.length===1,
   oneOriginalReceipt:original.receipts.length===1,originalEvidenceJoined:JSON.parse(original.receipts[0].snapshot_json).sourceBundleSha256===JSON.parse(original.bundles[0].snapshot_json).contentSha256,
   reopenExpectedDisposition:reopened.status===(scenario==='tampered_bundle'?'REJECTED':'HOLD')&&reopened.reason===expectedReason,
   reopenSelectOnly:calls.length>0&&calls.every(q=>q.startsWith('SELECT')),
   noReacquisition:acquisitions===1,readbackBytesUnchanged:bytesBefore===JSON.stringify(after),
   noFormalPromotion:first.formalKpiEligible===false&&reopened.formalKpiEligible===false&&receipt?.trustedDurableTime!==true,
   noOriginalSignalsGenerated:bundle.sourceEarlySnapshot.data.marketSnapshot.signalSnapshot.horses.every(h=>h.valueMark===''&&h.warningMark==='')};
  return {...context,status:Object.values(checks).every(Boolean)?'PASS':'FAIL',scenario,raceId,
   fixtureAt:at,first,reopened,checks,evidence:{bundleKey,
    bundleUtf8Sha256:sha(beforeReopen.bundles[0].snapshot_json),
    receiptKey:beforeReopen.receipts[0]?.storage_key??null,
    receiptUtf8Sha256:receipt?sha(beforeReopen.receipts[0].snapshot_json):null,
    bundle,receipt},readbackQueryCount:calls.length};
 }catch{return {...context,status:'FAIL',scenario,reason:'REHEARSAL_EXECUTION_FAILED'};}
 finally{if(sql)try{sql.close();}catch{}if(directory)rmSync(directory,{recursive:true,force:true});}
}
export async function runNarInitialEvidenceRehearsalCliV1(args){
 if(!Array.isArray(args)||args.length!==0&&(args.length!==2||args[0]!=='--scenario'))return {...context,status:'REJECTED',reason:'CLI_ARGUMENTS_UNSUPPORTED'};
 return runNarInitialEvidenceRehearsalV1(args.length?args[1]:'baseline');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=await runNarInitialEvidenceRehearsalCliV1(process.argv.slice(2));process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=report.status==='PASS'?0:1;}
