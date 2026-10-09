import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPredictionKpiContractV2155 as assess} from '../src/prediction/prediction-kpi-contract-v2155.mjs';
const gates=['officialCard','identity','sourceFrozen','sourceLineage','leakageGuard','candidateTrace','portfolio','preservation','roleTournament','signalEvidence','productionWritePolicy','baselineReadiness','fieldEligibilityProof'];
const tiers=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
function fixture(){
  const runnerKeys=['h1','h2','h3','h4','h5','h6'],final5Keys=runnerKeys.slice(0,5),rolePairs=[];
  for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)rolePairs.push({horseKeys:[final5Keys[i],final5Keys[j]],status:'PASS'});
  const core={runId:'run1',raceId:'race1',freezeId:'prediction-frz1',snapshotHash:'verified-external-hash',fieldEligibilityFreezeId:'field-frz1',acquisitionFreezeId:'acq-frz1',contractFreezeId:'contract-frz1',frozenAt:'2026-10-09T09:00:00Z',offAt:'2026-10-09T10:00:00Z',mode:'FORWARD',stage:'ORIGINAL_EARLY',immutableStatus:'FROZEN',resultPresent:false,cancelled:false,postFreezeMutation:false,gates:Object.fromEntries(gates.map(k=>[k,'PASS'])),runnerKeys,final5Keys,rolePairs};
  const plan={eligibilityId:'el1',fieldId:'E_POSITION_PACE',scopeKey:'h1',requirementSnapshotId:'req1',eligibilityStatus:'ELIGIBLE',acquisitionRequired:'MUST_ACQUIRE',numericMetric:true,structuralMissing:false};
  const contract={version:'v2.15.5',baselineReadinessVersion:'CONTRACT_V04',freezeId:'contract-frz1',sourceSnapshotId:'contract-source1',frozenAt:'2026-10-09T07:00:00Z',fields:[plan]};
  const field={...plan,runId:'run1',raceId:'race1',contractFreezeId:'contract-frz1',freezeId:'field-frz1',acquisitionFreezeId:'acq-frz1',frozenAt:'2026-10-09T08:50:00Z',immutableStatus:'FROZEN',leakageGuard:'PASS',sourceLineage:'PASS',conflict:false,acquisitionState:'RESOLVED',resolutionStatus:'RESOLVED',value:0,sourceSnapshotId:'source1',sourceStage:'EARLY'};
  const attempt={attemptId:'a1',eligibilityId:'el1',fieldId:plan.fieldId,scopeKey:'h1',runId:'run1',raceId:'race1',attemptNo:1,tier:tiers[0],provider:'canonical-cache',sourceCandidate:'pre-result-cache',attemptedAt:'2026-10-09T08:00:00Z',result:'FOUND',sourceSnapshotId:'source1',leakageGuard:'PASS',immutableStatus:'FROZEN'};
  return {contract,core,fields:[field],attempts:[attempt]};
}
function exhaust(x){
  const f=x.fields[0];Object.assign(f,{acquisitionState:'EXHAUSTED_DECLARED',resolutionStatus:'SOURCE_MISSING',value:null,exhaustionCode:'SOURCE_EXHAUSTED',exhaustionReason:'All bounded pre-cutoff tiers completed without source',finalSourceState:'NOT_FOUND'});
  x.attempts=tiers.map((tier,i)=>({...x.attempts[0],attemptId:'a'+(i+1),attemptNo:i+1,tier,attemptedAt:`2026-10-09T08:0${i}:00Z`,result:'NOT_FOUND',reasonCode:'SOURCE_NOT_FOUND'}));return x;
}
function ineligible(x,fieldId='AI_WIN_PROB',eligibility='INELIGIBLE_MODEL_NOT_READY'){
  Object.assign(x.contract.fields[0],{fieldId,eligibilityStatus:eligibility,acquisitionRequired:'NOT_REQUIRED',eligibilityReasonCode:'MODEL_NOT_PROMOTED',reason:'No approved formal numeric contract',structuralMissing:true});
  Object.assign(x.fields[0],x.contract.fields[0],{acquisitionState:'NOT_REQUIRED',resolutionStatus:'NOT_APPLICABLE',value:null});x.attempts=[];return x;
}
test('full numeric resolution yields FULL candidate but never adoption or activation',async()=>{
  const x=fixture(),before=structuredClone(x),r=await assess(x);assert.equal(r.formalKpiStatus,'FORMAL_FULL');assert.equal(r.formalPredictionKpiCandidate,true);assert.equal(r.acquisitionGate,'TERMINAL');assert.equal(r.metricEligibleFields[0].value,0);assert.equal(r.formalKpiEligible,false);assert.equal(r.adopted,false);assert.equal(r.productionActivationReady,false);assert.deepEqual(x,before);assert.ok(Object.isFrozen(r.counts));
});
test('all four bounded tiers exhausted preserves prediction KPI candidate while numeric stays missing',async()=>{
  const r=await assess(exhaust(fixture()));assert.equal(r.formalKpiStatus,'FORMAL_WITH_DECLARED_MISSING');assert.equal(r.formalPredictionKpiCandidate,true);assert.deepEqual(r.metricEligibleFields,[]);assert.equal(r.counts.eligibleFieldCount,1);assert.equal(r.counts.resolvedEligibleFieldCount,0);assert.equal(r.counts.exhaustedAcquireCount,1);assert.equal(r.acquisitionExhausted[0].attemptIds.length,4);assert.equal(r.evidenceInterpretation,'MISSING_IS_NOT_NEGATIVE');
});
test('unpromoted probability does not remove core-valid prediction from KPI candidate',async()=>{
  const r=await assess(ineligible(fixture()));assert.equal(r.formalKpiStatus,'FORMAL_WITH_DECLARED_MISSING');assert.equal(r.formalPredictionKpiCandidate,true);assert.equal(r.counts.eligibleFieldCount,0);assert.deepEqual(r.metricEligibleFields,[]);
});
test('proxy-only EV is declared unavailable without changing core classification',async()=>{
  const x=ineligible(fixture(),'WIN_EV','INELIGIBLE_STAGE');Object.assign(x.contract.fields[0],{eligibilityReasonCode:'PROXY_MARKET',reason:'Same-snapshot formal market absent'});const r=await assess(x);assert.equal(r.formalKpiStatus,'FORMAL_WITH_DECLARED_MISSING');assert.deepEqual(r.metricEligibleFields,[]);
});
test('LIVE-only field is not missing EARLY and does not block FULL',async()=>{
  const x=ineligible(fixture(),'LIVE_BIAS','INELIGIBLE_STAGE');x.contract.fields[0].structuralMissing=false;const r=await assess(x);assert.equal(r.formalKpiStatus,'FORMAL_FULL');assert.deepEqual(r.missingFields,[]);
});
test('buildable pipeline must attempt acquisition even if numeric field is not yet eligible',async()=>{
  const x=exhaust(fixture());Object.assign(x.contract.fields[0],{eligibilityStatus:'INELIGIBLE_PIPELINE_NOT_READY',eligibilityReasonCode:'BUILD_REQUIRED',reason:'Canonical pre-cutoff reference must be built',acquisitionRequired:'MUST_ATTEMPT_PIPELINE'});x.fields[0].eligibilityStatus=x.contract.fields[0].eligibilityStatus;const r=await assess(x);assert.equal(r.formalKpiStatus,'FORMAL_WITH_DECLARED_MISSING');assert.equal(r.counts.requiredAcquireCount,1);
});
test('missing attempt, incomplete sweep or reasonless exhaustion cannot claim terminal',async()=>{
  for(const mutate of [x=>x.attempts=[],x=>x.attempts.pop(),x=>delete x.fields[0].exhaustionReason,x=>x.attempts[3].result='FOUND',x=>delete x.fields[0].finalSourceState]){const x=exhaust(fixture());mutate(x);const r=await assess(x);assert.equal(r.status,'HOLD');assert.equal(r.formalPredictionKpiCandidate,false)}
});
test('NOT_STARTED and IN_PROGRESS block before progression',async()=>{
  for(const state of ['NOT_STARTED','IN_PROGRESS']){const x=fixture();x.fields[0].acquisitionState=state;assert.equal((await assess(x)).formalKpiStatus,'NOT_FORMAL')}
});
test('failed acquisition cannot reclassify frozen eligible contract or shrink denominator',async()=>{
  const x=exhaust(fixture());x.fields[0].eligibilityStatus='INELIGIBLE_SAMPLE';const r=await assess(x);assert.equal(r.status,'HOLD');assert.equal(r.counts.eligibleFieldCount,1);
});
test('every core gate is required even when acquisition fully resolves',async()=>{
  for(const gate of gates){const x=fixture();x.core.gates[gate]='UNKNOWN';assert.equal((await assess(x)).formalPredictionKpiCandidate,false,gate)}
});
test('historical replay, late freeze, cancellation, result and mutation never become formal candidates',async()=>{
  for(const mutate of [x=>x.core.mode='DIAGNOSTIC_REPLAY',x=>x.core.frozenAt=x.core.offAt,x=>x.core.cancelled=true,x=>x.core.resultPresent=true,x=>x.core.postFreezeMutation=true,x=>x.core.stage='LIVE']){const x=fixture();mutate(x);assert.equal((await assess(x)).formalKpiStatus,'NOT_FORMAL')}
});
test('five distinct runners and ten distinct complete pairs cannot be replaced by counts',async()=>{
  for(const mutate of [x=>x.core.final5Keys.pop(),x=>x.core.rolePairs[9]=x.core.rolePairs[0],x=>x.core.rolePairs[0].status='HOLD',x=>x.core.runnerKeys[5]='h1']){const x=fixture();mutate(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('run, scope, source, freeze or contract mismatch fails closed',async()=>{
  for(const mutate of [x=>x.fields[0].runId='other',x=>x.fields[0].scopeKey='other',x=>x.fields[0].sourceSnapshotId='other',x=>x.fields[0].freezeId='other',x=>x.core.contractFreezeId='other',x=>x.contract.baselineReadinessVersion='CONTRACT_V03']){const x=fixture();mutate(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('no source lineage, conflict, LIVE source or pseudo-value passes numeric resolution',async()=>{
  for(const mutate of [x=>x.fields[0].sourceLineage='UNKNOWN',x=>x.fields[0].conflict=true,x=>x.fields[0].sourceStage='POST',x=>x.fields[0].value='UNKNOWN',x=>x.fields[0].value=null,x=>x.fields[0].value=NaN]){const x=fixture();mutate(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('unplanned fields, missing fields and duplicate attempts fail closed',async()=>{
  for(const mutate of [x=>x.fields.push({...x.fields[0],eligibilityId:'extra'}),x=>x.fields=[],x=>x.attempts.push(x.attempts[0]),x=>x.contract.fields.push(x.contract.fields[0])]){const x=fixture();mutate(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('attempts cannot happen after freeze, before preregistration or skip/reorder tiers',async()=>{
  for(const mutate of [x=>x.attempts[0].attemptedAt='2026-10-09T09:01:00Z',x=>x.attempts[0].attemptedAt='2026-10-09T06:00:00Z',x=>x.attempts[0].tier=tiers[1],x=>x.attempts.reverse()]){const x=exhaust(fixture());mutate(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('NOT_REQUIRED cannot bypass mandatory acquire or fabricate non-eligible numeric',async()=>{
  const x=fixture();x.fields[0].acquisitionState='NOT_REQUIRED';assert.equal((await assess(x)).status,'HOLD');const y=ineligible(fixture());y.fields[0].value=50;assert.equal((await assess(y)).status,'HOLD');
});
test('hash binds entire policy input and is deterministic',async()=>{
  const x=fixture(),a=await assess(x),b=await assess(structuredClone(x));assert.equal(a.inputHash,b.inputHash);x.fields[0].value=1;assert.notEqual((await assess(x)).inputHash,a.inputHash);
});
test('malformed, null and absent inputs fail closed without throwing',async()=>{
  for(const x of [undefined,null,[],{contract:null,core:null,fields:[null],attempts:[null]},fixture()]){if(x?.core)x.contract.fields=[null];assert.equal((await assess(x)).status,'HOLD')}
});
test('duplicate scope-field under different eligibility IDs cannot inflate coverage',async()=>{
  const x=fixture();x.contract.fields.push({...x.contract.fields[0],eligibilityId:'el2'});x.fields.push({...x.fields[0],eligibilityId:'el2'});x.attempts.push({...x.attempts[0],eligibilityId:'el2',attemptId:'a2'});assert.equal((await assess(x)).status,'HOLD');
});
test('structural-missing classification must come explicitly from frozen contract',async()=>{
  const x=ineligible(fixture());delete x.contract.fields[0].structuralMissing;assert.equal((await assess(x)).status,'HOLD');
});
