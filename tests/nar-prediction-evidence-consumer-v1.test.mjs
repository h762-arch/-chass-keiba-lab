import test from 'node:test';
import assert from 'node:assert/strict';
import {createPredictionEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {compareNarPredictionEvidence} from '../src/research/nar-prediction-evidence-consumer-v1.mjs';
const table=objects=>{const keys=[...new Set(objects.flatMap(Object.keys))];return [keys,...objects.map(o=>keys.map(k=>o[k]??null))];};
async function setup(){
 const raceId='20261009-NAR-OI-1',runId='NAR-78-TEST',modelVersion='NAR-SHADOW';
 const snapshot=await createPredictionEvidenceSnapshot({raceId,runId,modelVersion,cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
  source:{spreadsheetId:'synthetic',revision:'test',exportedAt:'2026-10-09T00:00:00Z',availableAt:'2026-10-08T23:00:00Z'},
  races:table([{CanonicalRace_ID:raceId,Org:'NAR',RaceDate:'2026-10-09',Course:'大井',Surface:'ダート',DistanceM:1200,TrackCondition_EARLY:'良'}]),
  runners:table([1,2,3].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`NAR${no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:no===1?52:56,PeakIndex:110-no*15,Avg5Index:110-no*15,DistanceIndex:110-no*15,CourseIndex:110-no*15,Prev1Index:100-no*15,Prev2Index:98-no*15,Prev3Index:96-no*15,EARLY_Odds:10,Mark:'⚠️'}))),
  history:table([1,2,3].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`NAR${no}`,Run_No:1,PastRaceDate:'2026-09-01',PastCourse:'大井',Finish:no,DistanceM:1200,Surface:'ダ',RunTime:`1:${12+no}.0`,Last3F:36}))),
  identityMap:[1,2,3].map(no=>({raceId,horseKey:`NAR${no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:`synthetic/${no}`}))});
 const baseline={raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map(h=>({...structuredClone(h),weightCarried:56,pastRuns:[],timeIndex:70,fiveRaceAvgIndex:70,distanceIndex:70,courseIndex:70}))}};
 const indexPolicy={status:'APPROVED_RESEARCH',scale:'NAR_APP_RAW_INDEX',runId,modelVersion,snapshotHash:snapshot.snapshotHash,evidenceRef:'synthetic/index-policy'};
 return {snapshot,baseline,indexPolicy};
}
test('NAR indices reach actual app transform and influence probability/ability mark',async()=>{
 const {snapshot,baseline,indexPolicy}=await setup(),saved=structuredClone(baseline);
 const out=await compareNarPredictionEvidence(snapshot,baseline,{indexPolicy});assert.deepEqual(baseline,saved);
 assert.equal(out.changed,true);assert.ok(out.trace.some(e=>e.family==='INDEX'&&e.decisionUsed&&e.affectedOutputs.includes('PROBABILITY_OR_ABILITY_MARK')));
 assert.equal(out.after.horses[0].abilityMark,'◎');assert.ok(out.after.horses[0].win>out.before.horses[0].win);
 assert.equal(out.formalKpiEligible,false);assert.equal(out.signalStatus,'NOT_GENERATED');assert.equal(out.freezeMutation,'NONE');
});
test('TIME history consumption does not claim probability influence',async()=>{
 const {snapshot,baseline}=await setup();const out=await compareNarPredictionEvidence(snapshot,baseline);
 assert.ok(out.trace.filter(e=>e.family==='HISTORY').every(e=>e.decisionUsed&&e.affectedOutputs.includes('TIME_RESEARCH')&&!e.affectedOutputs.includes('PROBABILITY_OR_ABILITY_MARK')));
 assert.ok(out.after.time.every(t=>t.theory.available));
});
test('raw index without an associated scale policy stays unused',async()=>{
 const {snapshot,baseline}=await setup();const out=await compareNarPredictionEvidence(snapshot,baseline);
 assert.ok(out.trace.filter(e=>e.family==='INDEX').every(e=>!e.decisionUsed&&e.unusedReason==='INDEX_SCALE_POLICY_UNAPPROVED_OR_MISSING'));
});
test('policy approval bound to another snapshot or model cannot propagate indices',async()=>{
 for(const key of ['snapshotHash','runId','modelVersion','scale']){
  const {snapshot,baseline,indexPolicy}=await setup();indexPolicy[key]='OTHER';
  const out=await compareNarPredictionEvidence(snapshot,baseline,{indexPolicy});assert.equal(out.indexPolicyStatus,'UNAPPROVED');
 }
});
test('weight consumes existing model path without new weights',async()=>{
 const {snapshot,baseline}=await setup();const out=await compareNarPredictionEvidence(snapshot,baseline);
 assert.ok(out.trace.some(e=>e.family==='CONDITION'&&e.decisionUsed&&e.affectedOutputs.includes('PROBABILITY_OR_ABILITY_MARK')));
});
test('unknown ability never generates probabilities from weight alone',async()=>{
 const {snapshot,baseline}=await setup();for(const h of baseline.data.horses)for(const k of ['timeIndex','fiveRaceAvgIndex','distanceIndex','courseIndex'])delete h[k];
 const out=await compareNarPredictionEvidence(snapshot,baseline);assert.ok(out.after.horses.every(h=>h.win===null&&h.place===null&&h.abilityMark===''));
});
test('same features produce no decision-use claim',async()=>{
 const {snapshot,baseline,indexPolicy}=await setup();for(const h of baseline.data.horses){const s=snapshot.data.horses.find(r=>r.horseKey===h.horseKey),e=snapshot.evidence.find(r=>r.horseKey===h.horseKey&&r.family==='INDEX');h.pastRuns=structuredClone(s.pastRuns);h.weightCarried=s.weightCarried;for(const [a,b]of Object.entries({PeakIndex:'timeIndex',Avg5Index:'fiveRaceAvgIndex',DistanceIndex:'distanceIndex',CourseIndex:'courseIndex'}))h[b]=e.values[a];h.recentIndex=[e.values.Prev3Index,e.values.Prev2Index,e.values.Prev1Index];}
 const out=await compareNarPredictionEvidence(snapshot,baseline,{indexPolicy});assert.equal(out.changed,false);assert.ok(out.trace.every(e=>!e.decisionUsed));
});
test('snapshot tamper and baseline identity/version mismatch fail closed',async()=>{
 const {snapshot,baseline}=await setup(),bad=structuredClone(snapshot);bad.data.race.distance=1400;
 await assert.rejects(compareNarPredictionEvidence(bad,baseline),/HASH_MISMATCH/);
 baseline.modelVersion='OTHER';await assert.rejects(compareNarPredictionEvidence(snapshot,baseline),/VERSION_MISMATCH/);
});
test('runner number mapping mismatch cannot silently attach another horse',async()=>{
 const {snapshot,baseline}=await setup();baseline.data.horses[0].horseNo=99;
 await assert.rejects(compareNarPredictionEvidence(snapshot,baseline),/RUNNER_IDENTITY_MISMATCH/);
});
test('market and supplied probability overrides are excluded from app input',async()=>{
 const {snapshot,baseline,indexPolicy}=await setup();const a=await compareNarPredictionEvidence(snapshot,baseline,{indexPolicy});
 baseline.data.horses.forEach(h=>{h.odds=1.1;h.popularity=1;h.winRate=99;h.mark='⚠️';h.actualTime='0:01.0';});
 const b=await compareNarPredictionEvidence(snapshot,baseline,{indexPolicy});assert.deepEqual(b.after,a.after);
});
test('baseline current-race history cannot contaminate comparison',async()=>{
 const {snapshot,baseline}=await setup();baseline.data.horses[0].pastRuns=[{date:'2026-10-09',finish:1}];
 await assert.rejects(compareNarPredictionEvidence(snapshot,baseline),/BASELINE_HISTORY_CURRENT_OR_FUTURE/);
});
test('baseline name disagreement cannot hide behind matching key and number',async()=>{
 const {snapshot,baseline}=await setup();baseline.data.horses[0].horseName='別の馬';
 await assert.rejects(compareNarPredictionEvidence(snapshot,baseline),/RUNNER_IDENTITY_MISMATCH/);
});
