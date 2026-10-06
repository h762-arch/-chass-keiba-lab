import {readNarEarly,saveNarEarly} from './nar-early-store.mjs';
import {NAR_EARLY_MAX_CAPTURE_AGE_MS} from './nar-early-freeze.mjs';

const reject=reason=>Object.freeze({status:'REJECTED',reason,snapshot:null});
// Research-only orchestration; no built-in fetch, app wiring or production flags.
// acquire({raceId}) must return {record,acquiredAt,acquisitionKind:'fresh'}.
// This receipt is a caller assertion, not authenticated proof of official data.
export async function captureNarEarlyResearch({enabled=false,store,raceId,acquire,clock=Date.now}={}){
 if(enabled!==true)return Object.freeze({status:'DISABLED',reason:null,snapshot:null});
 try{
  if(typeof clock!=='function'||typeof store?.get!=='function'||typeof store?.insertIfAbsent!=='function')return reject('CAPTURE_CONTRACT_INVALID');
  const started=clock();if(!Number.isFinite(started))return reject('CAPTURE_CLOCK_INVALID');
  const existing=await readNarEarly({store,raceId});
  // Neither missing acquisition hooks nor expired clocks invalidate stored EARLY.
  if(existing.status!=='MISSING')return existing;
  if(typeof acquire!=='function')return reject('CAPTURE_ACQUISITION_REQUIRED');
  let receipt;
  try{receipt=await acquire(Object.freeze({raceId}));}catch{return reject('CAPTURE_ACQUISITION_FAILED')}
  const finished=clock(),at=typeof receipt?.acquiredAt==='string'?Date.parse(receipt.acquiredAt):NaN;
  if(!Number.isFinite(finished)||finished<started)return reject('CAPTURE_CLOCK_INVALID');
  if(receipt?.acquisitionKind!=='fresh'||!Number.isFinite(at)||at<started||at>finished||finished-at>NAR_EARLY_MAX_CAPTURE_AGE_MS)return reject('CAPTURE_RECEIPT_INVALID');
  // Source timestamps, identities, original seals and pre-post gates remain
  // enforced by freeze/save. Never manufacture or repair these source fields.
  return await saveNarEarly({store,raceId,record:receipt.record,now:finished,freshAcquisition:true});
 }catch{return reject('CAPTURE_FAILED')}
}
