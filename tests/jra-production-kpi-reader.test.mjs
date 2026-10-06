import test from 'node:test';
import assert from 'node:assert/strict';
import {auditProductionJraEarlyKpi,createProductionKpiDb,productionKpiSummaryLines}
 from '../scripts/jra-production-kpi-reader.mjs';

const raceId='20261004-JRA-東京-11',now=Date.parse('2026-10-04T09:00:00Z');
const report={snapshotAudit:'PASS',snapshotDataRaceIds:[raceId]};
const snapshot={organization:'JRA',race_id:raceId,revision:1,status:'PARTIAL',
 source_validated_at:'2026-10-04T06:00:00Z',data_calculated_at:'2026-10-04T06:01:00Z',
 calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',
 data_json:JSON.stringify({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
  race:{date:'2026-10-04',racecourse:'東京',raceNo:11,postTime:'15:40'},horses:[
   {horseNo:1,horseName:'A',abilityRank:1,overall:80,win:30,place:60,predictedTime:'1:59.0'},
   {horseNo:2,horseName:'B',abilityRank:2,overall:70,win:15,place:40,predictedTime:''},
   {horseNo:3,horseName:'C',abilityRank:3,overall:60,win:10,place:30,predictedTime:''}
  ]})};
const result={organization:'JRA',race_date:'2026-10-04',track:'東京',race_no:11,
 fetched_at:'2026-10-04T08:00:00Z',payload_json:JSON.stringify({ok:true,organization:'JRA',
  date:'2026-10-04',track:'東京',race:11,source:'JRA_OFFICIAL',finishOrder:[1,2,3],
  quality:{complete:true,finishOrderCount:3},results:[
   {horseNo:1,position:1,actualTime:'1:59.2'},
   {horseNo:2,position:2,actualTime:'1:59.5'},
   {horseNo:3,position:3,actualTime:'2:00.0'}]})};

test('no v2 DATA returns unavailable KPI with zero additional D1 queries',async()=>{
 let calls=0;
 const read=await auditProductionJraEarlyKpi({snapshotAudit:'EMPTY',snapshotDataRaceIds:[]},
  {execute:()=>{calls++;throw Error('must not query');},now});
 assert.equal(read.status,'EMPTY');assert.equal(read.reason,'NO_V2_DATA');
 assert.equal(read.summary,null);assert.equal(calls,0);
 assert.match(productionKpiSummaryLines(read),/Formal KPI values: UNAVAILABLE/);
});

test('validated v2 cohort executes only two bound SELECTs and reports formal values',async()=>{
 const sqls=[];
 const execute=async sql=>{
  sqls.push(sql);
  assert.match(sql,/^SELECT\b/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b|market_json|final_json|result_json|source_json/i);
  return sql.includes('precomputed_race_snapshots')?[snapshot]:[result];
 };
 const oldFetch=globalThis.fetch;let network=0;
 globalThis.fetch=()=>{network++;throw Error('network forbidden');};
 try{
  const read=await auditProductionJraEarlyKpi(report,{execute,now});
  assert.equal(read.status,'READY');assert.equal(read.summary.formalRaceCount,1);
  assert.equal(read.summary.matchedRunnerCount,3);
  assert.equal(read.summary.meanRaceTimeMaeSeconds,.2);
  assert.equal(sqls.length,2);assert.equal(network,0);
  assert.match(sqls[0],/ORDER BY revision ASC LIMIT 1$/);
  assert.match(sqls[1],/WHERE kind='result' AND cache_key='result\|2026-10-04\|東京\|11'$/);
  const lines=productionKpiSummaryLines(read);
  assert.match(lines,/Requested \/ formal \/ excluded races: 1 \/ 1 \/ 0/);
  assert.doesNotMatch(lines,/payload_json|finalPopularity|odds/);
 }finally{globalThis.fetch=oldFetch;}
});

test('bad cohort, unauthorized SQL and remote failure all fail closed',async()=>{
 const db=createProductionKpiDb(async()=>[]);
 assert.throws(()=>db.prepare('DELETE FROM precomputed_race_snapshots'),/KPI_QUERY_NOT_ALLOWED/);
 assert.throws(()=>db.prepare('SELECT * FROM jra_official_cache'),/KPI_QUERY_NOT_ALLOWED/);
 assert.throws(()=>db.prepare('SELECT organization,race_date,track,race_no,payload_json,fetched_at FROM jra_official_cache WHERE kind=\'result\' AND cache_key=?')
  .bind("result|2026-10-04|東京|11';DROP TABLE x;--"),/KPI_BIND_INVALID/);
 let calls=0;
 const blocked=await auditProductionJraEarlyKpi({snapshotAudit:'FAIL',snapshotDataRaceIds:[raceId]},
  {execute:()=>{calls++;return [];},now});
 assert.equal(blocked.status,'BLOCKED');assert.equal(calls,0);
 const failed=await auditProductionJraEarlyKpi(report,{execute:async()=>{throw Error('private DB error');},now});
 assert.equal(failed.status,'BLOCKED');assert.equal(failed.reason,'KPI_READ_FAILED');
 assert.doesNotMatch(productionKpiSummaryLines(failed),/private DB error/);
});
