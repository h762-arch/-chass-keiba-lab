// Offline source-registration gate. Readers own authenticated source access.
import {createHash} from 'node:crypto';
const VERSION='CHASS_ACQUISITION_REGISTRY_V2155_V1';
const TIERS=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
function canonical(v){
 if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 throw Error('NON_JSON');
}
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const text=v=>typeof v==='string'&&v.trim().length>0;
const time=v=>text(v)&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const frozen=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v)}return v};
const guard=(ok,reason)=>{if(!ok)throw Error(reason)};
export function registerPredictionAcquisitionSourcesV2155({plan,registry,anchor,readers}={}){
 try{
  const body=canonical(registry);guard(body.length<=30000,'REGISTRY_TOO_LARGE');
  const r=JSON.parse(body),p=JSON.parse(canonical(plan)),registryHash=hash(r),planHash=hash(p);
  guard(p.version==='v2.15.5'&&p.mode==='FORWARD'&&p.stage==='ORIGINAL_EARLY'&&p.immutableStatus==='FROZEN'&&p.leakageGuard==='PASS','FORWARD_PLAN_REQUIRED');
  guard(r.schemaVersion===VERSION&&r.mode==='FORWARD'&&r.stage==='ORIGINAL_EARLY'&&r.immutableStatus==='FROZEN'&&text(r.registryId),'FROZEN_REGISTRY_REQUIRED');
  guard(r.planHash===planHash&&r.planId===p.planId&&r.runId===p.runId&&r.raceId===p.raceId&&r.eligibilityId===p.eligibilityId&&r.fieldId===p.fieldId&&r.scopeKey===p.scopeKey&&r.contractFreezeId===p.contractFreezeId&&r.requirementSnapshotId===p.requirementSnapshotId,'REGISTRY_PLAN_BINDING_INVALID');
  guard(Number.isFinite(time(r.frozenAt))&&Number.isFinite(time(p.frozenAt))&&time(r.frozenAt)<=time(p.frozenAt),'REGISTRY_PREREGISTRATION_REQUIRED');
  guard(anchor?.registryId===r.registryId&&anchor?.registryHash===registryHash&&anchor?.planHash===planHash,'INDEPENDENT_REGISTRY_ANCHOR_REQUIRED');
  guard(Array.isArray(r.entries)&&r.entries.length===4&&Array.isArray(p.tiers)&&p.tiers.length===4,'EXACT_REGISTRATION_REQUIRED');
  guard(new Set(r.entries.map(e=>e?.provider)).size===4,'UNIQUE_PROVIDER_REGISTRATION_REQUIRED');
  r.entries.forEach((e,i)=>{
   guard(e?.tier===TIERS[i]&&e.tier===p.tiers[i]?.tier&&text(e.provider)&&e.provider===p.tiers[i]?.provider&&text(e.sourceCandidate)&&e.sourceCandidate===p.tiers[i]?.sourceCandidate,'REGISTRATION_TIER_BINDING_INVALID');
   guard(text(e.sourceRef)&&text(e.readerId)&&e.allowedStage==='EARLY'&&e.preResultRequired===true&&e.identityRequired===true&&e.enabled===true,'PRE_RESULT_SOURCE_REGISTRATION_REQUIRED');
   guard(readers&&Object.hasOwn(readers,e.readerId)&&typeof readers[e.readerId]==='function','ALL_REGISTERED_READERS_REQUIRED');
  });
  const collectors=Object.create(null);frozen(r);frozen(p);
  for(const e of r.entries){
   const reader=readers[e.readerId];
   collectors[e.provider]=async({context,signal})=>{
    // Reject use by another executor plan before any external read.
    if(context?.planHash!==planHash||context.tier!==e.tier||context.provider!==e.provider||context.sourceCandidate!==e.sourceCandidate)return {result:'CONFLICT',reasonCode:'REGISTERED_CONTEXT_MISMATCH'};
    if(signal?.aborted)return {result:'CONFLICT',reasonCode:'REGISTERED_READ_ABORTED'};
    const response=await reader({context,signal,registration:e});
    // No substitution of an endpoint or fallback hidden behind a reader.
    if(!response||response.sourceRef!==e.sourceRef||!response.receipt)return {result:'CONFLICT',reasonCode:'REGISTERED_SOURCE_MISMATCH'};
    if(signal?.aborted)return {result:'CONFLICT',reasonCode:'REGISTERED_READ_ABORTED'};
    const receipt=JSON.parse(canonical(response.receipt));
    // FOUND availability/identity/value is subsequently validated by Phase90.
    return receipt;
   };
  }
  return frozen({status:'REGISTERED',registryId:r.registryId,registryHash,planHash,collectors,assessmentOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE',persisted:false});
 }catch(e){return frozen({status:'HOLD',reason:['NON_JSON','REGISTRY_TOO_LARGE','FORWARD_PLAN_REQUIRED','FROZEN_REGISTRY_REQUIRED','REGISTRY_PLAN_BINDING_INVALID','REGISTRY_PREREGISTRATION_REQUIRED','INDEPENDENT_REGISTRY_ANCHOR_REQUIRED','EXACT_REGISTRATION_REQUIRED','UNIQUE_PROVIDER_REGISTRATION_REQUIRED','REGISTRATION_TIER_BINDING_INVALID','PRE_RESULT_SOURCE_REGISTRATION_REQUIRED','ALL_REGISTERED_READERS_REQUIRED'].includes(e?.message)?e.message:'REGISTRATION_FAILED',collectors:null,formalKpiEligible:false,adopted:false,productionActivationReady:false,persisted:false,freezeMutation:'NONE'})}
}
