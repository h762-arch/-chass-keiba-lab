import {readNarInitialResearchBundle,verifyNarInitialResearchBundle} from './nar-initial-research-bundle.mjs';

const schema='NAR-COMMIT-OBSERVATION-RESEARCH-1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
const reject=reason=>freeze({status:'REJECTED',reason,formalKpiEligible:false,adopted:false});
function canonical(v){if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';throw Error('NON_JSON')}
async function digest(v){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')}
const keyFor=s=>`nar-commit-observation:v1:${s.raceId}:${s.contentSha256}`;
const validTime=n=>Number.isSafeInteger(n)&&n>=0;
function sample(clock){try{const n=clock();return validTime(n)?n:null}catch{return null}}
function observationFor(o){
 if(!o||!['RESOLVED','REJECTED','UNOBSERVED'].includes(o.outcome)||!['startedAt','returnedAt'].every(k=>o[k]===null||validTime(o[k])))throw Error('OBSERVATION_INVALID');
 const out={outcome:o.outcome,startedAt:o.startedAt,returnedAt:o.returnedAt};
 if(canonical(o)!==canonical(out))throw Error('OBSERVATION_FIELDS_INVALID');
 if(o.outcome==='UNOBSERVED'&&(o.startedAt!==null||o.returnedAt!==null))throw Error('UNOBSERVED_TIME_INVALID');
 return out;
}
function bodyFor(snapshot,observation){
 const race=snapshot.sourceEarlySnapshot.data.race;
 return {schemaVersion:schema,kind:'commit_observation',researchOnly:true,trustedDurableTime:false,raceId:snapshot.raceId,sourceBundleSha256:snapshot.contentSha256,acquiredAt:snapshot.acquiredAt,sealedAt:snapshot.sealedAt,postAt:Date.parse(`${race.raceDate}T${race.postTime}:00+09:00`),observation:observationFor(observation)};
}
function timingFor(receipt){
 const {observation:o,postAt}=receipt,acquired=Date.parse(receipt.acquiredAt),sealed=Date.parse(receipt.sealedAt);
 if(o.outcome!=='RESOLVED'||o.startedAt===null||o.returnedAt===null||o.startedAt<sealed||o.startedAt<acquired||o.returnedAt<o.startedAt)return 'UNKNOWN';
 return o.returnedAt-acquired<=60000&&o.returnedAt<postAt?'OBSERVED_WITHIN_WINDOW':'OBSERVED_OUTSIDE_WINDOW';
}

// One dedicated connection/capture at a time. Observations are caller-visible
// driver returns, not authenticated database durability timestamps.
export function observeNarSqlCommitResearch({db,clock=Date.now}={}){
 if(!db||!['exec','first','run'].every(k=>typeof db[k]==='function')||typeof clock!=='function')throw Error('COMMIT_OBSERVER_CONTRACT_INVALID');
 const events=[];
 return Object.freeze({
  db:Object.freeze({first:(...a)=>db.first(...a),run:(...a)=>db.run(...a),async exec(sql){
   if(sql!=='COMMIT')return db.exec(sql);
   const startedAt=sample(clock);
   try{const result=await db.exec(sql);events.push(freeze({outcome:'RESOLVED',startedAt,returnedAt:sample(clock)}));return result}
   catch(error){events.push(freeze({outcome:'REJECTED',startedAt,returnedAt:sample(clock)}));throw error}
  }}),
  observations:()=>freeze(structuredClone(events)),
 });
}

export async function verifyNarCommitObservationResearch({snapshot,receipt}={}){
 try{
  const source=structuredClone(snapshot),saved=structuredClone(receipt);
  if((await verifyNarInitialResearchBundle(source,{raceId:source?.raceId})).status!=='PRESERVED')return reject('OBSERVATION_SOURCE_INVALID');
  const {contentSha256,...body}=saved;
  if(canonical(body)!==canonical(bodyFor(source,saved.observation))||contentSha256!==await digest(body))return reject('OBSERVATION_CONTENT_INVALID');
  return freeze({status:'PRESERVED',reason:null,timing:timingFor(saved),receipt:saved,formalKpiEligible:false,adopted:false});
 }catch{return reject('OBSERVATION_UNREADABLE')}
}

// receiptStore.get(key) -> string|null; insertIfAbsent(key,json) -> boolean,
// atomically immutable across connections. No automatic schema or repair.
export async function saveNarCommitObservationResearch({enabled=false,snapshot,observation,receiptStore}={}){
 if(enabled!==true)return freeze({status:'DISABLED',formalKpiEligible:false,adopted:false});
 if(typeof receiptStore?.get!=='function'||typeof receiptStore.insertIfAbsent!=='function')return reject('OBSERVATION_STORE_CONTRACT_INVALID');
 try{
  const source=structuredClone(snapshot);
  if((await verifyNarInitialResearchBundle(source,{raceId:source?.raceId})).status!=='PRESERVED')return reject('OBSERVATION_SOURCE_INVALID');
  const key=keyFor(source),existing=await receiptStore.get(key);
  if(existing!==null)return typeof existing==='string'?await verifyNarCommitObservationResearch({snapshot:source,receipt:JSON.parse(existing)}):reject('OBSERVATION_STORED_TYPE_INVALID');
  const body=bodyFor(source,observation),receipt={...body,contentSha256:await digest(body)};
  const inserted=await receiptStore.insertIfAbsent(key,JSON.stringify(receipt));
  if(typeof inserted!=='boolean')return reject('OBSERVATION_INSERT_CONTRACT_INVALID');
  const raw=await receiptStore.get(key);
  if(typeof raw!=='string')return reject('OBSERVATION_READBACK_MISSING');
  const checked=await verifyNarCommitObservationResearch({snapshot:source,receipt:JSON.parse(raw)});
  if(checked.status!=='PRESERVED')return checked;
  if(inserted&&checked.receipt.contentSha256!==receipt.contentSha256)return reject('OBSERVATION_READBACK_MISMATCH');
  return freeze({...checked,status:inserted?'CREATED':'PRESERVED'});
 }catch{return reject('OBSERVATION_SAVE_FAILED')}
}

// SELECT-only research admission gate. Never promotes formal eligibility, even
// when application-observed timing is within window. Missing evidence stays HOLD.
export async function readNarInitialAdmissionResearch({store,receiptStore,raceId}={}){
 const source=await readNarInitialResearchBundle({store,raceId});
 if(source.status!=='PRESERVED')return freeze({...source,formalKpiEligible:false,adopted:false});
 const hold=(reason,timing='UNKNOWN',receipt=null)=>freeze({status:'HOLD',reason,timing,snapshot:source.snapshot,receipt,formalKpiEligible:false,adopted:false});
 if(source.kind!=='INITIAL_RESEARCH')return hold('LEGACY_TIMING_UNCONFIRMED');
 if(typeof receiptStore?.get!=='function')return hold('COMMIT_EVIDENCE_UNAVAILABLE');
 let raw;
 try{raw=await receiptStore.get(keyFor(source.snapshot))}catch{return hold('COMMIT_EVIDENCE_UNAVAILABLE')}
 try{
  if(raw===null)return hold('COMMIT_EVIDENCE_MISSING');
  if(typeof raw!=='string')return reject('OBSERVATION_STORED_TYPE_INVALID');
  const checked=await verifyNarCommitObservationResearch({snapshot:source.snapshot,receipt:JSON.parse(raw)});
  if(checked.status!=='PRESERVED')return checked;
  const reason=checked.timing==='OBSERVED_OUTSIDE_WINDOW'?'COMMIT_OBSERVED_LATE':checked.timing==='UNKNOWN'?'COMMIT_TIMING_UNCONFIRMED':'DURABLE_TIME_AND_FORMAL_POLICY_UNVERIFIED';
  return hold(reason,checked.timing,checked.receipt);
 }catch{return reject('OBSERVATION_UNREADABLE')}
}
