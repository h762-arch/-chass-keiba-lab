import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const NAR_STATUS_MIRROR_MAX_AGE_MS=30*60*1000;
export const narStatusSourceUrl=date=>`https://chass-keiba-lab7.h7625421.workers.dev/api/chass/v1/public/nar-precompute-status?date=${date}&format=compact`;
export const narStatusSnapshotPath=date=>`chat-snapshot/status/${date}/nar-precompute-status.json`;
export const validMirrorDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const schema='chass-nar-status-snapshot-v1';
const context={scope:'MIRROR_INTEGRITY_FRESHNESS_AND_READINESS_ONLY',sourceReferenceBasis:'CALLER_SUPPLIED_COMMIT',acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
// Pure, Node-only audit. No IO, repair, credential, writer or model port.
export function auditNarStatusMirror(input={}){
 const hold=(reasonCodes,extra={})=>({...context,status:'HOLD',reasonCodes,...extra});
 try{
  const {expectedDate,commitSha,attempt,snapshot,manifest,now=Date.now(),maxAgeMs=NAR_STATUS_MIRROR_MAX_AGE_MS}=input;
  if(!validMirrorDate(expectedDate)||typeof commitSha!=='string'||!/^[a-f0-9]{40}$/.test(commitSha)||!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime())||!Number.isInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>86400000)return hold(['AUDIT_CONFIGURATION_INVALID']);
  const reference={date:expectedDate,commitSha,auditedAt:new Date(now).toISOString(),maxAgeMs};
  if(manifest?.ok!==true||manifest.schemaVersion!=='chass-chat-mirror-manifest-v1'||manifest.branch!=='chass-data'||manifest.statusMirror?.latestAttemptPath!=='chat-snapshot/status/latest-attempt.json'||!isDeepStrictEqual(manifest.statusMirror.latestAttempt,attempt))return hold(['MANIFEST_ATTEMPT_MISMATCH'],reference);
  if(attempt?.schemaVersion!==schema||attempt.date!==expectedDate||attempt.sourceUrl!==narStatusSourceUrl(expectedDate)||attempt.readOnlyCapture!==true||!stamp(attempt.attemptedAt)||Date.parse(attempt.attemptedAt)>now)return hold(['ATTEMPT_INVALID'],reference);
  if(attempt.status==='FAILED'){
   if(attempt.snapshotPath!==null||!stamp(attempt.finishedAt)||Date.parse(attempt.finishedAt)<Date.parse(attempt.attemptedAt)||Date.parse(attempt.finishedAt)>now)return hold(['ATTEMPT_INVALID'],reference);
   return hold(['LATEST_CAPTURE_FAILED'],{...reference,attemptedAt:attempt.attemptedAt});
  }
  if(attempt.status!=='CAPTURED'||attempt.snapshotPath!==narStatusSnapshotPath(expectedDate)||!stamp(attempt.capturedAt)||Date.parse(attempt.capturedAt)<Date.parse(attempt.attemptedAt)||Date.parse(attempt.capturedAt)>now||attempt.hashBasis!=='UTF8_JSON_STRINGIFY_PAYLOAD'||!sha(attempt.payloadSha256))return hold(['ATTEMPT_INVALID'],reference);
  if(!snapshot||['schemaVersion','status','date','sourceUrl','attemptedAt','capturedAt','payloadSha256','hashBasis','readOnlyCapture'].some(k=>snapshot[k]!==attempt[k]))return hold(['SNAPSHOT_ATTEMPT_MISMATCH'],reference);
  const p=snapshot.payload;
  if(!p||p.ok!==true||p.date!==expectedDate||!Array.isArray(p.races)||p.races.length>500||typeof p.schemaReady!=='boolean'||['researchOnly','formalKpiEligible','productionActivationReady'].some(k=>typeof p[k]!=='boolean'))return hold(['PAYLOAD_INVALID'],reference);
  if(createHash('sha256').update(JSON.stringify(p)).digest('hex')!==snapshot.payloadSha256)return hold(['PAYLOAD_HASH_MISMATCH'],reference);
  if(p.schemaReady?(!Number.isInteger(p.savedRaceCount)||p.savedRaceCount!==p.races.length||!Number.isInteger(p.rejectedRowCount)||p.rejectedRowCount<0||p.rejectedRowCount>500):(p.savedRaceCount!==null||p.races.length!==0))return hold(['PAYLOAD_INVALID'],reference);
  const ageMs=now-Date.parse(attempt.capturedAt),observed={capturedAt:attempt.capturedAt,ageMs,schemaReady:p.schemaReady,historyStoreSchemaReady:p.historyStoreSchemaReady??null,savedRaceCount:p.savedRaceCount,...(Object.hasOwn(p,'rejectedRowCount')?{rejectedRowCount:p.rejectedRowCount}:{}),trackCodes:p.trackCodes??null,effectiveMaxJobs:p.effectiveMaxJobs??null,datedTrial:p.datedTrial??null,scheduleStatus:p.scheduleStatus??null,researchOnly:p.researchOnly,formalKpiEligible:p.formalKpiEligible,productionActivationReady:p.productionActivationReady};
  const reasons=[];
  if(ageMs>maxAgeMs)reasons.push('SNAPSHOT_STALE');
  if(p.schemaReady!==true)reasons.push('SCHEMA_UNAVAILABLE');
  if(p.historyStoreSchemaReady!==true)reasons.push('HISTORY_SCHEMA_UNAVAILABLE');
  if(p.schemaReady&&p.rejectedRowCount>0)reasons.push('REJECTED_ROWS_PRESENT');
  if(p.scheduleStatus==='BLOCKED')reasons.push('COLLECTION_CONFIGURATION_BLOCKED');
  if(p.researchOnly!==true||p.formalKpiEligible!==false||p.productionActivationReady!==false)reasons.push('GOVERNANCE_FLAGS_UNEXPECTED');
  return {...context,...reference,status:reasons.length?'HOLD':'VERIFIED',reasonCodes:reasons,observed};
 }catch{return hold(['AUDIT_INPUT_UNREADABLE']);}
}
