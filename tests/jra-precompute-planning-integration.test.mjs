import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseJraRaceCard,JRA_RACE_PARSER_VERSION} from '../jra-race-fetch.mjs';
import {createJraPrecomputePlanningIntegration} from '../src/prediction/jra-precompute-planning-integration.mjs';
import {calculateJraData} from '../src/prediction/jra-data-calculator.mjs';

const date='2026-09-05',scheduledTime=Date.parse('2026-09-04T15:00:00Z');
const current=Date.parse('2026-09-05T00:00:00Z');
const fetchedAt='2026-09-04T23:45:00.000Z',expiresAt='2026-09-05T01:00:00.000Z';
const versions={calculationVersion:'jra-ability-data-v1',modelVersion:'10.0.1-jra-drive1-ability'};
const card=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const parsed=parseJraRaceCard(card,{date,track:'中山',race:5});
const raceId=no=>`20260905-JRA-中山-${String(no).padStart(2,'0')}`;
const body=no=>({ok:true,organization:'JRA',...structuredClone(parsed),
 race:{...parsed.race,raceNo:no},fetchedAt,
 sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=example'});
function cacheRow(no,payload=body(no)){
 const payload_json=JSON.stringify(payload);
 return {kind:'race',cache_key:`race|${date}|中山|${no}`,organization:'JRA',race_date:date,track:'中山',race_no:no,
  payload_json,source_url:payload.sourceUrl,fetched_at:fetchedAt,expires_at:expiresAt,
  parser_version:JRA_RACE_PARSER_VERSION,content_hash:createHash('sha256').update(payload_json).digest('hex')};
}
function setup(numbers=[5,6,7],overrides={}){
 const calls={meetings:0,races:[],latest:[],saves:0,writes:0};
 const rows=new Map(numbers.map(no=>[no,cacheRow(no)])),saved=[];
 const meeting={date,status:'complete',meetings_json:JSON.stringify([{
  organization:'JRA',date,track:'中山',status:'meeting',raceNumbers:numbers
 }]),checked_at:fetchedAt,next_refresh_at:expiresAt,source:'JRA_OFFICIAL',parser_version:'jra-program-v1',error_code:null};
 const DB={prepare(sql){
  if(sql.startsWith('SELECT date, status, meetings_json'))return {bind(value){assert.equal(value,date);
   return {async first(){calls.meetings++;return meeting}}}};
  if(sql.startsWith('SELECT kind,cache_key,organization'))return {bind(key){return {async first(){
   const no=Number(key.split('|').at(-1));calls.races.push(no);return rows.get(no)??null;
  }}}};
  throw new Error('unexpected_sql');
 },run(){calls.writes++;throw new Error('write_forbidden')}};
 const options={DB,sourceMode:'official-cache',maxPlanningJobs:2,maxJobs:1,
  planningDeadline:current+2_000,executionDeadline:current+5_000,now:()=>current,versions,
  readLatest:async(binding,organization,id)=>{
   assert.equal(binding,DB);assert.equal(organization,'JRA');calls.latest.push(id);return null;
  },saveSnapshot:async(binding,snapshot)=>{
   assert.equal(binding,DB);calls.saves++;saved.push(snapshot);return {saved:true,revision:1};
  },...overrides};
 return {options,calls,rows,saved};
}

test('one captured SOURCE/latest per inspected job feeds selector and bounded runner',async()=>{
 const {options,calls,saved}=setup();
 const run=createJraPrecomputePlanningIntegration(options);
 assert.equal(calls.meetings,0);
 const result=await run({scheduledTime});
 assert.equal(result.targetDate,date);
 assert.equal(result.selectionTurn,Math.floor(scheduledTime/300_000));
 assert.equal(result.discoveredCount,3);
 assert.equal(result.planning.status,'PARTIAL');
 assert.equal(result.planning.reason,'MAX_PLANNING_JOBS');
 assert.equal(result.planning.inspectedCount,2);
 assert.equal(result.planning.unscannedCount,1);
 assert.equal(result.execution.status,'COMPLETED');
 assert.equal(result.execution.completedJobs[0].value.status,'SAVED');
 assert.equal(calls.meetings,1);
 assert.equal(calls.races.length,2);
 assert.equal(calls.latest.length,2);
 assert.deepStrictEqual(new Set(calls.races.map(raceId)),new Set(calls.latest));
 assert.equal(calls.saves,1);
 assert.equal(calls.writes,0);
 assert.deepStrictEqual(saved[0].layers.DATA,calculateJraData(saved[0].layers.SOURCE));
 assert.equal(JSON.stringify(result).includes('horses'),false);
 assert.equal(result.planning.unscannedJobs[0].raceId!==saved[0].raceId,true);
});

test('planning deadline at entry preserves every discovered job as unscanned with zero race reads',async()=>{
 const {options,calls}=setup([5,6],{planningDeadline:current});
 const result=await createJraPrecomputePlanningIntegration(options)({scheduledTime});
 assert.equal(result.planning.status,'PARTIAL');
 assert.equal(result.planning.reason,'DEADLINE');
 assert.equal(result.planning.unscannedCount,2);
 assert.equal(result.selection.selectedCount,0);
 assert.equal(result.execution.totalJobs,0);
 assert.deepStrictEqual(calls,{meetings:1,races:[],latest:[],saves:0,writes:0});
});

test('execution deadline is independent: selection can complete yet execution starts nothing',async()=>{
 const {options,calls}=setup([5],{maxPlanningJobs:1,executionDeadline:current});
 const result=await createJraPrecomputePlanningIntegration(options)({scheduledTime});
 assert.equal(result.planning.status,'COMPLETE');
 assert.equal(result.selection.selectedCount,1);
 assert.equal(result.execution.status,'PARTIAL');
 assert.deepStrictEqual(result.execution.unstartedJobs.map(job=>job.raceId),[raceId(5)]);
 assert.deepStrictEqual(calls.races,[5]);
 assert.deepStrictEqual(calls.latest,[raceId(5)]);
 assert.equal(calls.saves,0);
});

test('cache mutation after planning cannot change the selected SOURCE or trigger a second read',async()=>{
 const {options,calls,rows,saved}=setup([5],{maxPlanningJobs:1});
 const original=body(5),changed=body(5);
 changed.horses[0].horseName='計画後の差し替え';
 options.readLatest=async()=>{
  calls.latest.push(raceId(5));rows.set(5,cacheRow(5,changed));return null;
 };
 const result=await createJraPrecomputePlanningIntegration(options)({scheduledTime});
 assert.equal(result.execution.status,'COMPLETED');
 assert.deepStrictEqual(calls.races,[5]);
 assert.deepStrictEqual(calls.latest,[raceId(5)]);
 assert.deepStrictEqual(saved[0].layers.SOURCE.horses.map(h=>h.horseName),
  original.horses.map(h=>h.horseName));
});

test('rotation before planning truncation reaches every race even at one job per turn',async()=>{
 const {options,calls}=setup([5,6,7],{maxPlanningJobs:1,maxJobs:0});
 const first=[];
 for(let turn=0;turn<3;turn++){
  const result=await createJraPrecomputePlanningIntegration(options)({scheduledTime:scheduledTime+turn*300_000});
  first.push(result.selection.deferredJobs[0].raceId);
  assert.equal(result.planning.unscannedCount,2);
 }
 assert.deepStrictEqual(new Set(first),new Set([raceId(5),raceId(6),raceId(7)]));
 assert.equal(calls.races.length,3);
 assert.equal(calls.latest.length,3);
 assert.equal(calls.saves,0);
});

test('expired cache does not reach latest/runner and unknown status fails closed',async()=>{
 const {options,calls,rows}=setup([5],{maxPlanningJobs:1});
 rows.delete(5);
 const result=await createJraPrecomputePlanningIntegration(options)({scheduledTime});
 assert.equal(result.selection.unavailable[0].reason,'jra_precompute_cache_missing');
 assert.equal(result.execution.totalJobs,0);
 assert.equal(calls.latest.length,0);
 const wrong=body(5);delete wrong.horses[0].runningStatus;
 rows.set(5,cacheRow(5,wrong));
 await assert.rejects(createJraPrecomputePlanningIntegration(options)({scheduledTime}),
  error=>error.code==='jra_precompute_cache_invalid');
 assert.equal(calls.saves,0);
});

test('invalid schedule, direct mode and missing versions fail before any I/O',async()=>{
 const {options,calls}=setup();
 assert.throws(()=>createJraPrecomputePlanningIntegration({...options,sourceMode:'direct'}),
  /jra_precompute_direct_mode_not_approved/);
 assert.throws(()=>createJraPrecomputePlanningIntegration({...options,sourceMode:undefined}),
  /invalid_jra_precompute_source_mode/);
 assert.throws(()=>createJraPrecomputePlanningIntegration({...options,versions:{}}),
  /jra_explicit_versions_required/);
 await assert.rejects(createJraPrecomputePlanningIntegration(options)({scheduledTime:NaN}),
  /invalid_jra_precompute_scheduled_time/);
 assert.equal(calls.meetings+calls.races.length+calls.latest.length+calls.saves,0);
});

test('wall clock reversal between meeting read and planning fails before race I/O',async()=>{
 const {options,calls}=setup([5],{maxPlanningJobs:1});
 let ticks=0;
 options.now=()=>++ticks===1?current:current-1;
 await assert.rejects(createJraPrecomputePlanningIntegration(options)({scheduledTime}),
  /jra_precompute_wall_clock_reversed/);
 assert.deepStrictEqual(calls.races,[]);
 assert.deepStrictEqual(calls.latest,[]);
 assert.equal(calls.saves,0);
});

test('module remains isolated from Worker and Production activation',async()=>{
 const source=await readFile(new URL('../src/prediction/jra-precompute-planning-integration.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/worker\.js|ENABLE_|fetchImpl|fetch\s*\(|jra-precompute-production-composition/);
 for(const name of ['../worker.js','../worker-entry.mjs']){
  const worker=await readFile(new URL(name,import.meta.url),'utf8');
  assert.equal(worker.includes('jra-precompute-planning-integration'),false);
 }
});
