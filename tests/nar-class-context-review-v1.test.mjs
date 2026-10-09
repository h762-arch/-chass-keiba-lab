import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {createPredictionEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {compareNarPredictionEvidence} from '../src/research/nar-prediction-evidence-consumer-v1.mjs';
import {buildNarMultiAngleComparison} from '../src/research/nar-multi-angle-comparison-v1.mjs';
import {buildNarClassContextReview} from '../src/research/nar-class-context-review-v1.mjs';
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(row=>keys.map(k=>row[k]??null))];};
async function setup(change=()=>{}){
  const raceId='20261009-NAR-OI-1',runId='phase83-test',modelVersion='unchanged';
  const rows=[1,2].flatMap(no=>[1,2].map(slot=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,Run_No:slot,
    PastRaceDate:slot===1?'2026-09-01':'2026-08-01',PastCourse:'大井',Surface:'ダ',DistanceM:1600,Going:'良',
    Class:slot===1?'B3二':'C1',RunTime:no===1?'1:45.0':'1:42.0',Last3F:no===1?40:38,Finish:no===1?5:1,FieldSize:10,Passage:'2 2'})));
  change(rows);
  const snapshot=await createPredictionEvidenceSnapshot({raceId,runId,modelVersion,cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
    source:{spreadsheetId:'synthetic',revision:'test',availableAt:'2026-10-08T23:00:00Z',exportedAt:'2026-10-09T00:00:00Z'},
    races:table([{CanonicalRace_ID:raceId,Org:'NAR',RaceDate:'2026-10-09',Course:'大井',Surface:'ダ',DistanceM:1600,TrackCondition_EARLY:'UNKNOWN'}]),
    runners:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:56}))),
    history:table(rows),identityMap:[1,2].map(no=>({raceId,horseKey:`id${no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:'synthetic'}))});
  const baseline={raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map((h,i)=>({...structuredClone(h),pastRuns:[],timeIndex:110-i*20,courseIndex:110-i*20}))}};
  const comparison=await compareNarPredictionEvidence(snapshot,baseline),dossier=await buildNarMultiAngleComparison(snapshot,comparison);
  return {snapshot,comparison,dossier};
}
const run=({snapshot,comparison,dossier})=>buildNarClassContextReview(snapshot,comparison,dossier);
test('class strata bind actual app output without altering predictions or parent dossiers',async()=>{
  const input=await setup(),before=structuredClone(input),out=await run(input);
  assert.deepEqual(input,before);assert.equal(out.coverage.questions,3);assert.equal(out.coverage.withSharedLabel,3);
  assert.equal(out.coverage.strata,6);assert.equal(out.questions[0].strata[0].a.value,105);
  assert.ok(out.questions.every(q=>q.status==='RAW_DIVERGENCE_PERSISTS'));assert.ok(Object.isFrozen(out.questions[0].strata));
});
test('race names and subdivisions never receive inferred class equivalence',async()=>{
  const input=await setup(rows=>rows.filter(r=>r.CanonicalHorse_Key==='id2').forEach(r=>r.Class=r.Run_No===1?'三宅坂賞B3二':'C1二'));
  const out=await run(input);assert.equal(out.coverage.withoutSharedLabel,3);
  assert.ok(out.questions.every(q=>q.status==='NO_SHARED_USABLE_CLASS_LABEL'));
});
test('missing and unknown labels remain missing rather than forming a class bucket',async()=>{
  for(const value of [null,'UNKNOWN','-','不明','']){
    const out=await run(await setup(rows=>rows.forEach(r=>r.Class=value)));
    assert.equal(out.coverage.strata,0);assert.equal(out.questions[0].missingClassRefs.a.length,2);
  }
});
test('only outer whitespace is normalized',async()=>{
  const out=await run(await setup(rows=>rows.forEach(r=>r.Class=r.CanonicalHorse_Key==='id1'?' B3二 ':'B3二')));
  assert.equal(out.coverage.withSharedLabel,3);assert.deepEqual(out.questions[0].classLabels.shared,['B3二']);
});
test('class filtering can reverse raw direction without overturning model order',async()=>{
  const out=await run(await setup(rows=>{rows[0].RunTime='1:41.0';rows[1].RunTime='1:50.0';rows[3].Class='C2';}));
  const q=out.questions.find(q=>q.axis==='CLOCK_SECONDS');assert.equal(q.status,'RAW_DIRECTION_REVERSES');
  assert.equal(q.strata[0].direction,'A_LOWER');assert.equal(q.modelLeader,'id1');assert.equal(q.predictionChangeAllowed,false);
});
test('mixed directions and ties remain separate, never majority-voted',async()=>{
  const mixed=await run(await setup(rows=>{rows[0].RunTime='1:41.0';rows[1].RunTime='1:50.0';}));
  assert.equal(mixed.questions.find(q=>q.axis==='CLOCK_SECONDS').status,'MIXED_RAW_DIRECTIONS');
  const tied=await run(await setup(rows=>{rows[0].RunTime='1:42.0';rows[3].Class='C2';}));
  assert.equal(tied.questions.find(q=>q.axis==='CLOCK_SECONDS').status,'RAW_TIE');
});
test('refs preserve original history positions after class filtering',async()=>{
  const out=await run(await setup());const q=out.questions.find(q=>q.axis==='CLOCK_SECONDS');
  const c=q.strata.find(s=>s.classLabel==='C1');assert.equal(c.a.refs[0].historyIndex,1);
  assert.equal(c.b.refs[0].historyIndex,1);assert.equal(c.a.refs[0].date,'2026-08-01');
});
test('invalid finish denominator is excluded from class observations',async()=>{
  const out=await run(await setup(rows=>rows[1].FieldSize=null));
  const q=out.questions.find(q=>q.axis==='FINISH_FRACTION');assert.deepEqual(q.classLabels.shared,['B3二']);
  assert.equal(q.strata[0].a.sampleCount,1);
});
test('pace and current going are never inferred from class, clock or passages',async()=>{
  const out=await run(await setup());assert.equal(out.paceContext,'UNAVAILABLE');assert.equal(out.currentGoing,'UNKNOWN');
  assert.ok(out.questions.every(q=>q.answer==='UNRESOLVED_PACE_CLASS_EQUIVALENCE_AND_FORWARD_VALIDATION'));
  assert.ok(out.questions.flatMap(q=>q.strata).every(s=>s.classEquivalence==='NOT_AUTHENTICATED'&&s.singleObservation));
});
test('rehashed or incomplete dossier cannot hide or fabricate questions',async()=>{
  for(const mutate of [d=>d.reviewQuestions.pop(),d=>d.reviewQuestions[0].modelLeader='id2',d=>d.coverage.pairs=99]){
    const input=await setup();input.dossier=structuredClone(input.dossier);mutate(input.dossier);
    const {reviewHash,...payload}=input.dossier;input.dossier.reviewHash=await stableHash(payload);
    await assert.rejects(run(input),/DOSSIER_BINDING_INVALID/);
  }
});
test('snapshot and comparison tampering are rejected by parent validation',async()=>{
  const input=await setup();input.snapshot=structuredClone(input.snapshot);input.snapshot.data.horses[0].pastRuns[0].raceClass='forged';
  await assert.rejects(run(input),/SNAPSHOT_HASH_MISMATCH/);
  const second=await setup();second.comparison=structuredClone(second.comparison);second.comparison.after.horses[0].overall=1;
  await assert.rejects(run(second),/COMPARISON_HASH_MISMATCH/);
});
test('null ability order creates no new questions or prediction authority',async()=>{
  const input=await setup();input.comparison=structuredClone(input.comparison);input.comparison.after.horses.forEach(h=>h.overall=null);
  input.comparison.outputHash=await stableHash(input.comparison.after);input.dossier=await buildNarMultiAngleComparison(input.snapshot,input.comparison);
  const out=await run(input);assert.equal(out.coverage.questions,0);assert.equal(out.roleDecision,'NOT_GENERATED');
  assert.equal(out.signalStatus,'NOT_GENERATED');assert.equal(out.predictionMutation,'NONE');assert.equal(out.freezeMutation,'NONE');
  assert.equal(out.signalMutation,'NONE');assert.equal(out.earlyEligible,false);assert.equal(out.formalKpiEligible,false);assert.equal(out.productionActivationReady,false);
});
