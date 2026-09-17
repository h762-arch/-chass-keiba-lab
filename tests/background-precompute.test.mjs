import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PRECOMPUTE_RUNNER_CONTRACTS,backgroundPrecomputeEnabled,raceJobKey,runFinalizationRevision,runMarketRevision,runRaceJobs,runRacePrecomputeJob,runResultRevision} from '../src/prediction/background-precompute.mjs';
import {createPrecomputedSnapshot,viewerState} from '../src/prediction/precomputed-snapshot.mjs';

const job={organization:'JRA',date:'2026-09-10',track:'中山',raceNo:1};
const computed={DATA:{horses:[{horseNo:1,ability:80}]},versions:{modelVersion:'10.0.1'}};

test('precompute flag defaults off and performs zero IO',async()=>{
  let calls=0;
  assert.equal(backgroundPrecomputeEnabled({}),false);
  assert.equal(backgroundPrecomputeEnabled({ENABLE_BACKGROUND_PRECOMPUTE:'false'}),false);
  const result=await runRacePrecomputeJob(job,{loadSource:async()=>{calls++;}});
  assert.equal(result.status,'DISABLED');
  assert.equal(calls,0);
});

test('stale identical input validates SOURCE without duplicate calculation and recovers freshness',async()=>{
  let calculated=0,saved=0,refreshed;
  const source={acquiredAt:'2026-09-10T00:00:00Z',horses:[]};
  const existing=await createPrecomputedSnapshot({raceId:raceJobKey(job),organization:'JRA',source,data:computed.DATA,market:{horses:[]},final:{horses:[]},now:'2026-09-10T00:00:00Z'});
  assert.equal(viewerState(existing,{now:Date.parse('2026-09-10T00:16:00Z')}).status,'STALE');
  const deps={enabled:true,now:'2026-09-10T00:16:00Z',loadSource:async()=>({...source,acquiredAt:'2026-09-10T00:16:00Z'}),calculate:async()=>{calculated++;return computed;},loadLatest:async()=>existing,save:async snapshot=>{saved++;refreshed=snapshot;return {saved:true};}};
  const result=await runRacePrecomputeJob(job,deps);
  assert.equal(result.status,'SOURCE_VALIDATED');
  assert.equal(calculated,0);
  assert.equal(saved,1);
  assert.equal(refreshed.inputHash,existing.inputHash);
  assert.deepEqual(refreshed.layers.DATA,existing.layers.DATA);
  assert.equal(refreshed.sourceValidatedAt,'2026-09-10T00:16:00Z');
  assert.equal(viewerState(refreshed,{now:Date.parse('2026-09-10T00:16:01Z')}).status,'CALCULATED');
});

test('matching input without DATA is recalculated instead of short-circuited',async()=>{
  let calculated=0,saved=0;
  const existing={inputHash:'same',layers:{SOURCE:{},DATA:null,MARKET:null,FINAL:null,RESULT:null}};
  const result=await runRacePrecomputeJob(job,{enabled:true,now:'2026-09-10T01:00:00Z',loadSource:async()=>({acquiredAt:'x'}),calculate:async()=>{calculated++;return computed;},loadLatest:async()=>existing,save:async()=>{saved++;}});
  assert.equal(result.status,'SAVED');
  assert.equal(calculated,1);
  assert.equal(saved,1);
});

test('historical inputHash match cannot resurrect old MARKET FINAL or RESULT',async()=>{
  const sourceA={acquiredAt:'2026-09-10T00:00:00Z',horses:[{horseNo:1,name:'A'}]};
  const oldA=await createPrecomputedSnapshot({raceId:raceJobKey(job),organization:'JRA',source:sourceA,data:computed.DATA,market:{horses:[{horseNo:1,odds:2}]},final:{horses:[{horseNo:1,mark:'◎'}]},result:{finishOrder:[1]},now:'2026-09-10T00:00:00Z'});
  const latestB=await createPrecomputedSnapshot({raceId:raceJobKey(job),organization:'JRA',source:{...sourceA,horses:[{horseNo:1,name:'B'}]},data:computed.DATA,market:null,final:null,now:'2026-09-10T01:00:00Z'});
  let calculated=0,savedSnapshot;
  const result=await runRacePrecomputeJob(job,{enabled:true,now:'2026-09-10T02:00:00Z',loadSource:async()=>({...sourceA,acquiredAt:'2026-09-10T02:00:00Z'}),calculate:async()=>{calculated++;return computed;},loadLatest:async(_organization,_raceId)=>latestB,save:async snapshot=>{savedSnapshot=snapshot;return {saved:true,revision:3};}});
  assert.notEqual(latestB.inputHash,oldA.inputHash);
  assert.equal(result.status,'SAVED');
  assert.equal(calculated,1);
  assert.equal(savedSnapshot.inputHash,oldA.inputHash);
  assert.equal(savedSnapshot.layers.MARKET,null);
  assert.equal(savedSnapshot.layers.FINAL,null);
  assert.equal(savedSnapshot.layers.RESULT,null);
});

test('initial duplicate save reports UNCHANGED instead of a false SAVED result',async()=>{
  const result=await runRacePrecomputeJob(job,{enabled:true,loadSource:async()=>({acquiredAt:'x',horses:[]}),calculate:async()=>computed,loadLatest:async()=>null,save:async()=>({saved:false,reason:'UNCHANGED',revision:9})});
  assert.equal(result.status,'UNCHANGED');
  assert.equal(result.saved,false);
  assert.equal(result.reason,'UNCHANGED');
  assert.equal(result.revision,9);
});

test('late SOURCE validation save is reported as UNCHANGED and remains monotonic',async()=>{
  const source={acquiredAt:'2026-09-10T02:00:00Z',horses:[]};
  const existing=await createPrecomputedSnapshot({raceId:raceJobKey(job),organization:'JRA',source,data:computed.DATA,market:null,final:null,now:'2026-09-10T02:00:00Z'});
  let savedSnapshot;
  const result=await runRacePrecomputeJob(job,{enabled:true,now:'2026-09-10T01:30:00Z',loadSource:async()=>({...source,acquiredAt:'2026-09-10T01:30:00Z'}),calculate:async()=>computed,loadLatest:async()=>existing,save:async snapshot=>{savedSnapshot=snapshot;return {saved:false,reason:'UNCHANGED',revision:4};}});
  assert.equal(savedSnapshot,existing);
  assert.equal(savedSnapshot.sourceValidatedAt,'2026-09-10T02:00:00Z');
  assert.equal(result.status,'UNCHANGED');
  assert.equal(result.saved,false);
  assert.equal(result.revision,4);
});

test('declared model version must match calculator output',async()=>{
  const result=await runRacePrecomputeJob(job,{enabled:true,versions:{modelVersion:'10.0.2'},loadSource:async()=>({acquiredAt:'x',horses:[]}),calculate:async()=>computed,loadLatest:async()=>null,save:async()=>{}});
  assert.equal(result.status,'FAILED');
  assert.equal(result.error,'version_mismatch:modelVersion');
});

test('one failed race does not block another race job',async()=>{
  let n=0;
  const results=await runRaceJobs([job,{...job,raceNo:2}],{enabled:true,loadSource:async()=>{if(n++===0)throw new Error('fixture failure');return {acquiredAt:'x'};},calculate:async()=>computed,loadLatest:async()=>null,save:async()=>{}});
  assert.deepEqual(results.map(result=>result.status),['FAILED','SAVED']);
});

test('JRA and NAR race identities remain physically separated',()=>{
  const jra=raceJobKey(job),nar=raceJobKey({...job,organization:'NAR'});
  assert.notEqual(jra,nar);
  assert.match(jra,/-JRA-/);
  assert.match(nar,/-NAR-/);
});

test('flags stay OFF and precompute is not wired into current Worker or App',async()=>{
  const [wrangler,worker,app]=await Promise.all(['../wrangler.jsonc','../worker.js','../app.js'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  assert.match(wrangler,/"ENABLE_BACKGROUND_PRECOMPUTE"\s*:\s*"false"/);
  assert.match(wrangler,/"ENABLE_PRECOMPUTED_VIEWER"\s*:\s*"false"/);
  assert.doesNotMatch(`${worker}\n${app}`,/runRacePrecomputeJob|readLatestPrecomputedSnapshot/);
});

test('runner contracts separate calculation market and result ownership',()=>{
  assert.deepEqual(PRECOMPUTE_RUNNER_CONTRACTS.calculation.owns,['SOURCE','DATA']);
  assert.deepEqual(PRECOMPUTE_RUNNER_CONTRACTS.market.owns,['MARKET']);
  assert.deepEqual(PRECOMPUTE_RUNNER_CONTRACTS.finalization.owns,['FINAL']);
  assert.deepEqual(PRECOMPUTE_RUNNER_CONTRACTS.result.owns,['RESULT']);
  assert.match(PRECOMPUTE_RUNNER_CONTRACTS.calculation.rule,/never writes MARKET, FINAL or RESULT/);
  assert.match(PRECOMPUTE_RUNNER_CONTRACTS.market.rule,/before FINAL/);
  assert.match(PRECOMPUTE_RUNNER_CONTRACTS.finalization.rule,/only after MARKET/);
  assert.match(PRECOMPUTE_RUNNER_CONTRACTS.result.rule,/only after FINAL/);
});

test('calculation runner rejects MARKET FINAL and RESULT output',async()=>{
  for(const ownedLayer of [{MARKET:{}},{FINAL:{}},{RESULT:{}}]){
    let saved=0;
    const result=await runRacePrecomputeJob(job,{enabled:true,loadSource:async()=>({acquiredAt:'x'}),calculate:async()=>({...computed,...ownedLayer}),loadLatest:async()=>null,save:async()=>saved++});
    assert.equal(result.status,'FAILED');
    assert.equal(result.error,'calculation_runner_layer_violation');
    assert.equal(saved,0);
  }
});

test('dedicated market finalization and result runners enforce ownership order',async()=>{
  let savedSnapshot;
  const calculation=await runRacePrecomputeJob(job,{enabled:true,loadSource:async()=>({acquiredAt:'x'}),calculate:async()=>computed,loadLatest:async()=>null,save:async snapshot=>{savedSnapshot=snapshot;}});
  assert.equal(calculation.snapshotStatus,'PARTIAL');
  assert.equal(savedSnapshot.layers.MARKET,null);
  assert.equal(savedSnapshot.layers.FINAL,null);
  await assert.rejects(runFinalizationRevision(savedSnapshot,{horses:[]}),/final_requires_market/);
  await assert.rejects(runResultRevision(savedSnapshot,{finishOrder:[1]}),/result_requires_final/);
  const marketed=await runMarketRevision(savedSnapshot,{horses:[{horseNo:1,odds:4}]});
  const finalized=await runFinalizationRevision(marketed,{horses:[{horseNo:1,mark:'◎'}]});
  const resulted=await runResultRevision(finalized,{finishOrder:[1]});
  assert.equal(resulted.status,'CALCULATED');
  assert.deepEqual(resulted.layers.RESULT,{finishOrder:[1]});
});
