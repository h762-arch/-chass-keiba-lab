import test from 'node:test';
import assert from 'node:assert/strict';
import {createPredictionEvidenceSnapshot,comparePredictionEvidence} from '../src/research/prediction-evidence-bridge-v1.mjs';
const table = objects => { const keys = [...new Set(objects.flatMap(Object.keys))]; return [keys,...objects.map(o => keys.map(k => o[k] ?? null))]; };
const raceId = '20261009-JRA-KYO-1', runId = 'RESEARCH-77', modelVersion = 'EXISTING-JRA-SHADOW';
function fixture(org='JRA') {
 return {raceId,runId,modelVersion,cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
  source:{spreadsheetId:'synthetic',revision:'fixture-1',exportedAt:'2026-10-09T00:00:00Z',availableAt:'2026-10-08T23:00:00Z'},
  races:table([{CanonicalRace_ID:raceId,Org:org,RaceDate:'2026-10-09',Course:'京都',Surface:'ダート',DistanceM:1200,TrackCondition_EARLY:'良',TrackCondition_FINAL:'重',ResultConfirmedAt:'2026-10-09T02:00:00Z'}]),
  runners:table([1,2].map(no => ({CanonicalRace_ID:raceId,CanonicalHorse_Key:`HORSE${no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:55,PeakIndex:110,EARLY_Odds:20,EARLY_Popularity:9,Mark:'◎',AI_WinProb:99,HoleSignal:'💎💎💎'}))),
  history:table([1,2].map(no => ({CanonicalRace_ID:raceId,CanonicalHorse_Key:`HORSE${no}`,Run_No:1,PastRaceDate:'2026-09-01',PastCourse:'京',Class:'1勝',FieldSize:12,Finish:no===1?1:11,Surface:'ダ',DistanceM:1200,Going:'良',RunTime:no===1?'1:10.0':'1:15.0',Margin:no===1?0:3,Passage:'2 2',Last3F:36,WeightCarried:55,Popularity:1}))),
  identityMap:[1,2].map(no => ({raceId,horseKey:`HORSE${no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:`fixture/identity/${no}`}))};
}
const baseline = snapshot => ({raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map(h => ({...structuredClone(h),pastRuns:[],weightCarried:55}))}});
const set = (table,key,value,row=1) => { table[row][table[0].indexOf(key)] = value; };
test('offline table projection excludes current market, old marks and current result',async()=>{
 const input=fixture(),before=structuredClone(input),s=await createPredictionEvidenceSnapshot(input);
 assert.deepEqual(input,before);assert.equal(s.data.horses[0].pastRuns[0].racecourse,'京都');
 assert.equal(s.data.horses[0].pastRuns[0].cornerPositions[0],2);
 assert.equal(s.data.race.trackCondition,'良');
 for(const field of ['EARLY_Odds','AI_WinProb','Mark','HoleSignal','ResultConfirmedAt','popularity']) assert.equal(JSON.stringify(s.data).includes(field),false);
 assert.equal(s.formalKpiEligible,false);assert.equal(s.sourceAuthentication,'UNVERIFIED');assert.equal(Object.isFrozen(s.data.horses),true);
});
test('source export alone cannot grant DECISION_USED',async()=>{
 const s=await createPredictionEvidenceSnapshot(fixture());
 assert.ok(s.evidence.every(e=>e.decisionUsed===false));
});
test('history reaches existing calculator and usage requires observable ablation delta',async()=>{
 const s=await createPredictionEvidenceSnapshot(fixture()),b=baseline(s),before=structuredClone(b);
 const out=await comparePredictionEvidence(s,b);
 assert.deepEqual(b,before);assert.equal(out.changed,true);
 assert.ok(out.trace.some(e=>e.family==='HISTORY' && e.stage==='DECISION_USED' && e.ablatedOutputHash!==out.outputHash));
 assert.ok(out.trace.filter(e=>e.family==='INDEX').every(e=>e.decisionUsed===false));
 assert.equal(out.freezeMutation,'NONE');assert.equal(out.probabilityStatus,'EXISTING_MODEL_UNCALIBRATED');assert.equal(out.marksStatus,'NOT_GENERATED');
});
test('equal baseline features remain COMPARED without decision-use claim',async()=>{
 const s=await createPredictionEvidenceSnapshot(fixture());const b=baseline(s);b.data=structuredClone(s.data);
 const out=await comparePredictionEvidence(s,b);assert.equal(out.changed,false);assert.ok(out.trace.every(e=>!e.decisionUsed));
 assert.ok(out.trace.some(e=>e.stage==='COMPARED'));
});
test('NAR snapshot is prepared but no JRA calculator substitution is permitted',async()=>{
 const s=await createPredictionEvidenceSnapshot(fixture('NAR'));const out=await comparePredictionEvidence(s);
 assert.equal(out.status,'HOLD');assert.equal(out.reason,'NAR_CONSUMER_NOT_CONNECTED');assert.ok(out.trace.every(e=>!e.decisionUsed));
});
test('late source and absent explicit versions fail closed',async()=>{
 const f=fixture();f.source.availableAt='2026-10-09T00:01:00Z';await assert.rejects(createPredictionEvidenceSnapshot(f),/SOURCE_NOT_AVAILABLE/);
 for(const key of ['runId','modelVersion']) {const f=fixture();delete f[key];await assert.rejects(createPredictionEvidenceSnapshot(f),/EXPLICIT_IDENTITY/);}
});
test('TEMP and unknown status require resolved identity and explicit runner status',async()=>{
 const f=fixture();set(f.runners,'CanonicalHorse_Key','TEMP|馬1');await assert.rejects(createPredictionEvidenceSnapshot(f),/IDENTITY_UNRESOLVED/);
 const g=fixture();set(g.runners,'CancelStatus','UNKNOWN');await assert.rejects(createPredictionEvidenceSnapshot(g),/STATUS_UNKNOWN/);
});
test('duplicate runner and history slots are rejected',async()=>{
 const f=fixture();f.runners.push(structuredClone(f.runners[1]));await assert.rejects(createPredictionEvidenceSnapshot(f),/DUPLICATE/);
 const g=fixture();g.history.push(structuredClone(g.history[1]));await assert.rejects(createPredictionEvidenceSnapshot(g),/DUPLICATE/);
});
test('current and future race outcomes cannot enter historical features',async()=>{
 for(const day of ['2026-10-09','2026-10-10']) {const f=fixture();set(f.history,'PastRaceDate',day);await assert.rejects(createPredictionEvidenceSnapshot(f),/CURRENT_OR_FUTURE/);}
});
test('missing index remains missing and empty history has no AVAILABLE event',async()=>{
 const f=fixture();set(f.runners,'PeakIndex','UNKNOWN');f.history=f.history.slice(0,1);
 const s=await createPredictionEvidenceSnapshot(f);assert.equal(s.evidence.find(e=>e.horseKey==='HORSE1'&&e.family==='INDEX').stage,'MISSING');
 assert.ok(s.evidence.filter(e=>e.family==='HISTORY').every(e=>e.stage==='MISSING'));
});
test('tampered snapshot and mismatched comparison versions are rejected',async()=>{
 const s=await createPredictionEvidenceSnapshot(fixture()),tampered=structuredClone(s);tampered.data.horses[0].weightCarried=1;
 await assert.rejects(comparePredictionEvidence(tampered,baseline(s)),/HASH_MISMATCH/);
 const b=baseline(s);b.modelVersion='OTHER';await assert.rejects(comparePredictionEvidence(s,b),/VERSION_MISMATCH/);
});
test('market changes leave projected core and snapshot evidence unchanged',async()=>{
 const f=fixture(),g=structuredClone(f);set(g.runners,'EARLY_Odds',1.1);set(g.runners,'AI_WinProb',0);set(g.history,'Popularity',9);
 const a=await createPredictionEvidenceSnapshot(f),b=await createPredictionEvidenceSnapshot(g);assert.equal(a.snapshotHash,b.snapshotHash);
});
