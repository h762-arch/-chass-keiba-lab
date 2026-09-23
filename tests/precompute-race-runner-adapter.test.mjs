import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPrecomputeRaceRunnerAdapter} from '../src/prediction/precompute-race-runner-adapter.mjs';
import {runBoundedPrecomputeJobs} from '../src/prediction/precompute-execution-budget.mjs';
import {raceJobKey} from '../src/prediction/background-precompute.mjs';

const job=Object.freeze({organization:'JRA',date:'2026-09-23',track:'中山',raceNo:1,
  raceId:raceJobKey({organization:'JRA',date:'2026-09-23',track:'中山',raceNo:1})});
const timestamp='2026-09-23T00:00:00.000Z';
const defaults=()=>({
  loadSource:async()=>({horses:[{horseNo:1}],acquiredAt:timestamp}),
  calculate:async()=>({DATA:{horses:[{horseNo:1,ability:80}]}}),
  loadLatest:async()=>null,
  save:async()=>({saved:true,revision:1}),
  versions:{modelVersion:'10.0.1'},now:()=>timestamp
});

test('real job runner with fake dependencies saves through the adapter',async()=>{
  const runner=createPrecomputeRaceRunnerAdapter(defaults());
  const result=await runner(job);
  assert.equal(result.status,'SAVED');
  assert.equal(result.raceId,job.raceId);
  assert.equal(Object.isFrozen(job),true);
});

test('injected job receives explicit dependencies, enabled true and a job timestamp',async()=>{
  const deps=defaults();
  let calls=0,received;
  const runner=createPrecomputeRaceRunnerAdapter({...deps,runJob:async (input,options)=>{
    calls++;received={input,options};return {status:'UNCHANGED',saved:false};
  }});
  assert.deepEqual(await runner(job),{status:'UNCHANGED',saved:false});
  assert.equal(calls,1);
  assert.equal(received.input,job);
  assert.equal(received.options.enabled,true);
  assert.equal(received.options.now,timestamp);
  for(const key of ['loadSource','calculate','loadLatest','save','versions']){
    assert.equal(received.options[key],deps[key]);
  }
});

test('equivalent timestamp representations reach runJob as the same UTC ISO instant',async()=>{
  const received=[];
  for(const value of ['2026-09-23T09:00:00+09:00','2026-09-23T00:00:00.000Z']){
    const runner=createPrecomputeRaceRunnerAdapter({
      ...defaults(),now:()=>value,
      runJob:async (_job,options)=>{
        received.push(options.now);
        return {status:'UNCHANGED',saved:false};
      }
    });
    await runner(job);
  }
  assert.deepEqual(received,[timestamp,timestamp]);
});

test('all success and no-op states retain their result without reinterpretation',async()=>{
  for(const status of ['SAVED','SOURCE_VALIDATED','UNCHANGED','SUPERSEDED']){
    const value={status,saved:status==='SAVED',revision:2};
    const runner=createPrecomputeRaceRunnerAdapter({...defaults(),runJob:async()=>value});
    assert.equal(await runner(job),value);
  }
});

test('resolved FAILED becomes a per-job failure in bounded execution',async()=>{
  const jobs=[job,Object.freeze({...job,raceNo:2,raceId:raceJobKey({...job,raceNo:2})})];
  let calls=0;
  const runner=createPrecomputeRaceRunnerAdapter({...defaults(),runJob:async()=>{
    calls++;return calls===1?{status:'FAILED',error:'source_unavailable',saved:false}:{status:'SAVED',saved:true};
  }});
  const result=await runBoundedPrecomputeJobs({organization:'JRA',jobs,runner,deadline:100,now:()=>0});
  assert.equal(result.status,'FAILED');
  assert.deepEqual(result.failedJobs.map(record=>record.error),['source_unavailable']);
  assert.equal(result.completedCount,1);
  assert.equal(result.failedCount,1);
  assert.equal(calls,2);
});

test('real job runner failure is not counted as completion',async()=>{
  const runner=createPrecomputeRaceRunnerAdapter({...defaults(),loadSource:async()=>{throw new Error('source_unavailable');}});
  const result=await runBoundedPrecomputeJobs({organization:'JRA',jobs:[job],runner,deadline:100,now:()=>0});
  assert.equal(result.failedCount,1);
  assert.equal(result.completedCount,0);
  assert.equal(result.failedJobs[0].error,'source_unavailable');
});

test('DISABLED, unknown, null and malformed success values fail closed',async()=>{
  for(const value of [{status:'DISABLED'}, {status:'UNKNOWN'},null,{}, {status:'FAILED'}]){
    const runner=createPrecomputeRaceRunnerAdapter({...defaults(),runJob:async()=>value});
    await assert.rejects(runner(job),/unexpected_precompute_race_job_status|precompute_race_job_failed/);
  }
});

test('runner rejection propagates without retry',async()=>{
  let calls=0;
  const error=new Error('failed');
  const runner=createPrecomputeRaceRunnerAdapter({...defaults(),runJob:async()=>{calls++;throw error;}});
  await assert.rejects(runner(job),candidate=>candidate===error);
  assert.equal(calls,1);
});

test('invalid dependencies and timestamps reject before invoking a job',async()=>{
  for(const key of ['runJob','loadSource','calculate','loadLatest','save','now']){
    const input={...defaults(),runJob:async()=>({status:'SAVED'}),[key]:null};
    assert.throws(()=>createPrecomputeRaceRunnerAdapter(input));
  }
  assert.throws(()=>createPrecomputeRaceRunnerAdapter({...defaults(),versions:null}),/invalid_precompute_versions/);
  for(const value of [null,NaN,0,'bad-date']){
    let calls=0;
    const runner=createPrecomputeRaceRunnerAdapter({...defaults(),now:()=>value,runJob:async()=>{calls++;}});
    await assert.rejects(runner(job),/invalid_precompute_job_timestamp/);
    assert.equal(calls,0);
  }
});

test('module stays disconnected from Worker and has no direct I/O or timeout',async()=>{
  const source=await readFile(new URL('../src/prediction/precompute-race-runner-adapter.mjs',import.meta.url),'utf8');
  for(const pattern of [/\bfetch\s*\(/,/\.prepare\s*\(/,/Date\.now\s*\(/,/setTimeout\s*\(/,/Promise\.race\s*\(/,/AbortController/,/Math\.random\s*\(/]){
    assert.doesNotMatch(source,pattern);
  }
  for(const file of ['../worker.js','../worker-entry.mjs']){
    const content=await readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(content,/precompute-race-runner-adapter/);
  }
});
