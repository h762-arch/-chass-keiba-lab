import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runNarInitialEvidenceRehearsalV1 as rehearse} from '../scripts/nar-initial-evidence-rehearsal-v1.mjs';
import {auditNarInitialEvidenceV1 as audit} from '../src/research/nar-initial-evidence-audit-v1.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
function safe(r){assert.equal(r.formalReadiness,'HOLD');for(const k of ['formalKpiEligible','adopted','productionEvidenceVerified','externalAnchorAuthenticated','trustedDurableTime','earlyFreezeAuthenticated','storeReadPerformed'])assert.equal(r[k],false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.freezeMutation,'NONE');assert.equal(r.inputProvenance,'UNAUTHENTICATED');assert.ok(Object.isFrozen(r));}
for(const [scenario,status,reason] of [
 ['baseline','CONTENT_AND_OBSERVED_TIME_MATCH',null],
 ['late_ack','HOLD','COMMIT_OBSERVED_LATE'],
 ['lost_ack','HOLD','COMMIT_TIMING_UNCONFIRMED'],
 ['missing_receipt','HOLD','ORIGINAL_RECEIPT_TEXT_REQUIRED'],
 ['tampered_bundle','HOLD','BUNDLE_SEMANTICS_INVALID']
])test(`independently audit actual rehearsal export: ${scenario}`,async()=>{
 const report=await rehearse(scenario);assert.equal(report.status,'PASS');
 const before=JSON.stringify(report.evidence),r=await audit(before);assert.equal(r.status,status);assert.equal(r.reason,reason);safe(r);assert.equal(JSON.stringify(report.evidence),before);
 if(scenario==='baseline'){assert.equal(r.bundleUtf8Sha256,digest(report.evidence.bundleRawJson));assert.equal(r.receiptUtf8Sha256,digest(report.evidence.receiptRawJson));assert.equal(r.byteHashesVerified,true);assert.equal(r.semanticBindingsVerified,true);}
});
for(const [name,change,reason] of [
 ['old schema',e=>delete e.schemaVersion,'EVIDENCE_SCHEMA_INVALID'],
 ['missing original bundle',e=>delete e.bundleRawJson,'ORIGINAL_BUNDLE_TEXT_REQUIRED'],
 ['bundle bytes',e=>e.bundleRawJson+=' ','BUNDLE_BYTE_HASH_MISMATCH'],
 ['bundle key',e=>e.bundleKey+='other','BUNDLE_KEY_MISMATCH'],
 ['bundle summary',e=>e.bundle.candidateSignal.reason='changed','BUNDLE_SUMMARY_MISMATCH'],
 ['receipt bytes',e=>e.receiptRawJson+=' ','RECEIPT_BYTE_HASH_MISMATCH'],
 ['receipt key',e=>e.receiptKey+='other','RECEIPT_KEY_MISMATCH'],
 ['receipt summary',e=>e.receipt.observation.returnedAt++,'RECEIPT_SUMMARY_MISMATCH']
])test(`caller report flags cannot hide ${name}`,async()=>{const e=(await rehearse()).evidence;change(e);e.status='PASS';e.checks={all:true};const r=await audit(JSON.stringify(e));assert.equal(r.reason,reason);safe(r);});
test('rehashing altered raw content does not bypass semantic seals',async()=>{const e=(await rehearse()).evidence;e.bundle.candidateSignal.reason='changed';e.bundleRawJson=JSON.stringify(e.bundle);e.bundleUtf8Sha256=digest(e.bundleRawJson);const r=await audit(JSON.stringify(e));assert.equal(r.reason,'BUNDLE_SEMANTICS_INVALID');safe(r);});
test('rehashing changed receipt and matching summary cannot assert trusted durability',async()=>{const e=(await rehearse()).evidence;e.receipt.trustedDurableTime=true;e.receiptRawJson=JSON.stringify(e.receipt);e.receiptUtf8Sha256=digest(e.receiptRawJson);const r=await audit(JSON.stringify(e));assert.equal(r.reason,'RECEIPT_SEMANTICS_INVALID');safe(r);});
test('caller-created byte hashes and production flags never authenticate origin',async()=>{const e=(await rehearse()).evidence;e.bundleRawJson=JSON.stringify(e.bundle,null,2);e.bundleUtf8Sha256=digest(e.bundleRawJson);e.productionEvidenceVerified=true;e.evidenceKind='PRODUCTION_VERIFIED';e.formalKpiEligible=true;const r=await audit(JSON.stringify(e));assert.equal(r.status,'CONTENT_AND_OBSERVED_TIME_MATCH');assert.equal(r.declaredEvidenceKind,'UNSPECIFIED');safe(r);});
test('old export without raw strings holds instead of reconstructing saved bytes',async()=>{const e=(await rehearse()).evidence;delete e.bundleRawJson;delete e.receiptRawJson;const r=await audit(JSON.stringify(e));assert.equal(r.reason,'ORIGINAL_BUNDLE_TEXT_REQUIRED');safe(r);});
test('invalid, deep, oversized and callback inputs hold without executing caller code',async()=>{let calls=0;const cb={toJSON(){calls++;throw Error('PRIVATE');}};for(const raw of [null,cb,'{','null','[]','x'.repeat(1000001),'{"x":'+ '['.repeat(34)+'0'+']'.repeat(34)+'}',JSON.stringify({x:'馬'.repeat(340000)})]){const r=await audit(raw);assert.equal(r.status,'HOLD');safe(r);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}assert.equal(calls,0);});
