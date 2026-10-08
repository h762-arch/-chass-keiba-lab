import {freezeNarEarlySnapshot,verifyNarEarlySnapshot} from './nar-early-freeze.mjs';
import {readNarEarly} from './nar-early-store.mjs';
import {projectNarScenarioAbilityInput,evaluateNarScenarioPremarkResearch} from './nar-scenario-premark.mjs';
export const NAR_INITIAL_BUNDLE_SCHEMA='NAR-INITIAL-RESEARCH-BUNDLE-1';
const clone=v=>structuredClone(v);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
const reject=reason=>freeze({status:'REJECTED',reason,snapshot:null});
function canonical(v){if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';throw Error('NON_JSON')}
async function digest(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return [...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('')}
const keyFor=id=>typeof id==='string'&&/^\d{4}-\d{2}-\d{2}\|[^|]+\|[1-9]\d?$/.test(id)?'nar-initial-research:v1:'+id:null;
function recordFor(source){const d=source.data;return {race:d.race,predictionSnapshot:d.predictionSnapshot,marketSnapshot:d.marketSnapshot,finalSnapshot:d.finalSnapshot,snapshotIntegrity:d.sourceIntegrity}}
class MarketEligibilityError extends Error{}
function eligible(source){
 const horses=source.predictionSnapshot.horses,signal=source.marketSnapshot?.signalSnapshot;
 if(signal?.status!=='frozen'||!Array.isArray(signal.horses)||signal.horses.length!==horses.length)throw new MarketEligibilityError();
 const seen=new Set(),out=[];
 for(const h of signal.horses){if(!Number.isInteger(h.horseNo)||seen.has(h.horseNo)||!horses.some(x=>x.horseNo===h.horseNo)||!Number.isInteger(h.popularityAtFreeze)||h.popularityAtFreeze<1||h.popularityAtFreeze>horses.length||typeof h.oddsAtFreeze!=='number'||!Number.isFinite(h.oddsAtFreeze)||h.oddsAtFreeze<=0)throw new MarketEligibilityError();seen.add(h.horseNo);if(h.popularityAtFreeze>=6)out.push(h.horseNo)}
 return out.sort((a,b)=>a-b);
}
async function evaluate(record,receiptAt,at){
 const input=projectNarScenarioAbilityInput({raceId:`${record.race.raceDate}|${record.race.track}|${record.race.raceNo}`,acquiredAt:receiptAt,race:record.race,horses:record.predictionSnapshot.horses}),assessments=[];
 for(const horseNo of eligible(record)){const a=await evaluateNarScenarioPremarkResearch({input,horseNo,now:at});if(a.status==='REJECTED')throw Error('ASSESSMENT_INVALID');assessments.push(a)}
 return {input,assessments};
}
function bodyFor(source,acquiredAt,evaluatedAt,sealedAt,input,assessments){return {schemaVersion:NAR_INITIAL_BUNDLE_SCHEMA,kind:'initial_research',revision:1,mode:'shadow',researchOnly:true,adopted:false,formalKpiEligible:false,raceId:source.raceId,acquiredAt,evaluatedAt:new Date(evaluatedAt).toISOString(),sealedAt:new Date(sealedAt).toISOString(),sourceEarlySnapshot:source,abilityInput:input,assessments,candidateSignal:{status:'WITHHELD',reason:'ROUTE_AND_MARKET_POLICY_UNAPPROVED',horses:assessments.map(a=>({horseNo:a.horseNo,candidateMark:null}))}}}
export async function verifyNarInitialResearchBundle(snapshot,{raceId}={}){
 try{
  const saved=clone(snapshot),{contentSha256,...body}=saved;
  if(saved.schemaVersion!==NAR_INITIAL_BUNDLE_SCHEMA||saved.raceId!==raceId||contentSha256!==await digest(body))return reject('BUNDLE_CONTENT_OR_SCHEMA_INVALID');
  if((await verifyNarEarlySnapshot(saved.sourceEarlySnapshot,{raceId})).status!=='PRESERVED')return reject('BUNDLE_SOURCE_INVALID');
  const assessed=Date.parse(saved.evaluatedAt),sealed=Date.parse(saved.sealedAt),acquired=Date.parse(saved.acquiredAt);
  if(!Number.isFinite(assessed)||!Number.isFinite(sealed)||!Number.isFinite(acquired)||acquired>assessed||assessed>sealed||sealed-acquired>60000||saved.sourceEarlySnapshot.capturedAt!==saved.sealedAt)return reject('BUNDLE_TIME_INVALID');
  const record=recordFor(saved.sourceEarlySnapshot),source=await freezeNarEarlySnapshot({raceId,record,now:sealed,freshAcquisition:true});
  // Reconstruct saved-time semantics only; no acquisition, new storage or clock mutation.
  if(source.status!=='CREATED'||canonical(source.snapshot)!==canonical(saved.sourceEarlySnapshot))return reject('BUNDLE_SOURCE_CONTRACT_INVALID');
  const expected=await evaluate(record,saved.acquiredAt,assessed);
  if(canonical(bodyFor(source.snapshot,saved.acquiredAt,assessed,sealed,expected.input,expected.assessments))!==canonical(body))return reject('BUNDLE_SEMANTIC_MISMATCH');
  return freeze({status:'PRESERVED',reason:null,kind:'INITIAL_RESEARCH',snapshot:saved});
 }catch{return reject('BUNDLE_UNREADABLE')}
}
export async function readNarInitialResearchBundle({store,raceId}={}){
 const key=keyFor(raceId);if(!key||typeof store?.get!=='function')return reject('STORE_CONTRACT_INVALID');
 try{
  const legacy=await readNarEarly({store,raceId});if(!['MISSING','PRESERVED'].includes(legacy.status))return legacy;
  const raw=await store.get(key);
  if(legacy.status==='PRESERVED')return raw===null?freeze({...legacy,kind:'LEGACY_EARLY'}):reject('BOTH_INITIAL_NAMESPACES_PRESENT');
  if(raw===null)return freeze({status:'MISSING',reason:null,snapshot:null});
  if(typeof raw!=='string')return reject('BUNDLE_STORED_TYPE_INVALID');
  return await verifyNarInitialResearchBundle(JSON.parse(raw),{raceId});
 }catch{return reject('BUNDLE_STORE_READ_FAILED')}
}
export async function captureNarInitialResearchBundle({enabled=false,store,raceId,acquire,clock=Date.now}={}){
 if(enabled!==true)return freeze({status:'DISABLED',reason:null,snapshot:null});
 const key=keyFor(raceId);if(!key||typeof clock!=='function')return reject('CAPTURE_CONTRACT_INVALID');
 const existing=await readNarInitialResearchBundle({store,raceId});if(existing.status!=='MISSING')return existing;
 // Must atomically check BOTH namespaces. A plain insertIfAbsent is insufficient.
 if(typeof store.insertBundleIfBothAbsent!=='function'||typeof acquire!=='function')return reject('ATOMIC_CAPTURE_CONTRACT_REQUIRED');
 try{
  const started=clock();if(!Number.isFinite(started))return reject('CAPTURE_CLOCK_INVALID');
  const receipt=clone(await acquire({raceId})),evaluated=clock(),at=Date.parse(receipt?.acquiredAt);
  if(receipt?.acquisitionKind!=='fresh'||!Number.isFinite(at)||!Number.isFinite(evaluated)||at<started||at>evaluated||evaluated<started||evaluated-at>60000)return reject('CAPTURE_RECEIPT_INVALID');
  const record=receipt.record;if(record?.race?.narSourceAcquiredAt!==receipt.acquiredAt)return reject('SOURCE_RECEIPT_MISMATCH');
  const assessed=await evaluate(record,receipt.acquiredAt,evaluated),sealed=clock();
  if(!Number.isFinite(sealed)||sealed<evaluated||sealed-at>60000)return reject('FINAL_CAPTURE_WINDOW_INVALID');
  const source=await freezeNarEarlySnapshot({raceId,record,now:sealed,freshAcquisition:true});if(source.status!=='CREATED')return source;
  const body=bodyFor(source.snapshot,receipt.acquiredAt,evaluated,sealed,assessed.input,assessed.assessments),snapshot=freeze({...body,contentSha256:await digest(body)});
  const checked=await verifyNarInitialResearchBundle(snapshot,{raceId});if(checked.status!=='PRESERVED')return checked;
  // Check again after asynchronous hashing/verification, immediately before atomic storage.
  const committed=clock(),post=Date.parse(`${record.race.raceDate}T${record.race.postTime}:00+09:00`);
  if(!Number.isFinite(committed)||committed<sealed||committed-at>60000||committed>=post)return reject('COMMIT_WINDOW_INVALID');
  const inserted=await store.insertBundleIfBothAbsent('nar-early:v1:'+raceId,key,JSON.stringify(snapshot),{notAfter:post,acquiredAt:at,maxAgeMs:60000,notBefore:committed});
  if(typeof inserted!=='boolean')return reject('STORE_INSERT_CONTRACT_INVALID');
  const read=await readNarInitialResearchBundle({store,raceId});if(read.status==='MISSING')return reject('STORE_READBACK_MISSING');if(read.status!=='PRESERVED')return read;
  if(inserted&&(read.kind!=='INITIAL_RESEARCH'||read.snapshot.contentSha256!==snapshot.contentSha256))return reject('STORE_READBACK_MISMATCH');
  return freeze({...read,status:inserted?'CREATED':'PRESERVED'});
 }catch(error){return reject(error instanceof MarketEligibilityError?'MARKET_ELIGIBILITY_INVALID':'CAPTURE_FAILED')}
}
