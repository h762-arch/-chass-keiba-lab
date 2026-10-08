import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {createPredictionEvidenceSnapshot,createNarRetrospectiveEvidenceSnapshot,RETROSPECTIVE_BRIDGE_VERSION} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {compareNarPredictionEvidence,compareNarRetrospectiveEvidence} from '../src/research/nar-prediction-evidence-consumer-v1.mjs';
import {replayNarMasterEvidence} from '../src/research/nar-retrospective-replay-v1.mjs';
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(row=>keys.map(k=>row[k]??null))];};
function fixture(){
  const sourceRaceId='archive',canonicalRaceId='20260914-NAR-OI-12';
  const masters={sourceRaceId,canonicalRaceId,indexTable:table([1,2].map(no=>({'レースID':sourceRaceId,'開催日':'2026-09-14','主催':'NAR','競馬場':'大井',R:12,'芝/ダ':'ダ','距離m':1600,'馬番':no,'馬名':no===1?'旧表記':'馬2','最高指数':80-no*5,'コース指数':70-no*5,'5走平均':90-no*20,'距離指数':75-no*4,'斤量':56}))),
    historyTable:table([1,2].map(no=>({'レースID':sourceRaceId,'馬番':no,'馬ID':`id${no}`,'馬名':`馬${no}`,'走順':1,'過去開催日':'2026-08-20','過去競馬場':'大井','芝/ダ':'ダ','距離m':1600,'走破TIME':`1:4${no}.0`,'着順':no}))) };
  const review={basis:'POST_RACE_IDENTITY_ONLY',sourceRaceId,canonicalRaceId,observedAt:'2026-10-08T12:00:00Z',refs:['https://example.org/official-record'],
    context:{date:'2026-09-14',course:'大井',raceNo:12,surface:'ダ',distance:1600},participants:[{horseNo:1,officialName:'馬1',approvedIndexAlias:'旧表記',status:'ACTIVE'},{horseNo:2,officialName:'馬2',status:'ACTIVE'}]};
  return {masters,review,source:{spreadsheetId:'synthetic',revision:'test',availableAt:review.observedAt,exportedAt:review.observedAt},runId:'replay-test',modelVersion:'unchanged-NAR',cutoffAt:'2026-09-14T11:00:00Z',offAt:'2026-09-14T11:50:00Z'};
}
function constructorInput(out){const s=out.snapshot;return {raceId:s.raceId,runId:s.runId,modelVersion:s.modelVersion,cutoffAt:s.cutoffAt,offAt:s.offAt,source:s.source,races:out.adapter.races,runners:out.adapter.runners,history:out.adapter.history,identityMap:out.adapter.identityMap,replayEvidence:s.replayEvidence};}
function baseline(out){const s=out.snapshot;return {raceId:s.raceId,runId:s.runId,modelVersion:s.modelVersion,data:s.data};}
async function resign(s){const {snapshotHash,...p}=s;s.snapshotHash=await stableHash(p);return s;}
test('late evidence is isolated and source inputs never mutate',async()=>{
  const input=fixture(),saved=structuredClone(input),out=await replayNarMasterEvidence(input);
  assert.deepEqual(input,saved);assert.equal(out.snapshot.schemaVersion,RETROSPECTIVE_BRIDGE_VERSION);
  assert.equal(out.earlyEligible,false);assert.equal(out.formalKpiEligible,false);assert.equal(out.freezeMutation,'NONE');
  assert.ok(out.comparison.trace.some(e=>e.family==='INDEX'&&e.decisionUsed));
  assert.ok(out.comparison.trace.some(e=>e.family==='HISTORY'&&e.affectedOutputs.includes('TIME_RESEARCH')));
});
test('PRE_OFF constructor still rejects genuine late acquisition',async()=>{
  const out=await replayNarMasterEvidence(fixture());await assert.rejects(createPredictionEvidenceSnapshot(constructorInput(out)),/SOURCE_NOT_AVAILABLE_AT_CUTOFF/);
});
test('PRE_OFF consumer rejects retrospective schema',async()=>{
  const out=await replayNarMasterEvidence(fixture());await assert.rejects(compareNarPredictionEvidence(out.snapshot,baseline(out)),/NAR_SNAPSHOT_REQUIRED/);
});
test('missing, duplicate and wrong participant metadata fail closed',async()=>{
  for(const change of [p=>p.pop(),p=>p.push(p[0]),p=>p[0].officialName='別馬',p=>p[0].status='UNKNOWN',p=>delete p[0].approvedIndexAlias]){
    const input=fixture();change(input.review.participants);await assert.rejects(replayNarMasterEvidence(input));
  }
});
test('official race context mismatch cannot resolve identities',async()=>{
  const input=fixture();input.review.context.distance=1200;await assert.rejects(replayNarMasterEvidence(input),/OFFICIAL_RACE_CONTEXT_MISMATCH/);
});
test('late metadata cannot be backdated as available at historical cutoff',async()=>{
  const input=fixture();input.source.availableAt=input.cutoffAt;await assert.rejects(replayNarMasterEvidence(input),/RETROSPECTIVE_PROVENANCE_REQUIRED/);
});
test('current race results and final market never enter output features',async()=>{
  const input=fixture(),a=await replayNarMasterEvidence(input);
  input.review.participants.forEach(p=>Object.assign(p,{finish:1,odds:1.1,time:'1:00.0',place:100}));
  const b=await replayNarMasterEvidence(input);assert.deepEqual(b.snapshot.data,a.snapshot.data);assert.deepEqual(b.comparison.after,a.comparison.after);
  assert.equal(b.snapshot.data.race.trackCondition,'UNKNOWN');
});
test('current race appended to history is rejected',async()=>{
  const input=fixture(),t=input.masters.historyTable;t[1][t[0].indexOf('過去開催日')]='2026-09-14';await assert.rejects(replayNarMasterEvidence(input),/HISTORY_CURRENT_OR_FUTURE/);
});
test('rehashed forged eligibility or malformed timing rejected by replay consumer',async()=>{
  const out=await replayNarMasterEvidence(fixture());
  for(const change of [s=>s.earlyEligible=true,s=>s.formalKpiEligible=true,s=>s.replayEvidence.observedAt='invalid',s=>s.replayEvidence.refs=[],s=>s.replayMode='EARLY']){
    const s=structuredClone(out.snapshot);change(s);await resign(s);await assert.rejects(compareNarRetrospectiveEvidence(s,baseline(out)),/RETROSPECTIVE_PROVENANCE_REQUIRED/);
  }
});
test('snapshot content tampering remains rejected',async()=>{
  const out=await replayNarMasterEvidence(fixture()),s=structuredClone(out.snapshot);s.data.horses[0].weightCarried=1;
  await assert.rejects(compareNarRetrospectiveEvidence(s,baseline(out)),/SNAPSHOT_HASH_MISMATCH/);
});
test('retrospective constructor is NAR-only and missing provenance fails',async()=>{
  const out=await replayNarMasterEvidence(fixture()),input=constructorInput(out);
  input.races[1][input.races[0].indexOf('Org')]='JRA';await assert.rejects(createNarRetrospectiveEvidenceSnapshot(input),/NAR_RETROSPECTIVE_ONLY/);
  delete input.replayEvidence;await assert.rejects(createNarRetrospectiveEvidenceSnapshot(input),/RETROSPECTIVE_PROVENANCE_REQUIRED/);
});
