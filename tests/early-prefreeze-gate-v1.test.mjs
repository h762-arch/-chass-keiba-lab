import test from 'node:test';
import assert from 'node:assert/strict';
import {assessEarlyPrefreezeGate as assess,VERSION} from '../src/prediction/early-prefreeze-gate-v1.mjs';
function fixture(){const freezeAt='2026-10-17T01:00:00Z';return {raceId:'20261017-JRA-05-01',venue:'東京',raceNo:1,startAt:'2026-10-17T02:00:00Z',freezeAt,expectedRunnerCount:2,runners:[1,2].map(n=>({horseNo:n,horseName:`合成馬${n}`,canonicalId:`id-${n}`,identitySource:'declared-registry',identityVerified:true,capturedAt:'2026-10-17T00:00:00Z',sourceRef:'declared-source',evidenceId:`e-${n}`,evidenceSource:'declared-store',evidenceSavedAt:'2026-10-17T00:10:00Z',evidenceReadback:true})),snapshot:{id:'snapshot-1',hash:'a'.repeat(64),savedAt:'2026-10-17T00:20:00Z',readback:true},cpsi:{coverageVerified:true,modelReady:true},early:{freezeId:'freeze-1',signalHash:'b'.repeat(64),immutable:true,readback:true,freezeAt},readback:{snapshot:true,evidence:true,early:true},formalContractVerified:true};}
test('empty input is HOLD',()=>{const r=assess();assert.equal(r.formalReadiness,'HOLD');assert.equal(r.gate.G06.status,'HOLD');});
test('market absence is supplementary and empty immutability remains unknown',()=>{const r=assess();assert.equal(r.gate.G08.status,'MARKET_UNKNOWN');assert.equal(r.earlyImmutable,null);assert.equal(r.earlyFreezeVerified,false);});
test('result before freeze cannot pass',()=>{const r=assess({freezeAt:'2026-10-17T10:00:00+09:00',startAt:'2026-10-17T11:00:00+09:00',resultAt:'2026-10-17T09:00:00+09:00'});assert.equal(r.gate.G04.status,'HOLD');});
test('no fabricated readback',()=>assert.equal(assess().gate.G10.status,'HOLD'));
test('all synthetic declarations can pass candidate checks but never formal readiness',()=>{const x=fixture(),before=structuredClone(x),r=assess(x);assert.equal(VERSION,'CHASS_EARLY_PREFREEZE_GATE_V1');assert.equal(r.candidateReadiness,'PASS');assert.equal(r.formalReadiness,'HOLD');assert.equal(r.gate.G11.status,'HOLD');assert.deepEqual(r.blockingReasons,['FORMAL_INTEGRATION_NOT_VERIFIED']);assert.equal(r.formalKpiEligible,false);assert.equal(r.persistenceVerified,false);assert.equal(r.acquisitionCertified,false);assert.equal(r.earlyFreezeVerified,false);assert.equal(r.earlyImmutable,null);assert.equal(r.declaredEarlyImmutable,true);assert.equal(r.formalContractDeclared,true);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.assessmentBasis,'CALLER_DECLARATIONS_ONLY');assert.deepEqual(x,before);});
test('unknown market and pending result audit do not block candidate declarations',()=>{const x=fixture();delete x.market;delete x.resultAudit;const r=assess(x);assert.equal(r.candidateReadiness,'PASS');assert.equal(r.gate.G08.status,'MARKET_UNKNOWN');assert.equal(r.gate.G12.status,'HOLD');assert.equal(r.formalReadiness,'HOLD');});
test('explicit market unavailability does not fabricate market presence',()=>{const x=fixture();x.market={status:'NOT_AVAILABLE'};const r=assess(x);assert.equal(r.candidateReadiness,'PASS');assert.equal(r.marketAvailability,'NOT_AVAILABLE');});
const cases=[
 ['invalid race number',x=>x.raceNo=0,'G01'],
 ['duplicate runner',x=>x.runners[1].horseNo=1,'G02'],
 ['negative horse number',x=>x.runners[0].horseNo=-1,'G02'],
 ['unexpected roster count',x=>x.expectedRunnerCount=3,'G02'],
 ['empty roster',x=>x.runners=[],'G02'],
 ['null runner',x=>x.runners[0]=null,'G02'],
 ['duplicate canonical ID',x=>x.runners[1].canonicalId=x.runners[0].canonicalId,'G03'],
 ['missing identity source',x=>delete x.runners[0].identitySource,'G03'],
 ['nonboolean identity claim',x=>x.runners[0].identityVerified='true','G03'],
 ['source after freeze',x=>x.runners[0].capturedAt='2026-10-17T01:01:00Z','G04'],
 ['freeze at start',x=>x.freezeAt=x.startAt,'G04'],
 ['invalid calendar date',x=>x.startAt='2026-02-30T02:00:00Z','G01'],
 ['missing timezone',x=>x.startAt='2026-10-17T02:00:00','G01'],
 ['invalid timezone',x=>x.startAt='2026-10-17T02:00:00+25:00','G01'],
 ['missing snapshot hash',x=>delete x.snapshot.hash,'G05'],
 ['placeholder snapshot hash',x=>x.snapshot.hash='not-a-sha256','G05'],
 ['snapshot before source capture',x=>x.snapshot.savedAt='2026-10-16T23:59:00Z','G05'],
 ['snapshot after freeze',x=>x.snapshot.savedAt='2026-10-17T01:01:00Z','G05'],
 ['evidence before source capture',x=>x.runners[0].evidenceSavedAt='2026-10-16T23:59:00Z','G06'],
 ['evidence after snapshot',x=>x.runners[0].evidenceSavedAt='2026-10-17T00:21:00Z','G06'],
 ['unverified evidence readback',x=>x.runners[0].evidenceReadback=false,'G06'],
 ['model not ready',x=>x.cpsi.modelReady=false,'G07'],
 ['placeholder signal hash',x=>x.early.signalHash='fake','G09'],
 ['freeze identity time mismatch',x=>x.early.freezeAt='2026-10-17T00:59:00Z','G09'],
 ['mutable early declaration',x=>x.early.immutable=false,'G09'],
 ['missing early readback',x=>x.readback.early=false,'G10']
];
for(const [name,change,gate] of cases)test(name+' holds',()=>{const x=fixture();change(x);const r=assess(x);assert.equal(r.gate[gate].status,'HOLD');assert.equal(r.candidateReadiness,'HOLD');assert.equal(r.formalReadiness,'HOLD');assert.ok(r.blockingReasons.includes(r.gate[gate].reason));});
test('equivalent timezone instants are accepted without rewriting input',()=>{const x=fixture();x.early.freezeAt='2026-10-17T10:00:00+09:00';assert.equal(assess(x).gate.G09.status,'PASS');assert.equal(x.early.freezeAt,'2026-10-17T10:00:00+09:00');});
test('source/evidence/save at freeze equality is permitted, start equality is not',()=>{const x=fixture();for(const r of x.runners)r.capturedAt=r.evidenceSavedAt=x.freezeAt;x.snapshot.savedAt=x.freezeAt;assert.equal(assess(x).candidateReadiness,'PASS');x.startAt=x.freezeAt;assert.equal(assess(x).candidateReadiness,'HOLD');});
test('market captured after freeze remains supplementary unknown',()=>{const x=fixture();x.market={source:'declared',capturedAt:'2026-10-17T01:01:00Z'};const r=assess(x);assert.equal(r.gate.G08.status,'MARKET_UNKNOWN');assert.equal(r.candidateReadiness,'PASS');});
test('post-result comparison needs result time and compared time without changing prefreeze gates',()=>{const x=fixture();x.resultAudit={originalFreezeId:'freeze-1',compared:true};assert.equal(assess(x).gate.G12.status,'HOLD');x.resultAt='2026-10-17T02:10:00Z';x.resultAudit.comparedAt='2026-10-17T02:11:00Z';const r=assess(x);assert.equal(r.gate.G12.status,'PASS');assert.equal(r.candidateReadiness,'PASS');assert.equal(r.formalReadiness,'HOLD');x.resultAudit.originalFreezeId='other';assert.equal(assess(x).gate.G12.status,'HOLD');});
test('missing formal contract declaration is included but cannot promote',()=>{const x=fixture();x.formalContractVerified=false;const r=assess(x);assert.equal(r.formalContractDeclared,false);assert.equal(r.candidateReadiness,'PASS');assert.equal(r.gate.G11.status,'HOLD');});
test('invalid JSON roots, sparse arrays, cycles and oversized declarations hold without throwing',()=>{const cycle={};cycle.self=cycle;const sparse=fixture();sparse.runners=new Array(2);const huge=fixture();huge.runners=Array(501).fill({});for(const x of [null,[],false,'invalid',cycle,sparse,huge,{value:NaN},{value:BigInt(1)},{value:'x'.repeat(4097)}]){const r=assess(x);assert.equal(r.inputStatus,'INVALID_INPUT');assert.equal(r.formalReadiness,'HOLD');assert.equal(r.candidateReadiness,'HOLD');}});
test('input getters and toJSON callbacks are not executed',()=>{let calls=0;const x={};Object.defineProperty(x,'runners',{enumerable:true,get(){calls++;throw Error('PRIVATE');}});assert.equal(assess(x).inputStatus,'INVALID_INPUT');assert.equal(assess({toJSON(){calls++;throw Error('PRIVATE');}}).inputStatus,'INVALID_INPUT');assert.equal(calls,0);});
test('reason output does not echo arbitrary caller text',()=>{const x=fixture();x.snapshot.hash='PRIVATE_SECRET';const r=assess(x);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);assert.equal(r.formalReadiness,'HOLD');});
