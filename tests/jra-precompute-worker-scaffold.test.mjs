import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createJraPrecomputeWorkerRunner} from '../src/prediction/jra-precompute-worker-scaffold.mjs';
import {runScheduledPrecomputeGate,runScheduledTasks} from '../worker.js';

const versions={JRA_PRECOMPUTE_CALCULATION_VERSION:'explicit-calculation',JRA_PRECOMPUTE_MODEL_VERSION:'explicit-model'};

test('OFF creates no composition and performs no precompute DB, SOURCE or fetch IO',async()=>{
 for(const flag of [undefined,false,'false']){
  const calls={compose:0,db:0,fetch:0};
  const env={ENABLE_BACKGROUND_PRECOMPUTE:flag,DB:{prepare(){calls.db++;throw Error('unexpected DB')}},...versions};
  const runner=createJraPrecomputeWorkerRunner(env,{
   compose(){calls.compose++;throw Error('unexpected composition')},
   fetchImpl(){calls.fetch++;throw Error('unexpected fetch')}
  });
  assert.equal(runner,undefined);
  assert.deepEqual(await runScheduledPrecomputeGate(env,{runner}),{status:'DISABLED',enabled:false,ran:false});
  assert.deepEqual(calls,{compose:0,db:0,fetch:0});
 }
});

test('enabled gate remains lazy when scheduled result work suppresses precompute',async()=>{
 let db=0,compose=0;
 const env={ENABLE_BACKGROUND_PRECOMPUTE:'true',DB:{prepare(){db++}},...versions};
 const runner=createJraPrecomputeWorkerRunner(env,{compose(){compose++}});
 const result=await runScheduledTasks(env.DB,{
  env,precomputeRunner:runner,resultRunner:async()=>({processed:3})
 });
 assert.equal(result.precompute.status,'SUPPRESSED');
 assert.equal(db,0);
 assert.equal(compose,0);
});

test('missing either version fails closed before any DB or SOURCE IO',async()=>{
 for(const supplied of [{},{JRA_PRECOMPUTE_CALCULATION_VERSION:'v'},{JRA_PRECOMPUTE_MODEL_VERSION:'v'}]){
  let db=0,fetch=0,compose=0;
  const env={ENABLE_BACKGROUND_PRECOMPUTE:'true',JRA_PRECOMPUTE_SOURCE_MODE:'direct',...supplied,DB:{prepare(){db++}}};
  const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
   fetchImpl(){fetch++},compose(){compose++}
  })});
  assert.equal(outcome.status,'FAILED');
  assert.equal(outcome.error,'jra_explicit_versions_required');
  assert.deepEqual({db,fetch,compose},{db:0,fetch:0,compose:0});
 }
});

test('unresolved SOURCE policy fails closed even with explicit versions',async()=>{
 let db=0,fetch=0;
 const env={ENABLE_BACKGROUND_PRECOMPUTE:'true',...versions,DB:{prepare(){db++}}};
 const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{fetchImpl(){fetch++}})});
 assert.equal(outcome.error,'jra_precompute_source_mode_not_approved');
 assert.equal(db,0);
 assert.equal(fetch,0);
});

test('missing migration 0012 schema fails closed before composition and fetch',async()=>{
 let compose=0,fetch=0,db=0;
 const env={ENABLE_BACKGROUND_PRECOMPUTE:'true',JRA_PRECOMPUTE_SOURCE_MODE:'direct',...versions,DB:{prepare(sql){
  db++;assert.match(sql,/FROM precomputed_race_snapshots LIMIT 0/);
  return {first(){throw Error('no such table: precomputed_race_snapshots')}};
 }}};
 const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
  compose(){compose++},fetchImpl(){fetch++}
 })});
 assert.equal(outcome.error,'jra_precompute_snapshot_schema_unavailable');
 assert.deepEqual({compose,fetch,db},{compose:0,fetch:0,db:1});
});

test('missing meeting cache fails closed without SOURCE fetch or snapshot writes',async()=>{
 const sql=[],binds=[];let fetch=0;
 const env={ENABLE_BACKGROUND_PRECOMPUTE:'true',JRA_PRECOMPUTE_SOURCE_MODE:'direct',...versions,DB:{prepare(query){
  sql.push(query);
  return {bind(...args){binds.push(args);return this},first:async()=>null};
 }}};
 const outcome=await runScheduledPrecomputeGate(env,{runner:createJraPrecomputeWorkerRunner(env,{
  now:()=>Date.parse('2026-09-24T15:30:00Z'),fetchImpl(){fetch++}
 })});
 assert.equal(outcome.error,'jra_precompute_meeting_cache_missing');
 assert.equal(fetch,0);
 assert.equal(sql.length,2);
 assert.deepEqual(binds,[['2026-09-25']]);
 assert.match(sql[1],/FROM jra_meeting_calendar/);
 assert.ok(sql.every(query=>/^SELECT /i.test(query.trim())));
});

test('entrypoint injects the scaffold into the scheduled task gate',()=>{
 const worker=readFileSync(new URL('../worker.js',import.meta.url),'utf8');
 assert.match(worker,/const scheduledNow=new Date\(controller\?\.scheduledTime\|\|Date\.now\(\)\)/);
 assert.match(worker,/precomputeRunner:createJraPrecomputeWorkerRunner\(env,\{now:\(\)=>scheduledNow\.getTime\(\)\}\)/);
});
