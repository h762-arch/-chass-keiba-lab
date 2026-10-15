import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {diagnoseNarRestoredRaceBatch} from '../src/prediction/nar-quality-diagnostics.mjs';
import {compactNarPrecomputeStatus} from '../src/prediction/nar-status-compact.mjs';
import {narStatusSourceUrl,narStatusSnapshotPath} from '../src/research/nar-status-mirror-audit.mjs';
import {reportNarMaterialConditions} from '../src/research/nar-material-condition-report.mjs';
import {runNarConditionReportCli} from '../scripts/report-nar-material-conditions.mjs';
const date='2026-10-15',now=Date.parse('2026-10-15T13:40:00.000Z'),id='20261015-NAR-21-01';
function refresh(b){b.snapshot.payloadSha256=createHash('sha256').update(JSON.stringify(b.snapshot.payload)).digest('hex');const {payload,...a}=b.snapshot;b.attempt={...a,snapshotPath:narStatusSnapshotPath(date)};b.manifest={ok:true,schemaVersion:'chass-chat-mirror-manifest-v1',branch:'chass-data',statusMirror:{latestAttemptPath:'chat-snapshot/status/latest-attempt.json',latestAttempt:structuredClone(b.attempt)}};return b;}
function fixture(){
 const episode={observationKey:'o',contentHash:'h',facts:{distance:2000,timeSec:130,originCircuit:'JRA',dateText:'09.30',venue:'川崎'}};
 const data={race:{distance:1400},horses:[{horseNo:1,horseName:'PRIVATE_HORSE',runnerStatus:'active',predictedTime:null,evidence:{schemaVersion:1,runCount:1,sameDistanceCount:0,sameTrackCount:1,timeMissingReason:'time_missing_unknown'},history:{body:{schemaVersion:2,parsedCount:1,retainedCount:1,episodes:[episode],identity:{references:[{observationKey:'o',contentHash:'h',status:'HOLD',reasonCode:'EPISODE_LINK_UNMATCHED'}]}}}},{horseNo:2,horseName:'OTHER',runnerStatus:'active',predictedTime:'1:26.0',history:{body:{schemaVersion:2,identity:{references:[]}}}}],historyLinks:{body:{rows:[{horseNo:1,horseName:'PRIVATE_HORSE',pastRaceReferences:[{date:'2026-09-30',code:'21'}]}]}}};
 const row={raceId:id,track:'川崎',raceNo:1,horseCount:2,abilityCount:2,timeCount:1,quality:{schemaVersion:1,horseCount:2,activeHorseCount:2,activeAbilityCount:2,activeTimeCount:1},historyLinkAudit:{heldEpisodeCount:1},historyStoreAudit:{heldEpisodeCount:0,unresolvedObservationCount:1},preAnalysisStatus:'PARTIAL',preAnalysisPackHash:'a'.repeat(64)};
 const b=refresh({commitSha:'b'.repeat(40),snapshot:{schemaVersion:'chass-nar-status-snapshot-v1',status:'CAPTURED',date,sourceUrl:narStatusSourceUrl(date),attemptedAt:'2026-10-15T13:35:53.000Z',capturedAt:'2026-10-15T13:35:54.000Z',hashBasis:'UTF8_JSON_STRINGIFY_PAYLOAD',readOnlyCapture:true,payload:{ok:true,date,schemaReady:true,historyStoreSchemaReady:true,savedRaceCount:1,rejectedRowCount:0,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,races:[row]}}});
 const response=compactNarPrecomputeStatus({...structuredClone(b.snapshot.payload),qualityDiagnostics:diagnoseNarRestoredRaceBatch([{raceId:id,data}])});return {b,response};
}
const report = (f, options = {}) => reportNarMaterialConditions(f.b, f.response, {expectedDate: date, now, ...options});
const horse = f => f.response.qualityDiagnostics.races[0].diagnostics.horses[0];
const ref = f => horse(f).conditions.history.references[0];
function originsFixture() {
  const f = fixture(), h = horse(f), d = f.response.qualityDiagnostics.races[0].diagnostics;
  h.conditions.history.references = ['JRA','OTHER','UNAVAILABLE','NAR'].map((origin, i) => ({
    ...structuredClone(ref(f)), episodeIndex: i + 1, origin,
    observation: origin === 'NAR' ? 'MATCHING_CANDIDATE_PRESENT' : 'ORIGIN_NOT_NAR',
    eligibleCandidateCount: origin === 'NAR' ? 1 : 0
  }));
  h.conditions.history.heldReferenceCount = 4;
  h.conditions.history.observations = {ORIGIN_NOT_NAR: 3, MATCHING_CANDIDATE_PRESENT: 1};
  h.history.heldReferenceCount = 4;
  h.history.reasonCounts.EPISODE_LINK_UNMATCHED = 4;
  d.history.heldReferenceCount = 4; d.history.reasonCounts.EPISODE_LINK_UNMATCHED = 4;
  f.b.snapshot.payload.races[0].historyLinkAudit.heldEpisodeCount = 4;
  f.response.races[0].historyLinkAudit.heldEpisodeCount = 4;
  refresh(f.b);
  return f;
}
test('real generator yields a bounded condition ledger, not a diagnosis', () => {
  const r = report(fixture());
  assert.equal(r.status, 'CONDITION_REPORT_READY');
  assert.equal(r.totals.activeMissingTimeHorseCount, 1);
  assert.deepEqual(r.totals.timeObservations, {NO_FINITE_TIME_WITHIN_300M: 1});
  assert.deepEqual(r.totals.timeRetainedCoverage, {complete: 1, incomplete: 0});
  assert.equal(r.races[0].time[0].targetDistance, 1400);
  assert.equal(r.races[0].time[0].within300mFiniteTimeCount, 0);
  assert.equal(r.totals.heldHistoryReferenceCount, 1);
  assert.deepEqual(r.totals.historyOrigins, {NAR: 0, JRA: 1, OTHER: 0, UNAVAILABLE: 0});
  assert.equal(r.diagnosisStatus, 'NOT_ESTABLISHED');
  assert.equal(r.taskCompletion, 'NOT_CLAIMED');
});
test('non-NAR categories are counted separately and reconcile to all held references', () => {
  const r = report(originsFixture()), t = r.totals;
  assert.equal(r.status, 'CONDITION_REPORT_READY');
  assert.deepEqual(t.historyOrigins, {NAR: 1, JRA: 1, OTHER: 1, UNAVAILABLE: 1});
  assert.deepEqual(t.historyObservations, {MATCHING_CANDIDATE_PRESENT: 1, ORIGIN_NOT_NAR: 3});
  assert.equal(Object.values(t.historyOrigins).reduce((a,b) => a+b, 0), t.heldHistoryReferenceCount);
  assert.equal(t.historyOriginObservations.reduce((a,b) => a+b.count, 0), 4);
  assert.deepEqual(t.historyOriginObservations.find(x => x.origin === 'UNAVAILABLE'), {origin:'UNAVAILABLE', observation:'ORIGIN_NOT_NAR', count:1});
});
test('historical opt-in preserves stale source HOLD and original capture timestamp', () => {
  const f = fixture(), at = now + 3600000;
  assert.equal(report(f, {now:at}).status, 'HOLD');
  const r = report(f, {now:at, mode:'HISTORICAL'});
  assert.equal(r.status, 'HISTORICAL_CONDITION_REPORT_READY');
  assert.equal(r.sourceMirrorDecision, 'HOLD');
  assert.deepEqual(r.sourceMirrorReasons, ['SNAPSHOT_STALE']);
  assert.equal(r.sourceReference.capturedAt, f.b.snapshot.capturedAt);
  assert.equal(r.sourceReference.auditedAt, new Date(at).toISOString());
  assert.equal(r.currentStatusEligible, false);
});
test('bad hash, future capture and failed latest attempt cannot become historical reports', () => {
  for (const mutate of [f => f.b.snapshot.payloadSha256='0'.repeat(64), f => f.b.snapshot.capturedAt='2026-10-16T13:35:54.000Z', f => f.b.attempt.status='FAILED']) {
    const f=fixture(); mutate(f); const r=report(f,{mode:'HISTORICAL'});
    assert.equal(r.status,'HOLD'); assert.equal(r.totals,null); assert.deepEqual(r.races,[]);
  }
});
test('reader outputs, prior reports and plans cannot substitute for raw diagnostic JSON', () => {
  const f=fixture();
  for (const fake of [report(f),{status:'INSPECTION_READY',acceptance:{observations:[]}}, {status:'PLAN_READY'}, null]) {
    const r=reportNarMaterialConditions(f.b,fake,{expectedDate:date,now});
    assert.equal(r.status,'HOLD'); assert.equal(r.totals,null);
  }
});
test('row and Pack hash drift holds before emitting any counts', () => {
  for (const mutate of [f=>f.response.races[0].preAnalysisPackHash='c'.repeat(64), f=>f.response.savedRaceCount=0]) {
    const f=fixture();mutate(f);const r=report(f);
    assert.deepEqual(r.reasonCodes,['RESPONSE_ROW_DRIFT']);assert.deepEqual(r.races,[]);assert.equal(r.totals,null);
  }
});
test('forged origin or contradictory condition counts are not reported', () => {
  for (const mutate of [f=>ref(f).origin='PRIVATE', f=>ref(f).eligibleCandidateCount=1, f=>horse(f).conditions.time.finiteTimeCount=6]) {
    const f=fixture();mutate(f);assert.equal(report(f).status,'HOLD');
  }
});
test('unavailable affected diagnostics and mismatched detail scope hold', () => {
  for (const mutate of [f=>f.response.qualityDiagnostics.races[0].diagnostics.status='UNAVAILABLE', f=>f.response.qualityDiagnostics.detailScope='ALL_HORSES']) {
    const f=fixture();mutate(f);assert.equal(report(f).status,'HOLD');
  }
});
test('inactive held runners are included without adding inactive missing TIME to active totals', () => {
  const f=fixture();horse(f).active=false;
  const row=f.b.snapshot.payload.races[0]; row.quality.activeHorseCount=1;row.quality.activeAbilityCount=1;row.quality.activeTimeCount=1;
  f.response.races[0]=structuredClone(row);refresh(f.b);
  const d=f.response.qualityDiagnostics.races[0].diagnostics;
  d.activeHorseCount=1;d.time.missingActiveCount=0;d.time.observedMissingActiveCount=0;d.time.observations={};
  const r=report(f);
  assert.equal(r.status,'CONDITION_REPORT_READY');assert.equal(r.totals.activeMissingTimeHorseCount,0);
  assert.equal(r.totals.heldHistoryReferenceCount,1);assert.equal(r.races[0].history[0].active,false);
});
test('partial retained coverage remains explicit and is never promoted to full career coverage', () => {
  const f=fixture(),c=horse(f).conditions.time;
  c.coverageComplete=false;c.parsedRunCount=3;c.observation='RETAINED_COVERAGE_INCOMPLETE';
  const r=report(f);assert.equal(r.status,'CONDITION_REPORT_READY');
  assert.deepEqual(r.totals.timeRetainedCoverage,{complete:0,incomplete:1});
  assert.equal(r.races[0].time[0].parsedRunCount,3);
});
test('link/store/unresolved tasks remain separate, without summing overlap or claiming completion', () => {
  const f=fixture(),row=f.b.snapshot.payload.races[0];
  row.quality.activeAbilityCount=1;row.abilityCount=1;
  row.historyStoreAudit={heldEpisodeCount:1,unresolvedObservationCount:1};
  f.response.races[0]=structuredClone(row);refresh(f.b);
  const r=report(f);assert.equal(r.status,'CONDITION_REPORT_READY');
  assert.equal(r.historyCounterOverlap,'UNKNOWN_DO_NOT_ADD');
  assert.equal(r.totals.heldHistoryReferenceCount,1);
  assert.ok(r.remainingTasks.some(t=>t.kind==='REVIEW_ABILITY_SOURCE'&&t.requiredInput==='VERIFIED_SAVED_DATA_OR_PACK'));
  assert.ok(r.remainingTasks.every(t=>t.status==='UNRESOLVED'));
});
test('no diagnostic tasks yields null totals and keeps other unresolved review tasks', () => {
  const f=fixture(),row=f.b.snapshot.payload.races[0];
  row.timeCount=2;row.quality.activeTimeCount=2;row.quality.activeAbilityCount=1;row.abilityCount=1;
  row.historyLinkAudit.heldEpisodeCount=0;row.historyStoreAudit.unresolvedObservationCount=0;refresh(f.b);
  const r=reportNarMaterialConditions(f.b,null,{expectedDate:date,now});
  assert.equal(r.status,'NO_DIAGNOSTIC_TASKS');assert.equal(r.totals,null);
  assert.equal(r.remainingTasks[0].kind,'REVIEW_ABILITY_SOURCE');
});
test('report order is stable for reversed accepted reference details', () => {
  const f=originsFixture(),a=report(f);horse(f).conditions.history.references.reverse();
  const b=report(f);assert.deepEqual(a.races,b.races);assert.deepEqual(a.totals,b.totals);
  assert.notEqual(a.responseSha256,b.responseSha256);
});
test('source and response identity hashes are retained without asserting authenticated transport', () => {
  const f=fixture(),r=report(f);
  assert.equal(r.sourceReference.commitSha,f.b.commitSha);
  assert.equal(r.sourceReference.payloadSha256,f.b.snapshot.payloadSha256);
  assert.equal(r.responseSha256,createHash('sha256').update(JSON.stringify(f.response)).digest('hex'));
  assert.equal(r.diagnosticProvenance,'DECLARED_LOCAL_JSON_NOT_AUTHENTICATED');
  assert.equal(r.transportVerification,'NOT_PERFORMED_BY_THIS_REPORT');
});
test('unvalidated venue comparisons, names, raw text and arbitrary properties are excluded', () => {
  const f=fixture();ref(f).venueCodeComparison={status:'OBSERVED',observation:'PRIVATE_SECRET'};
  ref(f).freeText='PRIVATE_SECRET';f.response.privateNote='PRIVATE_SECRET';horse(f).horseName='PRIVATE_SECRET';
  const r=report(f),s=JSON.stringify(r);
  assert.equal(r.status,'CONDITION_REPORT_READY');assert.equal(r.venueCodeComparison,'NOT_EVALUATED');
  assert.equal(s.includes('PRIVATE_SECRET'),false);assert.equal(s.includes('PRIVATE_HORSE'),false);
});
test('input mutation, IO and predictive activation are absent from reporting', () => {
  const f=fixture(),before=JSON.stringify(f),a=report(f);
  assert.deepEqual(a,report(f));assert.equal(JSON.stringify(f),before);
  assert.equal(a.probabilityDecision,'MODEL_HOLD');assert.equal(a.productionActivationDecision,'NO-GO');
  assert.equal(a.formalKpiEligible,false);assert.equal(a.acquisitionCertified,false);
});
test('throwing input access and invalid options yield empty HOLD without private errors', () => {
  const f=fixture();Object.defineProperty(f.response,'date',{enumerable:true,get(){throw Error('PRIVATE_SECRET');}});
  const r=report(f);assert.equal(r.status,'HOLD');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
  for(const options of [{mode:null},{mode:'ARCHIVE'},{now:NaN},{now:null},{expectedDate:'2026-02-30'}]) assert.equal(report(fixture(),options).status,'HOLD');
});
async function files(t) {
  const root=await mkdtemp(path.join(tmpdir(),'condition-report-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture(),b=path.join(root,'bundle.json'),d=path.join(root,'diagnostics.json');
  await writeFile(b,JSON.stringify(f.b));await writeFile(d,JSON.stringify(f.response));
  return {b,d,args:['--bundle',b,'--diagnostics',d,'--date',date]};
}
test('two-file CLI requires explicit historical mode and emits read-only report', async t => {
  const f=await files(t);assert.equal(runNarConditionReportCli(f.args,{now}).status,'CONDITION_REPORT_READY');
  assert.equal(runNarConditionReportCli(f.args,{now:now+3600000}).status,'HOLD');
  assert.equal(runNarConditionReportCli([...f.args,'--historical'],{now:now+3600000}).status,'HISTORICAL_CONDITION_REPORT_READY');
});
test('CLI rejects URL, credential, clock, timeout and malformed date options', async t => {
  const f=await files(t);
  for(const extra of [['--url','https://example.invalid/'],['--token','PRIVATE_SECRET'],['--now','0'],['--timeout','1'],['--historical','true']]) {
    const r=runNarConditionReportCli([...f.args,...extra],{now});assert.equal(r.status,'HOLD');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
  }
  assert.equal(runNarConditionReportCli([...f.args.slice(0,5),'2026-02-30'],{now}).status,'HOLD');
});
test('CLI bounds both raw files and rejects malformed UTF8, JSON and absent inputs', async t => {
  for(const field of ['b','d']) for(const value of ['{',' '.repeat(1000001),new Uint8Array([255])]) {
    const f=await files(t);await writeFile(f[field],value);
    const r=runNarConditionReportCli(f.args,{now});assert.deepEqual(r.reasonCodes,['LOCAL_JSON_UNAVAILABLE']);assert.equal(r.totals,null);
  }
  assert.equal(runNarConditionReportCli(['--bundle','/missing','--diagnostics','/missing','--date',date],{now}).status,'HOLD');
});
test('multi-race report counts only accepted affected races and preserves independent source counters', () => {
  const f=fixture(),second=structuredClone(f.b.snapshot.payload.races[0]);
  second.raceId='20261015-NAR-21-02';second.raceNo=2;
  const third=structuredClone(second);third.raceId='20261015-NAR-21-03';third.raceNo=3;
  third.timeCount=2;third.quality.activeTimeCount=2;third.historyLinkAudit.heldEpisodeCount=0;third.historyStoreAudit.unresolvedObservationCount=0;
  f.b.snapshot.payload.races.push(second,third);f.b.snapshot.payload.savedRaceCount=3;refresh(f.b);
  f.response.races=structuredClone(f.b.snapshot.payload.races);f.response.savedRaceCount=3;
  const d=f.response.qualityDiagnostics.races[0];
  f.response.qualityDiagnostics.races.push({...structuredClone(d),raceId:second.raceId},{raceId:third.raceId,diagnostics:{status:'OBSERVED'}});
  f.response.qualityDiagnostics.races.reverse();f.response.races.reverse();
  const r=report(f);assert.equal(r.status,'CONDITION_REPORT_READY');assert.equal(r.acceptedRaceCount,2);
  assert.deepEqual(r.races.map(x=>x.raceId),[id,second.raceId]);
  assert.equal(r.totals.activeMissingTimeHorseCount,2);assert.equal(r.totals.heldHistoryReferenceCount,2);
  const tasks=r.remainingTasks.filter(t=>t.kind==='REVIEW_HISTORY_MATCH_CONDITIONS');
  assert.equal(tasks.length,2);assert.deepEqual(tasks[0].observed,{linkHeldReferences:1,storeHeldEpisodes:0,storeUnresolvedObservations:1});
  assert.equal(r.countScope,'ACCEPTED_DIAGNOSTIC_RACES_ONLY');
});
