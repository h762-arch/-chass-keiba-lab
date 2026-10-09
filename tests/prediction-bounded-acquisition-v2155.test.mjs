import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBoundedPredictionAcquisitionV2155 as execute} from '../src/prediction/prediction-bounded-acquisition-v2155.mjs';
import {assessPredictionKpiContractV2155 as assess} from '../src/prediction/prediction-kpi-contract-v2155.mjs';
const tiers=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
function fixture(){
  const plan={version:'v2.15.5',mode:'FORWARD',stage:'ORIGINAL_EARLY',immutableStatus:'FROZEN',leakageGuard:'PASS',planId:'plan1',runId:'run1',raceId:'race1',eligibilityId:'el1',scopeKey:'h1',fieldId:'E_POSITION_PACE',requirementSnapshotId:'req1',contractFreezeId:'contract1',acquisitionRequired:'MUST_ACQUIRE',numericMetric:true,frozenAt:'2026-10-09T09:00:00Z',cutoffAt:'2026-10-09T10:50:00Z',offAt:'2026-10-09T11:00:00Z',maxAttemptMs:50,tiers:tiers.map((tier,i)=>({tier,provider:'p'+i,sourceCandidate:'source-candidate-'+i}))};
  const calls=[],collectors=Object.fromEntries(plan.tiers.map(t=>[t.provider,async({context})=>{calls.push(context.tier);return {result:'NOT_FOUND',reasonCode:'SOURCE_NOT_FOUND'}}]));
  let time=Date.parse('2026-10-09T10:00:00Z');const clock=()=>{const n=time;time+=100;return n};return {plan,collectors,clock,calls};
}
const found=(overrides={})=>({result:'FOUND',runId:'run1',raceId:'race1',eligibilityId:'el1',scopeKey:'h1',fieldId:'E_POSITION_PACE',sourceSnapshotId:'source1',sourceStage:'EARLY',identityStatus:'PASS',sourceLineage:'PASS',leakageGuard:'PASS',capturedAt:'2026-10-09T10:00:00.050Z',dataAsOf:'2026-10-09T09:30:00Z',value:0,...overrides});
test('real registered collectors execute exactly four tiers before declared exhaustion',async()=>{
  const x=fixture(),r=await execute(x);assert.equal(r.acquisitionState,'EXHAUSTED_DECLARED');assert.deepEqual(x.calls,tiers);assert.equal(r.attempts.length,4);assert.equal(r.value,null);assert.equal(r.finalSourceState,'NOT_FOUND');assert.equal(r.persisted,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.productionActivationReady,false);assert.ok(Object.isFrozen(r.attempts));
});
test('first valid FOUND stops without unnecessary later provider calls and preserves zero',async()=>{
  const x=fixture();x.collectors.p0=async()=>found();const r=await execute(x);assert.equal(r.acquisitionState,'RESOLVED');assert.equal(r.value,0);assert.equal(r.attempts.length,1);assert.equal(r.attempts[0].completedAt,'2026-10-09T10:00:00.100Z');assert.deepEqual(x.calls,[]);
});
test('alternate authoritative success runs only preceding tiers',async()=>{
  const x=fixture();x.collectors.p2=async()=>found();const r=await execute(x);assert.equal(r.acquisitionState,'RESOLVED');assert.equal(r.attempts.length,3);assert.deepEqual(x.calls,tiers.slice(0,2));
});
test('missing collector is rejected before any call and cannot become exhaustion',async()=>{
  const x=fixture();delete x.collectors.p3;const r=await execute(x);assert.equal(r.reason,'ALL_COLLECTORS_REQUIRED');assert.equal(r.status,'HOLD');assert.equal(r.attempts.length,0);assert.equal(x.calls.length,0);
});
test('exceptions are sanitized, recorded as READ_FAILED and bounded',async()=>{
  const x=fixture();x.collectors.p0=async()=>{throw Error('private-token-secret')};const r=await execute(x);assert.equal(r.acquisitionState,'EXHAUSTED_DECLARED');assert.equal(r.resolutionStatus,'READ_FAILED');assert.equal(r.attempts[0].reasonCode,'COLLECTOR_READ_FAILED');assert.ok(!JSON.stringify(r).includes('private-token-secret'));
});
test('conflict stops progression and does not authorize exhaustion',async()=>{
  const x=fixture();x.collectors.p0=async()=>({result:'CONFLICT'});const r=await execute(x);assert.equal(r.status,'HOLD');assert.equal(r.reason,'SOURCE_CONFLICT');assert.equal(r.attempts.length,1);assert.deepEqual(x.calls,[]);
});
test('NOT_APPLICABLE requires an actual call and a reason',async()=>{
  const x=fixture();x.collectors.p0=async()=>({result:'NOT_APPLICABLE',reasonCode:'NO_ALTERNATE_SOURCE'});assert.equal((await execute(x)).acquisitionState,'EXHAUSTED_DECLARED');const y=fixture();y.collectors.p0=async()=>({result:'NOT_APPLICABLE'});assert.equal((await execute(y)).reason,'RECEIPT_REASON_REQUIRED');
});
test('timeout aborts cooperatively and remains HOLD without later tiers',async()=>{
  const x=fixture();x.plan.maxAttemptMs=5;let aborted=false;x.collectors.p0=({signal})=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true}));const r=await execute(x);assert.equal(r.reason,'COLLECTOR_TIMEOUT');assert.equal(r.status,'HOLD');assert.equal(aborted,true);assert.equal(r.attempts.length,1);assert.deepEqual(x.calls,[]);
});
test('cutoff reached during response rejects even pre-cutoff source timestamp',async()=>{
  const x=fixture();let i=0;x.clock=()=>[Date.parse(x.plan.cutoffAt)-1,Date.parse(x.plan.cutoffAt)][i++];x.collectors.p0=async()=>found();const r=await execute(x);assert.equal(r.reason,'CUTOFF_REACHED');assert.equal(r.status,'HOLD');assert.equal(r.attempts[0].result,'BLOCKED');
});
test('unstarted, backwards and invalid clocks never complete acquisition',async()=>{
  for(const clock of [()=>Date.parse('2026-10-09T08:00:00Z'),()=>NaN,(()=>{let i=0;return ()=>[Date.parse('2026-10-09T10:00:00Z'),Date.parse('2026-10-09T09:59:00Z')][i++]})()]){const x=fixture();x.clock=clock;assert.equal((await execute(x)).status,'HOLD')}
});
test('bad provenance, POST source, foreign field and identity remain HOLD with recorded attempt',async()=>{
  for(const overrides of [{runId:'other'},{fieldId:'other'},{sourceStage:'POST'},{identityStatus:'UNKNOWN'},{sourceLineage:'UNKNOWN'}]){const x=fixture();x.collectors.p0=async()=>found(overrides);const r=await execute(x);assert.equal(r.reason,'FOUND_PROVENANCE_INVALID');assert.equal(r.attempts.length,1)}
});
test('null, unknown and nonnumeric values never become zero or neutral score',async()=>{
  for(const value of [null,'UNKNOWN',undefined,NaN]){const x=fixture();x.collectors.p0=async()=>found({value});const r=await execute(x);assert.equal(r.status,'HOLD');assert.equal(r.attempts.length,1);assert.equal(r.value,undefined)}
});
test('future capture/as-of and missing timestamp cannot pass FOUND',async()=>{
  for(const overrides of [{capturedAt:'2026-10-09T10:01:00Z'},{dataAsOf:'2026-10-09T10:01:00Z'},{capturedAt:null}]){const x=fixture();x.collectors.p0=async()=>found(overrides);assert.equal((await execute(x)).reason,'FOUND_AVAILABILITY_INVALID')}
});
test('invalid plan, diagnostic stage, unlimited timeout and reordered tiers do not call sources',async()=>{
  for(const mutate of [p=>p.mode='DIAGNOSTIC_REPLAY',p=>p.maxAttemptMs=10000,p=>p.tiers.reverse(),p=>p.acquisitionRequired='NOT_REQUIRED',p=>p.frozenAt=p.cutoffAt]){const x=fixture();mutate(x.plan);assert.equal((await execute(x)).status,'HOLD');assert.equal(x.calls.length,0)}
});
test('plan is copied and collector context frozen; no input mutation',async()=>{
  const x=fixture(),before=structuredClone(x.plan);x.collectors.p0=async({context})=>{assert.ok(Object.isFrozen(context));return found()};await execute(x);assert.deepEqual(x.plan,before);
});
test('malformed receipts and absent inputs fail closed',async()=>{
  for(const value of [null,{result:'UNKNOWN'},[]]){const x=fixture();x.collectors.p0=async()=>value;const r=await execute(x);assert.equal(r.status,'HOLD');assert.equal(r.attempts.length,1)}for(const x of [undefined,null,{}])assert.equal((await execute(x)).status,'HOLD');
});
test('completed exhaustion attempts join the Phase88 policy without denominator shrink',async()=>{
  const x=fixture(),r=await execute(x),runnerKeys=['h1','h2','h3','h4','h5'],rolePairs=[];
  for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)rolePairs.push({horseKeys:[runnerKeys[i],runnerKeys[j]],status:'PASS'});
  const plan={eligibilityId:'el1',fieldId:'E_POSITION_PACE',scopeKey:'h1',requirementSnapshotId:'req1',eligibilityStatus:'ELIGIBLE',acquisitionRequired:'MUST_ACQUIRE',numericMetric:true,structuralMissing:false};
  const contract={version:'v2.15.5',baselineReadinessVersion:'CONTRACT_V04',freezeId:'contract1',sourceSnapshotId:'cs1',frozenAt:x.plan.frozenAt,fields:[plan]};
  const gates=['officialCard','identity','sourceFrozen','sourceLineage','leakageGuard','candidateTrace','portfolio','preservation','roleTournament','signalEvidence','productionWritePolicy','baselineReadiness','fieldEligibilityProof'];
  const core={runId:'run1',raceId:'race1',freezeId:'frz1',snapshotHash:'external-source-hash',fieldEligibilityFreezeId:'fields1',acquisitionFreezeId:'acq1',contractFreezeId:'contract1',frozenAt:'2026-10-09T10:40:00Z',offAt:x.plan.offAt,mode:'FORWARD',stage:'ORIGINAL_EARLY',immutableStatus:'FROZEN',resultPresent:false,cancelled:false,postFreezeMutation:false,gates:Object.fromEntries(gates.map(k=>[k,'PASS'])),runnerKeys,final5Keys:runnerKeys,rolePairs};
  const fields=[{...plan,runId:'run1',raceId:'race1',contractFreezeId:'contract1',freezeId:'fields1',acquisitionFreezeId:'acq1',frozenAt:'2026-10-09T10:30:00Z',immutableStatus:'FROZEN',leakageGuard:'PASS',sourceLineage:'PASS',conflict:false,acquisitionState:r.acquisitionState,resolutionStatus:r.resolutionStatus,value:r.value,exhaustionCode:r.exhaustionCode,exhaustionReason:r.exhaustionReason,finalSourceState:r.finalSourceState}];
  const a=await assess({contract,core,fields,attempts:r.attempts});assert.equal(a.formalKpiStatus,'FORMAL_WITH_DECLARED_MISSING');assert.equal(a.counts.eligibleNumericFieldCount,1);assert.equal(a.counts.exhaustedAcquireCount,1);assert.equal(a.formalKpiEligible,false);
});
