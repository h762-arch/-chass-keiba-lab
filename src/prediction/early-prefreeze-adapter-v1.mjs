import {createHash} from 'node:crypto';
import {assessEarlyPrefreezeGate} from './early-prefreeze-gate-v1.mjs';

export const VERSION='CHASS_EARLY_PREFREEZE_ADAPTER_V1';
const LIMIT=100000;
const required=['G01','G02','G03','G04','G07'];
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=512&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
function parse(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>LIMIT)throw Error();
 const x=JSON.parse(raw);
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error();
 return x;
}
function result(stage,status,reasons,extra={}){
 return {version:VERSION,stage,status,reasons,...extra,
  researchOnly:true,formalReadiness:'HOLD',formalKpiEligible:false,
  persistenceVerified:false,acquisitionCertified:false,earlyFreezeVerified:false,
  earlyImmutable:null,externalAnchorAuthenticated:false,
  probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
}

// freezeAt is the declared planned cutoff here. No future receipt is fabricated.
// This checks declarations only; it does not authorize a production save.
export function assessEarlyBeforeSaveV1(declarationsJson){
 try{
  const gate=assessEarlyPrefreezeGate(parse(declarationsJson));
  if(gate.inputStatus==='INVALID_INPUT')return result('BEFORE_SAVE','HOLD',['INVALID_DECLARATIONS']);
  const reasons=required.filter(k=>gate.gate[k].status!=='PASS').map(k=>gate.gate[k].reason);
  return result('BEFORE_SAVE',reasons.length?'HOLD':'DECLARATIONS_READY',reasons,{
   assessmentBasis:'CALLER_DECLARATIONS_ONLY',
   temporalVerification:'DECLARED_RELATIVE_ORDER_ONLY',
   deferredGates:['G05','G06','G09','G10'],
   formalBlocker:'FORMAL_INTEGRATION_NOT_VERIFIED'});
 }catch{return result('BEFORE_SAVE','HOLD',['INVALID_DECLARATIONS']);}
}

// An OFFLINE evidence envelope, not a D1 row or a store receipt. savedJson and
// readbackJson must be independently supplied exact UTF-8 JSON text. This module
// does not read a store and cannot establish the origin of either text or anchor.
export function assessEarlyAfterSaveV1(savedJson,readbackJson,anchorJson){
 try{
  const saved=parse(savedJson),readback=parse(readbackJson),anchor=parse(anchorJson);
  const digest=hash(savedJson);
  if(savedJson!==readbackJson)return result('AFTER_SAVE','HOLD',['READBACK_BYTES_MISMATCH']);
  if(anchor.schemaVersion!=='CHASS_EARLY_OFFLINE_ANCHOR_V1'||!sha(anchor.artifactSha256)||anchor.artifactSha256!==digest)
   return result('AFTER_SAVE','HOLD',['ARTIFACT_ANCHOR_MISMATCH']);
  if(saved.schemaVersion!=='CHASS_EARLY_OFFLINE_EVIDENCE_V1'||!text(saved.raceId)||!text(saved.snapshotId)||!text(saved.freezeId)||!sha(saved.signalHash)||!Number.isSafeInteger(saved.revision)||saved.revision<1)
   return result('AFTER_SAVE','HOLD',['INVALID_ARTIFACT_BINDING']);
  for(const key of ['raceId','snapshotId','revision','freezeId','signalHash'])
   if(saved[key]!==anchor[key]||readback[key]!==saved[key])return result('AFTER_SAVE','HOLD',['ARTIFACT_BINDING_MISMATCH']);
  const d=saved.declarations,gate=assessEarlyPrefreezeGate(d);
  if(gate.inputStatus==='INVALID_INPUT'||gate.candidateReadiness!=='PASS')
   return result('AFTER_SAVE','HOLD',['POST_SAVE_DECLARATIONS_INCOMPLETE']);
  if(d.raceId!==saved.raceId||d.snapshot.id!==saved.snapshotId||d.early.freezeId!==saved.freezeId||d.early.signalHash!==saved.signalHash)
   return result('AFTER_SAVE','HOLD',['DECLARATION_BINDING_MISMATCH']);
  return result('AFTER_SAVE','LOCAL_BYTES_MATCH',[],{
   assessmentBasis:'SUPPLIED_UTF8_BYTES_AND_UNAUTHENTICATED_ANCHOR',
   temporalVerification:'DECLARED_RELATIVE_ORDER_ONLY',
   localByteComparisonVerified:true,artifactSha256:digest,revision:saved.revision,
   formalBlocker:'INDEPENDENT_STORE_AND_FREEZE_AUTHENTICATION_REQUIRED'});
 }catch{return result('AFTER_SAVE','HOLD',['INVALID_EVIDENCE_INPUT']);}
}
