import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runPrecomputePipeline} from '../src/prediction/precompute-pipeline.mjs';

const meeting=(organization,track,raceNumbers,extra={})=>Object.freeze({
  organization,
  date:'2026-09-20',
  track,
  status:'meeting',
  raceNumbers:Object.freeze([...raceNumbers]),
  cancelledRaceNumbers:Object.freeze([]),
  ...extra
});

const run=(overrides={})=>runPrecomputePipeline({
  organization:'JRA',
  meetings:[meeting('JRA','中山',[1,2,3])],
  maxJobs:3,
  deadline:100,
  now:()=>0,
  runner:async job=>job.raceId,
  ...overrides
});

test('JRA and NAR compose discovery selection and execution to completion',async()=>{
  for(const [organization,track] of [['JRA','中山'],['NAR','大井']]){
    const calls=[];
    const result=await run({organization,meetings:[meeting(organization,track,[3,1,2])],runner:async job=>{calls.push(job.raceNo);return job.raceId}});
    assert.equal(result.organization,organization);
    assert.equal(result.discoveredCount,3);
    assert.equal(result.selection.selectedCount,3);
    assert.equal(result.execution.status,'COMPLETED');
    assert.equal(result.execution.completedCount,3);
    assert.deepEqual(calls,[1,2,3]);
  }
});

test('selection deferred jobs and execution unstarted jobs remain separate',async()=>{
  const times=[0,100];
  const result=await run({meetings:[meeting('JRA','中山',[1,2,3,4])],maxJobs:3,now:()=>times.shift()});
  assert.deepEqual(result.selection.selectedJobs.map(job=>job.raceNo),[1,2,3]);
  assert.deepEqual(result.selection.deferredJobs.map(job=>job.raceNo),[4]);
  assert.deepEqual(result.execution.completedJobs.map(record=>record.job.raceNo),[1]);
  assert.deepEqual(result.execution.unstartedJobs.map(job=>job.raceNo),[2,3]);
  assert.notEqual(result.selection.deferredJobs,result.execution.unstartedJobs);
  assert.equal('deferredJobs' in result.execution,false);
  assert.equal('unstartedJobs' in result.selection,false);
});

test('an already reached deadline starts no selected job',async()=>{
  let calls=0;
  const result=await run({deadline:10,now:()=>10,runner:async()=>calls++});
  assert.equal(calls,0);
  assert.equal(result.execution.status,'PARTIAL');
  assert.equal(result.execution.unstartedCount,3);
});

test('a running job is not aborted when the clock crosses the deadline',async()=>{
  let finish,clock=0,calls=0;
  const running=new Promise(resolve=>{finish=resolve});
  const pending=run({runner:async()=>{calls++;await running;clock=101;return 'done'},now:()=>clock});
  await Promise.resolve();
  assert.equal(calls,1);
  finish();
  const result=await pending;
  assert.equal(result.execution.completedJobs[0].value,'done');
  assert.equal(result.execution.unstartedCount,2);
  assert.equal(calls,1);
});

test('runner failure keeps the execution contract without retry or reinterpretation',async()=>{
  const calls=[];
  const result=await run({runner:async job=>{calls.push(job.raceNo);if(job.raceNo===1)throw Object.assign(new Error('boom'),{code:'fixture_failure'});return 'ok'}});
  assert.equal(result.execution.status,'FAILED');
  assert.equal(result.execution.failedCount,1);
  assert.equal(result.execution.completedCount,2);
  assert.equal(result.execution.failedJobs[0].error,'fixture_failure');
  assert.deepEqual(calls,[1,2,3]);
});

test('mixed or mismatched organizations fail closed without implicit filtering',async()=>{
  await assert.rejects(()=>run({meetings:[meeting('JRA','中山',[1]),meeting('NAR','大井',[1])]}),/organization_mismatch/);
  await assert.rejects(()=>run({organization:'JRA',meetings:[meeting('NAR','大井',[1])]}),/organization_mismatch/);
  await assert.rejects(()=>run({organization:'OTHER'}),/unsupported_precompute_job_organization/);
});

test('duplicate and cancellation behavior is owned by discovery',async()=>{
  const first=meeting('JRA','中山',[3,1,2,2],{cancelledRaceNumbers:Object.freeze([2])});
  const duplicate=meeting('JRA','中山',[1,2,3],{cancelledRaceNumbers:Object.freeze([2,2])});
  const result=await run({meetings:[duplicate,first]});
  assert.equal(result.discoveredCount,2);
  assert.deepEqual(result.selection.selectedJobs.map(job=>job.raceNo),[1,3]);
  assert.deepEqual(result.execution.completedJobs.map(record=>record.job.raceNo),[1,3]);
});

test('empty meetings remain zero-work while preserving execution clock validation',async()=>{
  let calls=0;
  const result=await run({meetings:[],runner:async()=>calls++});
  assert.equal(calls,0);
  assert.equal(result.discoveredCount,0);
  assert.equal(result.selection.selectedCount,0);
  assert.equal(result.execution.status,'COMPLETED');
  assert.equal(result.execution.totalJobs,0);
  await assert.rejects(()=>run({meetings:[],now:()=>NaN}),/invalid_precompute_execution_clock/);
});

test('validation failures propagate from their owning contracts',async()=>{
  await assert.rejects(()=>run({maxJobs:-1}),/invalid_precompute_max_jobs/);
  for(const deadline of [undefined,null,'100',NaN,Infinity,-Infinity])await assert.rejects(()=>run({deadline}),/invalid_precompute_execution_deadline/);
  await assert.rejects(()=>run({now:()=>NaN}),/invalid_precompute_execution_clock/);
  const times=[10,9],result=await run({now:()=>times.shift()});
  assert.equal(result.execution.status,'FAILED');
  assert.equal(result.execution.error,'non_monotonic_precompute_execution_clock');
  assert.equal(result.execution.unstartedCount,2);
});

test('pipeline preserves input and never creates prediction lifecycle layers',async()=>{
  const meetings=Object.freeze([meeting('JRA','中山',[2,1],{SOURCE:{hidden:true},MARKET:{odds:2},unexpected:'drop'})]);
  const before=structuredClone(meetings),seen=[];
  const result=await run({meetings,runner:async job=>seen.push(job)});
  assert.deepEqual(meetings,before);
  assert.deepEqual(seen.map(job=>Object.keys(job)),[
    ['organization','date','track','raceNo','raceId'],
    ['organization','date','track','raceNo','raceId']
  ]);
  for(const key of ['SOURCE','DATA','MARKET','FINAL','RESULT']){
    assert.equal(key in result,false);
    assert.equal(key in result.selection,false);
    assert.equal(key in result.execution,false);
  }
  assert.ok(Object.isFrozen(result));
});

test('production module is a thin zero-IO composition and remains runtime-disconnected',()=>{
  const source=fs.readFileSync(new URL('../src/prediction/precompute-pipeline.mjs',import.meta.url),'utf8');
  assert.match(source,/discoverPrecomputeRaceJobs\(meetings\)/);
  assert.match(source,/selectPrecomputeJobs\(\{organization,jobs:discoveredJobs,maxJobs\}\)/);
  assert.match(source,/runBoundedPrecomputeJobs\(\{/);
  assert.doesNotMatch(source,/\b(?:fetch|D1|DB|fs|env|SOURCE|calculator|snapshot|save|setTimeout|setInterval|Date\.now|performance\.now|Math\.random|retry|AbortController|Promise\.race)\b/);
  for(const file of ['../worker.js','../worker-entry.mjs','../src/prediction/background-precompute.mjs']){
    assert.doesNotMatch(fs.readFileSync(new URL(file,import.meta.url),'utf8'),/precompute-pipeline/);
  }
});
