import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessEarlyPredictionAvailabilityV2 as assess,
  canonicalizeRaceId,
  makeRaceLocalHorseKey,
  PREDICTION_READINESS,
  VERSION
} from '../src/prediction/early-prefreeze-availability-v2.mjs';

function fixture(){
  const freezeAt='2026-10-17T01:00:00Z';
  return {
    raceId:'20261017_東京_09',
    venue:'東京',
    raceNo:9,
    startAt:'2026-10-17T02:00:00Z',
    freezeAt,
    expectedRunnerCount:5,
    runners:[1,2,3,4,5].map(n=>({
      horseNo:n,
      horseName:`合成馬${n}`,
      canonicalId:`id-${n}`,
      identitySource:'declared-registry',
      identityVerified:true,
      capturedAt:'2026-10-17T00:00:00Z',
      sourceRef:'declared-source',
      evidenceId:`e-${n}`,
      evidenceSource:'declared-store',
      evidenceSavedAt:'2026-10-17T00:10:00Z',
      evidenceReadback:true
    })),
    snapshot:{
      id:'snapshot-1',
      hash:'a'.repeat(64),
      savedAt:'2026-10-17T00:20:00Z',
      readback:true
    },
    cpsi:{
      coverageVerified:true,
      modelReady:true,
      compatStatus:'AVAILABLE',
      MainCompatScore:70,
      CoreUsableCount:3
    },
    early:{
      freezeId:'freeze-1',
      signalHash:'b'.repeat(64),
      immutable:true,
      readback:true,
      freezeAt
    },
    readback:{snapshot:true,evidence:true,early:true},
    final5:[1,2,3,4,5]
  };
}

test('version and full prediction are independent from strict formal KPI hold',()=>{
  const r=assess(fixture());
  assert.equal(VERSION,'CHASS_EARLY_PREFREEZE_AVAILABILITY_V2_8_3');
  assert.equal(r.predictionReadiness,PREDICTION_READINESS.FULL);
  assert.equal(r.predictionCanFreeze,true);
  assert.equal(r.formalKpiReadiness,'HOLD');
});

test('race number 9 and 09 normalize to one canonical key',()=>{
  assert.equal(canonicalizeRaceId({raceId:'20261017_東京_9'}),'20261017_東京_09');
  assert.equal(canonicalizeRaceId({raceId:'20261017_東京_09'}),'20261017_東京_09');
  assert.equal(makeRaceLocalHorseKey({canonicalRaceId:'20261017_東京_09',horseNo:7}),'20261017_東京_09|H07');
});

test('numeric-string raceNo is accepted after canonical normalization',()=>{
  const x=fixture();
  x.raceNo='9';
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.FULL);
});

test('horse number normalization is independent from race number range',()=>{
  assert.equal(makeRaceLocalHorseKey({canonicalRaceId:'20261017_東京_09',horseNo:21}),'20261017_東京_09|H21');
  assert.equal(makeRaceLocalHorseKey({canonicalRaceId:'20261017_東京_09',horseNo:30}),'20261017_東京_09|H30');
});

test('missing or malformed freeze time is a real HOLD',()=>{
  for(const value of [undefined,'not-a-date','2026-10-17T01:00:00','2026-02-30T01:00:00Z']){
    const x=fixture();
    if(value===undefined) delete x.freezeAt; else x.freezeAt=value;
    const out=assess(x);
    assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
    assert.ok(out.holdReasons.includes('FREEZE_TIME_INVALID_OR_MISSING'));
  }
});

test('malformed explicit result time is a HOLD',()=>{
  const x=fixture();
  x.resultAt='bad-time';
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('RESULT_TIME_INVALID'));
});

test('missing core source timestamp is a HOLD, not persistence degradation',()=>{
  const x=fixture();
  delete x.runners[0].capturedAt;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('CORE_SOURCE_TIME_UNVERIFIED'));
});

test('source captured after freeze is a real HOLD',()=>{
  const x=fixture();
  x.runners[0].capturedAt='2026-10-17T01:01:00Z';
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('POST_FREEZE_SOURCE_IN_CORE'));
});

test('missing Final5 is a HOLD because FINAL5_READY cannot be claimed',()=>{
  const x=fixture();
  delete x.final5;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('FINAL5_MISSING_OR_CORRUPT'));
});

test('duplicate or off-roster Final5 is a HOLD',()=>{
  for(const final5 of [[1,2,3,4,4],[1,2,3,4,9]]){
    const x=fixture();
    x.final5=final5;
    const out=assess(x);
    assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
    assert.ok(out.holdReasons.includes('FINAL5_MISSING_OR_CORRUPT'));
  }
});

test('missing permanent horse IDs degrades same-race prediction instead of holding it',()=>{
  const x=fixture();
  for(const r of x.runners){
    delete r.canonicalId;
    delete r.identitySource;
    r.identityVerified=false;
  }
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.DEGRADED);
  assert.equal(out.predictionCanFreeze,true);
  assert.ok(out.degradedReasons.includes('PERMANENT_HORSE_ID_UNAVAILABLE'));
  assert.equal(out.raceLocalHorseKeys.length,5);
});

test('missing evidence-card materialization degrades but does not erase the prediction',()=>{
  const x=fixture();
  for(const r of x.runners){
    delete r.evidenceId;
    delete r.evidenceSource;
    delete r.evidenceSavedAt;
    r.evidenceReadback=false;
  }
  x.readback.evidence=false;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.DEGRADED);
  assert.ok(out.degradedReasons.includes('EVIDENCE_CARD_NOT_MATERIALIZED'));
  assert.ok(out.degradedReasons.includes('READBACK_PENDING'));
});

test('numeric compatibility CPSI may coexist with formal CPSI model HOLD',()=>{
  const x=fixture();
  x.cpsi.modelReady=false;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.DEGRADED);
  assert.equal(out.cpsiCompatStatus,'AVAILABLE');
  assert.equal(out.cpsiCompatValue,70);
  assert.equal(out.cpsiFormalModelStatus,'MODEL_HOLD');
  assert.ok(out.degradedReasons.includes('FORMAL_CPSI_MODEL_HOLD'));
});

test('declared CPSI AVAILABLE without valid MainCompatScore and CORE>=2 is invalid and ignored',()=>{
  const x=fixture();
  delete x.cpsi.MainCompatScore;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.DEGRADED);
  assert.equal(out.cpsiCompatStatus,'INVALID');
  assert.equal(out.cpsiCompatValue,null);
  assert.ok(out.degradedReasons.includes('CPSI_COMPAT_DECLARATION_INVALID'));
});

test('CPSI not applicable does not become a global blocker',()=>{
  const x=fixture();
  x.cpsi={coverageVerified:false,modelReady:false,status:'NOT_APPLICABLE'};
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.FULL);
  assert.equal(out.cpsiCompatStatus,'NOT_APPLICABLE');
});

test('resolved name conflict is quarantined and degraded, not whole-race HOLD',()=>{
  const x=fixture();
  x.runners[1].nameConflict=true;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.DEGRADED);
  assert.ok(out.degradedReasons.includes('NAME_CONFLICT_QUARANTINED'));
});

test('ambiguous horse assignment is a real HOLD',()=>{
  const x=fixture();
  x.runners[1].identityAmbiguous=true;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('IDENTITY_ASSIGNMENT_AMBIGUOUS'));
});

test('race ID and raceNo disagreement is a HOLD',()=>{
  const x=fixture();
  x.raceId='20261017_東京_08';
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('RACE_IDENTITY_UNRESOLVED'));
});

test('explicit result leakage is a real HOLD',()=>{
  const x=fixture();
  x.resultLeakDetected=true;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('RESULT_LEAK_DETECTED'));
});

test('broken runner universe is a real HOLD',()=>{
  const x=fixture();
  x.runners=x.runners.slice(0,4);
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('RUNNER_UNIVERSE_UNRESOLVED'));
});

test('optional module errors stay local',()=>{
  const x=fixture();
  x.optionalModules={workout:{status:'MISSING'},video:'UNAVAILABLE'};
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.DEGRADED);
  assert.ok(out.degradedReasons.includes('OPTIONAL_MODULE_DEGRADED'));
});


test('numeric-string HorseNo and expectedRunnerCount are normalized for prediction availability',()=>{
  const x=fixture();
  x.expectedRunnerCount='5';
  x.runners=x.runners.map(r=>({...r,horseNo:String(r.horseNo)}));
  x.final5=['1','2','3','4','5'];
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.FULL);
  assert.equal(out.raceLocalHorseKeys[4],'20261017_東京_09|H05');
});

test('missing core source provenance is a HOLD',()=>{
  const x=fixture();
  delete x.runners[0].sourceRef;
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.ok(out.holdReasons.includes('CORE_SOURCE_PROVENANCE_UNVERIFIED'));
});

test('malformed or conflicting explicit raceDate is a HOLD',()=>{
  for(const raceDate of ['bad-date','2026-10-18']){
    const x=fixture();
    x.raceDate=raceDate;
    const out=assess(x);
    assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
    assert.ok(out.holdReasons.includes('RACE_IDENTITY_UNRESOLVED'));
  }
});

test('availability overlay never claims local authority to promote Formal KPI',()=>{
  const out=assess(fixture());
  assert.equal(out.formalKpiAssessmentAuthority,'EXTERNAL_FORMAL_INTEGRATION_REQUIRED');
  assert.equal(out.formalKpiReadiness,'HOLD');
});

test('historical formal promotion is never authorized by availability overlay',()=>{
  const out=assess(fixture());
  assert.equal(out.historicalFormalPromotionAllowed,false);
  assert.equal(out.retryPolicy.maxAutomaticRetries,1);
});

test('invalid object shapes do not throw and remain HOLD',()=>{
  const cycle={}; cycle.self=cycle;
  for(const x of [null,[],false,'x',cycle,{value:NaN},{value:BigInt(1)}]){
    const out=assess(x);
    assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  }
});

test('getters are not executed',()=>{
  let calls=0;
  const x={};
  Object.defineProperty(x,'runners',{enumerable:true,get(){calls++;throw Error('PRIVATE');}});
  const out=assess(x);
  assert.equal(out.predictionReadiness,PREDICTION_READINESS.HOLD);
  assert.equal(calls,0);
});

// Repository adaptation: consistency checks beyond the uploaded 28 cases.
for(const [name,change] of [
 ['impossible ID date',x=>x.raceId='20260230_東京_09'],
 ['ID differs from JST start date',x=>x.raceId='20261018_東京_09'],
 ['malformed explicit date',x=>x.raceDate='2026--10-17'],
 ['invalid legacy calendar',x=>x.raceId='20260230-JRA-05-09'],
 ['legacy date contradiction',x=>{x.raceId='20261018-JRA-05-09';x.raceDate='2026-10-17';}],
 ['legacy race contradiction',x=>{x.raceId='20261017-JRA-05-08';x.raceDate='2026-10-17';}],
 ['pipe venue contradiction',x=>x.raceId='2026-10-17|中山|9'],
 ['result flag',x=>x.resultPresent=true],
 ['result object',x=>x.result={finishOrder:[1,2,3]}],
 ['result array',x=>x.result=[1,2,3]],
 ['result snapshot',x=>x.resultSnapshot={finishOrder:[1,2,3]}],
 ['validated input',x=>x.validationCompleted=true]
])test(`review: ${name} cannot authorize availability`,()=>{const x=fixture();change(x);const r=assess(x);assert.equal(r.predictionReadiness,PREDICTION_READINESS.HOLD);assert.equal(r.predictionCanFreeze,false);assert.equal(r.formalKpiEligible,false);});

test('review: legacy and pipe IDs preserve their namespace and numeric race normalization',()=>{
 for(const raceId of ['20261017-JRA-05-09','2026-10-17|東京|9']){const x=fixture();x.raceId=raceId;x.raceDate='2026-10-17';x.raceNo='9';const r=assess(x);assert.equal(r.predictionReadiness,PREDICTION_READINESS.FULL);assert.equal(r.canonicalRaceId,raceId);}
});
test('review: calendar date compares with JST rather than UTC',()=>{const x=fixture();x.raceId='20261018_東京_09';x.startAt='2026-10-17T16:00:00Z';x.freezeAt='2026-10-17T15:00:00Z';x.early.freezeAt=x.freezeAt;assert.equal(assess(x).predictionReadiness,PREDICTION_READINESS.FULL);});
test('review: invalid structured canonical helper never falls back to an opaque key',()=>{assert.equal(canonicalizeRaceId({raceId:'20260230_東京_09'}),null);assert.equal(canonicalizeRaceId({raceDate:'2026-02-30',venue:'東京',raceNo:9}),null);});

for(const [name,change] of [
 ['contradictory applicability',x=>x.cpsi.status='NOT_APPLICABLE'],
 ['score and count from separate declarations',x=>{delete x.cpsi.CoreUsableCount;x.cpsiCompat={status:'AVAILABLE',CoreUsableCount:3};}],
 ['contradictory score aliases',x=>x.cpsi.mainCompatScore=25],
 ['conflicting full declarations',x=>x.cpsiCompat={status:'AVAILABLE',MainCompatScore:90,CoreUsableCount:3}]
])test(`review: CPSI ${name} is ignored and degraded`,()=>{const x=fixture();change(x);const r=assess(x);assert.equal(r.predictionReadiness,PREDICTION_READINESS.DEGRADED);assert.equal(r.cpsiCompatStatus,'INVALID');assert.equal(r.cpsiCompatValue,null);});
test('review: nondeclared CPSI fields cannot override the declared score',()=>{const x=fixture();x.cpsi={coverageVerified:true,modelReady:true,MainCompatScore:-1};x.cpsiCompat={status:'AVAILABLE',MainCompatScore:70,CoreUsableCount:3};const r=assess(x);assert.equal(r.predictionReadiness,PREDICTION_READINESS.FULL);assert.equal(r.cpsiCompatValue,70);});
test('review: pure not-applicable CPSI has no numerical compatibility value',()=>{const x=fixture();x.cpsi={status:'NOT_APPLICABLE',MainCompatScore:70,CoreUsableCount:3};const r=assess(x);assert.equal(r.predictionReadiness,PREDICTION_READINESS.FULL);assert.equal(r.cpsiCompatValue,null);});
test('review: public horse-key helper invokes neither getters nor serialization callbacks',()=>{let calls=0;assert.equal(makeRaceLocalHorseKey({get horseNo(){calls++;throw Error();},canonicalRaceId:'r'}),null);assert.equal(makeRaceLocalHorseKey({toJSON(){calls++;throw Error();}}),null);assert.equal(makeRaceLocalHorseKey(null),null);assert.equal(calls,0);});
test('review: availability is declaration-only and never execution or KPI authority',()=>{
 for(const x of [fixture(),null]){const r=assess(x);assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.formalKpiEligible,false);assert.equal(r.assessmentBasis,'CALLER_DECLARATIONS_ONLY');assert.equal(r.freezeExecutionAuthorized,false);assert.equal(r.earlyFreezeVerified,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');}
});
test('review: caller input is preserved and persistence failures still degrade',()=>{const x=fixture();delete x.snapshot;delete x.early;delete x.readback;const before=structuredClone(x),r=assess(x);assert.equal(r.predictionReadiness,PREDICTION_READINESS.DEGRADED);assert.equal(r.predictionCanFreeze,true);assert.equal(r.freezeExecutionAuthorized,false);assert.deepEqual(x,before);});
test('review: opaque IDs are preserved with explicit declared race metadata',()=>{const x=fixture();x.raceId='legacy-race-9';x.raceDate='2026-10-17';x.raceNo='9';const r=assess(x);assert.equal(r.predictionReadiness,PREDICTION_READINESS.FULL);assert.equal(r.canonicalRaceId,'legacy-race-9');});
