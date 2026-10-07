import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeNarEarlySnapshot} from '../src/research/nar-early-freeze.mjs';
import {buildNarDiamondScenarioResearch,verifyNarDiamondScenarioResearch} from '../src/research/nar-diamond-scenario.mjs';
const now=Date.parse('2026-10-07T03:00:00Z'),at=new Date(now).toISOString(),raceId='2026-10-07|園田|7';
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'}
function fp(v){let h=2166136261,s=canonical(v);for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return 'fnv1a32:'+(h>>>0).toString(16).padStart(8,'0')}
async function source({style='先行・好位',mark='💎💎💎',horsePatch={},signalPatch={}}={}){
 const race={raceDate:'2026-10-07',track:'園田',raceNo:7,raceType:'NAR',postTime:'13:50',pace:'標準',trackCondition:'稍重'};
 const horses=Array.from({length:9},(_,i)=>({horseNo:i+1,horseName:`試験馬${i+1}`,runningStyle:style,frameNo:null,predictedTime:i===8?'1:33.5':'1:34.0',predictedTimeConfidence:90,features:{distanceFit:90,courseFit:88,last3fAbility:80,evidence:{sameDistance:4,sameTrack:3,last3f:4}},...(i===8?horsePatch:{})}));
 const signal={horseNo:9,valueMark:mark,popularityAtFreeze:9,oddsAtFreeze:30,evAtFreeze:150,warningMark:'',...signalPatch};
 const predictionSnapshot={race,createdAt:at,generatedAt:at,horses},marketSnapshot={createdAt:at,acquiredAt:at,horses:horses.map(h=>({horseNo:h.horseNo})),signalSnapshot:{status:'frozen',horses:[signal]}},finalSnapshot={createdAt:at,generatedAt:at,top3:[{horseNo:1}]};
 const record={race,predictionSnapshot,marketSnapshot,finalSnapshot,snapshotIntegrity:{algorithm:'FNV-1a-32/canonical-json',sealedAt:at,hashes:{predictionSnapshot:fp(predictionSnapshot),marketSnapshot:fp(marketSnapshot),finalSnapshot:fp(finalSnapshot)}}};
 const frozen=await freezeNarEarlySnapshot({raceId,record,now,freshAcquisition:true});assert.equal(frozen.status,'CREATED');return frozen.snapshot;
}
const build=snapshot=>buildNarDiamondScenarioResearch({snapshot,raceId,horseNo:9,now});
test('front-runner hypothesis carries source provenance, support and failure conditions without altering marks',async()=>{
 const snapshot=await source(),before=JSON.stringify(snapshot),x=await build(snapshot);
 assert.equal(x.status,'SCENARIO_READY');assert.match(x.scenario,/【仮定】/);assert.match(x.scenario,/前半の競り合い/);assert.match(x.scenario,/1:33.5/);assert.equal(x.sourceEarlySha256,snapshot.contentSha256);assert.equal(x.originalMark,'💎💎💎');assert.equal(x.adopted,false);assert.equal(x.formalKpiEligible,false);assert.deepEqual(x.targetPositions,[1]);assert.equal(JSON.stringify(snapshot),before);assert.ok(Object.isFrozen(x.conditions[0]));assert.equal((await verifyNarDiamondScenarioResearch(x,{snapshot,raceId})).status,'VERIFIED');
});
test('closing horse gets a different causal condition and stays a 2-3 place candidate',async()=>{
 const x=await build(await source({style:'差し・追込',mark:'💎'}));assert.equal(x.status,'SCENARIO_READY');assert.match(x.scenario,/進路を確保/);assert.match(x.scenario,/2〜3着へ差し込む/);assert.deepEqual(x.targetPositions,[2,3]);
});
test('missing style returns insufficient rather than inventing a position or demoting original mark',async()=>{
 const x=await build(await source({style:'不明'}));assert.equal(x.status,'INSUFFICIENT');assert.equal(x.scenario,null);assert.ok(x.missing.includes('UNAMBIGUOUS_RUNNING_STYLE'));assert.equal(x.originalMark,'💎💎💎');assert.equal(x.reviewEligibility,'REVIEW_REQUIRED');
});
test('missing evidence counts cannot be replaced by high EV or high scores',async()=>{
 const x=await build(await source({horsePatch:{features:{distanceFit:99,courseFit:99,evidence:{}},predictedTimeConfidence:99},signalPatch:{evAtFreeze:900}}));assert.equal(x.status,'INSUFFICIENT');assert.ok(x.missing.includes('ABILITY_SUPPORT'));
});
test('unknown frame, default pace and current going never turn into an asserted advantage',async()=>{
 const x=await build(await source());assert.ok(x.unknowns.includes('FRAME'));assert.match(x.scenario,/想定ペース・馬場適性は未確認/);assert.doesNotMatch(x.scenario,/内枠|平均ペース|稍重が有利/);const known=await build(await source({horsePatch:{frameNo:2}}));assert.match(known.scenario,/枠は2枠/);
});
test('ambiguous running style and non-numeric model evidence are not used',async()=>{
 const x=await build(await source({style:'先行または追込',horsePatch:{predictedTimeConfidence:null,features:{distanceFit:'不明',courseFit:null,evidence:{sameDistance:4,sameTrack:4}}}}));assert.equal(x.status,'INSUFFICIENT');assert.equal(x.scenario,null);
});
test('post-race generation is rejected without changing the original EARLY',async()=>{
 const snapshot=await source();const x=await buildNarDiamondScenarioResearch({snapshot,raceId,horseNo:9,now:Date.parse('2026-10-07T04:50:00Z')});assert.equal(x.reason,'SCENARIO_PRE_POST_REQUIRED');
});
test('bad source hash and policy-incompatible candidate fail closed',async()=>{
 const s=structuredClone(await source());s.data.race.trackCondition='重';assert.equal((await build(s)).reason,'EARLY_SOURCE_INVALID');assert.equal((await build(await source({signalPatch:{popularityAtFreeze:8}}))).reason,'DIAMOND_SOURCE_POLICY_INVALID');assert.equal((await build(await source({mark:'💎💎',signalPatch:{popularityAtFreeze:6.5}}))).reason,'DIAMOND_SOURCE_POLICY_INVALID');assert.equal((await build(await source({signalPatch:{warningMark:'⚠️'}}))).reason,'DIAMOND_SOURCE_POLICY_INVALID');
});
test('scenario tampering and a different sealed source are rejected',async()=>{
 const snapshot=await source(),x=await build(snapshot),bad=structuredClone(x);bad.scenario='後付け';assert.equal((await verifyNarDiamondScenarioResearch(bad,{snapshot,raceId})).reason,'SCENARIO_CONTENT_MISMATCH');assert.equal((await verifyNarDiamondScenarioResearch(x,{snapshot:await source({style:'差し'}),raceId})).reason,'SCENARIO_SOURCE_MISMATCH');
});
