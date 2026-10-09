// Transport-independent integrity verifier; no filesystem, network or adoption.
import {createHash} from 'node:crypto';
const VERSION='CHASS_ACQUISITION_QUARANTINE_V2155_V1';
const REGISTERED_VERSION='CHASS_REGISTERED_ACQUISITION_EVIDENCE_V2155_V1';
function canonical(v){
  if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  throw Error('NON_JSON');
}
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const guard=(v,reason)=>{if(!v)throw Error(reason)};
const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(v);
const equal=(a,b)=>canonical(a)===canonical(b);
const immutable=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(immutable);Object.freeze(v)}return v};
const failure=reason=>({status:'HOLD',reason,persisted:false,readbackVerified:false,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
function validate(payload,anchor){
  guard(payload?.schemaVersion===VERSION&&payload.environment==='QUARANTINE','STORE_SCHEMA_INVALID');
  const {plan,result}=payload;
  guard(safeId(plan?.planId)&&result?.planHash===hash(plan),'PLAN_HASH_MISMATCH');
  guard(result.runId===plan.runId&&result.raceId===plan.raceId&&result.eligibilityId===plan.eligibilityId,'STORE_IDENTITY_MISMATCH');
  guard(result.persisted===false&&result.formalKpiEligible===false&&result.adopted===false&&result.productionActivationReady===false,'STORE_PROMOTION_FORBIDDEN');
  guard(Array.isArray(result.attempts)&&result.attempts.length<=4,'STORE_ATTEMPTS_INVALID');
  result.attempts.forEach((a,i)=>guard(a.planHash===result.planHash&&a.attemptNo===i+1&&a.runId===plan.runId&&a.raceId===plan.raceId&&a.eligibilityId===plan.eligibilityId&&a.fieldId===plan.fieldId&&a.scopeKey===plan.scopeKey,'STORE_ATTEMPTS_INVALID'));
  guard(anchor?.schemaVersion===VERSION&&anchor.environment==='QUARANTINE'&&anchor.planId===plan.planId&&anchor.runId===plan.runId&&anchor.raceId===plan.raceId&&anchor.planHash===result.planHash&&anchor.payloadHash===hash(payload),'READBACK_ANCHOR_MISMATCH');
}
function validSnapshot(snapshot,receipt,sourceRef){
 guard(snapshot&&snapshot.sourceRef===sourceRef&&Object.hasOwn(snapshot,'payload')&&snapshot.payload!==null,'SOURCE_SNAPSHOT_REQUIRED');
 for(const k of ['sourceSnapshotId','runId','raceId','eligibilityId','fieldId','scopeKey','sourceStage','identityStatus','sourceLineage','leakageGuard','capturedAt','dataAsOf','value'])guard(equal(snapshot[k],receipt[k]),'SOURCE_SNAPSHOT_RECEIPT_MISMATCH');
}
function validateEvidence(payload){
 const e=payload.supportingEvidence,p=payload.plan,r=payload.result;
 guard(e?.schemaVersion===REGISTERED_VERSION&&Array.isArray(e.traces)&&e.traces.length<=4,'REGISTERED_EVIDENCE_REQUIRED');
 guard(e.registry?.planHash===r.planHash&&e.registry.planId===p.planId&&e.registry.runId===p.runId&&e.registry.raceId===p.raceId&&e.registryAnchor?.registryHash===hash(e.registry)&&e.registryAnchor.registryId===e.registry.registryId&&e.registryAnchor.planHash===r.planHash,'REGISTRY_EVIDENCE_BINDING_INVALID');
 const seen=new Set();
 for(const t of e.traces){
  guard(!seen.has(t.provider),'DUPLICATE_SOURCE_TRACE');seen.add(t.provider);
  const entry=e.registry.entries.find(v=>v.provider===t.provider),a=r.attempts.find(v=>v.provider===t.provider);
  guard(entry&&a&&t.tier===entry.tier&&t.tier===a.tier&&t.sourceCandidate===entry.sourceCandidate&&t.sourceCandidate===a.sourceCandidate&&t.sourceRef===entry.sourceRef,'TRACE_ATTEMPT_BINDING_INVALID');
  if(t.receipt.result==='FOUND'){validSnapshot(t.sourceSnapshot,t.receipt,t.sourceRef);guard(t.sourceHash===hash(t.sourceSnapshot),'SOURCE_HASH_MISMATCH')}
  if(a.result==='FOUND')guard(t.receipt.result==='FOUND'&&t.receipt.sourceSnapshotId===a.sourceSnapshotId,'FOUND_TRACE_REQUIRED');
 }
 for(const a of r.attempts.filter(v=>v.result==='FOUND'))guard(e.traces.some(t=>t.provider===a.provider&&t.receipt.result==='FOUND'),'FOUND_TRACE_REQUIRED');
 if(r.acquisitionState==='RESOLVED'){
  const t=e.traces.find(v=>v.receipt.result==='FOUND'&&v.receipt.sourceSnapshotId===r.sourceSnapshotId);
  guard(t&&equal(t.receipt.value,r.value),'RESOLVED_SOURCE_VALUE_MISMATCH');
 }
}

export {canonical as canonicalPredictionAcquisitionEvidenceV2155, validSnapshot as validatePredictionSourceSnapshotV2155};
export function verifyPredictionAcquisitionEvidenceV2155({payload,anchor,registered=false}={}){
 try{
  const bytes=canonical(payload);guard(Buffer.byteLength(bytes)<=300000,'STORE_TOO_LARGE');
  const p=JSON.parse(bytes),a=JSON.parse(canonical(anchor));validate(p,a);
  if(registered){try{validateEvidence(p)}catch{return failure('REGISTERED_EVIDENCE_READBACK_INVALID')}}
  return immutable({status:'EVIDENCE_VERIFIED',payload:p,anchor:a,persisted:false,readbackVerified:true,assessmentOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
 }catch(e){return failure(['STORE_SCHEMA_INVALID','PLAN_HASH_MISMATCH','STORE_IDENTITY_MISMATCH','STORE_PROMOTION_FORBIDDEN','STORE_ATTEMPTS_INVALID','READBACK_ANCHOR_MISMATCH','STORE_TOO_LARGE'].includes(e?.message)?e.message:'READBACK_FAILED')}
}
