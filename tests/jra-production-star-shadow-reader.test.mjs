import test from 'node:test';
import assert from 'node:assert/strict';
import {auditProductionJraStarShadow,productionStarShadowSummaryLines} from '../scripts/jra-production-star-shadow-reader.mjs';

const raceId='20261004-JRA-東京-11',now=Date.parse('2026-10-04T09:00:00Z');
const report={snapshotAudit:'PASS',snapshotDataRaceIds:[raceId]};
const snapshot={organization:'JRA',race_id:raceId,revision:1,status:'PARTIAL',
 source_validated_at:'2026-10-04T06:00:00Z',data_calculated_at:'2026-10-04T06:01:00Z',
 calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',
 data_json:JSON.stringify({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
  race:{date:'2026-10-04',racecourse:'東京',raceNo:11,postTime:'15:40'},horses:[
   {horseNo:1,horseName:'A',abilityRank:1,overall:80,win:30,place:60,predictedTime:'1:59.0'},
   {horseNo:2,horseName:'B',abilityRank:2,overall:70,win:15,place:40,predictedTime:''},
   {horseNo:3,horseName:'C',abilityRank:3,overall:60,win:10,place:30,predictedTime:''},
   {horseNo:4,horseName:'D',abilityRank:4,overall:55,win:5,place:20,predictedTime:''},
   {horseNo:5,horseName:'E',abilityRank:5,overall:50,win:4,place:15,predictedTime:''}
  ]})};
const result={organization:'JRA',race_date:'2026-10-04',track:'東京',race_no:11,
 fetched_at:'2026-10-04T08:00:00Z',payload_json:JSON.stringify({ok:true,organization:'JRA',
  date:'2026-10-04',track:'東京',race:11,source:'JRA_OFFICIAL',finishOrder:[5,2,3],
  quality:{complete:true,finishOrderCount:3},results:[
   {horseNo:1,position:4,actualTime:'1:59.2'},
   {horseNo:2,position:2,actualTime:'1:59.5'},
   {horseNo:3,position:3,actualTime:'2:00.0'},
   {horseNo:4,position:5,actualTime:'2:00.1'},
   {horseNo:5,position:1,actualTime:'1:59.0'}]})};

test('empty, invalid, duplicate and oversized cohorts never trigger D1 reads',async()=>{
 let calls=0;const execute=async()=>{calls++;throw Error('must not query');};
 const empty=await auditProductionJraStarShadow({snapshotAudit:'EMPTY'},{execute,now});
 assert.equal(empty.status,'EMPTY');assert.equal(empty.reason,'NO_V2_DATA');
 assert.match(productionStarShadowSummaryLines(empty),/Shadow hit rates: UNAVAILABLE/);
 for(const bad of [{snapshotAudit:'FAIL'},
  {snapshotAudit:'PASS',snapshotDataRaceIds:[]},
  {snapshotAudit:'PASS',snapshotDataRaceIds:Array(25).fill(raceId)},
  {snapshotAudit:'PASS',snapshotDataRaceIds:[raceId,raceId]},
  {snapshotAudit:'PASS',snapshotDataRaceIds:['20261004-NAR-東京-11']}])
  assert.equal((await auditProductionJraStarShadow(bad,{execute,now})).status,'BLOCKED');
 assert.equal(calls,0);
});

test('validated cohort uses only exact bound SELECTs and labels output as research',async()=>{
 const sqls=[],original=JSON.stringify({report,snapshot,result}),oldFetch=globalThis.fetch;let network=0;
 globalThis.fetch=()=>{network++;throw Error('network forbidden');};
 try{
  const read=await auditProductionJraStarShadow(report,{now,execute:async sql=>{
   sqls.push(sql);assert.match(sql,/^SELECT\b/);
   assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|REPLACE)\b|market_json|final_json|result_json|source_json/i);
   return sql.includes('precomputed_race_snapshots')?[snapshot]:[result];
  }});
  assert.equal(read.status,'READY');assert.equal(read.summary.observedRaceCount,1);
  assert.equal(read.summary.winHitRate,1);assert.equal(read.summary.top3HitRate,1);
  assert.equal(read.summary.observations[0].horseNo,5);assert.equal(sqls.length,3);
  assert.equal(network,0);assert.equal(JSON.stringify({report,snapshot,result}),original);
  const lines=productionStarShadowSummaryLines(read);
  assert.match(lines,/Requested \/ observed \/ excluded races: 1 \/ 1 \/ 0/);
  assert.match(lines,/NOT a formal EARLY mark or formal KPI; NOT an Activation gate/);
  assert.doesNotMatch(lines,/payload_json|horseName|odds|popularity/);
 }finally{globalThis.fetch=oldFetch;}
});

test('pending official results have unavailable rates instead of zero and preserve exclusion counts',async()=>{
 const read=await auditProductionJraStarShadow(report,{now,
  execute:async sql=>sql.includes('precomputed_race_snapshots')?[snapshot]:[]});
 assert.equal(read.status,'READY');assert.equal(read.summary.observedRaceCount,0);
 assert.equal(read.summary.reasonCounts.OFFICIAL_RESULT_NOT_FOUND,1);
 assert.equal(read.summary.winHitRate,null);assert.equal(read.summary.top3HitRate,null);
 assert.match(productionStarShadowSummaryLines(read),/N\/A \/ N\/A/);
});

test('snapshot and official-result transport failures are BLOCKED without exposing private errors',async()=>{
 for(const failKind of ['precomputed_race_snapshots','jra_official_cache']){
  const read=await auditProductionJraStarShadow(report,{now,execute:async sql=>{
   if(sql.includes(failKind))throw Error('private DB credentials');
   return [snapshot];
  }});
  assert.equal(read.status,'BLOCKED');assert.equal(read.summary,null);
  assert.doesNotMatch(productionStarShadowSummaryLines(read),/private DB credentials/);
 }
});

test('malformed official rows fail closed and no-rank-five data remains a research exclusion',async()=>{
 const malformed=await auditProductionJraStarShadow(report,{now,
  execute:async sql=>sql.includes('precomputed_race_snapshots')?[snapshot]:[{...result,payload_json:'{broken'}]});
 assert.equal(malformed.status,'BLOCKED');
 const data=JSON.parse(snapshot.data_json);data.horses=data.horses.slice(0,3);let calls=0;
 const noCandidate=await auditProductionJraStarShadow(report,{now,execute:async()=>{
  calls++;return [{...snapshot,data_json:JSON.stringify(data)}];
 }});
 assert.equal(noCandidate.status,'READY');assert.equal(noCandidate.summary.reasonCounts.NO_RANK_FIVE,1);
 assert.equal(noCandidate.summary.winHitRate,null);assert.equal(calls,1);
});
