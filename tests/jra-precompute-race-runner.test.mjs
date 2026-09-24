import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJraPrecomputeRaceRunner} from '../src/prediction/jra-precompute-race-runner.mjs';
import {runBoundedPrecomputeJobs} from '../src/prediction/precompute-execution-budget.mjs';
import {raceJobKey} from '../src/prediction/background-precompute.mjs';

const timestamp='2026-09-24T00:00:00.000Z';
const job=Object.freeze({organization:'JRA',date:'2026-09-05',track:'中山',raceNo:5,
  raceId:raceJobKey({organization:'JRA',date:'2026-09-05',track:'中山',raceNo:5})});
const token='pw01dde0106202604010520260905/16';
const listing=`<html><body><a href="/JRADB/accessD.html?CNAME=${token}">5R</a></body></html>`;
const card=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');

function timer(){
  const scheduled=new Map();let next=0,cleared=0;
  return {
    setTimer(callback){const id=++next;scheduled.set(id,callback);return id;},
    clearTimer(id){if(scheduled.delete(id))cleared++;},
    fire(){for(const callback of [...scheduled.values()])callback();},
    get active(){return scheduled.size;},get cleared(){return cleared;}
  };
}

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function fetchSequence({onFetch}={}){
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url,options});
    if(onFetch)return onFetch(url,options,calls.length);
    return new Response(calls.length===1?listing:card);
  };
  return {calls,fetchImpl};
}

function dependencies(overrides={}){
  const calls={calculate:0,loadLatest:0,save:0};
  const fetch=fetchSequence(overrides);
  const values={
    fetchImpl:fetch.fetchImpl,sourceTimeoutMs:100,now:()=>timestamp,
    calculate:async source=>{calls.calculate++;return {DATA:{horses:source.horses.map(horse=>({horseNo:horse.horseNo,ability:80}))}};},
    loadLatest:async()=>{calls.loadLatest++;return null;},
    save:async snapshot=>{calls.save++;return {saved:true,revision:1,snapshot};},
    versions:{modelVersion:'10.0.1'}
  };
  return {calls,fetch,...values,...overrides};
}

test('composes isolated JRA SOURCE, boundary and race runner into a SAVED result',async()=>{
  const clock=timer(),deps=dependencies({setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  const runner=createJraPrecomputeRaceRunner(deps);
  const result=await runner(job);
  assert.equal(result.status,'SAVED');
  assert.equal(result.raceId,job.raceId);
  assert.deepEqual(deps.calls,{calculate:1,loadLatest:1,save:1});
  assert.equal(deps.fetch.calls.length,2);
  assert.equal(deps.fetch.calls[0].options.signal,deps.fetch.calls[1].options.signal);
  assert.equal(deps.fetch.calls[0].options.signal.aborted,false);
  assert.equal(clock.active,0);
  assert.equal(clock.cleared,1);
  clock.fire();
  assert.equal(deps.fetch.calls[0].options.signal.aborted,false);
});

test('SOURCE timeout aborts the isolated loader and is classified by bounded execution',async()=>{
  const clock=timer(),waiting=deferred();
  const deps=dependencies({onFetch:()=>waiting.promise,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  const runner=createJraPrecomputeRaceRunner(deps);
  const execution=runBoundedPrecomputeJobs({organization:'JRA',jobs:[job],runner,deadline:100,now:()=>0});
  while(deps.fetch.calls.length===0)await Promise.resolve();
  const signal=deps.fetch.calls[0].options.signal;
  clock.fire();
  const result=await execution;
  assert.equal(signal.aborted,true);
  assert.equal(result.status,'FAILED');
  assert.equal(result.failedJobs[0].error,'precompute_source_timeout');
  assert.deepEqual(deps.calls,{calculate:0,loadLatest:0,save:0});
  waiting.resolve(new Response(listing));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(deps.calls,{calculate:0,loadLatest:0,save:0});
});

test('late rejection after SOURCE timeout is observed without retry or downstream work',async()=>{
  const clock=timer(),waiting=deferred();
  const deps=dependencies({onFetch:()=>waiting.promise,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  const runner=createJraPrecomputeRaceRunner(deps);
  const resultPromise=runner(job);
  while(deps.fetch.calls.length===0)await Promise.resolve();
  clock.fire();
  await assert.rejects(resultPromise,error=>error.code==='precompute_source_timeout');
  let unhandled=0;
  const listener=()=>{unhandled++;};
  process.on('unhandledRejection',listener);
  try{
    waiting.reject(new Error('late_source_failure'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(unhandled,0);
    assert.equal(deps.fetch.calls.length,1);
    assert.deepEqual(deps.calls,{calculate:0,loadLatest:0,save:0});
  }finally{process.off('unhandledRejection',listener);}
});

test('loader and calculator failures propagate once without downstream retry',async()=>{
  {
    const clock=timer();
    const deps=dependencies({onFetch:async()=>{throw new Error('jra_source_unavailable');},setTimer:clock.setTimer,clearTimer:clock.clearTimer});
    await assert.rejects(createJraPrecomputeRaceRunner(deps)(job),error=>error.code==='jra_source_unavailable');
    assert.equal(deps.fetch.calls.length,1);
    assert.deepEqual(deps.calls,{calculate:0,loadLatest:0,save:0});
  }
  {
    const clock=timer(),deps=dependencies({setTimer:clock.setTimer,clearTimer:clock.clearTimer});
    deps.calculate=async()=>{deps.calls.calculate++;throw new Error('calculator_failed');};
    await assert.rejects(createJraPrecomputeRaceRunner(deps)(job),error=>error.code==='calculator_failed');
    assert.deepEqual(deps.calls,{calculate:1,loadLatest:1,save:0});
  }
});

test('SAVED, SOURCE_VALIDATED, UNCHANGED and SUPERSEDED retain existing runner semantics',async()=>{
  const savedClock=timer(),savedDeps=dependencies({setTimer:savedClock.setTimer,clearTimer:savedClock.clearTimer});
  let snapshot;
  savedDeps.save=async value=>{savedDeps.calls.save++;snapshot=value;return {saved:true,revision:1};};
  assert.equal((await createJraPrecomputeRaceRunner(savedDeps)(job)).status,'SAVED');

  const validatedClock=timer(),validatedDeps=dependencies({setTimer:validatedClock.setTimer,clearTimer:validatedClock.clearTimer});
  validatedDeps.loadLatest=async()=>{validatedDeps.calls.loadLatest++;return snapshot;};
  assert.equal((await createJraPrecomputeRaceRunner(validatedDeps)(job)).status,'SOURCE_VALIDATED');
  assert.equal(validatedDeps.calls.calculate,0);

  for(const reason of ['UNCHANGED','SUPERSEDED']){
    const clock=timer(),deps=dependencies({setTimer:clock.setTimer,clearTimer:clock.clearTimer});
    deps.save=async()=>{deps.calls.save++;return {saved:false,reason,revision:2};};
    assert.equal((await createJraPrecomputeRaceRunner(deps)(job)).status,reason);
  }
});

test('calculation layer violations and JRA identity mismatch fail closed',async()=>{
  const clock=timer(),deps=dependencies({setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  deps.calculate=async()=>{deps.calls.calculate++;return {DATA:{},MARKET:{odds:[]},FINAL:{},RESULT:{}};};
  await assert.rejects(createJraPrecomputeRaceRunner(deps)(job),error=>error.code==='calculation_runner_layer_violation');
  assert.equal(deps.calls.save,0);

  const invalid=Object.freeze({...job,raceId:'20260905-JRA-中山-06'});
  const identityClock=timer(),identityDeps=dependencies({setTimer:identityClock.setTimer,clearTimer:identityClock.clearTimer});
  await assert.rejects(createJraPrecomputeRaceRunner(identityDeps)(invalid),error=>error.code==='jra_precompute_source_identity_mismatch');
  assert.equal(identityDeps.fetch.calls.length,0);
  assert.deepEqual(identityDeps.calls,{calculate:0,loadLatest:0,save:0});
});

test('composition requires explicit timeout and remains disconnected from runtime and direct I/O',async()=>{
  const deps=dependencies();
  for(const sourceTimeoutMs of [undefined,null,0,-1,NaN,Infinity,'100']){
    assert.throws(()=>createJraPrecomputeRaceRunner({...deps,sourceTimeoutMs}),/invalid_precompute_source_timeout/);
  }
  const source=await readFile(new URL('../src/prediction/jra-precompute-race-runner.mjs',import.meta.url),'utf8');
  for(const pattern of [/\bfetch\s*\(/,/\.prepare\s*\(/,/Date\.now\s*\(/,/Promise\.race\s*\(/,/Math\.random\s*\(/]){
    assert.doesNotMatch(source,pattern);
  }
  assert.doesNotMatch(source,/SOURCE|MARKET|FINAL|RESULT/);
  for(const file of ['../worker.js','../worker-entry.mjs']){
    const runtime=await readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(runtime,/jra-precompute-race-runner/);
  }
});
