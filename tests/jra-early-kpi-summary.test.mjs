import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeJraEarlyResultKpi} from '../src/research/jra-early-kpi-summary.mjs';

const now=Date.parse('2026-10-04T10:00:00Z');
const id=race=>`20261004-JRA-東京-${String(race).padStart(2,'0')}`;
const data=(race,{postTime='15:40',win=25}={})=>({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
 race:{date:'2026-10-04',racecourse:'東京',raceNo:race,postTime},horses:[
  {horseNo:1,horseName:'A',abilityRank:1,overall:80,win,place:60,predictedTime:'1:59.0'},
  {horseNo:2,horseName:'B',abilityRank:2,overall:70,win:10,place:30,predictedTime:''},
  {horseNo:3,horseName:'C',abilityRank:3,overall:60,win:5,place:20,predictedTime:''}
 ]});
const early=(race,options={})=>({organization:'JRA',race_id:id(race),revision:1,status:'PARTIAL',
 source_validated_at:'2026-10-04T06:00:00Z',data_calculated_at:'2026-10-04T06:01:00Z',
 calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',
 data_json:JSON.stringify(data(race,options))});
const result=race=>({organization:'JRA',race_date:'2026-10-04',track:'東京',race_no:race,
 fetched_at:'2026-10-04T08:00:00Z',payload_json:JSON.stringify({ok:true,organization:'JRA',
 date:'2026-10-04',track:'東京',race,source:'JRA_OFFICIAL',finishOrder:[1,2,3],
 quality:{complete:true,finishOrderCount:3},results:[
  {horseNo:1,position:1,actualTime:'1:59.2'},
  {horseNo:2,position:2,actualTime:'1:59.5'},
  {horseNo:3,position:3,actualTime:'2:00.0'}]})});

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

test('explicit cohort keeps formal KPI, pending and rejection separate; read path has no writes or network',async()=>{
 const malformed={...early(2),data_json:'{broken'};
 const rows=new Map([[id(1),[early(1)]],[id(2),[malformed,{...early(2),revision:2}]],
  [id(3),[early(3)]],[id(4),[early(4,{postTime:''})]],
  [id(5),[early(5)]],[id(6),[early(6,{win:50})]]]);
 const beforePost={...result(5),fetched_at:'2026-10-04T06:30:00Z'};
 const results=new Map([[`result|2026-10-04|東京|1`,result(1)],
  [`result|2026-10-04|東京|4`,result(4)],
  [`result|2026-10-04|東京|5`,beforePost],
  [`result|2026-10-04|東京|6`,result(6)]]);
 const DB=db(rows,results),oldFetch=globalThis.fetch;let network=0;
 globalThis.fetch=()=>{network++;throw Error('network forbidden');};
 try{
  const read=await summarizeJraEarlyResultKpi({DB,raceIds:[6,5,4,3,2,1].map(id),now});
  assert.equal(read.status,'READY');
  const s=read.summary;
  assert.equal(s.requestedRaceCount,6);assert.equal(s.formalRaceCount,2);
  assert.equal(s.excludedRaceCount,4);assert.equal(s.matchedRunnerCount,6);
  assert.equal(s.timeSampleCount,2);assert.equal(s.timeRaceCount,2);
  const brier=win=>Number(((((win/100)-1)**2+.1**2+.05**2)/3).toFixed(6));
  assert.equal(s.meanRaceWinBrier,Number(((brier(25)+brier(50))/2).toFixed(6)));
  assert.equal(s.meanRaceTimeMaeSeconds,.2);
  assert.deepEqual(s.included.map(row=>row.raceId),[id(1),id(6)]);
  assert.deepEqual({...s.reasonCounts},{EARLY_MALFORMED_DATA:1,OFFICIAL_RESULT_NOT_FOUND:1,
   UNVERIFIED_POST_TIME:1,RESULT_BEFORE_POST_TIME:1});
  assert.equal(DB.calls.length,11);assert.equal(network,0);
  assert.doesNotMatch(JSON.stringify(read),/odds|popularity|finalPopularity|payload_json|finishOrder/);
 }finally{globalThis.fetch=oldFetch;}
});

test('cohort validation rejects duplicates, NAR and oversized requests before any D1 access',async()=>{
 const DB=db(new Map(),new Map());
 for(const [raceIds,reason] of [
  [[id(1),id(1)],'DUPLICATE_RACE_ID'],
  [['20261004-NAR-東京-01'],'INVALID_RACE_IDS'],
  [Array.from({length:101},(_,index)=>id(index+1)),'INVALID_RACE_IDS'],
  [[],'INVALID_RACE_IDS']]){
  const read=await summarizeJraEarlyResultKpi({DB,raceIds,now});
  assert.equal(read.status,'REJECTED');assert.equal(read.reason,reason);
  assert.equal(read.summary,null);
 }
 assert.equal(DB.calls.length,0);
});

test('missing results never enter a formal mean or turn null into zero',async()=>{
 const DB=db(new Map([[id(1),[early(1)]]]),new Map());
 const read=await summarizeJraEarlyResultKpi({DB,raceIds:[id(1)],now});
 assert.equal(read.summary.formalRaceCount,0);
 assert.equal(read.summary.meanRaceWinBrier,null);
 assert.equal(read.summary.meanRaceTop3Brier,null);
 assert.equal(read.summary.meanRaceTimeMaeSeconds,null);
 assert.deepEqual({...read.summary.reasonCounts},{OFFICIAL_RESULT_NOT_FOUND:1});
});
