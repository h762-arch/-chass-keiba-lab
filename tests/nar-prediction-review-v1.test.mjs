import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {createPredictionEvidenceSnapshot,createNarRetrospectiveEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {compareNarPredictionEvidence} from '../src/research/nar-prediction-evidence-consumer-v1.mjs';
import {buildNarMultiAngleComparison} from '../src/research/nar-multi-angle-comparison-v1.mjs';
import {buildNarClassContextReview} from '../src/research/nar-class-context-review-v1.mjs';
import {reviewNarPredictionEvidence} from '../src/research/nar-prediction-review-v1.mjs';
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(row=>keys.map(k=>row[k]??null))];};
async function fixture({retrospective=false,missingIndex=false,knownGoing=false}={}){
  const raceId='20261009-NAR-OI-1',runId='phase84-test',modelVersion='unchanged';
  const source={spreadsheetId:'synthetic',revision:'test',availableAt:retrospective?'2026-10-09T02:00:00Z':'2026-10-08T23:00:00Z',exportedAt:retrospective?'2026-10-09T03:00:00Z':'2026-10-09T00:00:00Z'};
  const snapshot=await (retrospective?createNarRetrospectiveEvidenceSnapshot:createPredictionEvidenceSnapshot)({raceId,runId,modelVersion,source,
    cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
    ...(retrospective?{replayEvidence:{basis:'POST_RACE_IDENTITY_ONLY',observedAt:'2026-10-09T02:30:00Z',refs:['https://example.com/synthetic-review']}}:{}),
    races:table([{CanonicalRace_ID:raceId,Org:'NAR',RaceDate:'2026-10-09',Course:'大井',Surface:'ダ',DistanceM:1600,TrackCondition_EARLY:knownGoing?'良':'UNKNOWN'}]),
    runners:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:56,
      PeakIndex:missingIndex?null:90-no*5,CourseIndex:missingIndex?null:80-no*5,Pressure_Scenario:'caller text only',PedigreeCoverage:'caller coverage only'}))),
    history:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,Run_No:1,PastRaceDate:'2026-09-01',PastCourse:'大井',Surface:'ダ',DistanceM:1600,Going:'良',Class:'B3二',RunTime:no===1?'1:45.0':'1:42.0',Last3F:no===1?40:38,Finish:no===1?5:1,FieldSize:10,Passage:'2 2'}))),
    identityMap:[1,2].map(no=>({raceId,horseKey:`id${no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:'synthetic'}))});
  const baseline={raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map((h,i)=>({...structuredClone(h),pastRuns:[],timeIndex:110-i*20,courseIndex:110-i*20}))}};
  const options={indexPolicy:{status:'APPROVED_RESEARCH',scale:'NAR_APP_RAW_INDEX',runId,modelVersion,snapshotHash:snapshot.snapshotHash,evidenceRef:'synthetic research only'}};
  return {snapshot,baseline,options};
}
const run=({snapshot,baseline,options})=>reviewNarPredictionEvidence(snapshot,baseline,options);
test('single entrypoint reproduces canonical consumer and both review parents unchanged',async()=>{
  const input=await fixture(),before=structuredClone(input),out=await run(input);
  const comparison=await compareNarPredictionEvidence(input.snapshot,input.baseline,input.options);
  const dossier=await buildNarMultiAngleComparison(input.snapshot,comparison),classes=await buildNarClassContextReview(input.snapshot,comparison,dossier);
  assert.deepEqual(out.comparison,comparison);assert.deepEqual(out.dossier,dossier);assert.deepEqual(out.classReview,classes);assert.deepEqual(input,before);
});
test('all active identities, output values, history and time are attached to the correct horse',async()=>{
  const out=await run(await fixture());assert.deepEqual(out.review.rows.map(r=>r.horseNo),[1,2]);
  for(const row of out.review.rows){assert.equal(row.existingModel.after.horseName,row.horseName);assert.equal(row.historyInterpretation.horseKey,row.horseKey);assert.equal(row.timeResearch.horseNo,row.horseNo);}
});
test('index effects and history TIME/explanation effects are separate from probability effects',async()=>{
  const out=await run(await fixture());
  assert.ok(out.review.rows.some(r=>r.features.find(f=>f.family==='INDEX').observedProbabilityOrMarkEffect));
  for(const r of out.review.rows){const h=r.features.find(f=>f.family==='HISTORY');assert.equal(h.observedProbabilityOrMarkEffect,false);assert.equal(h.observedExplanationEffect,true);assert.equal(h.observedTimeEffect,true);assert.equal(h.effectScope,'FIELD_WIDE_ABLATION_NOT_HORSE_LOCAL_CAUSAL_EFFECT');}
});
test('history explanation alone never reports a prediction effect',async()=>{
  const input=await fixture();input.baseline.data.horses.forEach((h,i)=>{h.pastRuns=[structuredClone(input.snapshot.data.horses[i].pastRuns[0])];h.pastRuns[0].cornerPositions=[9,9];});
  const out=await run(input),h=out.review.rows[0].features.find(f=>f.family==='HISTORY');
  assert.equal(h.status,'EXPLANATION_ONLY');assert.equal(h.observedTimeEffect,false);assert.equal(h.observedProbabilityOrMarkEffect,false);
});
test('present but unsupported factors cannot be promoted by caller notes',async()=>{
  const out=await run(await fixture());for(const r of out.review.rows){
    for(const family of ['PRESSURE','PEDIGREE']){const f=r.features.find(f=>f.family===family);assert.equal(f.sourceAvailable,true);assert.equal(f.status,'PRESENT_NO_OBSERVED_MODEL_CHANGE');assert.ok(r.gaps.some(g=>g.family===family&&g.code==='SOURCE_FACTOR_NOT_MAPPED'));}
  }
});
test('missing factors remain missing with attributable source refs',async()=>{
  const out=await run(await fixture({missingIndex:true}));for(const r of out.review.rows){const f=r.features.find(f=>f.family==='INDEX');assert.equal(f.status,'MISSING');assert.ok(f.sourceRefs.length);assert.ok(r.gaps.some(g=>g.family==='INDEX'&&g.code==='SOURCE_FACTOR_MISSING'));}
});
test('unapproved index policy is visible and never replaced by implicit approval',async()=>{
  const input=await fixture();input.options={};const out=await run(input);
  assert.ok(out.review.rows.every(r=>r.gaps.some(g=>g.code==='INDEX_RESEARCH_POLICY_NOT_APPROVED')));
  assert.equal(out.comparison.indexPolicyStatus,'UNAPPROVED');
});
test('unique pair questions and duplicated horse-row references are counted separately',async()=>{
  const out=await run(await fixture());const n=out.classReview.questions.length;
  assert.ok(n>0);assert.equal(out.review.coverage.uniqueQuestions,n);assert.equal(out.review.coverage.rowQuestionReferences,2*n);
  for(const r of out.review.rows)assert.ok(r.counterReview.questions.every(q=>q.pair.includes(r.horseKey)));
});
test('known going does not authorize revised predictions',async()=>{
  const out=await run(await fixture({knownGoing:true}));assert.equal(out.review.reviewDecision,'HOLD');
  assert.ok(out.review.rows.every(r=>r.reviewDecision==='HOLD'&&!r.predictionChangeAllowed&&r.revisedFinalPrediction==='NOT_GENERATED'));
  assert.ok(out.review.rows.every(r=>!r.gaps.some(g=>g.code==='CURRENT_GOING_UNCONFIRMED')));
});
test('retrospective entrypoint preserves late evidence and false EARLY authority',async()=>{
  const out=await run(await fixture({retrospective:true}));assert.equal(out.review.replayMode,'RETROSPECTIVE_ONLY');
  assert.equal(out.comparison.replayMode,'RETROSPECTIVE_ONLY');assert.equal(out.review.earlyEligible,false);
});
test('tampered snapshot and mismatched baseline cannot form a review',async()=>{
  const a=await fixture();a.snapshot=structuredClone(a.snapshot);a.snapshot.data.horses[0].horseName='forged';await assert.rejects(run(a),/SNAPSHOT_HASH_MISMATCH/);
  const b=await fixture();b.baseline.runId='other';await assert.rejects(run(b),/BASELINE_IDENTITY_VERSION_MISMATCH/);
});
test('deeply frozen review hashes cover gaps, provenance and false activation flags',async()=>{
  const out=await run(await fixture()),{reviewHash,...payload}=out.review;assert.equal(reviewHash,await stableHash(payload));
  assert.ok(Object.isFrozen(out.comparison));assert.ok(Object.isFrozen(out.review.rows[0].features[0].sourceRefs));
  assert.equal(out.review.formalKpiEligible,false);assert.equal(out.review.productionActivationReady,false);assert.equal(out.review.signalStatus,'NOT_GENERATED');
  for(const k of ['predictionMutation','signalMutation','freezeMutation'])assert.equal(out.review[k],'NONE');
});
