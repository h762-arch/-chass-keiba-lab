import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseJraRaceCard,JRA_RACE_PARSER_VERSION} from '../jra-race-fetch.mjs';
import {createJraPrecomputeOfficialCacheSource} from '../src/prediction/jra-precompute-official-cache-source.mjs';
import {selectJraPrecomputeCacheJobs} from '../src/prediction/jra-precompute-cache-job-selection.mjs';
import {calculateJraData} from '../src/prediction/jra-data-calculator.mjs';
import {createPrecomputedIdentity} from '../src/prediction/precomputed-snapshot.mjs';

const date='2026-09-05',current=Date.parse('2026-09-05T00:00:00.000Z');
const fetchedAt='2026-09-04T23:45:00.000Z',expiresAt='2026-09-05T01:00:00.000Z';
const job=no=>({organization:'JRA',date,track:'中山',raceNo:no,raceId:`20260905-JRA-中山-${String(no).padStart(2,'0')}`});
const card=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const parsed=parseJraRaceCard(card,{date,track:'中山',race:5});
const body={ok:true,organization:'JRA',...parsed,fetchedAt,sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=example'};
const cacheRow=(payload=body,overrides={})=>{
 const payload_json=JSON.stringify(payload);
 return {kind:'race',cache_key:`race|${date}|中山|5`,organization:'JRA',race_date:date,track:'中山',race_no:5,
  payload_json,source_url:payload.sourceUrl,fetched_at:fetchedAt,expires_at:expiresAt,
  parser_version:JRA_RACE_PARSER_VERSION,content_hash:createHash('sha256').update(payload_json).digest('hex'),...overrides};
};
function fakeDb(row){
 const calls={reads:0,writes:0,fetches:0};
 const DB={prepare(sql){
  assert.match(sql,/^SELECT kind,cache_key,organization/);
  return {bind(key){assert.equal(key,`race|${date}|中山|5`);return {first:async()=>{calls.reads++;return row}}}};
 },run(){calls.writes++;throw Error('write_forbidden')}};
 return {DB,calls};
}
const strict=(row,clock=()=>current)=>{const {DB,calls}=fakeDb(row);return {read:createJraPrecomputeOfficialCacheSource({DB,now:clock}),calls}};
const rejects=async(row,code,clock)=>{
 const {read,calls}=strict(row,clock);
 await assert.rejects(read(job(5)),error=>error.code===code);
 assert.deepStrictEqual(calls,{reads:1,writes:0,fetches:0});
};
const productionVersions={calculationVersion:'jra-ability-data-v1',modelVersion:'10.0.1-jra-drive1-ability'};
const selectorSource=candidate=>({organization:'JRA',raceId:candidate.raceId,acquiredAt:fetchedAt});
const selectorInputHash=async candidate=>(await createPrecomputedIdentity({
 organization:'JRA',source:selectorSource(candidate),versions:productionVersions
})).inputHash;

test('fresh official cache yields the exact original acquisition time, no odds, popularity or network',async()=>{
 const rich=structuredClone(body);
 rich.horses[0].odds=47;rich.horses[0].popularity=9;
 const {read,calls}=strict(cacheRow(rich));
 const source=await read(job(5));
 assert.equal(source.acquiredAt,fetchedAt);
 assert.equal(source.source,'JRA_OFFICIAL');
 assert.deepStrictEqual(source.horses.map(h=>h.runningStatus),rich.horses.map(h=>h.runningStatus));
 assert.ok(source.horses.every(h=>!Object.hasOwn(h,'odds')&&!Object.hasOwn(h,'popularity')));
 assert.ok(calculateJraData(source).horses.length>=2);
 assert.deepStrictEqual(calls,{reads:1,writes:0,fetches:0});
 assert.equal(rich.horses[0].odds,47);
});

test('market-only odds and popularity changes do not alter cache-only SOURCE or DATA',async()=>{
 const changed=structuredClone(body);
 changed.horses[0].odds=99;
 changed.horses[0].popularity=12;
 const original=await strict(cacheRow()).read(job(5));
 const marketChanged=await strict(cacheRow(changed)).read(job(5));
 assert.deepStrictEqual(marketChanged,original);
 assert.deepStrictEqual(calculateJraData(marketChanged),calculateJraData(original));
});

test('missing, expired, future-dated and mismatched cache rows fail closed',async()=>{
 await rejects(null,'jra_precompute_cache_missing');
 await rejects(cacheRow(body,{expires_at:new Date(current).toISOString()}),'jra_precompute_cache_expired');
 await rejects(cacheRow(body,{fetched_at:new Date(current+1).toISOString()}),'jra_precompute_cache_invalid');
 for(const override of [{organization:'NAR'},{track:'東京'},{race_no:6},{parser_version:'old'},{cache_key:'race|other'}]){
  await rejects(cacheRow(body,override),'jra_precompute_cache_invalid');
 }
});

test('unknown or absent official runningStatus, wrong identity and corrupt JSON fail closed',async()=>{
 for(const status of [undefined,'unknown','injured']){
  const invalid=structuredClone(body);
  if(status===undefined)delete invalid.horses[0].runningStatus;
  else invalid.horses[0].runningStatus=status;
  await rejects(cacheRow(invalid),'jra_precompute_cache_invalid');
 }
 const wrong=structuredClone(body);wrong.race.raceNo=6;
 await rejects(cacheRow(wrong),'jra_precompute_cache_invalid');
 const staleDisplay=structuredClone(body);staleDisplay.bridgeCache={expired:true};
 await rejects(cacheRow(staleDisplay),'jra_precompute_cache_invalid');
 await rejects(cacheRow(body,{payload_json:'{' }), 'jra_precompute_cache_corrupt');
});

test('status is never replaced with active for a fresh cancelled or excluded horse',async()=>{
 for(const status of ['scratched','excluded']){
  const changed=structuredClone(body);
  changed.horses[0].runningStatus=status;
  changed.quality.activeHorseCount=2;
  const source=await strict(cacheRow(changed)).read(job(5));
  assert.equal(source.horses[0].runningStatus,status);
  assert.equal(calculateJraData(source).horses.length,2);
 }
});

test('integrity hash detects payload corruption before projection',async()=>{
 await rejects(cacheRow(body,{content_hash:'a'.repeat(64)}),'jra_precompute_cache_corrupt');
});

test('selection skips unavailable cache and advances past formerly first saved job',async()=>{
 const jobs=[job(1),job(2),job(3)];
 const stored=new Map();const reads=[];
 const fresh=async candidate=>{
  if(candidate.raceNo===1)throw Object.assign(Error('missing'),{code:'jra_precompute_cache_missing'});
  return selectorSource(candidate);
 };
 const select=()=>selectJraPrecomputeCacheJobs({jobs,maxJobs:1,selectionTurn:0,loadFreshSource:fresh,
  readLatest:async candidate=>{reads.push(candidate.raceNo);return stored.get(candidate.raceNo)||null},
  versions:productionVersions});
 const first=await select();
 assert.equal(first.selected[0].job.raceNo,2);
 assert.equal(first.unavailable[0].job.raceNo,1);
 assert.deepStrictEqual(reads,[2,3]);
 stored.set(2,{layers:{DATA:{}},inputHash:await selectorInputHash(job(2)),...productionVersions,sourceValidatedAt:fetchedAt});
 const second=await select();
 assert.equal(second.selected[0].job.raceNo,3);
 stored.set(3,{layers:{DATA:{}},inputHash:await selectorInputHash(job(3)),...productionVersions,sourceValidatedAt:'2026-09-04T23:50:00.000Z'});
 const third=await select();
 assert.equal(third.selected[0].job.raceNo,2);
 assert.equal(third.selected[0].source.raceId,job(2).raceId);
});

test('selection treats stale SOURCE inputHash or mismatched versions as uncomputed and never ignores corrupt cache',async()=>{
 const jobs=[job(2),job(3)];
 const current3=await selectorInputHash(job(3));
 const selected=await selectJraPrecomputeCacheJobs({jobs,maxJobs:1,selectionTurn:0,versions:productionVersions,
  loadFreshSource:async x=>selectorSource(x),
  readLatest:async x=>x.raceNo===2
   ?{layers:{DATA:{}},inputHash:'stale-source-input',...productionVersions,sourceValidatedAt:fetchedAt}
   :{layers:{DATA:{}},inputHash:current3,...productionVersions,sourceValidatedAt:fetchedAt}});
 assert.deepStrictEqual(selected.selected.map(x=>x.job.raceNo),[2]);
 assert.equal(selected.selected[0].calculated,false);
 const mismatched=await selectJraPrecomputeCacheJobs({jobs,maxJobs:1,selectionTurn:0,versions:productionVersions,
  loadFreshSource:async x=>selectorSource(x),readLatest:async x=>x.raceNo===2
   ?{layers:{DATA:{}},inputHash:await selectorInputHash(x),calculationVersion:'old',modelVersion:productionVersions.modelVersion,sourceValidatedAt:fetchedAt}
   :null});
 assert.deepStrictEqual(mismatched.selected.map(x=>x.job.raceNo),[2]);
 await assert.rejects(selectJraPrecomputeCacheJobs({jobs,maxJobs:1,selectionTurn:0,versions:productionVersions,
  loadFreshSource:async()=>{throw Object.assign(Error('corrupt'),{code:'jra_precompute_cache_corrupt'})},readLatest:async()=>null}),
 error=>error.code==='jra_precompute_cache_corrupt');
});

test('monotonic selection turns prevent a repeatedly failing first job from starving other jobs',async()=>{
 const jobs=[job(1),job(2),job(3)];
 const selected=[];
 for(let selectionTurn=0;selectionTurn<6;selectionTurn++){
  const result=await selectJraPrecomputeCacheJobs({jobs,maxJobs:1,selectionTurn,
   versions:productionVersions,
   loadFreshSource:async x=>selectorSource(x),readLatest:async()=>null});
  selected.push(result.selected[0].job.raceNo);
 }
 assert.deepStrictEqual(selected,[1,2,3,1,2,3]);
 await assert.rejects(selectJraPrecomputeCacheJobs({jobs,maxJobs:1,
  versions:{calculationVersion:'v',modelVersion:'v'},loadFreshSource:async()=>{},readLatest:async()=>null}),
 /invalid_jra_precompute_cache_selection/);
});

test('isolated modules do not wire Worker, production composition or fetch',async()=>{
 const reader=await readFile(new URL('../src/prediction/jra-precompute-official-cache-source.mjs',import.meta.url),'utf8');
 const selector=await readFile(new URL('../src/prediction/jra-precompute-cache-job-selection.mjs',import.meta.url),'utf8');
 const worker=await readFile(new URL('../worker.js',import.meta.url),'utf8');
 assert.doesNotMatch(reader,/readJraOfficialRaceCache|fetch\s*\(/);
 assert.doesNotMatch(selector,/fetch\s*\(/);
 assert.doesNotMatch(worker,/jra-precompute-(official-cache-source|cache-job-selection)/);
});
