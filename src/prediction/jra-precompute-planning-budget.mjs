import {raceJobKey} from './background-precompute.mjs';

function validJob(job){
 try{return job?.organization==='JRA'&&typeof job.date==='string'&&
  /^\d{4}-\d{2}-\d{2}$/.test(job.date)&&typeof job.track==='string'&&
  Number.isInteger(job.raceNo)&&job.raceNo>=1&&job.raceNo<=12&&
  job.raceId===raceJobKey(job);}catch{return false;}
}

// Read-only, isolated planning guard. Inputs are already discovered race jobs.
// Every complete inspection carries the original SOURCE and latest snapshot,
// so a later selector can reuse them without reading either store again.
export async function scanJraPrecomputePlanningJobs({
 jobs,maxPlanningJobs,planningDeadline,now,loadFreshSource,readLatest
}={}){
 if(!Array.isArray(jobs)||!Number.isSafeInteger(maxPlanningJobs)||maxPlanningJobs<0||
    typeof planningDeadline!=='number'||!Number.isFinite(planningDeadline)||
    typeof now!=='function'||typeof loadFreshSource!=='function'||typeof readLatest!=='function'){
  throw new TypeError('invalid_jra_precompute_planning_budget');
 }
 const seen=new Set();
 for(const job of jobs){
  if(!validJob(job)||seen.has(job.raceId))throw new TypeError('invalid_jra_precompute_planning_job');
  seen.add(job.raceId);
 }

 let previous=-Infinity;
 const withinDeadline=()=>{
  const current=now();
  if(typeof current!=='number'||!Number.isFinite(current))throw new TypeError('invalid_jra_precompute_planning_clock');
  if(current<previous)throw new Error('jra_precompute_planning_clock_reversed');
  previous=current;
  return current<planningDeadline;
 };
 const inspected=[];
 let reason=null;
 // Check before the first candidate and again before each store read. A read
 // that finishes after the deadline cannot become an inspected candidate.
 for(let index=0;index<jobs.length;index++){
  if(!withinDeadline()){reason='DEADLINE';break;}
  if(inspected.length>=maxPlanningJobs){reason='MAX_PLANNING_JOBS';break;}
  const job=jobs[index];
  let source;
  try{source=await loadFreshSource(job);}
  catch(error){
   if(!['jra_precompute_cache_missing','jra_precompute_cache_expired'].includes(error?.code))throw error;
   if(!withinDeadline()){reason='DEADLINE';break;}
   inspected.push(Object.freeze({job,unavailableReason:error.code}));
   continue;
  }
  if(!withinDeadline()){reason='DEADLINE';break;}
  const latest=await readLatest(job);
  if(!withinDeadline()){reason='DEADLINE';break;}
  inspected.push(Object.freeze({job,source,latest}));
 }
 // Check the clock even when there are no jobs, and after the last candidate.
 if(!withinDeadline()&&inspected.length<jobs.length)reason='DEADLINE';
 const unscannedJobs=Object.freeze(jobs.slice(inspected.length));
 return Object.freeze({
  status:unscannedJobs.length?'PARTIAL':'COMPLETE',
  reason:unscannedJobs.length?reason:null,
  inspected:Object.freeze(inspected),unscannedJobs,
  discoveredCount:jobs.length,inspectedCount:inspected.length,unscannedCount:unscannedJobs.length
 });
}
