import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJraPrecomputeProductionComposition} from '../src/prediction/jra-precompute-production-composition.mjs';

const date='2026-09-05',nowMs=Date.parse('2026-09-05T00:00:00.000Z');
const versions={calculationVersion:'jra-data-isolated-v1',modelVersion:'10.0.1-jra-drive1'};
const token='pw01dde0106202604010520260905/16';
const listing=`<html><body><a href="/JRADB/accessD.html?CNAME=${token}">5R</a></body></html>`;
const card=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const row={
 date,status:'complete',
 meetings_json:JSON.stringify([{organization:'JRA',date,track:'中山',status:'meeting',raceNumbers:[5]}]),
 checked_at:'2026-09-04T23:59:00.000Z',next_refresh_at:'2026-09-05T01:00:00.000Z',
 source:'JRA_OFFICIAL',parser_version:'jra-program-v1',error_code:null
};
function fakeDb(){
 const calls={reads:0,writes:0};
 return {calls,prepare(sql){
  if(!/^SELECT date, status, meetings_json/.test(sql))throw Error('unexpected_sql');
  return {bind(value){
   assert.equal(value,date);
   return {async first(){calls.reads++;return row}};
  }};
 },run(){calls.writes++;throw Error('write_not_allowed')}};
}
function setup(overrides={}){
 const DB=fakeDb(),calls={fetches:0,reads:0,saves:0},saved=[];
 const options={
  DB,date,now:()=>nowMs,maxJobs:1,deadline:nowMs+5000,sourceTimeoutMs:1000,versions,
  fetchImpl:async()=>{
   calls.fetches++;
   return new Response(calls.fetches===1?listing:card);
  },
  readLatest:async (binding,organization,raceId)=>{
   assert.equal(binding,DB);assert.equal(organization,'JRA');assert.match(raceId,/20260905-JRA-中山-05/);
   calls.reads++;return null;
  },
  saveSnapshot:async (binding,snapshot)=>{
   assert.equal(binding,DB);calls.saves++;saved.push(snapshot);
   return {saved:true,revision:1};
  },
  ...overrides
 };
 return {DB,calls,saved,options};
}

test('construction is inert; runtime composes meeting, bounded SOURCE, DATA and store ports',async()=>{
 const {DB,calls,saved,options}=setup();
 const runtime=createJraPrecomputeProductionComposition(options);
 assert.equal(typeof runtime,'function');
 assert.deepStrictEqual([DB.calls.reads,DB.calls.writes,calls.fetches,calls.reads,calls.saves],[0,0,0,0,0]);
 const result=await runtime();
 assert.equal(result.organization,'JRA');
 assert.equal(result.execution.status,'COMPLETED');
 assert.equal(result.execution.completedJobs[0].value.status,'SAVED');
 assert.deepStrictEqual([DB.calls.reads,DB.calls.writes,calls.fetches,calls.reads,calls.saves],[1,0,2,1,1]);
 assert.equal(saved[0].calculationVersion,versions.calculationVersion);
 assert.equal(saved[0].modelVersion,versions.modelVersion);
 assert.equal(saved[0].layers.DATA.horses.length,3);
 assert.equal(saved[0].layers.SOURCE.source,'JRA_OFFICIAL');
 for(const layer of ['MARKET','FINAL','RESULT'])assert.equal(saved[0].layers[layer],null);
});

test('default store ports reach only the injected fake D1 binding at runtime',async()=>{
 const {options}=setup();
 let inserts=0,insertValues;
 const DB={prepare(sql){
  return {bind(...values){
   if(sql.startsWith('INSERT INTO precomputed_race_snapshots')){
    insertValues=values;
    return {async run(){inserts++;return {success:true}}};
   }
   if(sql.startsWith('SELECT date, status, meetings_json'))return {async first(){return row}};
   if(sql.startsWith('SELECT MAX(revision)'))return {async first(){return {revision:0}}};
   if(sql.startsWith('SELECT'))return {async first(){return null}};
   throw Error('unexpected_sql');
  }};
 }};
 const runtime=createJraPrecomputeProductionComposition({
  ...options,DB,readLatest:undefined,saveSnapshot:undefined
 });
 assert.equal(inserts,0);
 const result=await runtime();
 assert.equal(result.execution.status,'COMPLETED');
 assert.equal(inserts,1);
 assert.equal(insertValues[0],'JRA');
 assert.equal(insertValues[10],versions.calculationVersion);
 assert.equal(insertValues[11],versions.modelVersion);
 assert.equal(insertValues[16],null);
 assert.equal(insertValues[17],null);
 assert.equal(insertValues[18],null);
});

test('versions belong to caller and are required before any I/O',()=>{
 for(const value of [undefined,null,{}, {modelVersion:'m'},{calculationVersion:'c'}]){
  const {DB,calls,options}=setup({versions:value});
  assert.throws(()=>createJraPrecomputeProductionComposition(options),/jra_explicit_version/);
  assert.equal(DB.calls.reads+DB.calls.writes+calls.fetches+calls.reads+calls.saves,0);
 }
});

test('meeting cache failure stops before SOURCE and store',async()=>{
 const {DB,calls,options}=setup();
 DB.prepare=()=>({bind:()=>({first:async()=>null})});
 const runtime=createJraPrecomputeProductionComposition(options);
 await assert.rejects(runtime(),/jra_precompute_meeting_cache_missing/);
 assert.deepStrictEqual([calls.fetches,calls.reads,calls.saves],[0,0,0]);
});

test('invalid runtime budget and missing source boundary reject at construction',()=>{
 for(const overrides of [{maxJobs:-1},{deadline:NaN},{sourceTimeoutMs:0},{fetchImpl:null}]){
  const {options}=setup(overrides);
  assert.throws(()=>createJraPrecomputeProductionComposition(options));
 }
});

test('module stays disconnected from Worker, schedule and feature flags',async()=>{
 const moduleText=await readFile(new URL('../src/prediction/jra-precompute-production-composition.mjs',import.meta.url),'utf8');
 for(const token of ['worker.js','worker-entry.mjs','scheduled','ENABLE_BACKGROUND_PRECOMPUTE','ENABLE_PRECOMPUTED_VIEWER','wrangler']){
  assert.equal(moduleText.includes(token),false);
 }
 for(const file of ['../worker.js','../worker-entry.mjs']){
  const worker=await readFile(new URL(file,import.meta.url),'utf8');
  assert.equal(worker.includes('jra-precompute-production-composition'),false);
 }
});
