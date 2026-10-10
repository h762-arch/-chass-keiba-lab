import {raceJobKey} from './background-precompute.mjs';
import {validDate,JRA_TRACKS} from '../../jra-meeting-discovery.mjs';

const reasons=new Set(['ALREADY_FROZEN','DATA_MISSING','POST_TIME_UNKNOWN','POST_TIME_REACHED','DATA_IDENTITY']);
const finalReason=value=>value?.status==='FROZEN'?'FROZEN':value?.status==='PRESERVED'?'ALREADY_FROZEN':
 value?.reason==='MARKET_SAVE_CONFLICT'?'SAVE_CONFLICT':value?.reason==='NOT_PRE_RACE'?'POST_TIME_REACHED':
 value?.reason||'RUNNER_RESULT_INVALID';

// No DATA planner/cap is accepted by this API. One event is emitted for each
// discovery and terminal disposition; ATTEMPT_STARTED precedes any MARKET I/O.
export async function runJraMarketQueue({enabled=false,jobs,selectionTurn,runId,
 maxInspections,maxAttempts,deadline,now,inspect,runner,record}={}){
 if(enabled!==true)return Object.freeze({status:'DISABLED',attemptedCount:0,savedCount:0});
 if(!Array.isArray(jobs)||!Number.isSafeInteger(selectionTurn)||selectionTurn<0||
  typeof runId!=='string'||!runId.trim()||!Number.isSafeInteger(maxInspections)||maxInspections<1||
  !Number.isSafeInteger(maxAttempts)||maxAttempts<1||!Number.isFinite(deadline)||
  [now,inspect,runner,record].some(f=>typeof f!=='function'))throw Error('invalid_market_queue');
 const ids=new Set();
 for(const j of jobs){
  if(j?.organization!=='JRA'||!validDate(j.date)||!JRA_TRACKS.includes(j.track)||j.raceId!==raceJobKey(j)||ids.has(j.raceId))throw Error('invalid_market_queue_job');
  ids.add(j.raceId);
 }
 const offset=jobs.length?selectionTurn%jobs.length:0;
 const order=[...jobs.slice(offset),...jobs.slice(0,offset)];
 let previous=-Infinity,sequence=0,attemptedCount=0,savedCount=0,inspectedCount=0;
 const clock=()=>{const t=now();if(!Number.isFinite(t)||t<previous)throw Error('market_clock_reversed');previous=t;return t;};
 const started=clock(),events=[],eligible=[];
 const emit=async(job,rank,phase,reason,extra={})=>{
  const t=clock();
  const e=Object.freeze({schemaVersion:1,runId,eventNo:++sequence,raceId:job.raceId,
   targetDate:job.date,selectionTurn,queueRank:rank,phase,reason,recordedAt:new Date(t).toISOString(),
   attemptedAt:null,selected:false,saved:false,elapsedMs:t-started,...extra});
  await record(e);events.push(e);return e;
 };
 try{
  for(let i=0;i<order.length;i++)await emit(order[i],i+1,'DISCOVERED','DISCOVERED');
  for(let i=0;i<order.length;i++){
   const j=order[i],rank=i+1;
   if(clock()>=deadline){await emit(j,rank,'TERMINAL','NOT_SELECTED_DEADLINE');continue;}
   if(inspectedCount>=maxInspections){await emit(j,rank,'TERMINAL','NOT_SELECTED_INSPECTION_LIMIT');continue;}
   inspectedCount++;
   let state;
   try{state=await inspect(j);}
   catch{await emit(j,rank,'TERMINAL','INSPECTION_FAILED');continue;}
   if(state?.reason==='READY')eligible.push({job:j,rank});
   else await emit(j,rank,'TERMINAL',reasons.has(state?.reason)?state.reason:'INSPECTION_INVALID');
  }
  for(const {job,rank} of eligible){
   if(clock()>=deadline){await emit(job,rank,'TERMINAL','NOT_SELECTED_DEADLINE');continue;}
   if(attemptedCount>=maxAttempts){await emit(job,rank,'TERMINAL','NOT_SELECTED_LIMIT');continue;}
   const attemptedAt=new Date(clock()).toISOString();
   // If this insert fails, the runner is never invoked. If a later event fails,
   // the persisted STARTED record stays unresolved, never mislabeled unsaved.
   await emit(job,rank,'ATTEMPT_STARTED','ATTEMPT_STARTED',{attemptedAt,selected:true,saved:null});
   if(clock()>=deadline){await emit(job,rank,'TERMINAL','DEADLINE',{attemptedAt,selected:true});continue;}
   attemptedCount++;
   const attemptStart=clock();let value;
   try{value=await runner(job)}catch(error){value={status:'UNKNOWN',reason:'RUNNER_FAILED',saved:null};}
   if(value?.saved===true)savedCount++;
   await emit(job,rank,'TERMINAL',finalReason(value),{attemptedAt,selected:true,saved:value?.status==='UNKNOWN'||!['FROZEN','PRESERVED','HOLD'].includes(value?.status)?null:value?.saved===true,
    runnerStatus:value?.status||'UNKNOWN',runnerElapsedMs:clock()-attemptStart});
  }
  return Object.freeze({status:'COMPLETED',runId,discoveredCount:jobs.length,inspectedCount,attemptedCount,savedCount,
   elapsedMs:clock()-started,events:Object.freeze(events)});
 }catch(error){
  return Object.freeze({status:'INTERRUPTED',reason:error.message==='market_clock_reversed'?'CLOCK_INVALID':'AUDIT_WRITE_FAILED',
   runId,discoveredCount:jobs.length,inspectedCount,attemptedCount,savedCount,events:Object.freeze(events)});
 }
}
