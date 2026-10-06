import {freezeNarEarlySnapshot,verifyNarEarlySnapshot} from './nar-early-freeze.mjs';

// Isolated adapter. The injected store must provide atomic insert-if-absent;
// get(key) returns the original JSON string or null. No overwrite API is used.
const reject=reason=>Object.freeze({status:'REJECTED',reason,snapshot:null});
const keyFor=raceId=>typeof raceId==='string'&&/^\d{4}-\d{2}-\d{2}\|[^|]+\|[1-9]\d?$/.test(raceId)?'nar-early:v1:'+raceId:null;
function parse(raw){if(typeof raw!=='string')throw Error('invalid stored type');return JSON.parse(raw)}
export async function readNarEarly({store,raceId}={}){
 const key=keyFor(raceId);
 if(!key||typeof store?.get!=='function')return reject('STORE_CONTRACT_INVALID');
 try{
  const raw=await store.get(key);
  if(raw===null)return Object.freeze({status:'MISSING',reason:null,snapshot:null});
  return await verifyNarEarlySnapshot(parse(raw),{raceId});
 }catch{return reject('STORE_READ_FAILED')}
}
export async function saveNarEarly({store,raceId,record,now=Date.now(),freshAcquisition=false}={}){
 const key=keyFor(raceId);
 if(!key||typeof store?.get!=='function'||typeof store?.insertIfAbsent!=='function')return reject('STORE_CONTRACT_INVALID');
 const current=await readNarEarly({store,raceId});
 if(current.status!=='MISSING')return current;
 const candidate=await freezeNarEarlySnapshot({raceId,record,now,freshAcquisition});
 if(candidate.status!=='CREATED')return candidate;
 try{
  const inserted=await store.insertIfAbsent(key,JSON.stringify(candidate.snapshot));
  if(typeof inserted!=='boolean')return reject('STORE_INSERT_CONTRACT_INVALID');
  const saved=await readNarEarly({store,raceId});
  if(saved.status==='MISSING')return reject('STORE_READBACK_MISSING');
  if(saved.status!=='PRESERVED')return saved;
  if(inserted&&saved.snapshot.contentSha256!==candidate.snapshot.contentSha256)return reject('STORE_READBACK_MISMATCH');
  return Object.freeze({status:inserted?'CREATED':'PRESERVED',reason:null,snapshot:saved.snapshot});
 }catch{return reject('STORE_WRITE_FAILED')}
}
