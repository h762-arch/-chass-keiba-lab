import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildProductionJraAuditEvidence,productionAuditEvidenceLines} from '../scripts/jra-production-audit-evidence.mjs';

const id=n=>`20261010-JRA-東京-0${n}`;
const report={targetDate:'2026-10-10',checkedAt:'2026-10-10T08:00:00.000Z',
 migration:'PASS',schema:'PASS',indexes:'PASS',meeting:'PASS',race:'PASS',snapshotAudit:'PASS',
 snapshotDataRaceIds:[id(2),id(1)],productionActivationReady:true};
const kpi={status:'READY',reason:null,summary:{requestedRaceCount:2,formalRaceCount:1,excludedRaceCount:1,
 matchedRunnerCount:5,timeSampleCount:1,timeRaceCount:1,meanRaceWinBrier:.2,meanRaceTop3Brier:.3,meanRaceTimeMaeSeconds:.4,
 included:[{raceId:id(1),earlyRevision:1,matchedRunnerCount:5,timeSampleCount:1}],
 excluded:[{raceId:id(2),status:'PENDING',reason:'OFFICIAL_RESULT_NOT_FOUND'}]}};
const shadow={status:'READY',reason:null,summary:{requestedRaceCount:2,observedRaceCount:1,excludedRaceCount:1,
 winHits:1,top3Hits:1,winHitRate:1,top3HitRate:1,
 observations:[{raceId:id(1),earlyRevision:1,horseNo:5,winHit:true,top3Hit:true}],
 excluded:[{raceId:id(2),status:'PENDING',reason:'OFFICIAL_RESULT_NOT_FOUND'}]}};
const commitSha='807245e534fffcb9e23f46ad66cb32fb973e5986';

test('evidence retains cohort and revisions, hashes exact UTF-8 bytes, and never authorizes Activation',()=>{
 const before=JSON.stringify({report,kpi,shadow});
 const result=buildProductionJraAuditEvidence({report,kpi,shadow,commitSha});
 assert.equal(result.status,'READY');assert.equal(Object.isFrozen(result),true);
 assert.equal(result.sha256,createHash('sha256').update(result.json,'utf8').digest('hex'));
 assert.equal(result.json.endsWith('\n'),true);
 const evidence=JSON.parse(result.json);
 assert.equal(evidence.productionActivationReady,false);assert.equal(evidence.starFormalMarkAdopted,false);
 assert.equal(evidence.commitSha,commitSha);assert.equal(evidence.schemaVersion,'CHASS-JRA-AUDIT-EVIDENCE-1');
 assert.deepEqual(evidence.raceIds,[id(1),id(2)]);
 assert.deepEqual(evidence.starResearch.summary.observations,shadow.summary.observations);
 assert.deepEqual(evidence.formalKpi.summary.included,kpi.summary.included);
 assert.equal(evidence.starResearch.summary.excluded[0].reason,'OFFICIAL_RESULT_NOT_FOUND');
 assert.equal(JSON.stringify({report,kpi,shadow}),before);
 assert.match(productionAuditEvidenceLines(result),new RegExp(result.sha256));
 assert.match(productionAuditEvidenceLines(result),/```json\n/);
});

test('ordering and unselected private fields cannot affect the exported digest',()=>{
 const initial=buildProductionJraAuditEvidence({report,kpi,shadow,commitSha});
 const changed=buildProductionJraAuditEvidence({
  report:{...report,snapshotDataRaceIds:[...report.snapshotDataRaceIds].reverse(),issues:['private token']},
  kpi:{...kpi,summary:{...kpi.summary,data_json:'private DATA',included:kpi.summary.included.map(row=>({...row,horseName:'private name'}))}},
  shadow:{...shadow,payload_json:'private result',summary:{...shadow.summary,market_json:'private MARKET'}},commitSha});
 assert.equal(changed.sha256,initial.sha256);assert.equal(changed.json,initial.json);
 assert.doesNotMatch(changed.json,/private|data_json|market_json|payload_json|horseName/);
 const revised=buildProductionJraAuditEvidence({report,kpi:{...kpi,summary:{...kpi.summary,
  included:[{...kpi.summary.included[0],earlyRevision:2}]}},shadow:{...shadow,summary:{...shadow.summary,
  observations:[{...shadow.summary.observations[0],earlyRevision:2}]}},commitSha});
 assert.notEqual(revised.sha256,initial.sha256);
});

test('empty and blocked results remain unavailable; zero observations preserve null rates',()=>{
 const empty={status:'EMPTY',reason:'NO_V2_DATA',summary:null};
 const result=buildProductionJraAuditEvidence({report:{...report,snapshotAudit:'EMPTY',snapshotDataRaceIds:[]},kpi:empty,shadow:empty});
 const json=JSON.parse(result.json);
 assert.equal(json.commitSha,null);assert.equal(json.starResearch.summary,null);
 const excluded=report.snapshotDataRaceIds.map(raceId=>({raceId,status:'PENDING',reason:'OFFICIAL_RESULT_NOT_FOUND'}));
 const zero=buildProductionJraAuditEvidence({report,kpi,shadow:{status:'READY',reason:null,summary:{
  requestedRaceCount:2,observedRaceCount:0,excludedRaceCount:2,winHits:0,top3Hits:0,
  winHitRate:null,top3HitRate:null,observations:[],excluded}}});
 assert.equal(JSON.parse(zero.json).starResearch.summary.winHitRate,null);
 const blocked={status:'BLOCKED',reason:'SHADOW_READ_OR_VALIDATION_FAILED',summary:null};
 assert.equal(JSON.parse(buildProductionJraAuditEvidence({report,kpi,shadow:blocked}).json).starResearch.status,'BLOCKED');
});

test('duplicate, mismatched or incomplete race partitions fail closed',()=>{
 for(const changed of [
  {...report,snapshotDataRaceIds:[id(1),id(1)]},
  {...report,snapshotDataRaceIds:['20261011-JRA-東京-01']},
  {...report,targetDate:'2026-02-30'},
  {...report,checkedAt:'invalid'}]){
  const result=buildProductionJraAuditEvidence({report:changed,kpi,shadow});
  assert.equal(result.status,'REJECTED');assert.equal(result.json,null);
 }
 for(const s of [
  {...shadow.summary,observations:[]},
  {...shadow.summary,excluded:[{raceId:id(1),status:'PENDING',reason:'OFFICIAL_RESULT_NOT_FOUND'}]},
  {...shadow.summary,observedRaceCount:2}
 ])assert.equal(buildProductionJraAuditEvidence({report,kpi,shadow:{...shadow,summary:s}}).status,'REJECTED');
 assert.equal(buildProductionJraAuditEvidence({report,kpi,shadow,commitSha:'not-a-sha'}).status,'REJECTED');
 assert.match(productionAuditEvidenceLines(buildProductionJraAuditEvidence()),/UNAVAILABLE/);
});

test('formal and shadow reads of a shared race must identify the same frozen EARLY revision',()=>{
 const changed={...shadow,summary:{...shadow.summary,observations:[{...shadow.summary.observations[0],earlyRevision:2}]}};
 const evidence=buildProductionJraAuditEvidence({report,kpi,shadow:changed});
 assert.equal(evidence.status,'REJECTED');assert.equal(evidence.sha256,null);
});
