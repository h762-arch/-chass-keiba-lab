import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {calculateJraData} from '../src/prediction/jra-data-calculator.mjs';
import {calculateJraDataLayer,createIsolatedJraDataRaceRunner} from '../src/prediction/jra-data-race-runner-adapter.mjs';

const html=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const source=parseJraRaceCard(html,{date:'2026-09-05',track:'中山',race:5});
const job=Object.freeze({organization:'JRA',date:'2026-09-05',track:'中山',raceNo:5});
const timestamp='2026-09-05T01:00:00.000Z';
const versions={calculationVersion:'jra-data-isolated-v1',modelVersion:'10.0.1-jra-drive1'};
const clone=value=>structuredClone(value);
const dependencies=()=>({
 loadSource:async()=>clone(source),
 loadLatest:async()=>null,
 save:async()=>({saved:true,revision:1}),
 now:()=>timestamp
});

test('calculator envelope is DATA only and retains the exact calculator output',()=>{
 const result=calculateJraDataLayer(clone(source));
 assert.deepStrictEqual(Object.keys(result),['DATA']);
 assert.deepStrictEqual(result.DATA,calculateJraData(clone(source)));
});

test('real generic runner receives isolated DATA with explicit caller versions',async()=>{
 let saved=null,loads=0;
 const runner=createIsolatedJraDataRaceRunner({
  ...dependencies(),versions,
  loadSource:async()=>{loads++;return clone(source)},
  save:async snapshot=>{saved=snapshot;return {saved:true,revision:1}}
 });
 const result=await runner(job);
 assert.equal(result.status,'SAVED');
 assert.equal(loads,1);
 assert.deepStrictEqual(saved.layers.DATA,calculateJraData(clone(source)));
 assert.deepStrictEqual(saved.layers.SOURCE,source);
 for(const layer of ['MARKET','FINAL','RESULT'])assert.equal(saved.layers[layer],null);
 assert.equal(saved.calculationVersion,versions.calculationVersion);
 assert.equal(saved.modelVersion,versions.modelVersion);
});

test('both JRA versions must be explicit before source loading or job execution',async()=>{
 let called=0;
 for(const supplied of [undefined,null,{}, {modelVersion:'m'}, {calculationVersion:'c'},
  {calculationVersion:'',modelVersion:'m'}, {calculationVersion:'c',modelVersion:' '},
  {calculationVersion:0,modelVersion:'m'}, {calculationVersion:'c',modelVersion:0}]) {
  assert.throws(()=>createIsolatedJraDataRaceRunner({
   ...dependencies(),versions:supplied,
   loadSource:async()=>{called++;return source}
  }),/jra_explicit_version/);
 }
 assert.equal(called,0);
});

test('version object mutations after composition cannot change the runner declaration',async()=>{
 const provided={...versions};
 let received;
 const runner=createIsolatedJraDataRaceRunner({...dependencies(),versions:provided,
  runJob:async (_job,options)=>{received=options.versions;return {status:'UNCHANGED',saved:false}}
 });
 provided.modelVersion='changed-after-composition';
 await runner(job);
 assert.equal(received.modelVersion,versions.modelVersion);
 assert.equal(Object.isFrozen(received),true);
});

test('declared calculation and model versions each change snapshot identity',async()=>{
 const identities=[];
 for(const declared of [versions,{...versions,calculationVersion:'jra-data-isolated-v2'},
  {...versions,modelVersion:'10.0.1-jra-drive2'}]){
  let snapshot;
  const runner=createIsolatedJraDataRaceRunner({...dependencies(),versions:declared,
   save:async value=>{snapshot=value;return {saved:true,revision:1}}
  });
  assert.equal((await runner(job)).status,'SAVED');
  identities.push(snapshot.inputHash);
 }
 assert.equal(new Set(identities).size,3);
});

test('scratched runner stays in SOURCE and does not enter DATA',async()=>{
 const changed=clone(source);
 changed.horses.push({...clone(source.horses[0]),horseNo:98,runningStatus:'scratched'});
 let saved;
 const runner=createIsolatedJraDataRaceRunner({...dependencies(),versions,
  loadSource:async()=>changed,
  save:async snapshot=>{saved=snapshot;return {saved:true,revision:1}}
 });
 assert.equal((await runner(job)).status,'SAVED');
 assert.equal(saved.layers.SOURCE.horses.length,source.horses.length+1);
 assert.deepStrictEqual(saved.layers.DATA,calculateJraData(source));
 assert.equal(saved.layers.DATA.horses.some(h=>h.horseNo===98),false);
});

test('NAR jobs and invalid official runner status fail closed without saving',async()=>{
 let saves=0,loads=0;
 const runner=createIsolatedJraDataRaceRunner({
  ...dependencies(),versions,
  loadSource:async()=>{loads++;const invalid=clone(source);invalid.horses[0].runningStatus='unknown';return invalid},
  save:async()=>{saves++;return {saved:true}}
 });
 await assert.rejects(runner({...job,organization:'NAR'}),/jra_race_job_required/);
 assert.equal(loads,0);
 await assert.rejects(runner(job),error=>error.code==='invalid_official_running_status');
 assert.equal(saves,0);
});

test('adapter has no Worker, D1, flag or deployment wiring',async()=>{
 const content=await readFile(new URL('../src/prediction/jra-data-race-runner-adapter.mjs',import.meta.url),'utf8');
 for(const token of ['worker.js','worker-entry.mjs','wrangler','D1','ENABLE_','fetch('])assert.ok(!content.includes(token));
 for(const file of ['../worker.js','../worker-entry.mjs']){
  const worker=await readFile(new URL(file,import.meta.url),'utf8');
  assert.ok(!worker.includes('jra-data-race-runner-adapter'));
 }
});
