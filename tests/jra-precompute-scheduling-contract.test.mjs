import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 jraPrecomputeSchedule,rotateJraPrecomputePlanningJobs,
 jraPrecomputeSourceMode,jraPrecomputeWallNow
} from '../src/prediction/jra-precompute-scheduling-contract.mjs';
import {scanJraPrecomputePlanningJobs} from '../src/prediction/jra-precompute-planning-budget.mjs';

const day='2026-09-25';
const job=raceNo=>Object.freeze({organization:'JRA',date:day,track:'中山',raceNo,
 raceId:`20260925-JRA-中山-${String(raceNo).padStart(2,'0')}`});

test('scheduled event alone determines JST target date and stable five-minute turn',()=>{
 const scheduledTime=Date.parse('2026-09-24T15:00:00.000Z');
 const schedule=jraPrecomputeSchedule(scheduledTime);
 assert.deepStrictEqual(schedule,{targetDate:day,selectionTurn:Math.floor(scheduledTime/300_000)});
 assert.deepStrictEqual(jraPrecomputeSchedule(scheduledTime),schedule);
 assert.equal(jraPrecomputeSchedule(Date.parse('2026-09-24T14:59:59.999Z')).targetDate,'2026-09-24');
 assert.equal(jraPrecomputeSchedule(scheduledTime+299_999).selectionTurn,schedule.selectionTurn);
 assert.equal(jraPrecomputeSchedule(scheduledTime+300_000).selectionTurn,schedule.selectionTurn+1);
});

test('missing, negative, non-finite and non-integral scheduled times fail closed',()=>{
 for(const value of [undefined,null,'0',NaN,Infinity,-Infinity,-1,0.5,Number.MAX_SAFE_INTEGER]){
  assert.throws(()=>jraPrecomputeSchedule(value),/invalid_jra_precompute_scheduled_time/);
 }
});

test('one-step rotation gives every race a first position over N consecutive turns',()=>{
 const jobs=Object.freeze(Array.from({length:12},(_,index)=>job(index+1)));
 const first=[];
 for(let turn=1000;turn<1012;turn++){
  const ordered=rotateJraPrecomputePlanningJobs(jobs,turn,4);
  assert.equal(Object.isFrozen(ordered),true);
  assert.deepStrictEqual(new Set(ordered.map(row=>row.raceId)),new Set(jobs.map(row=>row.raceId)));
  first.push(ordered[0].raceId);
 }
 assert.equal(new Set(first).size,jobs.length);
 assert.deepStrictEqual(jobs.map(row=>row.raceNo),Array.from({length:12},(_,index)=>index+1));
});

test('one-inspection deadlines still offer every job a turn without revisiting cache',async()=>{
 const jobs=Array.from({length:4},(_,index)=>job(index+1));
 const inspected=[];
 for(let turn=0;turn<jobs.length;turn++){
  let ticks=0;
  const plan=await scanJraPrecomputePlanningJobs({
   jobs:rotateJraPrecomputePlanningJobs(jobs,turn,4),maxPlanningJobs:4,
   planningDeadline:10,now:()=>++ticks>=4?10:0,
   loadFreshSource:async candidate=>({raceId:candidate.raceId}),
   readLatest:async candidate=>{inspected.push(candidate.raceId);return null;}
  });
  assert.equal(plan.status,'PARTIAL');
  assert.equal(plan.inspectedCount,1);
  assert.equal(plan.unscannedCount,3);
 }
 assert.equal(new Set(inspected).size,jobs.length);
});

test('bad jobs and planning limits fail before rotation',()=>{
 const jobs=[job(1),job(2)];
 for(const candidates of [undefined,[],[job(1),job(1)],[{...job(1),raceId:'wrong'}],
  [{...job(1),date:'2026-99-99',raceId:'20269999-JRA-中山-01'}],[null]]){
  assert.throws(()=>rotateJraPrecomputePlanningJobs(candidates,0,1));
 }
 for(const value of [-1,0,0.5,NaN,Infinity,undefined]){
  assert.throws(()=>rotateJraPrecomputePlanningJobs(jobs,0,value));
 }
 for(const value of [-1,0.5,NaN,Infinity,undefined]){
  assert.throws(()=>rotateJraPrecomputePlanningJobs(jobs,value,1));
 }
});

test('SOURCE mode is explicit, direct is classified but not approved or fetched',()=>{
 assert.equal(jraPrecomputeSourceMode('official-cache'),'official-cache');
 assert.equal(jraPrecomputeSourceMode('direct'),'direct');
 for(const mode of [undefined,null,'','cache','DIRECT']){
  assert.throws(()=>jraPrecomputeSourceMode(mode),/invalid_jra_precompute_source_mode/);
 }
});

test('live wall clock is separate from scheduled event identity',()=>{
 const time=Date.parse('2026-09-25T02:00:00Z');
 let wall=time;
 assert.equal(jraPrecomputeWallNow(()=>wall),time);
 wall+=10_000;
 assert.equal(jraPrecomputeWallNow(()=>wall),time+10_000);
 for(const clock of [null,()=>NaN,()=>Infinity,()=>undefined]){
  assert.throws(()=>jraPrecomputeWallNow(clock),/invalid_jra_precompute_wall_clock/);
 }
});

test('scheduling remains isolated from Worker, composition and I/O',async()=>{
 const source=await readFile(new URL('../src/prediction/jra-precompute-scheduling-contract.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/worker\.js|Composition|ENABLE_|\.prepare\s*\(|\.run\s*\(|fetch\s*\(/);
});
