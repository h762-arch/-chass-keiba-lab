import { stableHash } from '../prediction/precomputed-snapshot.mjs';
import { auditSignalEvidenceLedger } from './signal-evidence-ledger-audit.mjs';

const text=v=>typeof v==='string'&&v.trim().length>0;
const stamp=v=>text(v)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const keys=['runId','raceId','freezeId','sourceSnapshotId'];
const scoped=(a,b)=>keys.every(k=>a?.[k]===b?.[k]);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

function jsonShape(value){
 if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('invalid_root');
 let nodes=0;const ancestors=new Set();
 const walk=(v,depth)=>{
  if(++nodes>100000||depth>32)throw new Error('json_limit');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v))return;
  if(!v||typeof v!=='object'||ancestors.has(v)||
   (!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype))throw new Error('invalid_json');
  const own=Reflect.ownKeys(v);
  if(own.some(k=>typeof k!=='string')||Array.isArray(v)&&
   (own.length!==v.length+1||Array.from({length:v.length},(_,i)=>String(i)).some(k=>!Object.hasOwn(v,k))))
   throw new Error('invalid_keys');
  for(const k of own){if(Array.isArray(v)&&k==='length')continue;
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d.enumerable||!Object.hasOwn(d,'value'))throw new Error('invalid_property');
  }
  ancestors.add(v);for(const child of Object.values(v))walk(child,depth+1);ancestors.delete(v);
 };
 walk(value,0);
}

// Checks content binding to caller-supplied captured receipts. A matching hash
// is not independent authentication, source truth, or production permission.
export async function auditSignalSourceBindings(input,{cryptoImpl=globalThis.crypto}={}){
 const result=(status,reason,audit=null)=>freeze({status,reason,mode:'research',
  lineageStatus:status==='READY'?'CONTENT_BOUND':'NOT_VERIFIED',authenticity:'NOT_VERIFIED',
  adopted:false,formalKpiEligible:false,productionActivationReady:false,audit});
 let bundle;
 try{jsonShape(input);bundle=structuredClone(input);}catch{return result('REJECTED','INVALID_CAPTURED_JSON');}
 const {manifest,scope,snapshot,evidence,survivalReviews,sources}=bundle;
 if(!keys.every(k=>text(scope?.[k])))return result('REJECTED','SCOPE_REQUIRED');
 if(!manifest||manifest.schemaVersion!==1||!scoped(manifest,scope)||
  manifest.immutableStatus!=='FROZEN'||!stamp(manifest.frozenAt)||!stamp(manifest.offAt)||
  manifest.frozenAt!==snapshot?.frozenAt||Date.parse(manifest.frozenAt)>=Date.parse(manifest.offAt))
  return result('REJECTED','INVALID_BINDING_MANIFEST');
 if(!Array.isArray(evidence)||!Array.isArray(survivalReviews)||!Array.isArray(sources))
  return result('UNVERIFIED','CAPTURED_LEDGER_UNAVAILABLE');
 if(evidence.length>8000||sources.length>8000||survivalReviews.length>99)
  return result('REJECTED','INPUT_LIMIT');
 for(const [field,value] of [['snapshotHash',snapshot],['evidenceHash',evidence],
  ['survivalReviewsHash',survivalReviews],['sourcesHash',sources]]){
  if(!hash(manifest[field]))return result('REJECTED','MANIFEST_HASH_REQUIRED');
  let actual;try{actual=await stableHash(value,{cryptoImpl});}catch{return result('REJECTED','HASH_UNAVAILABLE');}
  if(actual!==manifest[field])return result('REJECTED','MANIFEST_CONTENT_MISMATCH');
 }
 const base=auditSignalEvidenceLedger({scope,snapshot,evidence,survivalReviews});
 if(base.status!=='READY')return result(base.status,base.reason,base);
 const horseNos=new Set(snapshot.horses.map(h=>h.horseNo)),registry=new Map(),origins=new Map();
 for(const source of sources){
  if(!scoped(source,scope)||!horseNos.has(source?.horseNo)||!text(source.sourceRef)||
   registry.has(source.sourceRef)||!text(source.originId)||!text(source.independenceGroup)||
   !text(source.family)||source.stage!=='EARLY'||!stamp(source.capturedAt)||!stamp(source.dataAsOf)||
   Date.parse(source.dataAsOf)>Date.parse(source.capturedAt)||
   Date.parse(source.capturedAt)>Date.parse(manifest.frozenAt)||!hash(source.payloadHash)||
   source.payload===undefined)return result('REJECTED','INVALID_SOURCE_RECEIPT');
  let actual;try{actual=await stableHash(source.payload,{cryptoImpl});}catch{return result('REJECTED','HASH_UNAVAILABLE');}
  if(actual!==source.payloadHash)return result('REJECTED','SOURCE_PAYLOAD_MISMATCH');
  // Multiple derived measurements from one horse's source episode must retain
  // the registry's single independence group, regardless of evidence codes.
  const originKey=JSON.stringify([source.horseNo,source.originId]);
  if(origins.has(originKey)&&origins.get(originKey)!==source.independenceGroup)
   return result('REJECTED','SOURCE_ORIGIN_GROUP_CONFLICT');
  origins.set(originKey,source.independenceGroup);registry.set(source.sourceRef,source);
 }
 for(const e of evidence){
  // Declared missing/ineligible/unknown rows remain visible to Phase110 but
  // cannot provide known evidence, so an absent payload is not fabricated.
  if(e.eligibility!=='ELIGIBLE'||e.resolution!=='RESOLVED'||e.direction==='UNKNOWN'||e.conflict)continue;
  const source=registry.get(e.sourceRef);
  if(!source)return result('UNVERIFIED','EVIDENCE_SOURCE_UNAVAILABLE',base);
  if(source.horseNo!==e.horseNo||source.family!==e.family||
   source.independenceGroup!==e.independenceGroup||Date.parse(source.capturedAt)>Date.parse(e.capturedAt))
   return result('REJECTED','EVIDENCE_SOURCE_BINDING_MISMATCH');
 }
 return result('READY',null,base);
}
