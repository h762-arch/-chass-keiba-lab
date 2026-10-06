import {createHash} from 'node:crypto';
import {buildProductionJraAuditEvidence} from './jra-production-audit-evidence.mjs';

const fail=reason=>Object.freeze({status:'REJECTED',reason,productionActivationReady:false});
const integer=n=>Number.isInteger(n)&&n>=0;
const reason=value=>value===null||(typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value));
const revision=n=>Number.isInteger(n)&&n>=1;
const rate=(n,max=1)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=max;

function validMetrics(result,kind){
 if(!reason(result?.reason))return false;
 if(result.status!=='READY')return result.summary===null;
 const s=result.summary;
 if(!s||!Array.isArray(s.excluded)||s.excluded.some(row=>
  !['READY','PENDING','REJECTED','EXCLUDED'].includes(row?.status)||!reason(row.reason)||row.reason===null))return false;
 if(kind==='star'){
  if(!Array.isArray(s.observations)||s.observations.some(row=>!revision(row?.earlyRevision)||
   !revision(row.horseNo)||row.horseNo>99||typeof row.winHit!=='boolean'||typeof row.top3Hit!=='boolean'||
   (row.winHit&&!row.top3Hit)))return false;
  const n=s.observations.length,w=s.observations.filter(row=>row.winHit).length,p=s.observations.filter(row=>row.top3Hit).length;
  return s.winHits===w&&s.top3Hits===p&&s.winHitRate===(n?w/n:null)&&s.top3HitRate===(n?p/n:null);
 }
 if(!Array.isArray(s.included)||s.included.some(row=>!revision(row?.earlyRevision)||
  !revision(row.matchedRunnerCount)||!integer(row.timeSampleCount)||row.timeSampleCount>row.matchedRunnerCount))return false;
 const n=s.included.length,timeRaces=s.included.filter(row=>row.timeSampleCount>0).length;
 return s.matchedRunnerCount===s.included.reduce((sum,row)=>sum+row.matchedRunnerCount,0)&&
  s.timeSampleCount===s.included.reduce((sum,row)=>sum+row.timeSampleCount,0)&&s.timeRaceCount===timeRaces&&
  (n?rate(s.meanRaceWinBrier)&&rate(s.meanRaceTop3Brier):s.meanRaceWinBrier===null&&s.meanRaceTop3Brier===null)&&
  (timeRaces?rate(s.meanRaceTimeMaeSeconds,Infinity):s.meanRaceTimeMaeSeconds===null);
}

// Validate exact exported bytes against an independently supplied digest and expected identity.
// VERIFIED means content/metadata consistency only: no D1/network access or Activation authorization.
export function verifyJraAuditEvidence({json,sha256,targetDate,commitSha}={}){
 if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>2*1024*1024||
  typeof sha256!=='string'||!/^[0-9a-f]{64}$/.test(sha256)||
  typeof targetDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||
  typeof commitSha!=='string'||!/^[0-9a-f]{40}$/.test(commitSha))return fail('INVALID_VERIFIER_INPUT');
 if(createHash('sha256').update(json,'utf8').digest('hex')!==sha256)return fail('HASH_MISMATCH');
 let e;
 try{e=JSON.parse(json);}catch{return fail('MALFORMED_EVIDENCE');}
 if(e?.targetDate!==targetDate||e?.commitSha!==commitSha)return fail('EVIDENCE_IDENTITY_MISMATCH');
 try{
  if(!validMetrics(e.formalKpi,'formal')||!validMetrics(e.starResearch,'star'))return fail('EVIDENCE_METRICS_INVALID');
  const p=e.preflight;
  if(!p||['migration','schema','indexes','meeting'].some(key=>!['PASS','FAIL'].includes(p[key]))||
   !['PASS','NOT_YET_PROVEN'].includes(p.race)||!['PASS','FAIL','EMPTY'].includes(p.snapshotAudit))return fail('EVIDENCE_CONTRACT_INVALID');
  const rebuilt=buildProductionJraAuditEvidence({report:{...p,targetDate:e.targetDate,checkedAt:e.checkedAt,
   snapshotDataRaceIds:e.raceIds},kpi:e.formalKpi,shadow:e.starResearch,commitSha:e.commitSha});
  // Exact reconstruction also rejects unknown fields, unsupported versions/scope and changed NO-GO flags.
  if(rebuilt.status!=='READY'||rebuilt.json!==json)return fail('EVIDENCE_CONTRACT_INVALID');
  return Object.freeze({status:'VERIFIED',reason:null,targetDate,commitSha,sha256,
   formalKpiStatus:e.formalKpi.status,starResearchStatus:e.starResearch.status,
   productionActivationReady:false,starFormalMarkAdopted:false,
   scope:'CONTENT_AND_METADATA_CONSISTENCY_ONLY'});
 }catch{return fail('EVIDENCE_CONTRACT_INVALID');}
}
