import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {createPredictionEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {compareNarPredictionEvidence} from '../src/research/nar-prediction-evidence-consumer-v1.mjs';
import {buildNarMultiAngleComparison} from '../src/research/nar-multi-angle-comparison-v1.mjs';
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(row=>keys.map(k=>row[k]??null))];};
async function setup(change=()=>{}){
  const raceId='20261009-NAR-OI-1',runId='phase82-test',modelVersion='unchanged';
  const h=[1,2,3].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,Run_No:1,PastRaceDate:'2026-09-01',PastCourse:no===3?'川崎':'大井',Surface:'ダ',DistanceM:1600,Going:'良',RunTime:no===1?'1:45.0':'1:42.0',Last3F:no===1?40:38,Finish:no===1?5:1,FieldSize:10,Passage:no===1?'9 9':'1 1'}));
  // B has another going before the comparable run: refs must retain original history index.
  h.push({...h[1],Run_No:2,PastRaceDate:'2026-08-20',Going:'稍重',RunTime:'1:43.0'});change(h);
  const snapshot=await createPredictionEvidenceSnapshot({raceId,runId,modelVersion,cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
    source:{spreadsheetId:'synthetic',revision:'test',availableAt:'2026-10-08T23:00:00Z',exportedAt:'2026-10-09T00:00:00Z'},
    races:table([{CanonicalRace_ID:raceId,Org:'NAR',RaceDate:'2026-10-09',Course:'大井',Surface:'ダ',DistanceM:1600,TrackCondition_EARLY:'UNKNOWN'}]),
    runners:table([1,2,3].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:56}))),history:table(h),
    identityMap:[1,2,3].map(no=>({raceId,horseKey:`id${no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:'synthetic'}))});
  const baseline={raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map((h,i)=>({...structuredClone(h),pastRuns:[],timeIndex:110-i*20,courseIndex:110-i*20}))}};
  const comparison=await compareNarPredictionEvidence(snapshot,baseline);
  return {snapshot,comparison};
}
async function resignSnapshot(s){const {snapshotHash,...p}=s;s.snapshotHash=await stableHash(p);return s;}
test('actual app output binds to all field pairs without mutating inputs',async()=>{
  const {snapshot,comparison}=await setup(),saved=structuredClone({snapshot,comparison}),out=await buildNarMultiAngleComparison(snapshot,comparison);
  assert.deepEqual({snapshot,comparison},saved);assert.deepEqual(out.coverage,{runners:3,pairs:3,comparedPairs:1,sharedContexts:1});
  assert.equal(Object.isFrozen(out.pairs),true);assert.equal(out.predictionMutation,'NONE');
});
test('shared historical going never fills unknown current going',async()=>{
  const {snapshot,comparison}=await setup(),out=await buildNarMultiAngleComparison(snapshot,comparison),context=out.pairs[0].contexts[0];
  assert.equal(context.going,'良');assert.equal(context.matchesDeclaredCurrentGoing,false);
  assert.equal(context.scope,'SHARED_HISTORICAL_CONTEXT_NOT_CURRENT_FORECAST');assert.equal(out.currentGoing,'UNKNOWN');
});
test('raw clock/closing/finish disagreements become review questions, not revised marks',async()=>{
  const {snapshot,comparison}=await setup(),out=await buildNarMultiAngleComparison(snapshot,comparison);
  assert.equal(out.pairs[0].modelLeader,'id1');assert.equal(out.reviewQuestions.length,3);
  const clock=out.pairs[0].contexts[0].axes.find(a=>a.axis==='CLOCK_SECONDS');
  assert.equal(clock.a.value,105);assert.equal(clock.b.value,102);assert.equal(clock.deltaAminusB,3);assert.equal(clock.direction,'B_LOWER');
  assert.ok(out.reviewQuestions.every(q=>q.modelLeader==='id1'&&q.smallerObservationHorse==='id2'&&!q.predictionChangeAllowed));
});
test('different going, course or distance cannot be pooled into a shared comparison',async()=>{
  for(const change of [h=>h.filter(r=>r.CanonicalHorse_Key==='id2').forEach(r=>r.Going='重'),h=>h.filter(r=>r.CanonicalHorse_Key==='id2').forEach(r=>r.PastCourse='船橋'),h=>h.filter(r=>r.CanonicalHorse_Key==='id2').forEach(r=>r.DistanceM=1800)]){
    const {snapshot,comparison}=await setup(change),out=await buildNarMultiAngleComparison(snapshot,comparison);
    assert.equal(out.coverage.comparedPairs,0);assert.ok(out.pairs.every(p=>p.status==='NO_SHARED_USABLE_KNOWN_GOING_CONTEXT'));
  }
});
test('single observations and correlated axes do not turn into evidence votes',async()=>{
  const {snapshot,comparison}=await setup(),out=await buildNarMultiAngleComparison(snapshot,comparison),context=out.pairs[0].contexts[0];
  assert.ok(context.axes.every(a=>a.singleObservation));assert.equal(context.independentEvidenceVotes,'NOT_COMPUTED');assert.equal(context.winner,'NOT_ASSIGNED');
  assert.ok(out.limitations.includes('CORRELATED_AXES_NOT_INDEPENDENT'));
});
test('larger late position gain is not evidence that horse is stronger',async()=>{
  const {snapshot,comparison}=await setup(),out=await buildNarMultiAngleComparison(snapshot,comparison),axis=out.pairs[0].contexts[0].axes.find(a=>a.axis==='RECORDED_LATE_POSITION_GAIN');
  assert.equal(axis.a.value,4);assert.equal(axis.b.value,0);assert.equal(axis.meaning,'POSITION_CHANGE_ONLY_NOT_ABILITY_OR_FINISH_ADVANTAGE');
  assert.ok(out.reviewQuestions.every(q=>q.axis!=='RECORDED_LATE_POSITION_GAIN'));
});
test('unavailable clock is omitted without zero or hypothetical time substitution',async()=>{
  const {snapshot,comparison}=await setup(h=>h[0].RunTime=null),out=await buildNarMultiAngleComparison(snapshot,comparison);
  assert.ok(out.pairs[0].contexts[0].axes.every(a=>a.axis!=='CLOCK_SECONDS'));
});
test('source refs map filtered going rows back to original snapshot history positions',async()=>{
  const {snapshot,comparison}=await setup(h=>{h[1].Going='稍重';h[3].Going='良';}),out=await buildNarMultiAngleComparison(snapshot,comparison);
  const axis=out.pairs[0].contexts[0].axes.find(a=>a.axis==='CLOCK_SECONDS');assert.equal(axis.b.refs[0].historyIndex,1);assert.equal(axis.b.refs[0].date,'2026-08-20');
});
test('hash tampering and another snapshot/run/model cannot attach review to forecast',async()=>{
  const {snapshot,comparison}=await setup(),s=structuredClone(snapshot);s.data.race.distance=1800;
  await assert.rejects(buildNarMultiAngleComparison(s,comparison),/SNAPSHOT_HASH_MISMATCH/);
  for(const key of ['snapshotHash','runId','modelVersion']){const c=structuredClone(comparison);c[key]='other';await assert.rejects(buildNarMultiAngleComparison(snapshot,c),/COMPARISON_BINDING_INVALID/);}
});
test('comparison output hash and complete runner identities are mandatory',async()=>{
  const {snapshot,comparison}=await setup(),c=structuredClone(comparison);c.after.horses[0].overall=1;
  await assert.rejects(buildNarMultiAngleComparison(snapshot,c),/COMPARISON_HASH_MISMATCH/);
  c.after.horses[2]=structuredClone(c.after.horses[0]);c.outputHash=await stableHash(c.after);
  await assert.rejects(buildNarMultiAngleComparison(snapshot,c),/RUNNER_IDENTITY_MISMATCH/);
});
test('current/future history remains forbidden even after hashes are recalculated',async()=>{
  const {snapshot,comparison}=await setup(),s=structuredClone(snapshot),c=structuredClone(comparison);
  s.data.horses[0].pastRuns[0].date=s.data.race.date;await resignSnapshot(s);c.snapshotHash=s.snapshotHash;
  await assert.rejects(buildNarMultiAngleComparison(s,c),/NAR_HISTORY_CURRENT_OR_FUTURE/);
});
test('missing ability order, ties and source authority never manufacture role/signal decisions',async()=>{
  const {snapshot,comparison}=await setup(),c=structuredClone(comparison);c.after.horses.forEach(h=>h.overall=null);c.outputHash=await stableHash(c.after);
  const out=await buildNarMultiAngleComparison(snapshot,c);assert.ok(out.pairs.every(p=>p.modelLeader===null));assert.equal(out.reviewQuestions.length,0);
  assert.equal(out.roleDecision,'NOT_GENERATED');assert.equal(out.signalStatus,'NOT_GENERATED');assert.equal(out.earlyEligible,false);assert.equal(out.formalKpiEligible,false);assert.equal(out.productionActivationReady,false);
});
test('all pair identities remain stable if snapshot runner order changes',async()=>{
  const {snapshot,comparison}=await setup(),a=await buildNarMultiAngleComparison(snapshot,comparison),s=structuredClone(snapshot),c=structuredClone(comparison);
  s.data.horses.reverse();await resignSnapshot(s);c.snapshotHash=s.snapshotHash;const b=await buildNarMultiAngleComparison(s,c);assert.deepEqual(a.pairs,b.pairs);
});
