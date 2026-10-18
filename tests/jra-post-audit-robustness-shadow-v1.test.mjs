import test from 'node:test';
import assert from 'node:assert/strict';
import {auditJraPostRobustness} from '../src/research/jra-post-audit-robustness-shadow-v1.mjs';
function fixture(){const f={predictionLayer:'PUBLISHED_NOTE',races:[
 {raceId:'2026-10-18|東京|8',preCapturedAt:'2026-10-17T20:40:00+09:00',postAt:'2026-10-18T13:35:00+09:00',resultCapturedAt:'2026-10-18T14:15:00+09:00',freezeVerified:false,
 marks:[{horseNo:2,mark:'◎'},{horseNo:12,mark:'○'},{horseNo:9,mark:'▲'},{horseNo:3,mark:'△'},{horseNo:6,mark:'☆'}],top3:[5,14,15],cpsiRankOneNo:2,wave:56,ticket:{stakeYen:2800,payoutYen:0}},
 {raceId:'2026-10-18|東京|11',preCapturedAt:'2026-10-17T20:40:00+09:00',postAt:'2026-10-18T15:20:00+09:00',resultCapturedAt:'2026-10-18T16:00:00+09:00',freezeVerified:false,
 marks:[{horseNo:9,mark:'◎'},{horseNo:7,mark:'○'},{horseNo:6,mark:'▲'},{horseNo:2,mark:'△'},{horseNo:11,mark:'☆'}],top3:[9,11,6],cpsiRankOneNo:9,wave:50,ticket:{stakeYen:2800,payoutYen:22270}},
 {raceId:'2026-10-18|東京|12',preCapturedAt:'2026-10-17T20:40:00+09:00',postAt:'2026-10-18T16:10:00+09:00',resultCapturedAt:'2026-10-18T17:00:00+09:00',freezeVerified:false,
 marks:[{horseNo:14,mark:'◎'},{horseNo:13,mark:'○'},{horseNo:7,mark:'▲'},{horseNo:10,mark:'△'},{horseNo:15,mark:'☆'}],top3:[14,15,13],cpsiRankOneNo:14,wave:49,ticket:{stakeYen:2800,payoutYen:127600}}
 ]};
 f.cohort={cohortId:'SYNTHETIC_THREE_RACE_REFERENCE',declaredRaceIds:f.races.map(r=>r.raceId),selectionRule:'SYNTHETIC_TEST_CASES_NOT_ACTUAL_12R_KPI',registeredAt:'2026-10-17T20:00:00+09:00',evaluationMode:'RETROSPECTIVE_REFERENCE'};
 f.races.forEach((r,i)=>{
  Object.assign(r,{organization:'JRA',snapshotId:'SYNTHETIC_SNAPSHOT_'+i,inputFreezeId:'SYNTHETIC_FREEZE_'+i,runId:'SYNTHETIC_RUN',roster:Array.from({length:16},(_,j)=>j+1)});
  r.signalSource={raceId:r.raceId,organization:'JRA',snapshotId:r.snapshotId,inputFreezeId:r.inputFreezeId,runId:r.runId,capturedAt:r.preCapturedAt,kind:'EARLY',sourceRef:'SYNTHETIC_PRE'};
  r.resultSource={raceId:r.raceId,organization:'JRA',capturedAt:r.resultCapturedAt,sourceRef:'SYNTHETIC_RESULT'};
  Object.assign(r.ticket,{basis:'REFERENCE_SIMULATION',sourceRef:'SYNTHETIC_TICKET',raceId:r.raceId,snapshotId:r.snapshotId,predictionLayer:f.predictionLayer,preCommittedAt:r.preCapturedAt,settledAt:r.resultCapturedAt});
 });
 return f;
}
test('separates Win and Top3 success while retaining 8R total exclusion',()=>{
 const f=fixture(),copy=structuredClone(f),r=auditJraPostRobustness(f);
 assert.deepEqual(f,copy);assert.equal(r.status,'POST_RESEARCH_ONLY');
 assert.equal(r.summary.anchorWins,2);assert.equal(r.summary.anchorTop3,2);
 assert.equal(r.summary.completeTop3Races,2);assert.equal(r.summary.totalTop3MissRaces,1);
 assert.equal(r.rows[0].missType,'TOTAL_TOP3_MISS');
 assert.equal(r.rows[1].missType,'FULL_TOP3_COVERAGE');
 assert.equal(r.ticketStress.topTwoSharePct,100);
 assert.equal(r.scopeStatus,'REFERENCE_NOT_FORMAL_ORIGINAL_EARLY');
 assert.equal(r.formalKpiEligible,false);assert.equal(r.estimatedFutureProfitability,false);
});
test('reports top-payout concentration and leave-one-out without treating zero payouts as missing',()=>{
 const r=auditJraPostRobustness(fixture());
 assert.equal(r.ticketStress.roiPct,1784.2); // synthetic 3-race subsample only
 assert.equal(r.ticketStress.leaveTopOne.remainingRaces,2);
 assert.equal(r.ticketStress.leaveTopTwo.roiPct,0);
});
test('rejects source/time/result/ticket contamination and duplicate race',()=>{
 const mutate=[f=>f.races[0].postAt='2026-10-18T14:35:00+09:00',
  f=>f.races[0].result={winner:5},f=>f.races[0].ticket.payoutYen=-1,
  f=>f.races[1].raceId=f.races[0].raceId,f=>f.races[0].marks[1].mark='◎',
  f=>f.races[2].resultCapturedAt='2026-10-18T15:00:00+09:00'];
 for(const m of mutate){const f=fixture();m(f);assert.equal(auditJraPostRobustness(f).status,'HOLD');}
});
test('unknown ticket stays unscored rather than being treated as a loss',()=>{
 const f=fixture();f.races[0].ticket=null;
 const r=auditJraPostRobustness(f);
 assert.equal(r.ticketStress.racesWithSuppliedAmounts,2);
 assert.equal(r.ticketStress.racesWithVerifiedAmounts,0);
 assert.equal(r.ticketStress.investmentYen,5600);
 assert.equal(r.summary.totalTop3MissRaces,1);
});
