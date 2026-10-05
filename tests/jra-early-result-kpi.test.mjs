import test from 'node:test';
import assert from 'node:assert/strict';
import {compareJraEarlyToOfficialResult} from '../src/research/jra-early-result-kpi.mjs';

const raceId='20261004-JRA-東京-11',now=Date.parse('2026-10-04T09:00:00Z');
const version='jra-ability-data-v2',model='10.0.1-jra-drive1-ability';
const earlyData=()=>({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
 race:{date:'2026-10-04',racecourse:'東京',raceNo:11,postTime:'15:40'},
 horses:[
  {horseNo:1,horseName:'Alpha',abilityRank:1,overall:88,win:25,place:60,predictedTime:'1:58.8'},
  {horseNo:2,horseName:'Beta',abilityRank:2,overall:80,win:12,place:38,predictedTime:'1:59.2'},
  {horseNo:3,horseName:'Gamma',abilityRank:3,overall:75,win:10,place:25,predictedTime:''}
 ]});
const early=(revision,overrides={})=>({organization:'JRA',race_id:raceId,revision,
 source_validated_at:'2026-10-04T06:00:00Z',data_calculated_at:'2026-10-04T06:01:00Z',
 calculation_version:version,model_version:model,status:'PARTIAL',data_json:JSON.stringify(earlyData()),...overrides});
const official=()=>({ok:true,organization:'JRA',source:'JRA_OFFICIAL',date:'2026-10-04',track:'東京',race:11,
 finishOrder:[1,2,3],quality:{complete:true,finishOrderCount:3},
 results:[{horseNo:1,position:1,actualTime:'1:59.0',finalPopularity:1},
  {horseNo:2,position:2,actualTime:'1:59.0',finalPopularity:2},
  {horseNo:3,position:3,actualTime:'2:00.0',finalPopularity:3}]});
const result=(overrides={})=>({organization:'JRA',race_date:'2026-10-04',track:'東京',race_no:11,
 fetched_at:'2026-10-04T08:00:00Z',expires_at:'2026-10-05T08:00:00Z',payload_json:JSON.stringify(official()),...overrides});

function db(earlyRows=[early(1)],resultRow=result()){
 const calls=[];
 return {calls,prepare(sql){
  assert.match(sql,/^SELECT\b/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b|market_json|final_json|result_json|source_json/i);
  const call={sql,args:[]};calls.push(call);
  return {bind(...args){call.args=args;return this;},async first(){
   if(sql.includes('precomputed_race_snapshots')){
    assert.match(sql,/ORDER BY revision ASC LIMIT 1/);
    const [org,id,calc,mod]=call.args;
    return earlyRows.filter(row=>row.organization===org&&row.race_id===id&&row.calculation_version===calc&&
     row.model_version===mod&&row.data_json!=null&&row.data_json!=='').sort((a,b)=>a.revision-b.revision)[0]??null;
   }
   assert.match(sql,/FROM jra_official_cache WHERE kind='result' AND cache_key=\?/);
   assert.deepEqual(call.args,['result|2026-10-04|東京|11']);
   return resultRow;
  }};
 }};
}

test('frozen v2 EARLY compares with official result without viewer, network, writes or market output',async()=>{
 const DB=db([early(2),early(1)]);
 const oldFetch=globalThis.fetch;let network=0;
 globalThis.fetch=()=>{network++;throw Error('network forbidden');};
 try{
  const read=await compareJraEarlyToOfficialResult({DB,raceId,now});
  assert.equal(read.status,'READY');assert.equal(read.comparison.earlyRevision,1);
  assert.equal(read.comparison.formalKpiEligible,true);
  assert.equal(read.comparison.postTimeStatus,'PRE_POST');
  assert.equal(read.comparison.matchedRunnerCount,3);
  assert.equal(read.comparison.winBrier,Number((((.25-1)**2+.12**2+.10**2)/3).toFixed(6)));
  assert.equal(read.comparison.top3Brier,Number((((.60-1)**2+(.38-1)**2+(.25-1)**2)/3).toFixed(6)));
  assert.equal(read.comparison.timeMaeSeconds,.2);assert.equal(read.comparison.timeSampleCount,2);
  assert.deepEqual(read.comparison.runners.map(h=>h.timeErrorSeconds),[.2,-.2,null]);
  assert.equal(DB.calls.length,2);assert.equal(network,0);
  assert.doesNotMatch(JSON.stringify(read),/finalPopularity|odds|popularity|result_json/);
 }finally{globalThis.fetch=oldFetch;}
});

test('malformed earliest revision is rejected before reading result or later DATA',async()=>{
 const DB=db([early(2),early(1,{data_json:'{broken'})]);
 const read=await compareJraEarlyToOfficialResult({DB,raceId,now});
 assert.equal(read.status,'REJECTED');assert.equal(read.reason,'EARLY_MALFORMED_DATA');
 assert.equal(DB.calls.length,1);
});

test('old version and NAR never enter official result comparison',async()=>{
 for(const [id,rows] of [[raceId,[early(1,{calculation_version:'jra-ability-data-v1'})]],
  ['20261004-NAR-東京-11',[early(1)]]]){
  const DB=db(rows);
  assert.match((await compareJraEarlyToOfficialResult({DB,raceId:id,now})).reason,/^EARLY_/);
  assert.equal(DB.calls.length,id===raceId?1:0);
 }
});

test('missing official result is pending, malformed or mismatched result fails closed',async()=>{
 assert.equal((await compareJraEarlyToOfficialResult({DB:db([early(1)],null),raceId,now})).status,'PENDING');
 for(const bad of [result({payload_json:'{broken'}),result({track:'京都'}),
  result({payload_json:JSON.stringify({...official(),source:'manual'})}),
  result({payload_json:JSON.stringify({...official(),finishOrder:[1,1,3]})}),
  result({fetched_at:'2026-10-04T05:00:00Z'})]){
  const read=await compareJraEarlyToOfficialResult({DB:db([early(1)],bad),raceId,now});
  assert.equal(read.status,'REJECTED');assert.equal(read.comparison,null);
 }
});

test('saved official result remains usable after its cache expiry',async()=>{
 const old=result({expires_at:'2026-10-04T08:01:00Z'});
 const read=await compareJraEarlyToOfficialResult({DB:db([early(1)],old),raceId,now:now+30*24*60*60*1000});
 assert.equal(read.status,'READY');assert.equal(read.comparison.resultSource,'JRA_OFFICIAL');
});

test('late EARLY is rejected and missing official postTime never receives formal KPI eligibility',async()=>{
 const late=earlyData();late.race.postTime='14:00';
 const DB=db([early(1,{data_json:JSON.stringify(late)})]);
 const read=await compareJraEarlyToOfficialResult({DB,raceId,now});
 assert.equal(read.reason,'EARLY_AFTER_POST_TIME');assert.equal(DB.calls.length,1);
 const unknown=earlyData();unknown.race.postTime='';
 const comparison=await compareJraEarlyToOfficialResult({DB:db([early(1,{data_json:JSON.stringify(unknown)})]),raceId,now});
 assert.equal(comparison.status,'READY');assert.equal(comparison.comparison.formalKpiEligible,false);
 assert.equal(comparison.comparison.postTimeStatus,'UNVERIFIED');
});

test('runners missing official finish evidence are excluded from denominators',async()=>{
 const partial=official();partial.results=partial.results.filter(h=>h.horseNo!==3);
 // A top-three horse without an official runner row cannot be counted as a loss.
 const read=await compareJraEarlyToOfficialResult({DB:db([early(1)],result({payload_json:JSON.stringify(partial)})),raceId,now});
 assert.equal(read.status,'REJECTED');assert.equal(read.reason,'RESULT_INTEGRITY_FAILED');
 const extra=earlyData();extra.horses.push({horseNo:4,horseName:'Delta',abilityRank:4,overall:65,win:5,place:15});
 const DB=db([early(1,{data_json:JSON.stringify(extra)})]);
 const compared=await compareJraEarlyToOfficialResult({DB,raceId,now});
 assert.equal(compared.status,'READY');assert.equal(compared.comparison.unmatchedRunnerCount,1);
 assert.equal(compared.comparison.matchedRunnerCount,3);
 assert.deepEqual(compared.comparison.runners.at(-1),{horseNo:4,matched:false,win:null,top3:null,timeErrorSeconds:null});
});
