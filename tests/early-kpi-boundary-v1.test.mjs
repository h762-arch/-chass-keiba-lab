import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {summarizeBrowserReferenceCohort} from '../src/prediction/early-kpi-dashboard-boundary-v1.mjs';
import {summarizeEarlyEvidenceCohort} from '../src/research/early-kpi-cohort-v1.mjs';
import {compareJraEarlyToOfficialResult} from '../src/research/jra-early-result-kpi.mjs';

const now=Date.parse('2026-10-04T10:00:00Z'),id=n=>`20261004-JRA-東京-${String(n).padStart(2,'0')}`;
const data=n=>({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',race:{date:'2026-10-04',racecourse:'東京',raceNo:n,postTime:'15:40'},
 horses:[1,2,3].map((horseNo,i)=>({horseNo,horseName:'H'+horseNo,abilityRank:horseNo,overall:80-i*10,win:[25,10,5][i],place:[60,30,20][i],predictedTime:i?'':'1:59.0'}))});
const early=n=>({organization:'JRA',race_id:id(n),revision:1,status:'PARTIAL',source_validated_at:'2026-10-04T06:00:00Z',
 data_calculated_at:'2026-10-04T06:01:00Z',calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',data_json:JSON.stringify(data(n))});
const result=n=>({organization:'JRA',race_date:'2026-10-04',track:'東京',race_no:n,fetched_at:'2026-10-04T08:00:00Z',
 payload_json:JSON.stringify({ok:true,organization:'JRA',date:'2026-10-04',track:'東京',race:n,source:'JRA_OFFICIAL',
 quality:{complete:true,finishOrderCount:3},finishOrder:[1,2,3],results:[1,2,3].map((horseNo,i)=>({horseNo,position:i+1,actualTime:'1:59.2'}))})});
const target=n=>({organization:'JRA',raceId:id(n)});
function db(rows=[early(1)],results=[result(1)]){
 const calls=[];return {calls,prepare(sql){assert.match(sql,/^SELECT\b/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA)\b/i);
  assert.doesNotMatch(sql,/\b(?:market_json|final_json|result_json|source_json)\b/);
  const call={sql,args:[]};calls.push(call);return {bind(...args){call.args=args;return this;},async first(){
   if(sql.includes('precomputed_race_snapshots'))return rows.filter(r=>r.race_id===call.args[1]).sort((a,b)=>a.revision-b.revision)[0]||null;
   return results.find(r=>`result|${r.race_date}|${r.track}|${r.race_no}`===call.args[0])||null;
  }};
 }};
}
const editData=(row,mutate)=>{const d=JSON.parse(row.data_json);mutate(d);row.data_json=JSON.stringify(d);return row;};

test('common entry separates JRA candidates, pending and NAR HOLD without network or writes',async()=>{
 const pending=early(2),partial=editData(early(3),d=>d.horses.push({horseNo:4,horseName:'H4',abilityRank:4,overall:50,win:2,place:10}));
 const DB=db([early(1),pending,partial],[result(1),result(3)]),before=JSON.stringify(DB.calls);
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
 try{
  const out=await summarizeEarlyEvidenceCohort({DB,targets:[target(3),target(1),target(2),{organization:'NAR',raceId:'2026-10-04|高知|7'}],now});
  assert.equal(out.status,'READ_COMPLETE');assert.equal(out.report.contractQualifiedRaceCount,1);assert.equal(out.report.heldRaceCount,3);
  assert.deepEqual(out.report.reasonCounts,{OFFICIAL_RESULT_NOT_FOUND:1,RUNNER_COVERAGE_INCOMPLETE:1,NAR_AUTHENTICATED_OUTCOME_READER_NOT_WIRED:1});
  const expected=Number((((.25-1)**2+.1**2+.05**2)/3).toFixed(6));
  assert.equal(out.report.JRA.metrics.meanRaceWinBrier,expected);assert.equal(out.report.JRA.metrics.meanRaceTimeMaeSeconds,.2);
  assert.equal(out.report.JRA.metrics.unit,'MEAN_OF_RACE_MEANS');assert.equal(out.report.NAR.metrics,null);
  assert.equal(out.formalKpiEligible,false);assert.equal(out.formalKpiReadiness,'HOLD');assert.equal(out.sourceOriginAuthenticated,false);
  assert.equal(out.productionActivationDecision,'NO-GO');assert.equal(out.probabilityDecision,'MODEL_HOLD');
  assert.equal(DB.calls.length,6);assert.notEqual(JSON.stringify(DB.calls),before);
  assert.doesNotMatch(JSON.stringify(out),/payload_json|sourceRef|finishOrder|actualTimes|horseName/);
  assert.ok(Object.isFrozen(out.report.JRA.metrics));
 }finally{globalThis.fetch=old;}
});
test('NAR does not use JRA rows or require a fake data substitution',async()=>{
 const DB={prepare(){throw Error('UNEXPECTED_DB');}};
 const r=await summarizeEarlyEvidenceCohort({DB,targets:[{organization:'NAR',raceId:'2026-10-04|高知|7'}],now});
 assert.equal(r.report.heldRaceCount,1);assert.equal(r.report.JRA.metrics,null);assert.equal(r.report.NAR.metrics,null);
});
test('missing results have null means rather than zero rates',async()=>{
 const r=await summarizeEarlyEvidenceCohort({DB:db([early(1)],[]),targets:[target(1)],now});
 assert.equal(r.report.contractQualifiedRaceCount,0);assert.equal(r.report.JRA.metrics.meanRaceWinBrier,null);
 assert.equal(r.report.JRA.metrics.meanRaceTimeMaeSeconds,null);
});
test('unavailable D1 holds the requested JRA sample explicitly',async()=>{
 const r=await summarizeEarlyEvidenceCohort({targets:[target(1)],now});
 assert.equal(r.report.heldRaceCount,1);assert.equal(r.report.reasonCounts.D1_UNAVAILABLE,1);
 assert.equal(r.report.JRA.metrics,null);
});
for(const [name,targets] of [
 ['duplicate',[target(1),target(1)]],['empty',[]],['oversized',Array.from({length:101},()=>target(1))],
 ['NAR circuit confusion',[{organization:'NAR',raceId:id(1)}]],
 ['unknown venue',[{organization:'JRA',raceId:'20261004-JRA-不明-01'}]],
 ['invalid calendar',[{organization:'JRA',raceId:'20260230-JRA-東京-01'}]],
 ['precomputed comparison injection',[{...target(1),comparison:{formalKpiEligible:true}}]],
])test('rejects cohort before D1: '+name,async()=>{
 const DB=db();assert.equal((await summarizeEarlyEvidenceCohort({DB,targets,now})).status,'REJECTED');assert.equal(DB.calls.length,0);
});
for(const [name,change,reason] of [
 ['at-post calculation',r=>{r.data_calculated_at='2026-10-04T06:40:00Z';},'EARLY_AFTER_POST_TIME'],
 ['source after calculation',r=>{r.source_validated_at='2026-10-04T06:02:00Z';},'EARLY_SOURCE_AFTER_CALCULATION'],
 ['timezone-less time',r=>{r.data_calculated_at='2026-10-04T06:01:00';},'EARLY_INVALID_FRESHNESS'],
 ['invalid revision',r=>{r.revision=0;},'EARLY_INVALID_REVISION'],
 ['result leakage',r=>editData(r,d=>{d.resultSnapshot={finishOrder:[1,2,3]};}),'EARLY_RESULT_DATA_FORBIDDEN'],
 ['nested actual result',r=>editData(r,d=>{d.horses[0].features={actualTime:'1:59.2'};}),'EARLY_RESULT_DATA_FORBIDDEN'],
 ['current finish in horse',r=>editData(r,d=>{d.horses[0].finish=1;}),'EARLY_MALFORMED_DATA'],
 ['historical prediction',r=>editData(r,d=>{d.race.predictionKind='backtest_prediction';}),'EARLY_HISTORICAL_REFERENCE_ONLY'],
])test('EARLY boundary rejects '+name,async()=>{
 const r=early(1);change(r);const DB=db([r,{...early(1),revision:2}]);
 const out=await compareJraEarlyToOfficialResult({DB,raceId:id(1),now});
 assert.equal(out.reason,reason);assert.equal(DB.calls.length,1);
});
test('historical past-run finish is not confused with current outcome',async()=>{
 const r=editData(early(1),d=>{d.horses[0].features={pastRuns:[{date:'2026-09-01',finish:1}]};});
 assert.equal((await compareJraEarlyToOfficialResult({DB:db([r]),raceId:id(1),now})).status,'READY');
});
test('post-time or unknown-runner results cannot enter the qualified cohort',async()=>{
 const equal=result(1);equal.fetched_at='2026-10-04T06:40:00Z';
 assert.equal((await compareJraEarlyToOfficialResult({DB:db([early(1)],[equal]),raceId:id(1),now})).reason,'RESULT_BEFORE_POST_TIME');
 const unknown=result(1),p=JSON.parse(unknown.payload_json);p.results.push({horseNo:4,position:4});unknown.payload_json=JSON.stringify(p);
 assert.equal((await compareJraEarlyToOfficialResult({DB:db([early(1)],[unknown]),raceId:id(1),now})).reason,'RESULT_RUNNER_MISMATCH');
});
test('no T15/T5/FINAL/market requirements are introduced by the common reader',async()=>{
 const DB=db(),r=await summarizeEarlyEvidenceCohort({DB,targets:[target(1)],now});
 assert.equal(r.report.contractQualifiedRaceCount,1);assert.equal(DB.calls.length,2);
 assert.doesNotMatch(DB.calls.map(x=>x.sql).join('\n'),/T15|T5|market_json|final_json/);
});
test('order does not change the cohort or per-race means',async()=>{
 const rows=[early(1),early(2)],results=[result(1),result(2)];
 assert.deepEqual(await summarizeEarlyEvidenceCohort({DB:db(rows,results),targets:[target(2),target(1)],now}),
  await summarizeEarlyEvidenceCohort({DB:db(rows,results),targets:[target(1),target(2)],now}));
});
test('browser seals and optimistic caller flags never promote reference records',()=>{
 const records=[{race:{category:'中央競馬'},predictionSnapshot:{horses:[{horseNo:1}]},formalKpiEligible:true,snapshotIntegrity:{status:'verified'},sourceOriginAuthenticated:true},
  {race:{category:'地方競馬'},historicalResearch:{mode:'backtest'}},{race:{category:'unknown'}}];
 const before=JSON.stringify(records),r=summarizeBrowserReferenceCohort(records);
 assert.equal(r.formalRaceCount,0);assert.equal(r.referenceRaceCount,3);assert.equal(r.formalKpiReadiness,'HOLD');
 assert.equal(r.groups.JRA.count,1);assert.equal(r.groups.NAR.historical,1);assert.equal(r.groups.UNKNOWN.count,1);
 assert.equal(JSON.stringify(records),before);assert.ok(Object.isFrozen(r.groups.JRA));
});
test('browser empty or malformed input does not display formal zero-percent performance',()=>{
 assert.equal(summarizeBrowserReferenceCohort([]).referenceRaceCount,0);
 for(const value of [null,{},Array(5001).fill({})])assert.equal(summarizeBrowserReferenceCohort(value).status,'HOLD');
});
test('actual app keeps reference labels and fails closed if browser boundary cannot load',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 for(const engine of [undefined,{summarizeBrowserReferenceCohort},{summarizeBrowserReferenceCohort(){throw Error('FAILED');}}]){
  const window={__CHASS_TEST__:true,CHASS_EARLY_KPI_BOUNDARY:engine},deny=()=>{throw Error('SIDE_EFFECT');};
  const c={window,console,Date,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone,fetch:deny,
   localStorage:{getItem:()=>null,setItem:deny},setTimeout:deny,setInterval:deny,clearTimeout(){},clearInterval(){}};
  vm.createContext(c);vm.runInContext(source,c);const t=window.CHASS_TEST,records=[{formalKpiEligible:true}];
  assert.equal(t.dashboardKpiScope(records).formalRaceCount,0);assert.match(t.dashboardBoundaryHtml(records),/EARLY正式集計：HOLD/);
  assert.match(t.dashboardBoundaryHtml(records),/参考表示 1R/);assert.doesNotMatch(t.dashboardBoundaryHtml(records),/0\.0%/);
 }
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="earlyKpiBoundary"/);assert.doesNotMatch(html,/D1を正式な母集団/);
 assert.match(source,/FINAL TOP3捕捉（参考）/);assert.match(source,/穴候補の再計算捕捉（参考）/);
});
