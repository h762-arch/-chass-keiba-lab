// Node-only isolated acquisition evidence store. Never use a production data root.
import {mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {verifyPredictionAcquisitionEvidenceV2155} from './prediction-acquisition-evidence-verifier-v2155.mjs';
import {executeBoundedPredictionAcquisitionV2155} from './prediction-bounded-acquisition-v2155.mjs';
const VERSION='CHASS_ACQUISITION_QUARANTINE_V2155_V1';
function canonical(v){
  if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  throw Error('NON_JSON');
}
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const immutable=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(immutable);Object.freeze(v)}return v};
const guard=(v,reason)=>{if(!v)throw Error(reason)};
const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(v);
const location=(root,id)=>{guard(typeof root==='string'&&root.length>0&&safeId(id),'STORE_LOCATION_INVALID');return join(resolve(root),createHash('sha256').update(id).digest('hex'))};
const failure=reason=>immutable({status:'HOLD',reason,persisted:false,readbackVerified:false,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
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
export async function readPredictionAcquisitionQuarantineV2155({root,anchor}={}){
  try{
    const dir=location(root,anchor?.planId),bytes=await readFile(join(dir,'evidence.json'),'utf8');
    guard(Buffer.byteLength(bytes)<=300000,'STORE_TOO_LARGE');
    const verified=verifyPredictionAcquisitionEvidenceV2155({payload:JSON.parse(bytes),anchor});
    if(!verified.readbackVerified)return verified;
    const payload=verified.payload;
    return immutable({status:'READBACK_VERIFIED',persisted:true,readbackVerified:true,payload,anchor:structuredClone(anchor),assessmentOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
  }catch(e){return failure(['STORE_LOCATION_INVALID','STORE_SCHEMA_INVALID','PLAN_HASH_MISMATCH','STORE_IDENTITY_MISMATCH','STORE_PROMOTION_FORBIDDEN','STORE_ATTEMPTS_INVALID','READBACK_ANCHOR_MISMATCH','STORE_TOO_LARGE'].includes(e?.message)?e.message:'READBACK_FAILED')}
}
export async function executeAndQuarantinePredictionAcquisitionV2155({root,environment,plan,collectors,clock,supportingEvidence}={}){
  let temp;
  try{
    guard(environment==='QUARANTINE','QUARANTINE_REQUIRED');
    const target=location(root,plan?.planId);
    // Detach caller's plan before awaiting providers; later mutations cannot
    // change the evidence saved for the plan actually executed.
    const copied=JSON.parse(canonical(plan));
    const result=await executeBoundedPredictionAcquisitionV2155({plan:copied,collectors,clock});
    guard(result.planHash===hash(copied)&&result.runId===copied.runId&&result.raceId===copied.raceId,'EXECUTED_PLAN_REQUIRED');
    const payload={schemaVersion:VERSION,environment:'QUARANTINE',plan:copied,result};
    // Optional caller-owned evidence is copied after execution and published in
    // the same atomic document. This store does not authenticate its semantics.
    if(supportingEvidence!==undefined)payload.supportingEvidence=JSON.parse(canonical(supportingEvidence));
    const anchor={schemaVersion:VERSION,environment:'QUARANTINE',planId:copied.planId,runId:copied.runId,raceId:copied.raceId,planHash:result.planHash,payloadHash:hash(payload)};
    validate(payload,anchor);const bytes=canonical(payload);guard(Buffer.byteLength(bytes)<=300000,'STORE_TOO_LARGE');
    await mkdir(resolve(root),{recursive:true,mode:0o700});
    temp=join(resolve(root),'.pending-'+randomUUID());await mkdir(temp,{mode:0o700});
    await writeFile(join(temp,'evidence.json'),bytes,{flag:'wx',mode:0o600});
    // A non-empty destination cannot be replaced by directory rename. All
    // plan/attempt/field-state evidence is published as one directory entry.
    try{await rename(temp,target);temp=null}catch(e){
      if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;
      const existing=await readPredictionAcquisitionQuarantineV2155({root,anchor});
      guard(existing.readbackVerified,'IMMUTABLE_STORE_CONFLICT');
    }
    const readback=await readPredictionAcquisitionQuarantineV2155({root,anchor});
    guard(readback.readbackVerified,'WRITE_READBACK_FAILED');
    return readback;
  }catch(e){return failure(['QUARANTINE_REQUIRED','STORE_LOCATION_INVALID','NON_JSON','EXECUTED_PLAN_REQUIRED','IMMUTABLE_STORE_CONFLICT','STORE_TOO_LARGE','WRITE_READBACK_FAILED'].includes(e?.message)?e.message:'QUARANTINE_WRITE_FAILED')}
  finally{if(temp)await rm(temp,{recursive:true,force:true}).catch(()=>{})}
}
