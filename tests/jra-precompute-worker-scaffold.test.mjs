import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createJraPrecomputeWorkerRunner} from '../src/prediction/jra-precompute-worker-scaffold.mjs';
import {runScheduledPrecomputeGate,runScheduledTasks} from '../worker.js';

const versions={JRA_PRECOMPUTE_CALCULATION_VERSION:'explicit-calculation',JRA_PRECOMPUTE_MODEL_VERSION:'explicit-model'};
const settings={JRA_PRECOMPUTE_SOURCE_MODE:'official-cache',JRA_PRECOMPUTE_MAX_PLANNING_JOBS:'4',
 JRA_PRECOMPUTE_MAX_JOBS:'1',JRA_PRECOMPUTE_PLANNING_WINDOW_MS:'2000',JRA_PRECOMPUTE_TOTAL_WINDOW_MS:'8000'};
const scheduledTime=Date.parse('2026-09-24T15:30:00Z');
const startedAt=scheduledTime+1000;
const validEnv={ENABLE_BACKGROUND_PRECOMPUTE:'true',...versions,...settings};

test('OFF creates no composition and performs no precompute DB, SOURCE or fetch IO',async()=>{
 for(const flag of [undefined,false,'false']){
  const calls={compose:0,db:0,wall:0};
  const env={ENABLE_BACKGROUND_PRECOMPUTE:flag,DB:{prepare(){calls.db++;throw Error('unexpected DB')}},...versions};
  const runner=createJraPrecomputeWorkerRunner(env,{
   compose(){calls.compose++;throw Error('unexpected composition')},
   wallNow(){calls.wall++;throw Error('unexpected clock')}
  });
  assert.equal(runner,undefined);
  assert.deepEqual(await runScheduledPrecomputeGate(env,{runner}),{status:'DISABLED',enabled:false,ran:false});
  assert.deepEqual(calls,{compose:0,db:0,wall:0});
 }
});

test('enabled gate remains lazy when scheduled result work suppresses precompute',async()=>{
 let db=0,compose=0,wall=0;
 const env={...validEnv,DB:{prepare(){db++}}};
 const runner=createJraPrecomputeWorkerRunner(env,{scheduledTime,wallNow(){wall++},compose(){compose++}});
 const result=await runScheduledTasks(env.DB,{
  env,precomputeRunner:runner,resultRunner:async()=>({processed:3})
 });
 assert.equal(result.precompute.status,'SUPPRESSED');
 assert.equal(db,0);
 assert.equal(compose,0);
 assert.equal(wall,0);
});

test('missing either version fails closed before any DB or SOURCE IO',async()=>{
 for(const supplied of [{},{JRA_PRECOMPUTE_CALCULATION_VERSION:'v'},{JRA_PRECOMPUTE_MODEL_VERSION:'v'}]){
  let db=0,compose=0;
  const env={...validEnv,JRA_PRECOMPUTE_CALCULATION_VERSION:undefined,JRA_PRECOMPUTE_MODEL_VERSION:undefined,
   ...supplied,DB:{prepare(){db++}}};
  const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
   scheduledTime,compose(){compose++}
  })});
  assert.equal(outcome.status,'FAILED');
  assert.equal(outcome.error,'jra_explicit_versions_required');
  assert.deepEqual({db,compose},{db:0,compose:0});
 }
});

test('unresolved SOURCE policy fails closed even with explicit versions',async()=>{
 for(const mode of [undefined,'direct','unknown']){
  let db=0,compose=0;
  const env={...validEnv,JRA_PRECOMPUTE_SOURCE_MODE:mode,DB:{prepare(){db++}}};
  const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
   scheduledTime,compose(){compose++}
  })});
  assert.equal(outcome.error,'jra_precompute_source_mode_not_approved');
  assert.equal(db,0);
  assert.equal(compose,0);
 }
});

test('missing migration 0012 schema fails closed before composition and cache reads',async()=>{
 let compose=0,db=0;
 const env={...validEnv,DB:{prepare(sql){
  db++;assert.match(sql,/FROM precomputed_race_snapshots LIMIT 0/);
  return {first(){throw Error('no such table: precomputed_race_snapshots')}};
 }}};
 const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
  scheduledTime,wallNow:()=>startedAt,compose(){compose++}
 })});
 assert.equal(outcome.error,'jra_precompute_snapshot_schema_unavailable');
 assert.deepEqual({compose,db},{compose:0,db:1});
});

test('missing meeting cache fails closed without race cache or snapshot writes',async()=>{
 const sql=[],binds=[];
 const env={...validEnv,DB:{prepare(query){
  sql.push(query);
  return {bind(...args){binds.push(args);return this},first:async()=>null};
 }}};
 const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
  scheduledTime,wallNow:()=>startedAt
 })});
 assert.equal(outcome.error,'jra_precompute_meeting_cache_missing');
 assert.equal(sql.length,2);
 assert.deepEqual(binds,[['2026-09-25']]);
 assert.match(sql[1],/FROM jra_meeting_calendar/);
 assert.ok(sql.every(query=>/^SELECT /i.test(query.trim())));
});

test('invalid job caps and windows fail closed before schema probe or composition',async()=>{
 const cases=[
  ['JRA_PRECOMPUTE_MAX_PLANNING_JOBS',[undefined,'0','-1','1.2','NaN','Infinity','01','9007199254740992'],
   'jra_precompute_max_planning_jobs_invalid'],
  ['JRA_PRECOMPUTE_MAX_JOBS',[undefined,'0','-1','0.5','NaN','Infinity','01'],
   'jra_precompute_max_jobs_invalid'],
  ['JRA_PRECOMPUTE_PLANNING_WINDOW_MS',[undefined,'0','-1','0.5','NaN','Infinity','01'],
   'jra_precompute_planning_window_invalid'],
  ['JRA_PRECOMPUTE_TOTAL_WINDOW_MS',[undefined,'0','-1','0.5','NaN','Infinity','01','2000','1999'],
   'jra_precompute_total_window_invalid']
 ];
 for(const [name,values,code] of cases){
  for(const value of values){
   let db=0,compose=0,wall=0;
   const env={...validEnv,[name]:value,DB:{prepare(){db++}}};
   const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
    scheduledTime,wallNow(){wall++},compose(){compose++}
   })});
   assert.equal(outcome.error,code,`${name}=${value}`);
   assert.deepStrictEqual({db,compose,wall},{db:0,compose:0,wall:0});
  }
 }
});

test('scheduledTime and DB are validated before schema probe, without clock fallback',async()=>{
 for(const time of [undefined,null,NaN,Infinity,-1,0.5,'2026-09-25']){
  let db=0,compose=0,wall=0;
  const env={...validEnv,DB:{prepare(){db++}}};
  const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
   scheduledTime:time,wallNow(){wall++},compose(){compose++}
  })});
  assert.equal(outcome.error,'invalid_jra_precompute_scheduled_time');
  assert.deepStrictEqual({db,compose,wall},{db:0,compose:0,wall:0});
 }
 for(const DB of [undefined,{}, {prepare:null}]){
  let compose=0,wall=0;
  const env={...validEnv,DB};
  const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
   scheduledTime,wallNow(){wall++},compose(){compose++}
  })});
  assert.equal(outcome.error,'invalid_jra_precompute_db');
  assert.deepStrictEqual({compose,wall},{compose:0,wall:0});
 }
});

test('live wall clock sets separate deadlines; scheduled event identity is passed unchanged',async()=>{
 const calls={schema:0,compose:0,run:0,clock:0};
 const DB={prepare(query){
  calls.schema++;assert.match(query,/FROM precomputed_race_snapshots LIMIT 0/);
  return {async first(){return null}};
 }};
 const env={...validEnv,DB};
 const runner=createJraPrecomputeWorkerRunner(env,{
  scheduledTime,wallNow(){calls.clock++;return startedAt},
  compose(options){
   calls.compose++;
   assert.strictEqual(options.DB,DB);
   assert.equal(options.sourceMode,'official-cache');
   assert.equal(options.maxPlanningJobs,4);
   assert.equal(options.maxJobs,1);
   assert.equal(options.planningDeadline,startedAt+2000);
   assert.equal(options.executionDeadline,startedAt+8000);
   assert.deepStrictEqual(options.versions,{calculationVersion:'explicit-calculation',modelVersion:'explicit-model'});
   assert.equal(options.now(),startedAt);
   return async ({scheduledTime:actual})=>{calls.run++;assert.equal(actual,scheduledTime);return {status:'COMPLETED'}};
  }
 });
 assert.deepStrictEqual(calls,{schema:0,compose:0,run:0,clock:0});
 const result=await runScheduledPrecomputeGate(env,{runner});
 assert.equal(result.status,'COMPLETED');
 assert.deepStrictEqual(calls,{schema:1,compose:1,run:1,clock:2});
});

test('invalid live clock and overflowing deadline fail before schema probe',async()=>{
 for(const value of [NaN,Infinity,'0']){
  let db=0,compose=0;
  const env={...validEnv,DB:{prepare(){db++}}};
  const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
   scheduledTime,wallNow:()=>value,compose(){compose++}
  })});
  assert.equal(outcome.error,'invalid_jra_precompute_clock');
  assert.deepStrictEqual({db,compose},{db:0,compose:0});
 }
 let db=0;
 const env={...validEnv,DB:{prepare(){db++}}};
 const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
  scheduledTime,wallNow:()=>Number.MAX_SAFE_INTEGER-5
 })});
 assert.equal(outcome.error,'invalid_jra_precompute_deadline');
 assert.equal(db,0);
});

test('live clock reversal after schema probe fails before integration I/O',async()=>{
 let clockCalls=0,ran=0;
 const env={...validEnv,DB:{prepare(){return {async first(){return null}}}}};
 const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
  scheduledTime,wallNow:()=>++clockCalls===1?startedAt:startedAt-1,
  compose(options){return async()=>{ran++;options.now()}}
 })});
 assert.equal(outcome.error,'jra_precompute_wall_clock_reversed');
 assert.equal(ran,1);
});

test('entrypoint injects the scaffold into the scheduled task gate',()=>{
 const worker=readFileSync(new URL('../worker.js',import.meta.url),'utf8');
 assert.match(worker,/const scheduledNow=new Date\(controller\?\.scheduledTime\|\|Date\.now\(\)\)/);
 assert.match(worker,/precomputeRunner:createJraPrecomputeWorkerRunner\(env,\{scheduledTime:controller\?\.scheduledTime,wallNow:\(\)=>Date\.now\(\)\}\)/);
 assert.doesNotMatch(worker,/precomputeRunner:createJraPrecomputeWorkerRunner\(env,\{now:/);
});
