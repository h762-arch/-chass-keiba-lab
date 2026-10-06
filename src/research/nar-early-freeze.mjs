// Isolated research contract: no app/Worker wiring, storage, fetch or KPI promotion.
export const NAR_EARLY_SCHEMA='CHASS-NAR-EARLY-1';
export const NAR_EARLY_MAX_CAPTURE_AGE_MS=60_000;
const reject=reason=>Object.freeze({status:'REJECTED',reason,snapshot:null});
const clone=value=>JSON.parse(JSON.stringify(value));
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw Error('non_json_value');
}
function deepFreeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value)}return value}
function fingerprint(value){let h=2166136261;const text=canonical(value);for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return 'fnv1a32:'+(h>>>0).toString(16).padStart(8,'0')}
async function digest(value){const bytes=new TextEncoder().encode(canonical(value)),hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')}
function identity(race){return `${race?.raceDate||''}|${race?.track||''}|${Number(race?.raceNo)}`}
const historical=r=>!!(r?.historicalResearch||r?.race?.historicalResearch||r?.predictionSnapshot?.historicalResearch||r?.predictionSnapshot?.backgroundCollector||r?.race?.researchMode==='historical_research'||r?.predictionSnapshot?.race?.researchMode==='historical_research'||r?.race?.predictionKind==='backtest_prediction'||r?.predictionSnapshot?.predictionKind==='backtest_prediction');
function postTime(race){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(race?.raceDate||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(race?.postTime||''))return NaN;
 const at=Date.parse(race.raceDate+'T'+race.postTime+':00+09:00');
 return Number.isFinite(at)&&new Date(at+9*3600_000).toISOString().slice(0,10)===race.raceDate?at:NaN;
}
export async function verifyNarEarlySnapshot(snapshot,{raceId}={}){
 try{
  if(!snapshot||snapshot.schemaVersion!==NAR_EARLY_SCHEMA||snapshot.phase!=='EARLY'||snapshot.organization!=='NAR'||snapshot.revision!==1||snapshot.raceId!==raceId||identity(snapshot.data?.race)!==raceId)return reject('EARLY_IDENTITY_OR_SCHEMA_INVALID');
  const {contentSha256,...body}=snapshot;
  if(typeof contentSha256!=='string'||await digest(body)!==contentSha256)return reject('EARLY_CONTENT_MISMATCH');
  return Object.freeze({status:'PRESERVED',reason:null,snapshot:deepFreeze(clone(snapshot))});
 }catch{return reject('EARLY_UNREADABLE')}
}
export async function freezeNarEarlySnapshot({raceId,record,existing=null,now=Date.now(),freshAcquisition=false}={}){
 // Always select the first stored version; never fall forward after rejection.
 if(existing!==null)return verifyNarEarlySnapshot(existing,{raceId});
 if(!Number.isFinite(now))return reject('INVALID_CLOCK');
 if(freshAcquisition!==true)return reject('FRESH_ACQUISITION_REQUIRED');
 if(historical(record))return reject('HISTORICAL_REFERENCE_ONLY');
 if(record?.result||record?.resultSnapshot||record?.validationCompleted||record?.validated)return reject('RESULT_ALREADY_PRESENT');
 const race=record?.race,prediction=record?.predictionSnapshot,market=record?.marketSnapshot,final=record?.finalSnapshot,seal=record?.snapshotIntegrity;
 if(!(race?.raceType==='NAR'||race?.category==='地方競馬')||race?.raceType==='JRA'||identity(race)!==raceId||identity(prediction?.race)!==raceId)return reject('NAR_IDENTITY_REQUIRED');
 if(typeof race.track!=='string'||!race.track.trim()||!Number.isInteger(Number(race.raceNo))||Number(race.raceNo)<1||Number(race.raceNo)>99)return reject('NAR_IDENTITY_REQUIRED');
 const postAt=postTime(race);if(!Number.isFinite(postAt))return reject('POST_TIME_UNVERIFIED');
 if(now>=postAt)return reject('NOT_PRE_POST');
 if(!Array.isArray(prediction.horses)||prediction.horses.length<2||!Array.isArray(market?.horses)||!Array.isArray(final?.top3))return reject('SNAPSHOT_INCOMPLETE');
 const numbers=prediction.horses.map(h=>Number(h.horseNo));
 if(numbers.some(n=>!Number.isInteger(n)||n<1||n>99)||new Set(numbers).size!==numbers.length||!final.top3.length||final.top3.some(h=>!numbers.includes(Number(h.horseNo)))||market.horses.some(h=>!numbers.includes(Number(h.horseNo))))return reject('RUNNER_IDENTITY_INVALID');
 const keys=['predictionSnapshot','marketSnapshot','finalSnapshot'];
 if(seal?.algorithm!=='FNV-1a-32/canonical-json'||!seal.hashes||keys.some(k=>typeof seal.hashes[k]!=='string'))return reject('SOURCE_SEAL_REQUIRED');
 try{
  if(keys.some(k=>fingerprint(record[k])!==seal.hashes[k]))return reject('SOURCE_SNAPSHOT_MISMATCH');
  const times=[prediction.createdAt,prediction.generatedAt,seal.sealedAt].map(Date.parse);
  if(times.some(t=>!Number.isFinite(t)||t>now||t>=postAt||now-t>NAR_EARLY_MAX_CAPTURE_AGE_MS)||times[2]<Math.max(times[0],times[1]))return reject('INITIAL_CAPTURE_WINDOW_INVALID');
  if([market.createdAt,market.acquiredAt,final.createdAt,final.generatedAt].filter(v=>v!=null).map(Date.parse).some(t=>!Number.isFinite(t)||t>now||t>=postAt))return reject('SOURCE_LAYER_TIME_INVALID');
  const body={schemaVersion:NAR_EARLY_SCHEMA,organization:'NAR',phase:'EARLY',revision:1,raceId,capturedAt:new Date(now).toISOString(),sourceSealedAt:seal.sealedAt,researchOnly:true,formalKpiEligible:false,events:[{revision:1,event:'EARLY_FROZEN',at:new Date(now).toISOString()}],data:clone({race,predictionSnapshot:prediction,marketSnapshot:market,finalSnapshot:final,sourceIntegrity:seal})};
  return Object.freeze({status:'CREATED',reason:null,snapshot:deepFreeze({...body,contentSha256:await digest(body)})});
 }catch{return reject('SOURCE_UNREADABLE')}
}
