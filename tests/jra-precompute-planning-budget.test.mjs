import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scanJraPrecomputePlanningJobs} from '../src/prediction/jra-precompute-planning-budget.mjs';
import {selectJraPrecomputeCacheJobs} from '../src/prediction/jra-precompute-cache-job-selection.mjs';

const date='2026-09-05';
const job=no=>Object.freeze({organization:'JRA',date,track:'中山',raceNo:no,
 raceId:`20260905-JRA-中山-${String(no).padStart(2,'0')}`});
const versions={calculationVersion:'jra-ability-data-v1',modelVersion:'10.0.1-jra-drive1-ability'};
function fixture(overrides={}){
 const jobs=[job(1),job(2),job(3)],calls={cache:[],latest:[]};
 let clock=0;
 const sourceFor=candidate=>({organization:'JRA',raceId:candidate.raceId,acquiredAt:'2026-09-04T23:00:00.000Z'});
 const options={jobs,maxPlanningJobs:3,planningDeadline:10,now:()=>clock,
  loadFreshSource:async candidate=>{calls.cache.push(candidate.raceNo);return sourceFor(candidate)},
  readLatest:async candidate=>{calls.latest.push(candidate.raceNo);return null},...overrides};
 return {calls,options,sourceFor,setClock(value){clock=value},getClock(){return clock}};
}

test('complete plan inspects each candidate exactly once and retains the validated SOURCE',async()=>{
 const {calls,options,sourceFor}=fixture();
 const result=await scanJraPrecomputePlanningJobs(options);
 assert.equal(result.status,'COMPLETE');
 assert.equal(result.reason,null);
 assert.deepStrictEqual(result.unscannedJobs,[]);
 assert.deepStrictEqual(result.inspected.map(row=>row.source),options.jobs.map(sourceFor));
 assert.deepStrictEqual(calls,{cache:[1,2,3],latest:[1,2,3]});
});

test('deadline at entry returns all jobs unscanned and performs no reads',async()=>{
 const {calls,options,setClock}=fixture();
 setClock(10);
 const result=await scanJraPrecomputePlanningJobs(options);
 assert.equal(result.status,'PARTIAL');
 assert.equal(result.reason,'DEADLINE');
 assert.equal(result.inspectedCount,0);
 assert.deepStrictEqual(result.unscannedJobs,options.jobs);
 assert.deepStrictEqual(calls,{cache:[],latest:[]});
});

test('deadline between cache and latest read leaves current job unscanned',async()=>{
 const {calls,options,setClock}=fixture();
 options.loadFreshSource=async candidate=>{
  calls.cache.push(candidate.raceNo);
  setClock(10);
  return {organization:'JRA',raceId:candidate.raceId};
 };
 const result=await scanJraPrecomputePlanningJobs(options);
 assert.deepStrictEqual(calls,{cache:[1],latest:[]});
 assert.equal(result.status,'PARTIAL');
 assert.deepStrictEqual(result.unscannedJobs,options.jobs);
});

test('deadline after a complete first inspection keeps only that candidate and no further reads',async()=>{
 const {calls,options}=fixture();
 options.loadFreshSource=async candidate=>{
  calls.cache.push(candidate.raceNo);
  return {organization:'JRA',raceId:candidate.raceId};
 };
 options.readLatest=async candidate=>{
  calls.latest.push(candidate.raceNo);
  return null;
 };
 const times=[0,0,0,10,10];
 options.now=()=>times.shift()??10;
 const result=await scanJraPrecomputePlanningJobs(options);
 assert.equal(result.status,'PARTIAL');
 assert.equal(result.reason,'DEADLINE');
 assert.deepStrictEqual(result.unscannedJobs,options.jobs.slice(1));
 assert.deepStrictEqual(calls,{cache:[1],latest:[1]});
});

test('maxPlanningJobs caps cache and latest reads; unscanned jobs are explicit',async()=>{
 const {calls,options}=fixture({maxPlanningJobs:1});
 const result=await scanJraPrecomputePlanningJobs(options);
 assert.equal(result.status,'PARTIAL');
 assert.equal(result.reason,'MAX_PLANNING_JOBS');
 assert.equal(result.inspectedCount,1);
 assert.deepStrictEqual(result.unscannedJobs,options.jobs.slice(1));
 assert.deepStrictEqual(calls,{cache:[1],latest:[1]});
 const zero=await scanJraPrecomputePlanningJobs({...options,maxPlanningJobs:0});
 assert.equal(zero.inspectedCount,0);
 assert.deepStrictEqual(calls,{cache:[1],latest:[1]});
});

test('clock reversal fails closed before any further I/O',async()=>{
 const {calls,options}=fixture();
 const times=[0,-1];
 options.now=()=>times.shift()??-1;
 await assert.rejects(scanJraPrecomputePlanningJobs(options),/jra_precompute_planning_clock_reversed/);
 assert.deepStrictEqual(calls,{cache:[1],latest:[]});
});

test('inspected prefix can feed strict selector without re-reading either store',async()=>{
 const {calls,options}=fixture({maxPlanningJobs:2});
 const plan=await scanJraPrecomputePlanningJobs(options);
 const byRace=new Map(plan.inspected.map(row=>[row.job.raceId,row]));
 const selected=await selectJraPrecomputeCacheJobs({
  jobs:plan.inspected.map(row=>row.job),maxJobs:1,selectionTurn:0,versions,
  loadFreshSource:async candidate=>byRace.get(candidate.raceId).source,
  readLatest:async candidate=>byRace.get(candidate.raceId).latest
 });
 assert.equal(selected.selected.length,1);
 assert.strictEqual(selected.selected[0].source,plan.inspected[0].source);
 assert.deepStrictEqual(plan.unscannedJobs,[options.jobs[2]]);
 assert.deepStrictEqual(calls,{cache:[1,2],latest:[1,2]});
});

test('missing cache skips latest read, while corrupt cache fails closed',async()=>{
 const {calls,options}=fixture({loadFreshSource:async candidate=>{
  calls.cache.push(candidate.raceNo);
  if(candidate.raceNo===1)throw Object.assign(new Error('missing'),{code:'jra_precompute_cache_missing'});
  return {organization:'JRA',raceId:candidate.raceId};
 }});
 const result=await scanJraPrecomputePlanningJobs(options);
 assert.equal(result.inspected[0].unavailableReason,'jra_precompute_cache_missing');
 assert.deepStrictEqual(calls,{cache:[1,2,3],latest:[2,3]});
 await assert.rejects(scanJraPrecomputePlanningJobs({...options,loadFreshSource:async()=>{
  throw Object.assign(new Error('corrupt'),{code:'jra_precompute_cache_corrupt'});
 }}),error=>error.code==='jra_precompute_cache_corrupt');
});

test('invalid bounds and duplicate jobs fail before I/O',async()=>{
 const {calls,options}=fixture();
 for(const change of [{maxPlanningJobs:-1},{planningDeadline:NaN},{now:null},{jobs:[job(1),job(1)]}]){
  await assert.rejects(scanJraPrecomputePlanningJobs({...options,...change}));
 }
 assert.deepStrictEqual(calls,{cache:[],latest:[]});
});

test('guard remains independent of Worker, Composition, flags, network and writes',async()=>{
 const source=await readFile(new URL('../src/prediction/jra-precompute-planning-budget.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/worker\.js|scheduled|Composition|ENABLE_|fetch\s*\(|\.prepare\s*\(|\.run\s*\(/);
 const composition=await readFile(new URL('../src/prediction/jra-precompute-cache-only-composition.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(composition,/jra-precompute-planning-budget/);
});
