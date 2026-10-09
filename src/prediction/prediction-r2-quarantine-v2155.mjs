// Isolated R2 binding integration. No default bucket, route, retry or adoption.
import {createHash} from 'node:crypto';
import {canonicalPredictionAcquisitionEvidenceV2155 as canonical,verifyPredictionAcquisitionEvidenceV2155 as verify} from './prediction-acquisition-evidence-verifier-v2155.mjs';
const VERSION='CHASS_R2_ACQUISITION_QUARANTINE_V2155_V1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const guard=(ok,r)=>{if(!ok)throw Error(r)};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const failure=(reason,writeState='NOT_ATTEMPTED')=>({status:'HOLD',reason,writeState,persisted:writeState==='OUTCOME_UNKNOWN'?null:false,remoteReadbackVerified:false,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
function bounded(promise,ms){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('R2_OPERATION_TIMEOUT')),ms)})]).finally(()=>clearTimeout(timer));
}
export function createPredictionR2QuarantineV2155({environment,storeId,bucket,operationTimeoutMs}={}){
 try{
  guard(environment==='QUARANTINE'&&typeof storeId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(storeId),'ISOLATED_R2_STORE_REQUIRED');
  guard(bucket&&typeof bucket.get==='function'&&typeof bucket.put==='function'&&Number.isInteger(operationTimeoutMs)&&operationTimeoutMs>=1&&operationTimeoutMs<=30000,'R2_BINDING_REQUIRED');
  // Identity/isolation of this actual binding must be established externally.
  const prefix='quarantine/'+storeId+'/',get=bucket.get.bind(bucket),put=bucket.put.bind(bucket),ms=operationTimeoutMs;
  const keyFor=id=>prefix+hash(id)+'/evidence.json';
  async function reconnect({receipt}={}){
   let reader;
   try{
    const expires=Date.now()+ms,step=fn=>{const left=expires-Date.now();guard(left>0,'R2_OPERATION_TIMEOUT');return bounded(fn(),left)};
    const r=JSON.parse(canonical(receipt)),a=r.acquisitionAnchor;
    guard(r.schemaVersion===VERSION&&r.environment==='QUARANTINE'&&r.storeId===storeId&&typeof a?.planId==='string'&&r.key===keyFor(a.planId)&&r.payloadHash===a.payloadHash&&hex(r.payloadHash)&&Number.isInteger(r.byteLength)&&r.byteLength>=1&&r.byteLength<=300000,'REMOTE_RECEIPT_INVALID');
    const object=await step(()=>get(r.key));
    guard(object&&object.key===r.key&&object.size===r.byteLength&&object.body&&typeof object.body.getReader==='function','REMOTE_OBJECT_MISSING_OR_INVALID');
    reader=object.body.getReader();const chunks=[];let count=0;
    for(;;){const {done,value}=await step(()=>reader.read());if(done)break;guard(value instanceof Uint8Array,'REMOTE_BODY_INVALID');count+=value.byteLength;guard(count<=r.byteLength,'REMOTE_SIZE_MISMATCH');chunks.push(Buffer.from(value))}
    guard(count===r.byteLength,'REMOTE_SIZE_MISMATCH');const raw=Buffer.concat(chunks);guard(hash(raw)===r.payloadHash,'REMOTE_BYTE_HASH_MISMATCH');
    const checked=verify({payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),anchor:a,registered:true});
    guard(checked.readbackVerified,'REMOTE_EVIDENCE_INVALID');
    return {status:'REMOTE_READBACK_VERIFIED',writeState:'READ_ONLY',persisted:true,remoteReadbackVerified:true,payload:checked.payload,receipt:r,assessmentOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'};
   }catch(e){return failure(['REMOTE_RECEIPT_INVALID','REMOTE_OBJECT_MISSING_OR_INVALID','REMOTE_BODY_INVALID','REMOTE_SIZE_MISMATCH','REMOTE_BYTE_HASH_MISMATCH','REMOTE_EVIDENCE_INVALID','R2_OPERATION_TIMEOUT'].includes(e?.message)?e.message:'REMOTE_READBACK_FAILED')}
   finally{try{if(reader){Promise.resolve(reader.cancel()).catch(()=>{});reader.releaseLock()}}catch{}}
  }
  async function persist({payload,anchor}={}){
   let attempted=false,acknowledged=false,recoveryReceipt;
   try{
    const checked=verify({payload,anchor,registered:true});guard(checked.readbackVerified,'VERIFIED_REGISTERED_EVIDENCE_REQUIRED');
    const raw=Buffer.from(canonical(checked.payload)),key=keyFor(checked.anchor.planId);
    const receipt={schemaVersion:VERSION,environment:'QUARANTINE',storeId,key,payloadHash:checked.anchor.payloadHash,byteLength:raw.byteLength,acquisitionAnchor:checked.anchor};
    recoveryReceipt=receipt;
    // RFC conditional create, delegated atomically to the trusted R2 service.
    // Do not implement an unsafe get-then-unconditional-put sequence.
    attempted=true;
    const written=await bounded(put(key,raw,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:hash(raw),httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}}),ms);
    acknowledged=true;
    guard(written===null||(written&&written.key===key),'R2_WRITE_ACK_INVALID');
    const readback=await reconnect({receipt});
    if(!readback.remoteReadbackVerified)return {...failure(written===null?'IMMUTABLE_REMOTE_CONFLICT':'REMOTE_WRITE_READBACK_FAILED',written===null?'CONDITION_NOT_MET':'ACKNOWLEDGED_UNVERIFIED'),persisted:written===null?false:null,receipt};
    return {...readback,writeState:written===null?'EXISTING_IDENTICAL':'CREATED'};
   }catch(e){return {...failure(e?.message==='VERIFIED_REGISTERED_EVIDENCE_REQUIRED'?e.message:acknowledged?'R2_WRITE_ACK_INVALID':'R2_WRITE_OUTCOME_UNKNOWN',attempted?'OUTCOME_UNKNOWN':'NOT_ATTEMPTED'),...(attempted?{receipt:recoveryReceipt}: {})}}
  }
  return Object.freeze({status:'R2_STORE_READY',persist,reconnect,formalKpiEligible:false,adopted:false,productionActivationReady:false});
 }catch(e){return failure(['ISOLATED_R2_STORE_REQUIRED','R2_BINDING_REQUIRED'].includes(e?.message)?e.message:'R2_STORE_SETUP_FAILED')}
}
