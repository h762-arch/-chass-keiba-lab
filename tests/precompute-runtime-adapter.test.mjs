import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPrecomputeRuntimeRunner} from '../src/prediction/precompute-runtime-adapter.mjs';

const meeting=(organization,track,raceNumbers=[])=>Object.freeze({
  organization,
  date:'2026-09-21',
  track,
  status:'meeting',
  raceNumbers:Object.freeze([...raceNumbers]),
  cancelledRaceNumbers:Object.freeze([])
});

const create=(overrides={})=>createPrecomputeRuntimeRunner({
  organization:'JRA',
  loadMeetings:async()=>[meeting('JRA','中山',[2,1])],
  maxJobs:2,
  deadline:100,
  now:()=>0,
  raceRunner:async job=>job.raceId,
  ...overrides
});

test('JRA and NAR injected dependencies execute through the default pipeline',async()=>{
  for(const [organization,track] of [['JRA','中山'],['NAR','大井']]){
    const calls=[];
    const runner=create({
      organization,
      loadMeetings:async()=>[meeting(organization,track,[2,1])],
      raceRunner:async job=>{calls.push(job.raceNo);return job.raceId}
    });
    const result=await runner();
    assert.equal(result.organization,organization);
    assert.equal(result.discoveredCount,2);
    assert.equal(result.execution.status,'COMPLETED');
    assert.deepEqual(calls,[1,2]);
  }
});

test('adapter calls the provider once and forwards dependencies unchanged',async()=>{
  const meetings=Object.freeze([meeting('JRA','中山',[1])]);
  const now=()=>7;
  const raceRunner=async()=>{};
  const expected=Object.freeze({pipeline:'result'});
  let providerCalls=0,pipelineCalls=0,providerArgument,pipelineArgument;
  const runner=create({
    loadMeetings:async argument=>{providerCalls++;providerArgument=argument;return meetings},
    maxJobs:1,
    deadline:42,
    now,
    raceRunner,
    pipeline:async argument=>{pipelineCalls++;pipelineArgument=argument;return expected}
  });
  assert.equal(await runner(),expected);
  assert.equal(providerCalls,1);
  assert.equal(pipelineCalls,1);
  assert.deepEqual(providerArgument,{organization:'JRA'});
  assert.equal(pipelineArgument.organization,'JRA');
  assert.equal(pipelineArgument.meetings,meetings);
  assert.equal(pipelineArgument.maxJobs,1);
  assert.equal(pipelineArgument.deadline,42);
  assert.equal(pipelineArgument.now,now);
  assert.equal(pipelineArgument.runner,raceRunner);
});

test('meeting provider failure is fail-closed before pipeline without retry',async()=>{
  const failure=Object.assign(new Error('provider failed'),{code:'provider_failure'});
  let providerCalls=0,pipelineCalls=0;
  const runner=create({
    loadMeetings:async()=>{providerCalls++;throw failure},
    pipeline:async()=>{pipelineCalls++}
  });
  await assert.rejects(runner,error=>error===failure);
  assert.equal(providerCalls,1);
  assert.equal(pipelineCalls,0);
});

test('pipeline failure propagates unchanged without retry',async()=>{
  const failure=Object.assign(new Error('pipeline failed'),{code:'pipeline_failure'});
  let providerCalls=0,pipelineCalls=0;
  const runner=create({
    loadMeetings:async()=>{providerCalls++;return []},
    pipeline:async()=>{pipelineCalls++;throw failure}
  });
  await assert.rejects(runner,error=>error===failure);
  assert.equal(providerCalls,1);
  assert.equal(pipelineCalls,1);
});

test('factory rejects invalid adapter dependencies',()=>{
  for(const loadMeetings of [undefined,null,false,{}])assert.throws(()=>create({loadMeetings}),/invalid_precompute_meeting_provider/);
  for(const raceRunner of [undefined,null,false,{}])assert.throws(()=>create({raceRunner}),/invalid_precompute_race_runner/);
  for(const pipeline of [null,false,{}])assert.throws(()=>create({pipeline}),/invalid_precompute_pipeline/);
});

test('domain validation remains owned by the default pipeline',async()=>{
  await assert.rejects(create({organization:'OTHER'}),/unsupported_precompute_job_organization/);
  await assert.rejects(create({maxJobs:-1}),/invalid_precompute_max_jobs/);
  await assert.rejects(create({deadline:NaN}),/invalid_precompute_execution_deadline/);
  await assert.rejects(create({now:()=>NaN}),/invalid_precompute_execution_clock/);
});

test('empty meetings produce zero work while preserving clock validation',async()=>{
  let raceCalls=0;
  const result=await create({loadMeetings:async()=>[],raceRunner:async()=>raceCalls++})();
  assert.equal(raceCalls,0);
  assert.equal(result.discoveredCount,0);
  assert.equal(result.execution.totalJobs,0);
  assert.equal(result.execution.status,'COMPLETED');
  await assert.rejects(create({loadMeetings:async()=>[],now:()=>NaN}),/invalid_precompute_execution_clock/);
});

test('adapter does not mutate configuration or provider meetings',async()=>{
  const meetings=Object.freeze([meeting('JRA','中山',[2,1])]);
  const config=Object.freeze({
    organization:'JRA',
    loadMeetings:async()=>meetings,
    maxJobs:2,
    deadline:100,
    now:()=>0,
    raceRunner:async job=>job.raceId
  });
  const before=structuredClone(meetings);
  const result=await createPrecomputeRuntimeRunner(config)();
  assert.deepEqual(meetings,before);
  assert.deepEqual(result.execution.completedJobs.map(record=>record.job.raceNo),[1,2]);
});

test('production adapter is thin, direct-IO-free, and runtime-disconnected',()=>{
  const source=fs.readFileSync(new URL('../src/prediction/precompute-runtime-adapter.mjs',import.meta.url),'utf8');
  assert.match(source,/pipeline=runPrecomputePipeline/);
  assert.match(source,/meetings=await loadMeetings\(\{organization\}\)/);
  assert.match(source,/return pipeline\(\{/);
  assert.doesNotMatch(source,/\b(?:fetch|D1|DB|fs|env|SOURCE|DATA|MARKET|FINAL|RESULT|calculator|snapshot|save|setTimeout|setInterval|Date\.now|performance\.now|Math\.random|retry|AbortController|Promise\.race)\b/);
  for(const file of ['../worker.js','../worker-entry.mjs','../src/prediction/background-precompute.mjs']){
    assert.doesNotMatch(fs.readFileSync(new URL(file,import.meta.url),'utf8'),/precompute-runtime-adapter/);
  }
});

test('flags remain off and NAR special cron stays isolated',()=>{
  const wrangler=fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.match(wrangler,/"ENABLE_BACKGROUND_PRECOMPUTE"\s*:\s*"false"/);
  assert.match(wrangler,/"ENABLE_PRECOMPUTED_VIEWER"\s*:\s*"false"/);
  const entry=fs.readFileSync(new URL('../worker-entry.mjs',import.meta.url),'utf8');
  assert.match(entry,/controller\?\.cron==='0 11 \* \* \*'\|\|controller\?\.cron==='30 11 \* \* \*'/);
  assert.match(entry,/ctx\.waitUntil\(runNarTomorrowPrefetch\(env\)\)/);
});
