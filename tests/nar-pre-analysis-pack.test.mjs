import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNarPreAnalysisPack as build,verifyNarPreAnalysisPack as verify} from '../src/prediction/nar-pre-analysis-pack.mjs';
import {assertMarketIndependentData,stableHash} from '../src/prediction/precomputed-snapshot.mjs';
const input=()=>({raceId:'20261014-NAR-21-01',race:{date:'2026-10-14',track:'川崎',raceNo:1,postTime:'15:00'},sourceAcquiredAt:'2026-10-14T00:00:00Z',horses:[{horseNo:1,horseName:'A',runnerStatus:'active',abilityScore:80,abilityRank:1,predictedTime:'1:30.0',evidence:{schemaVersion:1,runCount:2}},{horseNo:2,horseName:'B',runnerStatus:'active',abilityScore:null,abilityRank:null,predictedTime:null}]});
test('all-runner material pack preserves unknowns and emits explicit unconnected workflows',async()=>{
 const x=input(),p=await build(x);assert.equal(p.body.runnerCards.length,2);assert.equal(p.body.runnerCards[1].ability.score,null);assert.equal(p.body.runnerCards[1].time.reasonCode,'EVIDENCE_NOT_RETAINED');assert.equal(p.body.candidateCoverage.discoveryComplete,false);assert.equal(p.body.candidateCoverage.reviewedRunnerCount,0);assert.equal(p.body.workflows.find(w=>w.id==='BOTTOM4_AUDIT').status,'NOT_CONNECTED');assert.ok(p.body.workflows.filter(w=>w.status==='NOT_CONNECTED').every(w=>w.reasonCode&&w.recoveryAction));assert.equal(p.body.formalKpiEligible,false);assert.doesNotThrow(()=>assertMarketIndependentData(p));
});
test('pack hash and parent identity enforce provenance and reject repaired-hash cross-race reuse',async()=>{
 const x=input(),p=await build(x);assert.equal(await verify(p,x),true);assert.equal(await verify(p,{...x,raceId:'20261014-NAR-21-02'}),false);assert.equal(await verify(p,{...x,sourceAcquiredAt:'2026-10-14T01:00:00Z'}),false);const changed=structuredClone(x);changed.horses[0].abilityScore=1;assert.equal(await verify(p,changed),false);p.body.runnerCards[0].ability.score=1;assert.equal(await verify(p,x),false);p.packHash=await stableHash(p.body);assert.equal(await verify(p,x),false);
});
test('materialization is deterministic, deep-copies facts and makes no final decisions',async()=>{
 const x=input(),before=structuredClone(x),a=await build(x),b=await build(x);assert.deepEqual(a,b);assert.deepEqual(x,before);a.body.runnerCards[0].evidence.runCount=99;assert.equal(x.horses[0].evidence.runCount,2);assert.ok(a.body.runnerCards.every(h=>h.decision.status==='NOT_DECIDED'));assert.equal(a.body.runnerCards[0].ability.isCpsi,false);assert.equal('mark' in a.body.runnerCards[0],false);
});
test('inactive horses remain in material coverage instead of disappearing as candidates',async()=>{const x=input();x.horses[1].runnerStatus='scratched';const p=await build(x);assert.equal(p.body.runnerCards[1].runnerStatus,'scratched');assert.equal(p.body.candidateCoverage.runnerKeys.length,2);assert.equal(p.body.quality.activeHorseCount,1);});
