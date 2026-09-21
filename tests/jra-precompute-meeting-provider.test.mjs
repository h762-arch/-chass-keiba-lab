import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createJraPrecomputeMeetingProvider} from '../src/prediction/jra-precompute-meeting-provider.mjs';
import {discoverPrecomputeRaceJobs} from '../src/prediction/precompute-job-discovery.mjs';
import {createPrecomputeRuntimeRunner} from '../src/prediction/precompute-runtime-adapter.mjs';

const date='2026-09-21';
const nowMs=Date.parse('2026-09-21T00:00:00.000Z');

const baseMeetings=()=>[
  {organization:'JRA',date,track:'中山',status:'meeting',raceNumbers:[1,2]},
  {organization:'JRA',date,track:'阪神',status:'non_meeting',raceNumbers:[]}
];

const row=(overrides={})=>({
  date,
  status:'complete',
  meetings_json:JSON.stringify(baseMeetings()),
  checked_at:'2026-09-20T23:59:00.000Z',
  next_refresh_at:'2026-09-21T01:00:00.000Z',
  source:'JRA_OFFICIAL',
  parser_version:'jra-program-v1',
  error_code:null,
  ...overrides
});

function fakeDb(result){
  const calls={prepare:0,bind:0,first:0,sql:null,date:null,write:0};
  return {
    calls,
    prepare(sql){
      calls.prepare+=1;
      calls.sql=sql;
      return {bind(value){
        calls.bind+=1;
        calls.date=value;
        return {async first(){calls.first+=1;return typeof result==='function'?result():result;}};
      }};
    },
    run(){calls.write+=1;throw new Error('write_not_allowed');},
    batch(){calls.write+=1;throw new Error('write_not_allowed');},
    exec(){calls.write+=1;throw new Error('write_not_allowed');}
  };
}

const makeProvider=(result=row(),overrides={})=>{
  const DB=fakeDb(result);
  return {DB,loadMeetings:createJraPrecomputeMeetingProvider({DB,date,now:()=>nowMs,...overrides})};
};

async function rejectsCode(promise,code){
  await assert.rejects(promise,error=>error?.code===code);
}

test('fresh complete cache is read once and returned as immutable canonical JRA descriptors',async()=>{
  const source=row({meetings_json:JSON.stringify([
    {...baseMeetings()[0],extra:'drop-me'},
    baseMeetings()[1]
  ])});
  const before=structuredClone(source);
  const {DB,loadMeetings}=makeProvider(source);
  const meetings=await loadMeetings({organization:'JRA'});

  assert.deepEqual(meetings,baseMeetings());
  assert.equal(Object.hasOwn(meetings[0],'extra'),false);
  assert.equal(Object.isFrozen(meetings),true);
  assert.equal(Object.isFrozen(meetings[0]),true);
  assert.equal(Object.isFrozen(meetings[0].raceNumbers),true);
  assert.deepEqual(source,before);
  assert.deepEqual([DB.calls.prepare,DB.calls.bind,DB.calls.first,DB.calls.write],[1,1,1,0]);
  assert.equal(DB.calls.date,date);
  assert.match(DB.calls.sql,/^SELECT date, status, meetings_json, checked_at, next_refresh_at, source, parser_version, error_code/);
  assert.doesNotMatch(DB.calls.sql,/INSERT|UPDATE|DELETE|CREATE|ALTER/i);
});

test('provider composes with Runtime Adapter and passes meetings unchanged to Pipeline',async()=>{
  const {loadMeetings}=makeProvider();
  let pipelineInput;
  const expected={organization:'JRA',discoveredCount:2};
  const runtime=createPrecomputeRuntimeRunner({
    organization:'JRA',loadMeetings,maxJobs:2,deadline:nowMs+1000,now:()=>nowMs,
    raceRunner:async()=>({status:'SAVED'}),
    pipeline:async input=>{pipelineInput=input;return expected;}
  });
  assert.equal(await runtime(),expected);
  assert.deepEqual(pipelineInput.meetings,baseMeetings());
  assert.equal(pipelineInput.organization,'JRA');
});

test('returned meetings are accepted by Pure Discovery without invented cancellation data',async()=>{
  const {loadMeetings}=makeProvider();
  const meetings=await loadMeetings({organization:'JRA'});
  const jobs=discoverPrecomputeRaceJobs(meetings);
  assert.deepEqual(jobs.map(job=>job.raceNo),[1,2]);
  assert.equal(Object.hasOwn(meetings[0],'cancelledRaceNumbers'),false);
});

test('missing and unknown cache rows fail closed instead of becoming empty meetings',async()=>{
  await rejectsCode(makeProvider(null).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_missing');
  await rejectsCode(makeProvider(row({status:'unknown',meetings_json:'[]'})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_unknown');
});

test('stale cache and exact deadline boundary fail closed',async()=>{
  await rejectsCode(makeProvider(row({next_refresh_at:'2026-09-20T23:59:59.999Z'})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_stale');
  await rejectsCode(makeProvider(row({next_refresh_at:'2026-09-21T00:00:00.000Z'})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_stale');
});

test('invalid freshness timestamp fails closed',async()=>{
  for(const next_refresh_at of ['not-a-timestamp','',null,123]){
    await rejectsCode(makeProvider(row({next_refresh_at})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_invalid');
  }
});

test('malformed and non-array meetings JSON fail closed',async()=>{
  await rejectsCode(makeProvider(row({meetings_json:'{'})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_invalid');
  await rejectsCode(makeProvider(row({meetings_json:'{}'})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_invalid');
});

test('wrong descriptor organization, date, or status fails closed',async()=>{
  for(const meeting of [
    {...baseMeetings()[0],organization:'NAR'},
    {...baseMeetings()[0],date:'2026-09-22'},
    {...baseMeetings()[0],status:'unknown'}
  ]){
    await rejectsCode(makeProvider(row({meetings_json:JSON.stringify([meeting])})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_invalid');
  }
  await rejectsCode(makeProvider(row({date:'2026-09-22'})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_invalid');
});

test('provider rejects NAR and missing organization before any SELECT',async()=>{
  for(const organization of ['NAR',undefined]){
    const {DB,loadMeetings}=makeProvider();
    await rejectsCode(loadMeetings({organization}),'invalid_jra_precompute_meeting_organization');
    assert.equal(DB.calls.prepare,0);
  }
});

test('invalid DB and clock dependencies fail closed',async()=>{
  assert.throws(()=>createJraPrecomputeMeetingProvider({DB:null,date,now:()=>nowMs}),error=>error.code==='invalid_jra_precompute_meeting_db');
  assert.throws(()=>createJraPrecomputeMeetingProvider({DB:{prepare(){}},date:'bad',now:()=>nowMs}),error=>error.code==='invalid_jra_precompute_meeting_date');
  assert.throws(()=>createJraPrecomputeMeetingProvider({DB:{prepare(){}},date}),error=>error.code==='invalid_jra_precompute_meeting_clock');
  for(const value of [NaN,Infinity,-Infinity,'0',null]){
    const DB=fakeDb(row());
    const loadMeetings=createJraPrecomputeMeetingProvider({DB,date,now:()=>value});
    await rejectsCode(loadMeetings({organization:'JRA'}),'invalid_jra_precompute_meeting_clock');
    assert.equal(DB.calls.prepare,0);
  }
  const loadMeetings=createJraPrecomputeMeetingProvider({DB:{prepare(){throw new Error('offline');}},date,now:()=>nowMs});
  await rejectsCode(loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_read_failed');
});

test('invalid race numbers and unsupported or empty tracks fail closed',async()=>{
  for(const meeting of [
    {...baseMeetings()[0],raceNumbers:[0]},
    {...baseMeetings()[0],raceNumbers:[13]},
    {...baseMeetings()[0],raceNumbers:['x']},
    {...baseMeetings()[0],track:'大井'},
    {...baseMeetings()[0],track:''},
    {...baseMeetings()[1],raceNumbers:[1]}
  ]){
    await rejectsCode(makeProvider(row({meetings_json:JSON.stringify([meeting])})).loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_invalid');
  }
});

test('complete cache with an empty meeting array fails closed because the official parser cannot produce it',async()=>{
  const {loadMeetings}=makeProvider(row({meetings_json:'[]'}));
  await rejectsCode(loadMeetings({organization:'JRA'}),'jra_precompute_meeting_cache_invalid');
});

test('explicit cancellation is preserved and validated without mutating cached data',async()=>{
  const meetings=[{...baseMeetings()[0],cancelledRaceNumbers:[2],SOURCE:{secret:true},odds:[1.2]}];
  const source=row({meetings_json:JSON.stringify(meetings)});
  const before=structuredClone(source);
  const {loadMeetings}=makeProvider(source);
  const output=await loadMeetings({organization:'JRA'});
  assert.deepEqual(output[0].cancelledRaceNumbers,[2]);
  assert.equal(Object.isFrozen(output[0].cancelledRaceNumbers),true);
  assert.equal(Object.hasOwn(output[0],'SOURCE'),false);
  assert.equal(Object.hasOwn(output[0],'odds'),false);
  assert.deepEqual(source,before);
  assert.deepEqual(discoverPrecomputeRaceJobs(output).map(job=>job.raceNo),[1]);
});

test('production module has no direct network, refresh, write, clock, timer, or runtime wiring',()=>{
  const source=fs.readFileSync(new URL('../src/prediction/jra-precompute-meeting-provider.mjs',import.meta.url),'utf8');
  for(const forbidden of [
    /\bfetch\s*\(/,/handleJraMeetingRequest/,/handleJraMeetingPersistent/,/runScheduledJraMeetingRefresh/,
    /\.run\s*\(/,/\.batch\s*\(/,/\.exec\s*\(/,/\bINSERT\b/i,/\bUPDATE\b/i,/\bDELETE\b/i,
    /Date\.now\s*\(/,/setTimeout\s*\(/,/setInterval\s*\(/,/Math\.random\s*\(/,
    /worker\.js/,/worker-entry\.mjs/,/calculator/,/snapshot save/i
  ])assert.doesNotMatch(source,forbidden);
});
