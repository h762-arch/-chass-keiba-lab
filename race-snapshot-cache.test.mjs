import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readD1Manifest} from '../worker.js';

async function loadCore(fetchImpl){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8'),memory=new Map(),window={__CHASS_TEST__:true};
  const context={window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,structuredClone,fetch:fetchImpl,localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});return window.CHASS_TEST;
}

function record(){return {race:{raceDate:'2026-09-07',track:'大井',raceNo:10},predictionSnapshot:{modelVersion:'10.0.1',createdAt:'2026-09-07T09:00:00.000Z',race:{raceDate:'2026-09-07',track:'大井',raceNo:10},horses:[{horseNo:1,horseName:'テスト',win:30,place:60}]},marketSnapshot:null,finalSnapshot:{top3:[{horseNo:1,mark:'◎'}]},resultSnapshot:null,validationSnapshot:null,validationCompleted:false,updatedAt:'2026-09-07T09:00:00.000Z'} }

test('ten unchanged snapshot saves produce no research write or cloud POST',async()=>{
  const calls=[],core=await loadCore(async(url,options={})=>{calls.push([String(url),options.method||'GET']);return new Response(JSON.stringify({ok:true,records:[]}),{headers:{'content-type':'application/json'}})}),id='2026-09-07|大井|10',saved=record();
  core.saveRaceRecord(id,saved);await new Promise(resolve=>setTimeout(resolve,0));calls.length=0;core.resetStorageDiagnostics();
  for(let i=0;i<10;i++)assert.equal(core.persistRecordIfChanged(id,structuredClone(saved)).changed,false);
  await new Promise(resolve=>setTimeout(resolve,0));const d=core.getStorageDiagnostics();
  assert.equal(d.unchangedPersist,10);assert.equal(d.indexedDbWrite,0);assert.equal(d.cloudPost,0);assert.equal(d.d1Write,0);assert.equal(d.researchRefresh,0);assert.equal(calls.length,0);
});

test('single-race cloud sync never triggers a full research refresh',async()=>{
  const calls=[],saved=record(),descriptorResponse={raceId:'2026-09-07|大井|10',modelVersion:'10.0.1',status:'prediction_saved'};
  const core=await loadCore(async(url,options={})=>{calls.push([String(url),options.method||'GET']);return new Response(JSON.stringify({ok:true,records:[{raceId:'2026-09-07|大井|10',written:true,descriptor:descriptorResponse}]}),{headers:{'content-type':'application/json'}})});
  await core.syncRaceToCloud('2026-09-07|大井|10',saved);
  assert.equal(calls.filter(([url])=>url.includes('/api/db/sync')).length,1);assert.equal(calls.some(([url])=>url.includes('/api/db/research')),false);
});

test('cloud initialization loads health and manifest but defers research dataset',async()=>{
  const calls=[],core=await loadCore(async url=>{calls.push(String(url));const body=String(url).includes('/manifest')?{ok:true,records:[]}:{ok:true};return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})});
  await core.initCloudResearch();
  assert.equal(calls.some(url=>url.includes('/api/db/health')),true);assert.equal(calls.some(url=>url.includes('/api/db/manifest')),true);assert.equal(calls.some(url=>url.includes('/api/db/research')),false);
});

test('manifest uses scalar fingerprints without reading snapshot JSON for migrated rows',async()=>{
  const sql=[];const row={race_id:'r1',model_version:'10.0.1',updated_at:'2026-09-07T09:00:00Z',status:'prediction_saved',race_fp:'r',prediction_fp:'p',market_fp:null,final_fp:'f',result_fp:null,validation_fp:null,live_fp:'l'};
  const DB={prepare(query){sql.push(String(query));return {async all(){return {results:[row]}}}},async batch(){}};
  const manifest=await readD1Manifest(DB);
  const selects=sql.filter(query=>/^SELECT/i.test(query.trim()));assert.equal(manifest[0].predictionFingerprint,'p');assert.equal(selects.length,1);assert.equal(selects[0].includes('prediction_json'),false);
});

test('fingerprint migration is additive and never drops existing data',async()=>{
  const sql=await readFile(new URL('../migrations/0003_race_fingerprints.sql',import.meta.url),'utf8');
  assert.match(sql,/ALTER TABLE races ADD COLUMN prediction_fp/i);assert.doesNotMatch(sql,/\bDROP\b/i);
});
