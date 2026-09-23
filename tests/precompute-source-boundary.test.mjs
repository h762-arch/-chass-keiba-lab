import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPrecomputeSourceBoundary} from '../src/prediction/precompute-source-boundary.mjs';
import {createPrecomputeRaceRunnerAdapter} from '../src/prediction/precompute-race-runner-adapter.mjs';
import {runBoundedPrecomputeJobs} from '../src/prediction/precompute-execution-budget.mjs';
import {raceJobKey} from '../src/prediction/background-precompute.mjs';

const timestamp='2026-09-23T00:00:00.000Z';
const job=organization=>Object.freeze({organization,date:'2026-09-23',track:'中山',raceNo:1,
  raceId:raceJobKey({organization,date:'2026-09-23',track:'中山',raceNo:1})});

function timer(){
  const scheduled=new Map();
  let next=0,cleared=0;
  return {
    setTimer(callback){const id=++next;scheduled.set(id,callback);return id;},
    clearTimer(id){if(scheduled.delete(id))cleared++;},
    fire(){for(const [id,callback] of [...scheduled])callback();},
    get active(){return scheduled.size;},
    get cleared(){return cleared;}
  };
}

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function setup(organization,loadSource,clock){
  const calls={calculate:0,loadLatest:0,save:0};
  const boundary=createPrecomputeSourceBoundary({loadSource,timeoutMs:100,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  const raceRunner=createPrecomputeRaceRunnerAdapter({
    loadSource:boundary,
    calculate:async()=>{calls.calculate++;return {DATA:{horses:[{horseNo:1,ability:80}]}};},
    loadLatest:async()=>{calls.loadLatest++;return null;},
    save:async()=>{calls.save++;return {saved:true,revision:1};},
    versions:{modelVersion:'10.0.1'},now:()=>timestamp
  });
  return {calls,raceRunner,job:job(organization)};
}

test('JRA and NAR SOURCE success propagates per-job signal and clears timer',async()=>{
  for(const organization of ['JRA','NAR']){
    const clock=timer();let signal,received,invocations=0;
    const {calls,raceRunner,job:race}=setup(organization,async (input,options)=>{
      invocations++;received=input;signal=options.signal;
      return {horses:[{horseNo:1}],acquiredAt:timestamp};
    },clock);
    assert.equal((await raceRunner(race)).status,'SAVED');
    assert.equal(received,race);
    assert.equal(signal instanceof AbortSignal,true);
    assert.equal(signal.aborted,false);
    assert.deepEqual(calls,{calculate:1,loadLatest:1,save:1});
    assert.equal(invocations,1);
    assert.equal(clock.active,0);
    assert.equal(clock.cleared,1);
    clock.fire();
    assert.equal(signal.aborted,false);
  }
});

test('timeout aborts SOURCE, classifies failure, and never starts downstream lifecycle',async()=>{
  const clock=timer(),pending=deferred();let signal,invocations=0;
  const {calls,raceRunner,job:race}=setup('JRA',(_job,options)=>{
    invocations++;signal=options.signal;return pending.promise;
  },clock);
  const execution=runBoundedPrecomputeJobs({organization:'JRA',jobs:[race],runner:raceRunner,deadline:100,now:()=>0});
  clock.fire();
  const result=await execution;
  assert.equal(signal.aborted,true);
  assert.equal(result.status,'FAILED');
  assert.equal(result.failedJobs[0].error,'precompute_source_timeout');
  assert.equal(result.completedCount,0);
  assert.deepEqual(calls,{calculate:0,loadLatest:0,save:0});
  assert.equal(invocations,1);
  assert.equal(clock.active,0);
  pending.resolve({horses:[{horseNo:1}]});
  await Promise.resolve();
  assert.deepEqual(calls,{calculate:0,loadLatest:0,save:0});
});

test('late loader rejection is observed without resuming the race job',async()=>{
  const clock=timer(),pending=deferred();
  const {calls,raceRunner,job:race}=setup('NAR',()=>pending.promise,clock);
  const resultPromise=raceRunner(race);
  clock.fire();
  await assert.rejects(resultPromise,error=>error.code==='precompute_source_timeout');
  let unhandled=0;
  const onUnhandled=()=>{unhandled++;};
  process.on('unhandledRejection',onUnhandled);
  try{
    pending.reject(new Error('late_failure'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(unhandled,0);
    assert.deepEqual(calls,{calculate:0,loadLatest:0,save:0});
  }finally{process.off('unhandledRejection',onUnhandled);}
});

test('loader rejection preserves its original error, clears timer, and does not retry',async()=>{
  const clock=timer(),error=new Error('source_unavailable');let calls=0;
  const boundary=createPrecomputeSourceBoundary({loadSource:async()=>{calls++;throw error;},timeoutMs:10,
    setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  await assert.rejects(boundary(job('JRA')),candidate=>candidate===error);
  assert.equal(calls,1);
  assert.equal(clock.active,0);
  assert.equal(clock.cleared,1);
});

test('each SOURCE acquisition owns a distinct AbortController',async()=>{
  const clock=timer(),pending=[deferred(),deferred()],signals=[];
  let index=0;
  const boundary=createPrecomputeSourceBoundary({loadSource:(_job,{signal})=>{
    signals.push(signal);return pending[index++].promise;
  },timeoutMs:10,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  const first=boundary(job('JRA')),second=boundary(job('NAR'));
  assert.notEqual(signals[0],signals[1]);
  pending[0].resolve({horses:[]});
  await first;
  assert.equal(signals[0].aborted,false);
  clock.fire();
  await assert.rejects(second,error=>error.code==='precompute_source_timeout');
  assert.equal(signals[0].aborted,false);
  assert.equal(signals[1].aborted,true);
  pending[1].resolve({horses:[]});
});

test('boundary validates dependencies and timeout before calling loader',()=>{
  for(const timeoutMs of [undefined,null,0,-1,NaN,Infinity,'1']){
    assert.throws(()=>createPrecomputeSourceBoundary({loadSource:()=>{},timeoutMs}),/invalid_precompute_source_timeout/);
  }
  assert.throws(()=>createPrecomputeSourceBoundary({loadSource:null,timeoutMs:1}),/invalid_precompute_source_loader/);
});

test('module is disconnected and contains no whole-job timeout or production I/O',async()=>{
  const source=await readFile(new URL('../src/prediction/precompute-source-boundary.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/runRacePrecomputeJob|runBoundedPrecomputeJobs|fetch\s*\(|\.prepare\s*\(|Promise\.race|calculate\s*\(|save\s*\(/);
  for(const path of ['../worker.js','../worker-entry.mjs']){
    const worker=await readFile(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(worker,/precompute-source-boundary/);
  }
});
