import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerPredictionAcquisitionSourcesV2155 as register} from '../src/prediction/prediction-acquisition-registry-v2155.mjs';
import {executeBoundedPredictionAcquisitionV2155 as execute} from '../src/prediction/prediction-bounded-acquisition-v2155.mjs';
import {executeAndQuarantinePredictionAcquisitionV2155 as save,readPredictionAcquisitionQuarantineV2155 as read} from '../src/prediction/prediction-acquisition-quarantine-v2155.mjs';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
function fixture(){
 const tiers=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
 const plan={version:'v2.15.5',mode:'FORWARD',stage:'ORIGINAL_EARLY',immutableStatus:'FROZEN',leakageGuard:'PASS',planId:'plan1',runId:'run1',raceId:'race1',eligibilityId:'el1',scopeKey:'h1',fieldId:'f1',requirementSnapshotId:'req1',contractFreezeId:'contract1',acquisitionRequired:'MUST_ACQUIRE',numericMetric:true,frozenAt:'2026-10-09T09:00:00Z',cutoffAt:'2026-10-09T10:50:00Z',offAt:'2026-10-09T11:00:00Z',maxAttemptMs:50,tiers:tiers.map((tier,i)=>({tier,provider:'p'+i,sourceCandidate:'s'+i}))};
 const registry={schemaVersion:'CHASS_ACQUISITION_REGISTRY_V2155_V1',registryId:'registry1',mode:'FORWARD',stage:'ORIGINAL_EARLY',immutableStatus:'FROZEN',frozenAt:'2026-10-09T08:59:00Z',planHash:hash(plan),...Object.fromEntries(['planId','runId','raceId','eligibilityId','fieldId','scopeKey','contractFreezeId','requirementSnapshotId'].map(k=>[k,plan[k]])),entries:plan.tiers.map((t,i)=>({...t,readerId:'reader'+i,sourceRef:'source-ref-'+i,allowedStage:'EARLY',preResultRequired:true,identityRequired:true,enabled:true}))};
 let calls=0;const readers=Object.fromEntries(registry.entries.map(e=>[e.readerId,async({registration})=>{calls++;return {sourceRef:registration.sourceRef,receipt:{result:'NOT_FOUND',reasonCode:'NOT_FOUND_IN_REGISTERED_SOURCE'}}}]));
 const x={plan,registry,readers,clock:()=>Date.parse('2026-10-09T10:00:00Z'),calls:()=>calls};seal(x);return x;
}
function seal(x){x.anchor={registryId:x.registry.registryId,registryHash:hash(x.registry),planHash:hash(x.plan)}}
const found={result:'FOUND',runId:'run1',raceId:'race1',eligibilityId:'el1',fieldId:'f1',scopeKey:'h1',sourceSnapshotId:'src1',sourceStage:'EARLY',identityStatus:'PASS',sourceLineage:'PASS',leakageGuard:'PASS',capturedAt:'2026-10-09T09:50:00Z',dataAsOf:'2026-10-09T09:30:00Z',value:0};
test('registered four-tier readers execute bounded exhaustion',async()=>{const x=fixture(),r=register(x);assert.equal(r.status,'REGISTERED');const a=await execute({...x,collectors:r.collectors});assert.equal(a.acquisitionState,'EXHAUSTED_DECLARED');assert.equal(x.calls(),4);assert.equal(r.formalKpiEligible,false)});
test('registered FOUND retains zero and stops',async()=>{const x=fixture();x.readers.reader0=async()=>({sourceRef:'source-ref-0',receipt:found});const a=await execute({...x,collectors:register(x).collectors});assert.equal(a.value,0);assert.equal(a.attempts.length,1)});
test('missing reader blocks all registration before a source call',()=>{const x=fixture();delete x.readers.reader3;assert.equal(register(x).reason,'ALL_REGISTERED_READERS_REQUIRED');assert.equal(x.calls(),0)});
test('template or diagnostic registry never registers',()=>{for(const change of [r=>r.immutableStatus='POLICY_TEMPLATE',r=>r.mode='DIAGNOSTIC_REPLAY',r=>r.stage='POST']){const x=fixture();change(x.registry);seal(x);assert.equal(register(x).status,'HOLD')}});
test('foreign run/race/horse/field/contract/requirement cannot bind',()=>{for(const key of ['runId','raceId','scopeKey','fieldId','contractFreezeId','requirementSnapshotId']){const x=fixture();x.registry[key]='other';seal(x);assert.equal(register(x).reason,'REGISTRY_PLAN_BINDING_INVALID')}});
test('changed registry or absent independent anchor is HOLD',()=>{const x=fixture();x.registry.entries[0].sourceRef='other';assert.equal(register(x).reason,'INDEPENDENT_REGISTRY_ANCHOR_REQUIRED');const y=fixture();delete y.anchor;assert.equal(register(y).status,'HOLD')});
test('registry must be frozen before plan with timezone',()=>{for(const at of ['2026-10-09T10:00:00Z','2026-10-09 08:59']){const x=fixture();x.registry.frozenAt=at;seal(x);assert.equal(register(x).reason,'REGISTRY_PREREGISTRATION_REQUIRED')}});
test('duplicate providers or reordered candidates cannot register',()=>{const x=fixture();x.registry.entries[1].provider='p0';seal(x);assert.equal(register(x).reason,'UNIQUE_PROVIDER_REGISTRATION_REQUIRED');const y=fixture();y.registry.entries.reverse();seal(y);assert.equal(register(y).status,'HOLD')});
test('POST or disabled source entries and incomplete registry fail',()=>{for(const change of [r=>r.entries[0].allowedStage='POST',r=>r.entries[0].enabled=false,r=>r.entries.pop()]){const x=fixture();change(x.registry);seal(x);assert.equal(register(x).status,'HOLD')}});
test('endpoint substitution becomes conflict, never exhaustion',async()=>{const x=fixture();x.readers.reader0=async()=>({sourceRef:'other',receipt:found});const a=await execute({...x,collectors:register(x).collectors});assert.equal(a.status,'HOLD');assert.equal(a.attempts.length,1);assert.equal(a.reason,'SOURCE_CONFLICT')});
test('other plan context cannot call registered readers',async()=>{const x=fixture(),r=register(x);const a=await r.collectors.p0({context:{planHash:'other'}});assert.equal(a.result,'CONFLICT');assert.equal(x.calls(),0)});
test('registration copies plan and entries and captures reader references',async()=>{const x=fixture(),r=register(x);x.registry.entries[0].sourceRef='changed';x.readers.reader0=async()=>{throw Error('replaced')};const a=await execute({...x,collectors:r.collectors});assert.equal(a.acquisitionState,'EXHAUSTED_DECLARED');assert.equal(x.calls(),4)});
test('registered acquisition persists and reconnects without promoting KPI',async()=>{const x=fixture(),r=register(x),root=await mkdtemp(join(tmpdir(),'chass-registered-'));try{const s=await save({...x,root,environment:'QUARANTINE',collectors:r.collectors});assert.equal(s.readbackVerified,true);const again=await read({root,anchor:s.anchor});assert.equal(again.payload.result.attempts.length,4);assert.equal(again.productionActivationReady,false)}finally{await rm(root,{recursive:true,force:true})}});

test('diagnostic plan cannot register forward readers',()=>{const x=fixture();x.plan.mode='DIAGNOSTIC_REPLAY';x.registry.planHash=hash(x.plan);seal(x);assert.equal(register(x).reason,'FORWARD_PLAN_REQUIRED')});
