import {readJraEarlyResearchSnapshot} from '../prediction/jra-early-research-reader.mjs';
import {compareJraEarlyToOfficialResult} from './jra-early-result-kpi.mjs';
import {auditFrozenSignalRules} from './signal-rule-audit.mjs';
import {isFrozenSignalRaceId} from './signal-rule-cohort-audit.mjs';
import {summarizeJraFrozenSignalOutcomes} from './jra-signal-outcome-summary.mjs';
const fail=(status,reason)=>Object.freeze({status,reason,summary:null,productionActivationReady:false});

// Caller supplies explicit saved records (e.g. backup extraction), never current/result market substitutions.
// Imported readers use SELECT only; memoize each bound query within this call, not between audit runs.
export async function readJraSignalOutcomeCohort({DB,entries,now=Date.now()}={}){
 if(typeof DB?.prepare!=='function')return fail('REJECTED','D1_UNAVAILABLE');
 if(!Number.isFinite(now))return fail('REJECTED','INVALID_READER_CLOCK');
 if(!Array.isArray(entries)||entries.length<1||entries.length>100||entries.some(e=>
  !isFrozenSignalRaceId(e?.raceId)||!e.raceId.includes('-JRA-')||Number(e.raceId.slice(-2))>12))
  return fail('REJECTED','INVALID_COHORT');
 if(new Set(entries.map(e=>e.raceId)).size!==entries.length)return fail('REJECTED','DUPLICATE_RACE_ID');
 if(entries.some(({raceId,record})=>(record?.raceId!=null&&record.raceId!==raceId)||
  (record?.marketSnapshot?.raceId!=null&&record.marketSnapshot.raceId!==raceId)))
  return fail('REJECTED','SIGNAL_RACE_IDENTITY_MISMATCH');
 let selected;
 try{selected=entries.map(e=>({raceId:e.raceId,signalSnapshot:structuredClone(e.record?.marketSnapshot?.signalSnapshot)}));}
 catch{return fail('REJECTED','SIGNAL_COPY_FAILED');}
 const cache=new Map(),readDb={prepare(sql){
  if(!/^SELECT\b/i.test(sql.trim()))throw Error('read-only query required');
  return {bind(...args){return {first(){
   const key=JSON.stringify([sql,args]);
   if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>DB.prepare(sql).bind(...args).first()));
   return cache.get(key);
  }}}};
 }};
 const pairs=[],readerExclusions=[];
 for(const item of selected.sort((a,b)=>a.raceId.localeCompare(b.raceId))){
  if(auditFrozenSignalRules(item.signalSnapshot).status!=='READY'){pairs.push(item);continue;}
  const early=await readJraEarlyResearchSnapshot({DB:readDb,raceId:item.raceId,now});
  if(early.reason==='D1_READ_FAILED')return fail('BLOCKED','EARLY_READ_FAILED');
  if(early.status!=='READY'){
   readerExclusions.push(Object.freeze({raceId:item.raceId,reason:`EARLY_${early.reason}`}));
   pairs.push({...item,early});continue;
  }
  const officialComparison=await compareJraEarlyToOfficialResult({DB:readDb,raceId:item.raceId,now});
  if(officialComparison.reason==='RESULT_READ_FAILED'||officialComparison.reason==='EARLY_D1_READ_FAILED')
   return fail('BLOCKED','OFFICIAL_READ_FAILED');
  if(officialComparison.status==='REJECTED')readerExclusions.push(Object.freeze({raceId:item.raceId,reason:officialComparison.reason}));
  pairs.push({...item,early,officialComparison});
 }
 const result=summarizeJraFrozenSignalOutcomes(pairs);
 return Object.freeze({...result,productionActivationReady:false,readQueryCount:cache.size,
  readerExclusions:Object.freeze(readerExclusions)});
}
