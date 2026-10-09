import {raceJobKey} from './background-precompute.mjs';

const TURN_MS=300_000;
const JST_OFFSET_MS=9*60*60*1_000;

// Scheduled-event identity is independent of the wall clock used for budgets.
export function jraPrecomputeSchedule(scheduledTime){
 if(!Number.isSafeInteger(scheduledTime)||scheduledTime<0||
    !Number.isFinite(new Date(scheduledTime+JST_OFFSET_MS).getTime())){
  throw new TypeError('invalid_jra_precompute_scheduled_time');
 }
 return Object.freeze({
  targetDate:new Date(scheduledTime+JST_OFFSET_MS).toISOString().slice(0,10),
  selectionTurn:Math.floor(scheduledTime/TURN_MS)
 });
}

// Visit every bounded planning block before revisiting one. Repeated visits
// rotate the first job inside that block so even a one-job deadline remains
// fair over the long run. Never modify the discovery result.
export function rotateJraPrecomputePlanningJobs(jobs,selectionTurn,maxPlanningJobs){
 if(!Array.isArray(jobs)||jobs.length===0||
    !Number.isSafeInteger(selectionTurn)||selectionTurn<0||
    !Number.isSafeInteger(maxPlanningJobs)||maxPlanningJobs<1){
  throw new TypeError('invalid_jra_precompute_planning_order');
 }
 const seen=new Set();
 for(const job of jobs){
  let validIdentity=false;
  try{validIdentity=job?.raceId===raceJobKey(job);}catch{}
  const validDate=typeof job?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(job.date)&&
   !Number.isNaN(Date.parse(`${job.date}T00:00:00.000Z`))&&
   new Date(`${job.date}T00:00:00.000Z`).toISOString().slice(0,10)===job.date;
  if(job?.organization!=='JRA'||typeof job.date!=='string'||
     !validDate||
     typeof job.track!=='string'||!job.track.trim()||
     !Number.isInteger(job.raceNo)||job.raceNo<1||job.raceNo>12||
     !validIdentity||seen.has(job.raceId)){
   throw new TypeError('invalid_jra_precompute_planning_job');
  }
  seen.add(job.raceId);
 }
 const planningWidth=Math.min(maxPlanningJobs,jobs.length);
 const blockCount=Math.ceil(jobs.length/planningWidth);
 const blockIndex=selectionTurn%blockCount;
 const blockStart=blockIndex*planningWidth;
 const blockEnd=Math.min(blockStart+planningWidth,jobs.length);
 const block=jobs.slice(blockStart,blockEnd);
 const lane=Math.floor(selectionTurn/blockCount)%block.length;
 const rotatedBlock=[...block.slice(lane),...block.slice(0,lane)];
 return Object.freeze([...rotatedBlock,...jobs.slice(blockEnd),...jobs.slice(0,blockStart)]);
}

// Routing is only classified here. In particular, this does not approve
// direct mode for Production or perform any SOURCE retrieval.
export function jraPrecomputeSourceMode(mode){
 if(mode==='official-cache'||mode==='direct')return mode;
 throw new TypeError('invalid_jra_precompute_source_mode');
}

// A caller supplies a live wall clock; scheduledTime is never a clock here.
export function jraPrecomputeWallNow(now){
 if(typeof now!=='function')throw new TypeError('invalid_jra_precompute_wall_clock');
 const value=now();
 if(typeof value!=='number'||!Number.isFinite(value)){
  throw new TypeError('invalid_jra_precompute_wall_clock');
 }
 return value;
}
