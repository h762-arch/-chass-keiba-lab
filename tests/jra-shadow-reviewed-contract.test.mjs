import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewJraFinal5Exclusions as review,auditExclusionOutcome as outcome} from '../src/research/jra-coverage-rescue-shadow-v1.mjs';
import {auditJraPostRobustness as post} from '../src/research/jra-post-audit-robustness-shadow-v1.mjs';
import {timestamp,percentage} from '../src/research/jra-shadow-contract-v1.mjs';
const marks=['◎','○','▲','△','☆'];
const now=Date.parse('2026-10-18T20:00:00+09:00');
function fixture(){
 const source={raceId:'2026-10-18|東京|1',organization:'JRA',snapshotId:'SYNTHETIC_SNAPSHOT',runId:'RUN',inputFreezeId:'INPUT_FREEZE',capturedAt:'2026-10-18T10:00:00+09:00',kind:'EARLY',sourceRef:'SYNTHETIC_PRE'};
 return {organization:'JRA',raceId:source.raceId,race:{raceDate:'2026-10-18',postAt:'2026-10-18T15:00:00+09:00',surface:'ダ',population:'JRA_STANDARD_FLAT',declaredRunners:8},
  context:{cutoffAt:'2026-10-18T14:00:00+09:00',runId:'RUN',inputFreezeId:'INPUT_FREEZE',mode:'RETROSPECTIVE_REFERENCE'},
  snapshot:{...source,freezeId:'FREEZE_CLAIM_ONLY',isPreResult:true,freezeVerified:false},market:{...source},wave:null,
  horses:Array.from({length:8},(_,i)=>({horseNo:i+1,horseName:'Synthetic '+(i+1),mark:marks[i]??null,
   source:{...source,horseNo:i+1},cpsi:{value:i===7?null:50+i,coreUsableCount:i===7?1:3,neutralizedWeightPct:i===7?null:40,status:i===7?'INSUFFICIENT':'NUMERIC_SHADOW'},
   peak:50+i,recent:50+i,distance:80-i,course:80-i,recentSurfaces:['ダ'],preEvidenceGroups:['PRE_INDEX','RECENT_RUNS'],marketPopularity:i+1}))};
}
function result(pre){return {raceId:pre.raceId,organization:'JRA',snapshotId:pre.snapshotId,inputFreezeId:pre.inputFreezeId,sourceRef:'SYNTHETIC_RESULT',postAt:pre.pinnedPostAt,acquiredAt:'2026-10-18T16:00:00+09:00',top3:[6,7,8]};}
function cohort(){
 const rows=[['2026-10-17',1,1000],['2026-10-18',1,0],['2026-10-18',2,200]].map(([date,no,payout])=>{
  const r={raceId:date+'|東京|'+no,organization:'JRA',snapshotId:'S_'+date+'_'+no,runId:'RUN',inputFreezeId:'FREEZE',roster:[1,2,3,4,5,6,7,8],preCapturedAt:date+'T10:00:00+09:00',postAt:date+'T12:00:00+09:00',resultCapturedAt:date+'T13:00:00+09:00',freezeVerified:false,marks:marks.map((mark,i)=>({horseNo:i+1,mark})),top3:[1,2,3],cpsiRankOneNo:1,wave:50,ticket:null};
  r.signalSource={raceId:r.raceId,organization:'JRA',snapshotId:r.snapshotId,runId:r.runId,inputFreezeId:r.inputFreezeId,capturedAt:r.preCapturedAt,kind:'EARLY',sourceRef:'SYNTHETIC_PRE'};
  r.resultSource={raceId:r.raceId,organization:'JRA',capturedAt:r.resultCapturedAt,sourceRef:'SYNTHETIC_RESULT'};
  r.ticket={stakeYen:100,payoutYen:payout,basis:'REFERENCE_SIMULATION',raceId:r.raceId,snapshotId:r.snapshotId,predictionLayer:'PUBLISHED_NOTE',sourceRef:'SYNTHETIC_TICKET',preCommittedAt:r.preCapturedAt,settledAt:r.resultCapturedAt};
  return r;
 });
 return {predictionLayer:'PUBLISHED_NOTE',cohort:{cohortId:'TEST_COHORT',declaredRaceIds:rows.map(r=>r.raceId),selectionRule:'FIXED_SYNTHETIC_CASES',registeredAt:'2026-10-16T00:00:00+09:00',evaluationMode:'RETROSPECTIVE_REFERENCE'},races:rows};
}
for(const [name,mutate] of [
 ['post date mismatch',f=>f.race.postAt='2026-10-19T15:00:00+09:00'],
 ['impossible calendar date',f=>f.snapshot.capturedAt='2026-02-30T10:00:00+09:00'],
 ['invalid timezone',f=>f.snapshot.capturedAt='2026-10-18T10:00:00+25:00'],
 ['non-JRA venue',f=>f.raceId='2026-10-18|浦和|1'],
 ['race number 13',f=>f.raceId='2026-10-18|東京|13'],
 ['snapshot foreign race',f=>f.snapshot.raceId='2026-10-18|東京|2'],
 ['snapshot foreign run',f=>f.snapshot.runId='OTHER'],
 ['horse foreign circuit',f=>f.horses[0].source.organization='NAR'],
 ['horse foreign snapshot',f=>f.horses[0].source.snapshotId='OTHER'],
 ['horse foreign freeze',f=>f.horses[0].source.inputFreezeId='OTHER'],
 ['horse future source',f=>f.horses[0].source.capturedAt='2026-10-19T00:00:00+09:00'],
 ['horse source after snapshot',f=>f.horses[0].source.capturedAt='2026-10-18T10:00:01+09:00'],
 ['market missing receipt',f=>f.market=null],
 ['market foreign race',f=>f.market.raceId='2026-10-18|東京|2'],
 ['market after cutoff',f=>f.market.capturedAt='2026-10-18T14:00:01+09:00'],
 ['neutral weight absent for numeric CPSI',f=>f.horses[0].cpsi.neutralizedWeightPct=null],
 ['core count absent for numeric CPSI',f=>f.horses[0].cpsi.coreUsableCount=null],
 ['RESULT nested on evidence',f=>f.horses[0].source.RESULT={winner:1}],
 ['POST evidence family',f=>f.horses[0].preEvidenceGroups=['RESULT']],
 ['newcomer population',f=>f.race.population='NEWCOMER'],
 ['horse 99',f=>f.horses[7].horseNo=99],
 ['missing explicit context',f=>delete f.context],
 ['CPSI odds contamination field',f=>f.horses[0].cpsi.odds=2.1],
 ['wave foreign snapshot',f=>{f.wave={score:50,status:'NUMERIC_SHADOW',coveragePct:80,source:{...f.market,snapshotId:'OTHER'}};}]
])test('PRE fails closed: '+name,()=>{const f=fixture();mutate(f);assert.equal(review(f,{now}).status,'HOLD');});
test('PRE accessor arrays are rejected without invoking the getter',()=>{
 const f=fixture();let called=0;Object.defineProperty(f.horses,'0',{get(){called++;throw Error('PRIVATE');},enumerable:true});
 assert.equal(review(f,{now}).status,'HOLD');assert.equal(called,0);
});
test('PRE symbols, cycles, holes and nonfinite values return HOLD without throwing',()=>{
 for(const mutate of [f=>f[Symbol('private')]=1,f=>f.horses[0].cycle=f,f=>delete f.horses[0],f=>f.horses[0].recent=NaN]){const f=fixture();mutate(f);assert.equal(review(f,{now}).status,'HOLD');}
});
test('PRE never mutates or freezes caller inputs; UNKNOWN has its own queue',()=>{
 const f=fixture(),before=structuredClone(f),r=review(f,{now});assert.equal(r.status,'SHADOW_REVIEW');assert.deepEqual(f,before);assert.equal(Object.isFrozen(f),false);
 assert.ok(r.unknownReviewQueue.some(h=>h.horseNo===8));assert.equal(r.rows[0].evidenceFamilyCount,1);
 assert.deepEqual(r.final5.map(h=>h.horseNo),[1,2,3,4,5]);assert.equal(r.prospectiveEligible,false);assert.equal(r.researchBasis,'RETROSPECTIVE_REFERENCE');
 assert.equal(r.formalDiamondAssigned,false);assert.equal(r.formalDangerAssigned,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.ok(Object.isFrozen(r.rows[0]));
});
test('PRE recent/condition rank disagreement is review only, not a replacement',()=>{
 const f=fixture();f.horses[6].recent=199;f.horses[6].distance=1;f.horses[6].course=1;
 const r=review(f,{now}),h=r.rows.find(h=>h.horseNo===7);assert.ok(h.flags.includes('RECENT_CONDITION_RANK_CONFLICT'));assert.equal(h.reviewRequired,true);assert.equal(h.originalMark,null);
});
test('market does not change the ability review queue',()=>{
 const f=fixture(),a=review(f,{now});f.horses.forEach(h=>h.marketPopularity=null);f.market=null;
 const b=review(f,{now});assert.deepEqual(a.reviewQueue,b.reviewQueue);assert.equal(b.marketSanityReview.status,'MARKET_UNAVAILABLE');
});
test('a retrospective case cannot masquerade as a late prospective run',()=>{
 const f=fixture();f.context.mode='PROSPECTIVE';assert.equal(review(f,{now}).status,'HOLD');
 const early=review(f,{now:Date.parse('2026-10-18T13:00:00+09:00')});assert.equal(early.status,'SHADOW_REVIEW');assert.equal(early.prospectiveEligible,false);assert.equal(early.clockAuthority,'CALLER_INJECTED_TEST_CLOCK');
});
test('POST requires the actual immutable PRE instance; serialized or forged reports are rejected',()=>{
 const pre=review(fixture(),{now}),r=result(pre);assert.equal(outcome(pre,r,{now}).status,'POST_AUDIT_ONLY');
 assert.equal(outcome(structuredClone(pre),r,{now}).status,'HOLD');assert.equal(outcome({...pre,reviewQueue:[]},r,{now}).status,'HOLD');
});
for(const [name,mutate] of [
 ['original post differs',r=>{r.postAt='2026-10-17T15:00:00+09:00';r.acquiredAt='2026-10-17T16:00:00+09:00';}],
 ['foreign freeze',r=>r.inputFreezeId='OTHER'],['foreign snapshot',r=>r.snapshotId='OTHER'],
 ['future result',r=>r.acquiredAt='2026-10-19T16:00:00+09:00'],['outside roster',r=>r.top3=[1,2,18]],
 ['at post time',r=>r.acquiredAt=r.postAt]
])test('POST join fails closed: '+name,()=>{const p=review(fixture(),{now}),r=result(p);mutate(r);assert.equal(outcome(p,r,{now}).status,'HOLD');});
test('cohort money arithmetic, concentration, drawdown and per-day leave-out are exact',()=>{
 const f=cohort(),before=structuredClone(f),r=post(f,{now});assert.equal(r.status,'POST_RESEARCH_ONLY');assert.deepEqual(f,before);
 assert.equal(r.ticketStress.investmentYen,300);assert.equal(r.ticketStress.payoutYen,1200);assert.equal(r.ticketStress.netYen,900);assert.equal(r.ticketStress.roiPct,400);
 assert.equal(r.ticketStress.topOneSharePct,83.3);assert.equal(r.ticketStress.leaveTopOne.roiPct,100);assert.equal(r.ticketStress.leaveTopTwo.roiPct,0);
 assert.equal(r.ticketStress.medianPayoutYen,200);assert.equal(r.ticketStress.maxDrawdownYen,100);assert.equal(r.ticketStress.independentDayCount,2);
 assert.equal(r.ticketStress.leaveOneDayOut.find(d=>d.removedDate==='2026-10-17').roiPct,100);
 assert.equal(r.ticketStress.racesWithVerifiedAmounts,0);assert.equal(r.ticketStress.racesWithSuppliedAmounts,3);
});
test('cohort sorts chronologically rather than accepting submitted ordering as drawdown order',()=>{
 const f=cohort();f.races.reverse();const r=post(f,{now});assert.deepEqual(r.rows.map(h=>h.raceId),[...f.cohort.declaredRaceIds]);assert.equal(r.ticketStress.maxDrawdownYen,100);
});
test('actual and simulated payouts are never blended',()=>{
 const f=cohort();f.races[0].ticket.basis='ACTUAL_SETTLED';const r=post(f,{now});assert.equal(r.status,'POST_RESEARCH_ONLY');
 assert.equal(r.ticketStress.status,'SEGREGATED_BASES_NO_COMBINED_ROI');assert.equal(r.ticketStress.roiPct,null);
 assert.equal(r.ticketStress.byBasis.ACTUAL_SETTLED.roiPct,1000);assert.equal(r.ticketStress.byBasis.REFERENCE_SIMULATION.roiPct,100);
});
test('a ticket committed after the prediction but before post is accepted as an unverified supplied ticket',()=>{
 const f=cohort();f.races[0].ticket.preCommittedAt='2026-10-17T11:00:00+09:00';
 const r=post(f,{now});assert.equal(r.status,'POST_RESEARCH_ONLY');assert.equal(r.ticketStress.racesWithVerifiedAmounts,0);
});
test('zero and missing tickets, empty tails and actual removal count remain distinct',()=>{
 const f=cohort();f.races[0].ticket=null;f.races[2].ticket=null;const r=post(f,{now});assert.equal(r.ticketStress.roiPct,0);
 assert.equal(r.ticketStress.missingTicketRaces,2);assert.equal(r.ticketStress.leaveTopTwo.requestedRemoval,2);assert.equal(r.ticketStress.leaveTopTwo.removed,1);assert.equal(r.ticketStress.leaveTopTwo.roiPct,null);
 f.races[1].ticket=null;const empty=post(f,{now});assert.equal(empty.ticketStress.status,'NO_TICKET_DATA');assert.equal(empty.ticketStress.roiPct,null);
});
for(const [name,mutate] of [
 ['unsafe aggregate',f=>f.races.forEach(r=>r.ticket.stakeYen=Number.MAX_SAFE_INTEGER)],
 ['foreign ticket race',f=>f.races[0].ticket.raceId='2026-10-17|東京|2'],
 ['post-hoc ticket commitment',f=>f.races[0].ticket.preCommittedAt=f.races[0].resultCapturedAt],
 ['unsettled before result',f=>f.races[0].ticket.settledAt=f.races[0].preCapturedAt],
 ['negative payout',f=>f.races[0].ticket.payoutYen=-1],
 ['unknown ticket basis',f=>f.races[0].ticket.basis='VERIFIED'],
 ['cohort missing race',f=>f.cohort.declaredRaceIds.pop()],
 ['cohort replaced race',f=>f.cohort.declaredRaceIds[0]='2026-10-17|東京|12'],
 ['forged result identity',f=>f.races[0].resultSource.raceId='2026-10-18|東京|1'],
 ['mark outside roster',f=>f.races[0].marks[0].horseNo=18],
 ['post time date conflict',f=>f.races[0].postAt='2026-10-18T12:00:00+09:00'],
 ['PRE source future',f=>f.races[0].signalSource.capturedAt='2026-10-18T23:00:00+09:00'],
 ['late preregistration',f=>{f.cohort.evaluationMode='PROSPECTIVE_HOLDOUT';f.cohort.registeredAt='2026-10-18T19:00:00+09:00';}]
])test('cohort fails closed: '+name,()=>{const f=cohort();mutate(f);assert.equal(post(f,{now}).status,'HOLD');});
test('calendar and ratio boundary calculations are explicit',()=>{
 assert.ok(Number.isNaN(timestamp('2026-02-30T00:00:00Z')));assert.ok(Number.isNaN(timestamp('2026-10-18T24:00:00Z')));
 assert.equal(percentage(2,12),16.7);assert.equal(percentage(10,12),83.3);assert.equal(percentage(11,12),91.7);assert.equal(percentage(0,0),null);
});
