import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseJraRaceCard,JRA_RACE_PARSER_VERSION} from '../jra-race-fetch.mjs';
import {calculateJraData} from '../src/prediction/jra-data-calculator.mjs';
import {createJraPrecomputeCacheOnlyComposition} from '../src/prediction/jra-precompute-cache-only-composition.mjs';

const date='2026-09-05',current=Date.parse('2026-09-05T00:00:00.000Z');
const fetchedAt='2026-09-04T23:45:00.000Z',expiresAt='2026-09-05T01:00:00.000Z';
const versions={calculationVersion:'jra-ability-data-v1',modelVersion:'10.0.1-jra-drive1-ability'};
const card=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const parsed=parseJraRaceCard(card,{date,track:'中山',race:5});
const raceId=no=>`20260905-JRA-中山-${String(no).padStart(2,'0')}`;
const body=no=>({ok:true,organization:'JRA',...structuredClone(parsed),
 race:{...parsed.race,raceNo:no},fetchedAt,
 sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=example'});
const cacheRow=(no,payload=body(no),overrides={})=>{
 const payload_json=JSON.stringify(payload);
 return {kind:'race',cache_key:`race|${date}|中山|${no}`,organization:'JRA',race_date:date,track:'中山',race_no:no,
  payload_json,source_url:payload.sourceUrl,fetched_at:fetchedAt,expires_at:expiresAt,
  parser_version:JRA_RACE_PARSER_VERSION,content_hash:createHash('sha256').update(payload_json).digest('hex'),...overrides};
};
function setup(numbers=[5],overrides={}){
 const calls={meetings:0,races:0,storeReads:0,saves:0,writes:0};
 const rows=new Map(numbers.map(no=>[no,cacheRow(no)])),saved=[];
 let meeting={date,status:'complete',meetings_json:JSON.stringify([{organization:'JRA',date,track:'中山',status:'meeting',raceNumbers:numbers}]),
  checked_at:fetchedAt,next_refresh_at:expiresAt,source:'JRA_OFFICIAL',parser_version:'jra-program-v1',error_code:null};
 const DB={prepare(sql){
  if(sql.startsWith('SELECT date, status, meetings_json'))return {bind(value){assert.equal(value,date);return {async first(){calls.meetings++;return meeting}}}};
  if(sql.startsWith('SELECT kind,cache_key,organization'))return {bind(key){return {async first(){calls.races++;return rows.get(Number(key.split('|').at(-1)))??null}}}};
  throw Error('unexpected_sql');
 },run(){calls.writes++;throw Error('write_forbidden')}};
 const options={DB,date,maxJobs:1,deadline:current+5000,now:()=>current,versions,
  readLatest:async(binding,organization,id)=>{
   assert.equal(binding,DB);assert.equal(organization,'JRA');assert.ok(id.startsWith('20260905-JRA-中山-'));
   calls.storeReads++;return null;
  },
  saveSnapshot:async(binding,snapshot)=>{
   assert.equal(binding,DB);calls.saves++;saved.push(snapshot);
   return {saved:true,revision:1};
  },...overrides};
 return {DB,rows,calls,saved,options,setMeeting(value){meeting=value}};
}

test('construction is inert; selected fresh SOURCE goes through bounded DATA runner and snapshot store',async()=>{
 const {calls,saved,options}=setup();
 const run=createJraPrecomputeCacheOnlyComposition(options);
 assert.deepStrictEqual(calls,{meetings:0,races:0,storeReads:0,saves:0,writes:0});
 const result=await run({selectionTurn:0});
 assert.equal(result.organization,'JRA');
 assert.equal(result.discoveredCount,1);
 assert.deepStrictEqual(result.selection.selectedJobs.map(job=>job.raceId),[raceId(5)]);
 assert.equal(result.execution.status,'COMPLETED');
 assert.equal(result.execution.completedJobs[0].value.status,'SAVED');
 assert.deepStrictEqual(calls,{meetings:1,races:1,storeReads:2,saves:1,writes:0});
 assert.equal(saved[0].layers.SOURCE.acquiredAt,fetchedAt);
 assert.deepStrictEqual(saved[0].layers.DATA,calculateJraData(saved[0].layers.SOURCE));
 assert.equal(saved[0].calculationVersion,versions.calculationVersion);
 assert.equal(saved[0].modelVersion,versions.modelVersion);
 for(const layer of ['MARKET','FINAL','RESULT'])assert.equal(saved[0].layers[layer],null);
 assert.equal(JSON.stringify(result).includes('horses'),false); // SOURCE Map stays local.
});

test('default snapshot ports use only the injected fake D1 binding',async()=>{
 const {DB,options}=setup();
 let inserts=0,insertValues;
 const prepare=DB.prepare.bind(DB);
 DB.prepare=sql=>{
  if(sql.startsWith('SELECT date, status, meetings_json')||sql.startsWith('SELECT kind,cache_key,organization'))return prepare(sql);
  return {bind(...values){
   if(sql.startsWith('INSERT INTO precomputed_race_snapshots')){
    insertValues=values;
    return {async run(){inserts++;return {success:true}}};
   }
   if(sql.startsWith('SELECT MAX(revision)'))return {async first(){return {revision:0}}};
   if(sql.startsWith('SELECT'))return {async first(){return null}};
   throw Error('unexpected_sql');
  }};
 };
 const run=createJraPrecomputeCacheOnlyComposition({...options,readLatest:undefined,saveSnapshot:undefined});
 assert.equal(inserts,0);
 const result=await run({selectionTurn:0});
 assert.equal(result.execution.status,'COMPLETED');
 assert.equal(inserts,1);
 assert.equal(insertValues[0],'JRA');
 assert.equal(insertValues[10],versions.calculationVersion);
 assert.equal(insertValues[11],versions.modelVersion);
 for(const index of [16,17,18])assert.equal(insertValues[index],null);
});

test('mutation of race cache after selection cannot change SOURCE actually calculated or cause a second race read',async()=>{
 const {rows,calls,saved,options}=setup();
 const original=body(5),changed=body(5);
 changed.horses[0].horseName='後から差し替えた馬';
 options.readLatest=async()=>{
  calls.storeReads++;
  if(calls.storeReads===1)rows.set(5,cacheRow(5,changed));
  return null;
 };
 const result=await createJraPrecomputeCacheOnlyComposition(options)({selectionTurn:0});
 assert.equal(result.execution.status,'COMPLETED');
 assert.equal(calls.races,1);
 assert.deepStrictEqual(saved[0].layers.SOURCE.horses.map(h=>h.horseName),original.horses.map(h=>h.horseName));
 assert.deepStrictEqual(saved[0].layers.DATA,calculateJraData(saved[0].layers.SOURCE));
});

test('fresh-only selection skips unavailable jobs and caller turns rotate eligible jobs',async()=>{
 const {rows,calls,saved,options}=setup([5,6]);
 rows.delete(5);
 const run=createJraPrecomputeCacheOnlyComposition(options);
 const first=await run({selectionTurn:0});
 assert.deepStrictEqual(first.selection.selectedJobs.map(job=>job.raceId),[raceId(6)]);
 assert.equal(first.selection.unavailable[0].reason,'jra_precompute_cache_missing');
 assert.equal(calls.races,2);
 assert.equal(saved[0].raceId,raceId(6));
 rows.set(5,cacheRow(5));
 const second=await run({selectionTurn:1});
 assert.deepStrictEqual(second.selection.selectedJobs.map(job=>job.raceId),[raceId(6)]);
 const third=await run({selectionTurn:2});
 assert.deepStrictEqual(third.selection.selectedJobs.map(job=>job.raceId),[raceId(5)]);
 assert.equal(calls.races,6);
});

test('expired cache never falls back, and corrupt or unknown-status SOURCE fails before execution',async()=>{
 const {rows,calls,options}=setup();
 rows.set(5,cacheRow(5,body(5),{expires_at:new Date(current).toISOString()}));
 let result=await createJraPrecomputeCacheOnlyComposition(options)({selectionTurn:0});
 assert.equal(result.selection.selectedCount,0);
 assert.equal(result.selection.unavailable[0].reason,'jra_precompute_cache_expired');
 assert.equal(result.execution.totalJobs,0);
 assert.equal(calls.storeReads+calls.saves+calls.writes,0);
 const wrong=body(5);delete wrong.horses[0].runningStatus;
 rows.set(5,cacheRow(5,wrong));
 await assert.rejects(createJraPrecomputeCacheOnlyComposition(options)({selectionTurn:1}),error=>error.code==='jra_precompute_cache_invalid');
 rows.set(5,cacheRow(5,body(5),{content_hash:'a'.repeat(64)}));
 await assert.rejects(createJraPrecomputeCacheOnlyComposition(options)({selectionTurn:2}),error=>error.code==='jra_precompute_cache_corrupt');
 assert.equal(calls.saves+calls.writes,0);
});

test('missing explicit versions and selectionTurn fail before any I/O; stale meeting stops race reads',async()=>{
 const {calls,options,setMeeting}=setup();
 for(const version of [undefined,{}, {calculationVersion:'v'},{modelVersion:'v'}]){
  assert.throws(()=>createJraPrecomputeCacheOnlyComposition({...options,versions:version}),/jra_explicit_versions_required/);
 }
 const run=createJraPrecomputeCacheOnlyComposition(options);
 await assert.rejects(run(),/invalid_jra_precompute_selection_turn/);
 await assert.rejects(run({selectionTurn:-1}),/invalid_jra_precompute_selection_turn/);
 assert.deepStrictEqual(calls,{meetings:0,races:0,storeReads:0,saves:0,writes:0});
 setMeeting({date,status:'complete',meetings_json:'[]',next_refresh_at:new Date(current).toISOString()});
 await assert.rejects(run({selectionTurn:0}),error=>error.code==='jra_precompute_meeting_cache_stale');
 assert.equal(calls.races+calls.storeReads+calls.saves,0);
});

test('isolated module has no Worker, network, flags, or direct composition connection',async()=>{
 const text=await readFile(new URL('../src/prediction/jra-precompute-cache-only-composition.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(text,/fetchImpl|fetch\s*\(|jra-precompute-production-composition|ENABLE_BACKGROUND_PRECOMPUTE|ENABLE_PRECOMPUTED_VIEWER/);
 for(const name of ['../worker.js','../worker-entry.mjs']){
  const worker=await readFile(new URL(name,import.meta.url),'utf8');
  assert.equal(worker.includes('jra-precompute-cache-only-composition'),false);
 }
});
