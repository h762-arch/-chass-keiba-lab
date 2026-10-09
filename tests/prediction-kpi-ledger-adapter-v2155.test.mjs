import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPredictionKpiLedgerBundleV2155 as assess,predictionKpiLedgerSha256 as hash,PREDICTION_KPI_LEDGER_VERSION as VERSION} from '../src/prediction/prediction-kpi-ledger-adapter-v2155.mjs';
const tiers=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
const body=(x,k)=>x.bundle.sections.find(s=>s.kind===k).body;
async function reseal(x){for(const s of x.bundle.sections)s.contentSha256=await hash(s.body);x.anchor.bundleSha256=await hash(x.bundle);return x}
async function fixture(){
  const runnerKeys=['h1','h2','h3','h4','h5','h6'],final5Keys=runnerKeys.slice(0,5),rolePairs=[];
  for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)rolePairs.push({horseKeys:[final5Keys[i],final5Keys[j]],status:'PASS'});
  const gates=['officialCard','identity','sourceFrozen','sourceLineage','leakageGuard','candidateTrace','portfolio','preservation','roleTournament','signalEvidence','productionWritePolicy','baselineReadiness','fieldEligibilityProof'];
  const core={runId:'run1',raceId:'race1',freezeId:'prediction-frz1',snapshotHash:'external-prediction-content',fieldEligibilityFreezeId:'field-frz1',acquisitionFreezeId:'acq-frz1',contractFreezeId:'contract-frz1',frozenAt:'2026-10-09T09:00:00Z',offAt:'2026-10-09T10:00:00Z',mode:'FORWARD',stage:'ORIGINAL_EARLY',immutableStatus:'FROZEN',resultPresent:false,cancelled:false,postFreezeMutation:false,gates:Object.fromEntries(gates.map(k=>[k,'PASS'])),runnerKeys,final5Keys,rolePairs};
  const plan={eligibilityId:'el1',fieldId:'E_POSITION_PACE',scopeKey:'h1',requirementSnapshotId:'req1',eligibilityStatus:'ELIGIBLE',acquisitionRequired:'MUST_ACQUIRE',numericMetric:true,structuralMissing:false};
  const contract={version:'v2.15.5',baselineReadinessVersion:'CONTRACT_V04',freezeId:'contract-frz1',sourceSnapshotId:'contract-source1',frozenAt:'2026-10-09T07:00:00Z',fields:[plan]};
  const field={...plan,runId:'run1',raceId:'race1',contractFreezeId:'contract-frz1',freezeId:'field-frz1',acquisitionFreezeId:'acq-frz1',frozenAt:'2026-10-09T08:50:00Z',immutableStatus:'FROZEN',leakageGuard:'PASS',sourceLineage:'PASS',conflict:false,acquisitionState:'RESOLVED',resolutionStatus:'RESOLVED',value:0,sourceSnapshotId:'source1',sourceStage:'EARLY'};
  const attempt={attemptId:'a1',eligibilityId:'el1',fieldId:plan.fieldId,scopeKey:'h1',runId:'run1',raceId:'race1',attemptNo:1,tier:tiers[0],provider:'canonical-cache',sourceCandidate:'pre-result-cache',attemptedAt:'2026-10-09T08:00:00Z',result:'FOUND',sourceSnapshotId:'source1',leakageGuard:'PASS',immutableStatus:'FROZEN'};
  const source=(id,time,values)=>({sourceSnapshotId:id,runId:'run1',raceId:'race1',stage:'EARLY',capturedAt:time,dataAsOf:time,identityStatus:'PASS',sourceLineage:'PASS',leakageGuard:'PASS',immutableStatus:'FROZEN',values});
  const sources=[source('contract-source1','2026-10-09T06:30:00Z',[]),source('req1','2026-10-09T06:30:00Z',[]),source('source1','2026-10-09T07:50:00Z',[{eligibilityId:'el1',fieldId:plan.fieldId,scopeKey:'h1',value:0}])];
  const section=(kind,snapshotId,frozenAt,b)=>({kind,snapshotId,runId:'run1',raceId:'race1',frozenAt,immutableStatus:'FROZEN',body:b,contentSha256:''});
  const bundle={schemaVersion:VERSION,runId:'run1',raceId:'race1',predictionFreezeId:'prediction-frz1',immutableStatus:'FROZEN',sections:[section('contract','contract-frz1',contract.frozenAt,contract),section('core','prediction-frz1',core.frozenAt,core),section('fields','field-frz1',field.frozenAt,[field]),section('attempts','acq-frz1',field.frozenAt,[attempt]),section('sources','source-frz1',field.frozenAt,sources)]};
  return reseal({bundle,anchor:{schemaVersion:'VERIFIED_PREDICTION_KPI_INPUT_ANCHOR_V1',runId:'run1',raceId:'race1',predictionFreezeId:'prediction-frz1',bundleSha256:'',evidenceRef:'independent-test-anchor'}});
}
async function exhausted(){const x=await fixture(),f=body(x,'fields')[0];Object.assign(f,{acquisitionState:'EXHAUSTED_DECLARED',resolutionStatus:'SOURCE_MISSING',value:null,exhaustionCode:'SOURCE_EXHAUSTED',exhaustionReason:'All pre-cutoff tiers complete',finalSourceState:'NOT_FOUND'});const a=body(x,'attempts')[0];x.bundle.sections.find(s=>s.kind==='attempts').body=tiers.map((tier,i)=>({...a,attemptId:'a'+(i+1),attemptNo:i+1,tier,result:'NOT_FOUND',reasonCode:'SOURCE_NOT_FOUND'}));return reseal(x)}
test('five sealed ledgers join policy FULL without mutation or adoption',async()=>{
  const x=await fixture(),before=structuredClone(x),r=await assess(x);assert.equal(r.status,'POLICY_READY');assert.equal(r.assessment.formalKpiStatus,'FORMAL_FULL');assert.equal(r.assessment.metricEligibleFields[0].value,0);assert.equal(r.sectionBindings.length,5);assert.equal(r.formalKpiEligible,false);assert.equal(r.adopted,false);assert.equal(r.productionActivationReady,false);assert.equal(r.externalAuthentication,'CALLER_MUST_VERIFY_ANCHOR');assert.deepEqual(x,before);assert.ok(Object.isFrozen(r.assessment));
});
test('declared exhaustion retains candidate and eligible denominator through adapter',async()=>{
  const r=await assess(await exhausted());assert.equal(r.status,'POLICY_READY');assert.equal(r.assessment.formalKpiStatus,'FORMAL_WITH_DECLARED_MISSING');assert.equal(r.assessment.counts.eligibleNumericFieldCount,1);assert.equal(r.assessment.counts.resolvedEligibleNumericFieldCount,0);
});
test('anchor absent, malformed or bound to other run/race/Freeze is HOLD',async()=>{
  for(const mutate of [x=>delete x.anchor,x=>x.anchor.bundleSha256='invalid',x=>x.anchor.runId='other',x=>x.anchor.raceId='other',x=>x.anchor.predictionFreezeId='other',x=>delete x.anchor.evidenceRef]){const x=await fixture();mutate(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('content changes and recomputing local seals cannot bypass unchanged external anchor',async()=>{
  const x=await fixture(),original=x.anchor.bundleSha256;body(x,'fields')[0].value=50;assert.equal((await assess(x)).reason,'EXTERNAL_ANCHOR_HASH_MISMATCH');await reseal(x);x.anchor.bundleSha256=original;assert.equal((await assess(x)).reason,'EXTERNAL_ANCHOR_HASH_MISMATCH');
});
test('externally matched bundle still rejects invalid section seal',async()=>{
  const x=await fixture();x.bundle.sections[0].contentSha256='0'.repeat(64);x.anchor.bundleSha256=await hash(x.bundle);assert.equal((await assess(x)).reason,'SECTION_CONTENT_MISMATCH');
});
test('missing, extra, duplicate sections and snapshot IDs fail',async()=>{
  for(const mutate of [x=>x.bundle.sections.pop(),x=>x.bundle.sections.push(x.bundle.sections[0]),x=>x.bundle.sections[1].kind='contract',x=>x.bundle.sections[1].snapshotId='contract-frz1']){const x=await fixture();mutate(x);await reseal(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('ledger Run, race and freeze joins are exact',async()=>{
  for(const mutate of [x=>x.bundle.sections[0].runId='other',x=>x.bundle.sections[0].raceId='other',x=>body(x,'core').fieldEligibilityFreezeId='other',x=>body(x,'contract').freezeId='other',x=>body(x,'core').runId='other']){const x=await fixture();mutate(x);await reseal(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('registry must contain contract, requirement and resolved-value sources',async()=>{
  for(const id of ['contract-source1','req1','source1']){const x=await fixture();x.bundle.sections.find(s=>s.kind==='sources').body=body(x,'sources').filter(s=>s.sourceSnapshotId!==id);await reseal(x);assert.equal((await assess(x)).reason,'SOURCE_SNAPSHOT_MISSING_OR_LATE')}
});
test('source value, runner scope and field identity match exactly without imputation',async()=>{
  for(const mutate of [v=>v.value=50,v=>v.scopeKey='h2',v=>v.fieldId='other',v=>v.value=null]){const x=await fixture();mutate(body(x,'sources')[2].values[0]);await reseal(x);assert.equal((await assess(x)).reason,'SOURCE_VALUE_MISMATCH')}
});
test('late source, future data-as-of, POST stage and foreign identity reject',async()=>{
  for(const mutate of [s=>s.capturedAt='2026-10-09T08:01:00Z',s=>s.dataAsOf='2026-10-09T09:01:00Z',s=>s.stage='POST',s=>s.runId='other',s=>s.identityStatus='UNKNOWN']){const x=await fixture();mutate(body(x,'sources')[2]);await reseal(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('duplicate source IDs and duplicate value identity reject',async()=>{
  for(const mutate of [x=>body(x,'sources').push(body(x,'sources')[0]),x=>body(x,'sources')[2].values.push(body(x,'sources')[2].values[0])]){const x=await fixture();mutate(x);await reseal(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('section seals and attempt receipts cannot be later than their owning Freeze',async()=>{
  for(const mutate of [x=>x.bundle.sections[0].frozenAt='2026-10-09T09:01:00Z',x=>body(x,'fields')[0].frozenAt='2026-10-09T08:51:00Z',x=>body(x,'attempts')[0].attemptedAt='2026-10-09T08:51:00Z']){const x=await fixture();mutate(x);await reseal(x);assert.equal((await assess(x)).status,'HOLD')}
});
test('attempt storage order is normalized without changing declared tier order',async()=>{
  const x=await exhausted();body(x,'attempts').reverse();await reseal(x);assert.equal((await assess(x)).status,'POLICY_READY');body(x,'attempts')[0].tier='T0_CACHE_REGISTRY';await reseal(x);assert.equal((await assess(x)).reason,'POLICY_GATE_HOLD');
});
test('core HOLD, diagnostic replay and unfinished acquisition remain HOLD after valid hashes',async()=>{
  for(const mutate of [x=>body(x,'core').gates.portfolio='HOLD',x=>body(x,'core').mode='DIAGNOSTIC_REPLAY',x=>body(x,'fields')[0].acquisitionState='IN_PROGRESS']){const x=await fixture();mutate(x);await reseal(x);assert.equal((await assess(x)).reason,'POLICY_GATE_HOLD')}
});
test('template or missing-ledger input is never completed automatically',async()=>{
  for(const x of [undefined,{},null,{bundle:{schemaVersion:VERSION},anchor:{schemaVersion:'CONTRACT'}}])assert.equal((await assess(x)).status,'HOLD');
});
test('invalid hashes, non-JSON values and oversized ledgers are bounded HOLD',async()=>{
  const x=await fixture();body(x,'fields')[0].value=NaN;assert.equal((await assess(x)).status,'HOLD');const y=await fixture();y.bundle.sections.find(s=>s.kind==='attempts').body=Array(8001).fill({});assert.equal((await assess(y)).reason,'BOUNDED_ATTEMPTS_REQUIRED');
});
test('source observed during an attempt may join only with a valid pre-freeze completion receipt',async()=>{
  const x=await fixture();body(x,'sources')[2].capturedAt='2026-10-09T08:01:00Z';body(x,'attempts')[0].completedAt='2026-10-09T08:02:00Z';await reseal(x);assert.equal((await assess(x)).status,'POLICY_READY');body(x,'attempts')[0].completedAt='2026-10-09T09:01:00Z';await reseal(x);assert.equal((await assess(x)).status,'HOLD');
});
