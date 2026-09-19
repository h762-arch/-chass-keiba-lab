import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {raceJobKey} from '../src/prediction/background-precompute.mjs';
import {discoverPrecomputeRaceJobs} from '../src/prediction/precompute-job-discovery.mjs';

const meeting=(overrides={})=>({organization:'JRA',date:'2026-09-20',track:'中山',status:'meeting',raceNumbers:[1,2,3],cancelledRaceNumbers:[],...overrides});

test('JRA meeting produces minimal descriptors using the existing race identity',()=>{
  const jobs=discoverPrecomputeRaceJobs([meeting()]);
  assert.deepEqual(jobs,[1,2,3].map(raceNo=>({organization:'JRA',date:'2026-09-20',track:'中山',raceNo,raceId:raceJobKey({organization:'JRA',date:'2026-09-20',track:'中山',raceNo})})));
});

test('NAR meeting produces isolated descriptors',()=>{
  const jobs=discoverPrecomputeRaceJobs([meeting({organization:'NAR',track:'大井',raceNumbers:[1,2]})]);
  assert.deepEqual(jobs,[1,2].map(raceNo=>({organization:'NAR',date:'2026-09-20',track:'大井',raceNo,raceId:`20260920-NAR-大井-0${raceNo}`})));
});

test('JRA and NAR identities never collide for the same logical race coordinates',()=>{
  const jobs=discoverPrecomputeRaceJobs([
    meeting({organization:'NAR',track:'共有',raceNumbers:[1]}),
    meeting({organization:'JRA',track:'共有',raceNumbers:[1]})
  ]);
  assert.equal(jobs.length,2);
  assert.equal(new Set(jobs.map(job=>job.raceId)).size,2);
  assert.deepEqual(jobs.map(job=>job.organization),['JRA','NAR']);
});

test('duplicate meetings, numeric strings and duplicate races collapse by existing race identity',()=>{
  const input=meeting({raceNumbers:[2,'1',2,'01']});
  const jobs=discoverPrecomputeRaceJobs([input,{...input,raceNumbers:[1,2]}]);
  assert.deepEqual(jobs.map(job=>job.raceNo),[1,2]);
});

test('meeting and race input ordering cannot change output ordering',()=>{
  const logical=[
    meeting({organization:'NAR',date:'2026-09-21',track:'大井',raceNumbers:[3,1,2]}),
    meeting({organization:'JRA',date:'2026-09-20',track:'阪神',raceNumbers:[2,1]}),
    meeting({organization:'JRA',date:'2026-09-20',track:'中山',raceNumbers:[2,1]})
  ];
  const reversed=logical.toReversed().map(item=>({...item,raceNumbers:item.raceNumbers.toReversed()}));
  assert.deepEqual(discoverPrecomputeRaceJobs(logical),discoverPrecomputeRaceJobs(reversed));
});

test('empty, non-meeting, unknown and missing statuses produce no jobs',()=>{
  assert.deepEqual(discoverPrecomputeRaceJobs([]),[]);
  for(const status of ['non_meeting','unknown',undefined])assert.deepEqual(discoverPrecomputeRaceJobs([meeting({status})]),[]);
  assert.deepEqual(discoverPrecomputeRaceJobs([{status:'non_meeting'}]),[]);
  assert.deepEqual(discoverPrecomputeRaceJobs([{}]),[]);
});

test('explicit race cancellations are deduplicated and excluded',()=>{
  const jobs=discoverPrecomputeRaceJobs([meeting({raceNumbers:[1,2,3,4],cancelledRaceNumbers:[2,'2',4]})]);
  assert.deepEqual(jobs.map(job=>job.raceNo),[1,3]);
});

test('explicit cancellation wins across conflicting duplicate meetings regardless of input order',()=>{
  const active=meeting({raceNumbers:[1,2]}),cancelled=meeting({raceNumbers:[1,2],cancelledRaceNumbers:[1]});
  assert.deepEqual(discoverPrecomputeRaceJobs([active,cancelled]).map(job=>job.raceNo),[2]);
  assert.deepEqual(discoverPrecomputeRaceJobs([cancelled,active]).map(job=>job.raceNo),[2]);
});

test('horse changes and unexpected fields never leak into descriptors',()=>{
  const jobs=discoverPrecomputeRaceJobs([meeting({
    raceNumbers:[1],changes:[{raceNo:1,horseNo:8,horseStatus:'scratched'}],
    SOURCE:{horses:[1]},DATA:{score:1},MARKET:{odds:2.5},odds:2.5,popularity:1,revision:9,unexpected:'secret'
  })]);
  assert.deepEqual(Object.keys(jobs[0]),['organization','date','track','raceNo','raceId']);
  for(const key of ['SOURCE','DATA','MARKET','odds','popularity','revision','changes','unexpected'])assert.equal(key in jobs[0],false);
});

test('unsupported organizations and malformed meeting records reject explicitly',()=>{
  assert.throws(()=>discoverPrecomputeRaceJobs([meeting({organization:'XYZ'})]),/unsupported_race_job_organization/);
  assert.throws(()=>discoverPrecomputeRaceJobs([meeting({organization:'jra'})]),/unsupported_race_job_organization/);
  assert.throws(()=>discoverPrecomputeRaceJobs(null),/invalid_race_job_meetings/);
  assert.throws(()=>discoverPrecomputeRaceJobs([null]),/invalid_race_job_meeting/);
  assert.throws(()=>discoverPrecomputeRaceJobs([meeting({raceNumbers:null})]),/invalid_race_numbers/);
  assert.throws(()=>discoverPrecomputeRaceJobs([meeting({cancelledRaceNumbers:'2'})]),/invalid_cancelled_race_numbers/);
});

test('dates, tracks and race numbers are validated before identity creation',()=>{
  for(const date of ['2026/09/20','2026-02-30','2026-13-01','',['2026-09-20'],20260920])assert.throws(()=>discoverPrecomputeRaceJobs([meeting({date})]),/invalid_race_job_date/);
  for(const track of ['', '   ',123,['中山']])assert.throws(()=>discoverPrecomputeRaceJobs([meeting({track})]),/invalid_race_job_track/);
  for(const raceNo of [0,13,1.5,'x',true,null,{},' 1','1 '])assert.throws(()=>discoverPrecomputeRaceJobs([meeting({raceNumbers:[raceNo]})]),/invalid_race_job_number/);
  assert.deepEqual(discoverPrecomputeRaceJobs([meeting({track:'  中山  ',raceNumbers:['12']})])[0],{organization:'JRA',date:'2026-09-20',track:'中山',raceNo:12,raceId:'20260920-JRA-中山-12'});
});

test('discovery does not mutate input and returns immutable deterministic output',()=>{
  const input=[meeting({raceNumbers:[3,1,2],cancelledRaceNumbers:[2]})];
  const before=structuredClone(input);
  const first=discoverPrecomputeRaceJobs(input),second=discoverPrecomputeRaceJobs(structuredClone(input));
  assert.deepEqual(input,before);
  assert.deepEqual(first,second);
  assert.ok(Object.isFrozen(first));
  assert.ok(first.every(Object.isFrozen));
});

test('discovery module is side-effect free and remains disconnected from runtime',async()=>{
  const source=await readFile(new URL('../src/prediction/precompute-job-discovery.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|DB|D1|env|Date\.now|setTimeout|setInterval|Math\.random|calculator|savePrecomputedSnapshot)\b/);
  const [worker,entry]=await Promise.all([
    readFile(new URL('../worker.js',import.meta.url),'utf8'),
    readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(worker,/precompute-job-discovery/);
  assert.doesNotMatch(entry,/precompute-job-discovery/);
});
