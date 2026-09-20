import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {raceJobKey} from '../src/prediction/background-precompute.mjs';
import {runBoundedPrecomputeJobs} from '../src/prediction/precompute-execution-budget.mjs';

const job=(organization,raceNo,extra={})=>Object.freeze({organization,date:'2026-09-20',track:organization==='JRA'?'中山':'大井',raceNo,raceId:raceJobKey({organization,date:'2026-09-20',track:organization==='JRA'?'中山':'大井',raceNo}),...extra});
const execute=(overrides={})=>runBoundedPrecomputeJobs({organization:'JRA',jobs:[job('JRA',1),job('JRA',2)],runner:async value=>value.raceId,deadline:100,now:()=>0,...overrides});

test('JRA and NAR batches complete within the injected budget',async()=>{
  for(const organization of ['JRA','NAR']){
    const calls=[],jobs=[job(organization,1),job(organization,2)];
    const result=await execute({organization,jobs,runner:async value=>{calls.push(value.raceId);return value.raceNo},now:()=>10});
    assert.equal(result.status,'COMPLETED');
    assert.deepEqual(calls,jobs.map(value=>value.raceId));
    assert.deepEqual([result.totalJobs,result.startedCount,result.completedCount,result.failedCount,result.unstartedCount],[2,2,2,0,0]);
  }
});

test('an expired or exactly reached deadline starts no jobs',async()=>{
  for(const current of [100,101]){
    let calls=0;
    const result=await execute({now:()=>current,runner:async()=>calls++});
    assert.equal(calls,0);
    assert.equal(result.status,'PARTIAL');
    assert.equal(result.startedCount,0);
    assert.equal(result.unstartedCount,2);
  }
});

test('deadline is checked before every job and leaves remaining jobs unstarted',async()=>{
  const times=[0,100],calls=[];
  const result=await execute({now:()=>times.shift(),runner:async value=>calls.push(value.raceId)});
  assert.equal(result.status,'PARTIAL');
  assert.equal(result.completedCount,1);
  assert.equal(result.unstartedCount,1);
  assert.deepEqual(calls,[job('JRA',1).raceId]);
  assert.equal(result.unstartedJobs[0].raceId,job('JRA',2).raceId);
});

test('a running job is awaited after the deadline and only the next start is blocked',async()=>{
  let finish,clock=0,calls=0;
  const running=new Promise(resolve=>{finish=resolve});
  const pending=execute({now:()=>clock,runner:async()=>{calls++;await running;clock=101;return 'done'}});
  await Promise.resolve();
  assert.equal(calls,1);
  finish();
  const result=await pending;
  assert.equal(result.completedJobs[0].value,'done');
  assert.equal(result.unstartedCount,1);
  assert.equal(calls,1);
});

test('runner failures are recorded without retry and later jobs still observe budget',async()=>{
  const calls=[];
  const result=await execute({runner:async value=>{calls.push(value.raceId);if(value.raceNo===1)throw Object.assign(new Error('boom'),{code:'fixture_failure'});return 'ok'}});
  assert.equal(result.status,'FAILED');
  assert.equal(result.completedCount,1);
  assert.equal(result.failedCount,1);
  assert.equal(result.unstartedCount,0);
  assert.equal(result.failedJobs[0].error,'fixture_failure');
  assert.deepEqual(calls,[job('JRA',1).raceId,job('JRA',2).raceId]);
});

test('empty jobs produce an immutable zero-work result',async()=>{
  const result=await execute({jobs:[]});
  assert.equal(result.status,'COMPLETED');
  assert.deepEqual([result.totalJobs,result.startedCount,result.completedCount,result.failedCount,result.unstartedCount],[0,0,0,0,0]);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.completedJobs)&&Object.isFrozen(result.failedJobs)&&Object.isFrozen(result.unstartedJobs));
});

test('organization, identity, duplicate, runner and time inputs fail closed',async()=>{
  await assert.rejects(()=>execute({organization:'OTHER'}),/unsupported_precompute_execution_organization/);
  await assert.rejects(()=>execute({jobs:[job('JRA',1),job('NAR',2)]}),/organization_mismatch/);
  await assert.rejects(()=>execute({organization:'NAR',jobs:[job('JRA',1)]}),/organization_mismatch/);
  await assert.rejects(()=>execute({jobs:[{...job('JRA',1),raceId:'wrong'}]}),/identity_mismatch/);
  await assert.rejects(()=>execute({jobs:[job('JRA',1),job('JRA',1)]}),/duplicate_precompute_execution_job/);
  await assert.rejects(()=>execute({runner:null}),/invalid_precompute_execution_runner/);
  for(const deadline of [undefined,null,'100',NaN,Infinity,-Infinity])await assert.rejects(()=>execute({deadline}),/invalid_precompute_execution_deadline/);
  await assert.rejects(()=>execute({now:null}),/invalid_precompute_execution_clock/);
  for(const value of [NaN,Infinity,-Infinity,'1'])await assert.rejects(()=>execute({now:()=>value}),/invalid_precompute_execution_clock/);
  await assert.rejects(()=>execute({jobs:[],now:()=>NaN}),/invalid_precompute_execution_clock/);
});

test('invalid later or backward clock values stop before another job starts',async()=>{
  for(const second of [NaN,Infinity,-Infinity,'1']){
    const times=[0,second],result=await execute({now:()=>times.shift()});
    assert.equal(result.status,'FAILED');
    assert.equal(result.completedCount,1);
    assert.equal(result.unstartedCount,1);
    assert.equal(result.error,'invalid_precompute_execution_clock');
  }
  const times=[10,9],result=await execute({now:()=>times.shift()});
  assert.equal(result.status,'FAILED');
  assert.equal(result.error,'non_monotonic_precompute_execution_clock');
  assert.equal(result.unstartedCount,1);
});

test('input is not mutated and execution does not create lifecycle layers',async()=>{
  const first=job('JRA',1,{SOURCE:{secret:true},DATA:{x:1},MARKET:{odds:2},extra:'drop'}),input=Object.freeze([first]);
  const before=structuredClone(input),seen=[];
  const result=await execute({jobs:input,runner:async value=>seen.push(value)});
  assert.deepEqual(input,before);
  assert.deepEqual(Object.keys(seen[0]),['organization','date','track','raceNo','raceId']);
  assert.equal('SOURCE' in result.completedJobs[0].job,false);
  assert.equal('DATA' in result.completedJobs[0].job,false);
  assert.equal('MARKET' in result.completedJobs[0].job,false);
});

test('execution unstarted jobs stay distinct from selection deferred jobs',async()=>{
  const selectionDeferred=Object.freeze([job('JRA',3)]);
  const result=await execute({now:()=>100});
  assert.notEqual(result.unstartedJobs,selectionDeferred);
  assert.deepEqual(result.unstartedJobs.map(value=>value.raceNo),[1,2]);
  assert.deepEqual(selectionDeferred.map(value=>value.raceNo),[3]);
  assert.equal('deferredJobs' in result,false);
});

test('module remains zero-IO, clock-injected and disconnected from runtime',()=>{
  const source=fs.readFileSync(new URL('../src/prediction/precompute-execution-budget.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|D1|DB|fs|env|SOURCE|calculator|snapshot|save|setTimeout|setInterval|Date\.now|performance\.now|Math\.random|retry|AbortController|Promise\.race)\b/);
  for(const file of ['../worker.js','../worker-entry.mjs','../src/prediction/background-precompute.mjs']){
    assert.doesNotMatch(fs.readFileSync(new URL(file,import.meta.url),'utf8'),/precompute-execution-budget/);
  }
});
