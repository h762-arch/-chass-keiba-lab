import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runNarInitialEvidenceRehearsalV1 as run,runNarInitialEvidenceRehearsalCliV1 as cli,SCENARIOS} from '../scripts/nar-initial-evidence-rehearsal-v1.mjs';
for(const scenario of SCENARIOS)test(`disk save, observed COMMIT and read-only reconnect: ${scenario}`,async()=>{
 const r=await run(scenario);assert.equal(r.status,'PASS',JSON.stringify({reason:r.reason,checks:r.checks}));
 assert.equal(r.evidenceKind,'SYNTHETIC_REHEARSAL');assert.equal(r.productionEvidence,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.adopted,false);assert.equal(r.trustedDurableTime,false);
 assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');
 assert.equal(r.first.captureStatus,scenario==='lost_ack'?'REJECTED':'CREATED');
 assert.equal(r.first.auditStatus,'CREATED');assert.equal(r.first.commitObservationCount,1);
 assert.equal(r.reopened.captureStatus,'NOT_RUN');assert.equal(r.reopened.auditStatus,'NOT_RUN');
 assert.ok(r.readbackQueryCount>0);assert.ok(Object.values(r.checks).every(v=>v===true));
 assert.match(r.evidence.bundleUtf8Sha256,/^[a-f0-9]{64}$/);
 if(scenario==='missing_receipt'){assert.equal(r.evidence.receipt,null);assert.equal(r.evidence.receiptKey,null);}
 else{assert.equal(r.evidence.receipt.sourceBundleSha256,r.evidence.bundle.contentSha256);assert.equal(r.evidence.receipt.trustedDurableTime,false);assert.match(r.evidence.receiptUtf8Sha256,/^[a-f0-9]{64}$/);}
 if(scenario==='late_ack')assert.equal(r.evidence.receipt.observation.returnedAt-r.evidence.receipt.observation.startedAt,60001);
 if(scenario==='lost_ack')assert.equal(r.evidence.receipt.observation.outcome,'REJECTED');
 if(scenario==='tampered_bundle'){assert.equal(r.reopened.status,'REJECTED');assert.equal(r.evidence.bundle.candidateSignal.reason,'SIMULATED_TAMPER');}
 else assert.equal(r.reopened.status,'HOLD');
});
test('CLI accepts only fixed scenarios and never accepts a production path or URL',async()=>{
 for(const args of [null,['--db','production.sqlite'],['--url','https://example.invalid'],['--date','2026-10-17'],['--scenario','other'],['baseline'],['--scenario','baseline','extra']]){const r=await cli(args);assert.equal(r.status,'REJECTED');assert.equal(r.productionEvidence,false);}
});
test('fresh executions reproduce semantic evidence hashes without reusing a prior database',async()=>{
 const a=await run(),b=await run();assert.equal(a.status,'PASS');assert.equal(b.status,'PASS');assert.equal(a.evidence.bundleUtf8Sha256,b.evidence.bundleUtf8Sha256);assert.equal(a.evidence.receiptUtf8Sha256,b.evidence.receiptUtf8Sha256);assert.deepEqual(a.evidence.bundle,b.evidence.bundle);
});
test('command emits a complete JSON report and nonzero exit for unsupported arguments',()=>{
 const script=new URL('../scripts/nar-initial-evidence-rehearsal-v1.mjs',import.meta.url).pathname;
 const good=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:15000});assert.equal(good.status,0,good.stderr);const r=JSON.parse(good.stdout);assert.equal(r.status,'PASS');assert.equal(r.reopened.status,'HOLD');
 const digest=createHash('sha256').update(JSON.stringify(r.evidence.bundle)).digest('hex');assert.equal(digest,r.evidence.bundleUtf8Sha256);
 const bad=spawnSync(process.execPath,[script,'--db','anything'],{encoding:'utf8',timeout:15000});assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stdout).reason,'CLI_ARGUMENTS_UNSUPPORTED');
});
