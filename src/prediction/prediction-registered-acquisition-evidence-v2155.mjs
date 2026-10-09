// Node-only source evidence capture; all production adoption remains external.
import {createHash} from 'node:crypto';
import {registerPredictionAcquisitionSourcesV2155} from './prediction-acquisition-registry-v2155.mjs';
import {executeAndQuarantinePredictionAcquisitionV2155,readPredictionAcquisitionQuarantineV2155} from './prediction-acquisition-quarantine-v2155.mjs';
const VERSION='CHASS_REGISTERED_ACQUISITION_EVIDENCE_V2155_V1';
function canonical(v){
 if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 throw Error('NON_JSON');
}
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
function copy(v){const s=canonical(v);if(Buffer.byteLength(s)>200000)throw Error('EVIDENCE_TOO_LARGE');return JSON.parse(s)}
const equal=(a,b)=>canonical(a)===canonical(b);
const guard=(v,reason)=>{if(!v)throw Error(reason)};
const failure=reason=>({status:'HOLD',reason,persisted:false,readbackVerified:false,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
function validSnapshot(snapshot,receipt,sourceRef){
 guard(snapshot&&snapshot.sourceRef===sourceRef&&Object.hasOwn(snapshot,'payload')&&snapshot.payload!==null,'SOURCE_SNAPSHOT_REQUIRED');
 for(const k of ['sourceSnapshotId','runId','raceId','eligibilityId','fieldId','scopeKey','sourceStage','identityStatus','sourceLineage','leakageGuard','capturedAt','dataAsOf','value'])guard(equal(snapshot[k],receipt[k]),'SOURCE_SNAPSHOT_RECEIPT_MISMATCH');
}
function validateEvidence(payload){
 const e=payload.supportingEvidence,p=payload.plan,r=payload.result;
 guard(e?.schemaVersion===VERSION&&Array.isArray(e.traces)&&e.traces.length<=4,'REGISTERED_EVIDENCE_REQUIRED');
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
export async function readRegisteredPredictionAcquisitionEvidenceV2155(input={}){
 const saved=await readPredictionAcquisitionQuarantineV2155(input);
 if(!saved.readbackVerified)return saved;
 try{validateEvidence(saved.payload);return saved}catch{return failure('REGISTERED_EVIDENCE_READBACK_INVALID')}
}
export async function executeRegisteredPredictionAcquisitionEvidenceV2155({root,environment,plan,registry,registryAnchor,readers,clock}={}){
 try{
  guard(environment==='QUARANTINE','QUARANTINE_REQUIRED');
  const p=copy(plan),reg=copy(registry),anchor=copy(registryAnchor),traces=[],wrapped=Object.create(null);
  for(const [id,reader] of Object.entries(readers??{}))if(typeof reader==='function')wrapped[id]=async args=>{
   const response=await reader(args); // Phase90 sanitizes thrown provider errors.
   if(args.signal.aborted)return {sourceRef:args.registration.sourceRef,receipt:{result:'CONFLICT',reasonCode:'SOURCE_READ_ABORTED'}};
   let returned;
   try{
    returned=copy(response);guard(returned.sourceRef===args.registration.sourceRef,'SOURCE_REF_MISMATCH');
    guard(returned.receipt&&['FOUND','NOT_FOUND','READ_FAILED','BLOCKED','NOT_APPLICABLE','CONFLICT'].includes(returned.receipt.result),'SOURCE_RECEIPT_INVALID');
    if(returned.receipt?.result==='FOUND')validSnapshot(returned.sourceSnapshot,returned.receipt,returned.sourceRef);
   }catch{return {sourceRef:args.registration.sourceRef,receipt:{result:'CONFLICT',reasonCode:'SOURCE_EVIDENCE_INVALID'}}}
   const trace={tier:args.context.tier,provider:args.context.provider,sourceCandidate:args.context.sourceCandidate,sourceRef:returned.sourceRef,receipt:returned.receipt};
   if(returned.receipt?.result==='FOUND'){trace.sourceSnapshot=returned.sourceSnapshot;trace.sourceHash=hash(returned.sourceSnapshot)}
   traces.push(trace);return returned;
  };
  const registered=registerPredictionAcquisitionSourcesV2155({plan:p,registry:reg,anchor,readers:wrapped});
  if(registered.status!=='REGISTERED')return registered;
  const supportingEvidence={schemaVersion:VERSION,registry:reg,registryAnchor:anchor,traces};
  const saved=await executeAndQuarantinePredictionAcquisitionV2155({root,environment,plan:p,collectors:registered.collectors,clock,supportingEvidence});
  if(!saved.readbackVerified)return saved;
  const verified=await readRegisteredPredictionAcquisitionEvidenceV2155({root,anchor:saved.anchor});
  return verified;
 }catch(e){return failure(e?.message==='QUARANTINE_REQUIRED'?'QUARANTINE_REQUIRED':'REGISTERED_EVIDENCE_FAILED')}
}
