import test from 'node:test';
import assert from 'node:assert/strict';
import {readJraStarShadowCohort} from '../src/research/jra-star-shadow-reader.mjs';

const now=Date.parse('2026-10-10T10:00:00Z');
const id=race=>`20261010-JRA-東京-${String(race).padStart(2,'0')}`;
const data=(race,{postTime='15:40',win=25}={})=>({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
 race:{date:'2026-10-10',racecourse:'東京',raceNo:race,postTime},horses:[
  {horseNo:1,horseName:'A',abilityRank:1,overall:80,win,place:60,predictedTime:'1:59.0'},
  {horseNo:2,horseName:'B',abilityRank:2,overall:70,win:10,place:30,predictedTime:''},
  {horseNo:3,horseName:'C',abilityRank:3,overall:60,win:5,place:20,predictedTime:''},
  {horseNo:4,horseName:'D',abilityRank:4,overall:55,win:4,place:15,predictedTime:''},
  {horseNo:5,horseName:'E',abilityRank:5,overall:50,win:3,place:12,predictedTime:''}
 ]});
const early=(race,options={})=>({organization:'JRA',race_id:id(race),revision:1,status:'PARTIAL',
 source_validated_at:'2026-10-10T06:00:00Z',data_calculated_at:'2026-10-10T06:01:00Z',
 calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',
 data_json:JSON.stringify(data(race,options))});
const result=race=>({organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:race,
 fetched_at:'2026-10-10T08:00:00Z',payload_json:JSON.stringify({ok:true,organization:'JRA',
 date:'2026-10-10',track:'東京',race,source:'JRA_OFFICIAL',finishOrder:[5,2,3],
 quality:{complete:true,finishOrderCount:3},results:[
  {horseNo:1,position:4,actualTime:'1:59.2'},
  {horseNo:2,position:2,actualTime:'1:59.5'},
  {horseNo:3,position:3,actualTime:'2:00.0'},
  {horseNo:4,position:5,actualTime:'2:00.1'},
  {horseNo:5,position:1,actualTime:'1:59.0'}]})});

function db(earlies,results){
 const calls=[];
 return {calls,prepare(sql){
  assert.match(sql,/^SELECT\b/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b|market_json|final_json|result_json|source_json/i);
  const call={sql,args:[]};calls.push(call);
  return {bind(...args){call.args=args;return this;},async first(){
   if(sql.includes('precomputed_race_snapshots')){
    assert.match(sql,/ORDER BY revision ASC LIMIT 1/);
    const [org,raceId,calc,model]=call.args;
    return (earlies.get(raceId)??[]).filter(row=>row.organization===org&&row.calculation_version===calc&&
     row.model_version===model&&row.data_json).sort((a,b)=>a.revision-b.revision)[0]??null;
   }
   assert.match(sql,/FROM jra_official_cache WHERE kind='result' AND cache_key=\?/);
   return results.get(call.args[0])??null;
  }};
 }};
}

test('bounded cohort preserves earliest candidate, counts hits, and separates pending and invalid data',async()=>{
 const newer=early(1);newer.revision=2;
 const laterData=JSON.parse(newer.data_json);
 laterData.horses[3].abilityRank=5;laterData.horses[4].abilityRank=4;
 newer.data_json=JSON.stringify(laterData);
 const malformed={...early(3),data_json:'{broken'};
 const noFifth=early(5);const short=JSON.parse(noFifth.data_json);
 short.horses=short.horses.slice(0,3);noFifth.data_json=JSON.stringify(short);
 const rows=new Map([[id(1),[newer,early(1)]],[id(2),[early(2)]],
  [id(3),[malformed,{...early(3),revision:2}]],[id(4),[early(4,{postTime:''})]],
  [id(5),[noFifth]],[id(6),[early(6)]]]);
 const miss=result(6),payload=JSON.parse(miss.payload_json);
 payload.finishOrder=[1,2,3];payload.results[0].position=1;payload.results[4].position=4;
 miss.payload_json=JSON.stringify(payload);
 const results=new Map([[`result|2026-10-10|東京|1`,result(1)],
  [`result|2026-10-10|東京|4`,result(4)],[`result|2026-10-10|東京|6`,miss]]);
 const before=JSON.stringify([...rows]),DB=db(rows,results),oldFetch=globalThis.fetch;let network=0;
 globalThis.fetch=()=>{network++;throw Error('network forbidden');};
 try{
  const raceIds=[6,5,4,3,2,1].map(id);
  const read=await readJraStarShadowCohort({DB,raceIds,now});
  assert.equal(read.status,'READY');const s=read.summary;
  assert.equal(s.requestedRaceCount,6);assert.equal(s.observedRaceCount,2);
  assert.equal(s.excludedRaceCount,4);assert.equal(s.winHits,1);assert.equal(s.top3Hits,1);
  assert.equal(s.winHitRate,1/2);assert.equal(s.top3HitRate,1/2);
  assert.deepEqual(s.observations.map(o=>[o.raceId,o.earlyRevision,o.horseNo]),[[id(1),1,5],[id(6),1,5]]);
  assert.deepEqual({...s.reasonCounts},{OFFICIAL_RESULT_NOT_FOUND:1,EARLY_MALFORMED_DATA:1,
   TEMPORAL_OR_SOURCE_UNVERIFIED:1,NO_RANK_FIVE:1});
  assert.equal(s.excluded[0].status,'PENDING');assert.equal(DB.calls.length,14);
  assert.equal(network,0);assert.equal(JSON.stringify([...rows]),before);
  assert.deepEqual(raceIds,[6,5,4,3,2,1].map(id));
  assert.equal(Object.isFrozen(s),true);assert.equal(Object.isFrozen(s.observations[0]),true);
  assert.deepEqual((await readJraStarShadowCohort({DB,raceIds:[...raceIds].reverse(),now})).summary,s);
  assert.doesNotMatch(JSON.stringify(read),/odds|popularity|MARKET|FINAL|payload_json/);
 }finally{globalThis.fetch=oldFetch;}
});

test('invalid cohorts and clocks perform zero I/O',async()=>{
 const DB=db(new Map(),new Map());
 for(const raceIds of [[],null,['20261010-NAR-東京-01'],['20260230-JRA-東京-01'],
  ['20261010-JRA-東京-00'],['20261010-JRA-東京-13'],Array(101).fill(id(1))]){
  assert.equal((await readJraStarShadowCohort({DB,raceIds,now})).reason,'INVALID_RACE_IDS');
 }
 assert.equal((await readJraStarShadowCohort({DB,raceIds:[id(1),id(1)],now})).reason,'DUPLICATE_RACE_ID');
 assert.equal((await readJraStarShadowCohort({DB,raceIds:[id(1)],now:NaN})).reason,'INVALID_READER_CLOCK');
 assert.equal((await readJraStarShadowCohort({raceIds:[id(1)],now})).reason,'D1_UNAVAILABLE');
 assert.equal(DB.calls.length,0);
});

test('zero observations retain null rates and exact missing-data and pending reasons',async()=>{
 const DB=db(new Map([[id(1),[early(1)]]]),new Map());
 const read=await readJraStarShadowCohort({DB,raceIds:[id(1),id(2)],now});
 assert.equal(read.summary.observedRaceCount,0);assert.equal(read.summary.excludedRaceCount,2);
 assert.equal(read.summary.winHitRate,null);assert.equal(read.summary.top3HitRate,null);
 assert.deepEqual({...read.summary.reasonCounts},{OFFICIAL_RESULT_NOT_FOUND:1,EARLY_DATA_NOT_FOUND:1});
});

test('a revision change between SELECTs fails closed instead of comparing a different signal',async()=>{
 const rows=new Map([[id(1),[early(1)]]]),results=new Map([[`result|2026-10-10|東京|1`,result(1)]]);
 const DB=db(rows,results),prepare=DB.prepare;let reads=0;
 DB.prepare=function(sql){
  if(sql.includes('precomputed_race_snapshots')&&++reads===2)rows.set(id(1),[{...early(1),revision:2}]);
  return prepare(sql);
 };
 const read=await readJraStarShadowCohort({DB,raceIds:[id(1)],now});
 assert.equal(read.summary.observedRaceCount,0);
 assert.equal(read.summary.reasonCounts.EARLY_IDENTITY_MISMATCH,1);
});

test('D1 read failures remain exclusions and never count as losses',async()=>{
 const DB={prepare(){throw Error('unavailable');}};
 const read=await readJraStarShadowCohort({DB,raceIds:[id(1)],now});
 assert.equal(read.summary.reasonCounts.EARLY_D1_READ_FAILED,1);
 assert.equal(read.summary.winHitRate,null);
});
