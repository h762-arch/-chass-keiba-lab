import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNarHistoryInterpretation} from '../src/research/nar-history-interpretation-v1.mjs';
import {createPredictionEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {compareNarPredictionEvidence} from '../src/research/nar-prediction-evidence-consumer-v1.mjs';
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(row=>keys.map(k=>row[k]??null))];};
function fixture(){return {race:{date:'2026-10-09',racecourse:'大井',surface:'ダ',distance:1600,trackCondition:'良'},
  horse:{horseKey:'NAR-test',horseNo:1,pastRuns:[
    {date:'2026-09-01',racecourse:'大井',surface:'ダ',distance:1600,trackCondition:'良',fieldSize:10,finish:2,time:'1:42.0',last3F:38,cornerPositions:[3,4,2,2]},
    {date:'2026-08-20',racecourse:'大井',surface:'ダ',distance:1600,trackCondition:'稍重',fieldSize:12,finish:6,time:'1:44.0',last3F:39,cornerPositions:[5,7,6,7]},
    {date:'2026-08-10',racecourse:'川崎',surface:'ダ',distance:1600,trackCondition:'良',fieldSize:9,finish:1,time:'1:43.0',last3F:37,cornerPositions:[1,1]},
    {date:'2026-07-20',racecourse:'大井',surface:'ダ',distance:1400,trackCondition:'良',fieldSize:10,finish:4,time:'1:29.0',last3F:36,cornerPositions:[4,3]},
    {date:'2026-06-01',racecourse:'東京',surface:'芝',distance:1600,fieldSize:10,finish:1,time:'1:30.0',last3F:31},
    {date:'2026-05-01',racecourse:'大井',surface:'UNKNOWN',distance:1600,fieldSize:10,finish:1,time:'1:01.0'}]}};}
test('bounded exact course/distance evidence and arithmetic retain attributable refs',()=>{
  const input=fixture(),saved=structuredClone(input),out=buildNarHistoryInterpretation(input);
  assert.deepEqual(input,saved);assert.equal(out.historicalRunCount,6);assert.equal(out.usableDirtRunCount,4);
  assert.equal(out.sameCourse.runCount,3);assert.equal(out.sameDistance.runCount,3);assert.equal(out.exactCourseDistance.runCount,2);
  assert.equal(out.recent.medianFinish,3);assert.equal(out.recent.medianFinishFraction,0.222);
  assert.equal(out.recent.wins,1);assert.equal(out.recent.top3,2);
  assert.deepEqual(out.excluded,{surfaceMissing:1,otherSurface:1});assert.equal(out.exactCourseDistance.refs[0].historyIndex,0);
});
test('clock and last3F are grouped by going, never blended across conditions',()=>{
  const out=buildNarHistoryInterpretation(fixture());assert.equal(out.clock.groups.length,2);
  const good=out.clock.groups.find(g=>g.going==='良'),slow=out.clock.groups.find(g=>g.going==='稍重');
  assert.equal(good.median,102);assert.equal(slow.median,104);assert.equal(good.comparableToCurrentGoing,true);assert.equal(slow.comparableToCurrentGoing,false);
  assert.equal(out.closingSpeed.groups.find(g=>g.going==='良').median,38);assert.equal(out.clock.distanceAdjustment,'NONE');
});
test('unknown target going cannot select a convenient historical going',()=>{
  const input=fixture();input.race.trackCondition='UNKNOWN';const out=buildNarHistoryInterpretation(input);
  assert.ok(out.clock.groups.every(g=>!g.comparableToCurrentGoing));assert.ok(out.counterEvidence.some(e=>e.code==='CURRENT_GOING_UNCONFIRMED'));
});
test('recorded passage deltas are descriptive and not named early pace rates',()=>{
  const out=buildNarHistoryInterpretation(fixture());assert.equal(out.position.sampleCount,2);
  assert.equal(out.position.meaning,'FIRST_RECORDED_PASSAGE_NOT_FIRST_CORNER');
  assert.equal(out.position.observations[0].firstToLastGain,1);assert.equal(out.position.observations[1].lastToFinishGain,1);
  assert.equal(out.position.medianFirstToLastGain,-0.5);assert.equal(out.position.medianLastToFinishGain,0.5);
});
test('missing history stays missing without probabilities, marks or scenarios',()=>{
  const input=fixture();input.horse.pastRuns=[];const out=buildNarHistoryInterpretation(input);
  assert.equal(out.recent.medianFinish,null);assert.equal(out.recent.wins,null);assert.equal(out.recent.top3,null);assert.deepEqual(out.clock.groups,[]);
  assert.ok(out.counterEvidence.some(e=>e.code==='NO_USABLE_DIRT_HISTORY'));
  assert.equal(out.probabilityDriver,false);assert.equal(out.markDriver,false);assert.equal(out.signalStatus,'NOT_GENERATED');
});
test('invalid finish denominators and malformed time do not become zero evidence',()=>{
  const input=fixture();input.horse.pastRuns=[{date:'2026-09-01',surface:'ダ',racecourse:'大井',distance:1600,fieldSize:1,finish:1,time:'1:99.0',last3F:0,cornerPositions:[1,0]}];
  const out=buildNarHistoryInterpretation(input);assert.equal(out.recent.validResultCount,0);assert.equal(out.recent.medianFinishFraction,null);
  assert.deepEqual(out.clock.groups,[]);assert.deepEqual(out.closingSpeed.groups,[]);assert.equal(out.position.sampleCount,0);
});
test('impossible closing split and passage outside field are withheld',()=>{
  const input=fixture();input.horse.pastRuns=[input.horse.pastRuns[0]];input.horse.pastRuns[0].last3F=150;input.horse.pastRuns[0].cornerPositions=[1,99];
  const out=buildNarHistoryInterpretation(input);assert.deepEqual(out.closingSpeed.groups,[]);assert.equal(out.position.sampleCount,0);
});
test('current/future/invalid dates and oversized history fail closed',()=>{
  for(const change of [f=>f.horse.pastRuns[0].date=f.race.date,f=>f.horse.pastRuns[0].date='2027-01-01',f=>f.horse.pastRuns[0].date='2026-02-30',f=>f.horse.pastRuns=Array(11).fill(f.horse.pastRuns[0])]){
    const input=fixture();change(input);assert.throws(()=>buildNarHistoryInterpretation(input),/NAR_HISTORY/);
  }
});
test('source order cannot reverse recency or change computed statistics',()=>{
  const input=fixture(),a=buildNarHistoryInterpretation(input);input.horse.pastRuns.reverse();const b=buildNarHistoryInterpretation(input);
  assert.equal(a.recent.medianFinish,b.recent.medianFinish);assert.equal(a.recent.refs[0].date,b.recent.refs[0].date);
});
test('market, current result and old signals have no effect on interpretation',()=>{
  const input=fixture(),a=buildNarHistoryInterpretation(input);
  Object.assign(input.horse,{odds:1.1,popularity:1,finish:1,actualTime:'1:00.0',signal:'💎💎💎'});
  input.horse.pastRuns.forEach(r=>Object.assign(r,{odds:1.1,popularity:1,mark:'⚠️'}));
  assert.deepEqual(buildNarHistoryInterpretation(input),a);
});
async function setup(){
  const raceId='20261009-NAR-OI-1',runId='test81',modelVersion='unchanged';
  const snapshot=await createPredictionEvidenceSnapshot({raceId,runId,modelVersion,cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
    source:{spreadsheetId:'synthetic',revision:'test',availableAt:'2026-10-08T23:00:00Z',exportedAt:'2026-10-09T00:00:00Z'},
    races:table([{CanonicalRace_ID:raceId,Org:'NAR',RaceDate:'2026-10-09',Course:'大井',Surface:'ダ',DistanceM:1600,TrackCondition_EARLY:'良'}]),
    runners:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:56}))),
    history:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`id${no}`,Run_No:1,PastRaceDate:'2026-09-01',PastCourse:'大井',Surface:'ダ',DistanceM:1600,Finish:no,FieldSize:10,Going:'良',Passage:'3 2'}))),
    identityMap:[1,2].map(no=>({raceId,horseKey:`id${no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:'synthetic'}))});
  return {snapshot,baseline:{raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map(h=>({...structuredClone(h),pastRuns:[],timeIndex:70,courseIndex:70}))}}};
}
test('actual consumer explanation-only change is not probability/mark decision use',async()=>{
  const {snapshot,baseline}=await setup(),out=await compareNarPredictionEvidence(snapshot,baseline);
  assert.equal(out.predictionChanged,false);assert.equal(out.timeChanged,false);assert.equal(out.interpretationChanged,true);
  assert.ok(out.trace.filter(e=>e.family==='HISTORY').every(e=>e.interpretationUsed&&!e.decisionUsed&&e.affectedOutputs.includes('HISTORY_INTERPRETATION')&&!e.stages.includes('DECISION_USED')));
  assert.equal(out.historyInterpretationStatus,'RESEARCH_EXPLANATION_NOT_PREDICTION_DRIVER');assert.equal(out.formalKpiEligible,false);
});
test('identical history yields no interpretation-use claim',async()=>{
  const {snapshot,baseline}=await setup();baseline.data.horses.forEach((h,i)=>h.pastRuns=structuredClone(snapshot.data.horses[i].pastRuns));
  const out=await compareNarPredictionEvidence(snapshot,baseline);assert.equal(out.interpretationChanged,false);
  assert.ok(out.trace.filter(e=>e.family==='HISTORY').every(e=>!e.interpretationUsed&&!e.decisionUsed));
});
