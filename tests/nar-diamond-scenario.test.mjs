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
async function reseal(x){const {contentSha256,...body}=structuredClone(x);const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(body)));return {...body,contentSha256:[...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('')};}
test('negated, qualified and unsupported styles never produce a concrete scenario',async()=>{
 for(const style of ['先行できない・不明','差しではない','先行？','好位だが追込','追い込めない','未知の脚質']){
  const x=await build(await source({style}));assert.equal(x.status,'INSUFFICIENT',style);assert.equal(x.scenario,null);assert.ok(x.missing.includes('UNAMBIGUOUS_RUNNING_STYLE'));
 }
});
test('supported producer style labels preserve front and closing routes',async()=>{
 for(const style of ['逃げ','先行','好位','逃げ・先行','先行・好位','差し','追込','追い込み','中団','差し・追込'])assert.equal((await build(await source({style}))).status,'SCENARIO_READY',style);
});
test('out-of-range scores and fractional counts cannot supply ability support',async()=>{
 for(const [score,runs] of [[999,4],[90,.5],[-1,4],[101,4],[90,-1],[90,0],[true,4],[90,true]]){
  const x=await build(await source({horsePatch:{predictedTime:'',features:{distanceFit:score,courseFit:score,evidence:{sameDistance:runs,sameTrack:runs}}}}));assert.equal(x.status,'INSUFFICIENT',`${score}/${runs}`);assert.ok(x.missing.includes('ABILITY_SUPPORT'));assert.equal(x.scenario,null);
 }
});
test('invalid confidence and fractional time evidence cannot become TIME support',async()=>{
 for(const patch of [{predictedTimeConfidence:101},{predictedTimeConfidence:-1},{predictedTimeConfidence:true},{features:{evidence:{sameDistance:.5}}}]){
  const x=await build(await source({horsePatch:{features:{evidence:{sameDistance:4}},...patch}}));assert.equal(x.status,'INSUFFICIENT');assert.ok(!x.evidence.some(e=>e.code==='TIME_SUPPORT'));
 }
});
test('closing score uses the same bounded-score and integer-count requirements',async()=>{
 for(const [score,runs] of [[999,4],[90,.5]]){
  const x=await build(await source({style:'差し',mark:'💎',horsePatch:{predictedTime:'',features:{last3fAbility:score,evidence:{last3f:runs}}}}));assert.equal(x.status,'INSUFFICIENT');assert.ok(!x.evidence.some(e=>e.code==='FINISH_SUPPORT'));
 }
});
test('valid boundary evidence remains usable without clamping invalid values',async()=>{
 const x=await build(await source({horsePatch:{predictedTimeConfidence:100,features:{distanceFit:100,courseFit:70,evidence:{sameDistance:1,sameTrack:1}}}}));assert.equal(x.status,'SCENARIO_READY');assert.match(x.scenario,/同距離1走/);
});
test('rehashing a post-time or pre-capture generation timestamp cannot pass readback',async()=>{
 const snapshot=await source(),x=await build(snapshot);
 for(const generatedAt of ['2026-10-07T15:00:00.000Z','2026-10-07T04:50:00.000Z','2026-10-07T02:59:59.000Z','invalid']){
  const bad=await reseal({...x,generatedAt});assert.equal((await verifyNarDiamondScenarioResearch(bad,{snapshot,raceId})).reason,'SCENARIO_SEMANTIC_MISMATCH');
 }
});
test('rehashing research flags, signal, horse or narrative inconsistencies is rejected',async()=>{
 const snapshot=await source(),x=await build(snapshot);
 for(const patch of [{mode:'production'},{researchOnly:false},{adopted:true},{formalKpiEligible:true},{horseNo:8},{horseNo:'9'},{sourceSignal:{...x.sourceSignal,evAtFreeze:999}},{status:'INSUFFICIENT'},{targetPositions:[2,3]},{missing:['ABILITY_SUPPORT']},{conditions:[]},{scenario:'後付けの勝ち筋'},{sourceCapturedAt:'2026-10-07T02:00:00.000Z'}]){
  assert.equal((await verifyNarDiamondScenarioResearch(await reseal({...x,...patch}),{snapshot,raceId})).reason,'SCENARIO_SEMANTIC_MISMATCH',JSON.stringify(patch));
 }
});
test('saved pre-post assessment can be read after the race without a fresh generation',async()=>{
 const snapshot=await source(),x=await build(snapshot),realNow=Date.now;Date.now=()=>Date.parse('2026-10-08T03:00:00Z');
 try{assert.equal((await verifyNarDiamondScenarioResearch(x,{snapshot,raceId})).status,'VERIFIED');assert.equal((await buildNarDiamondScenarioResearch({snapshot,raceId,horseNo:9})).reason,'SCENARIO_PRE_POST_REQUIRED')}finally{Date.now=realNow}
});
test('insufficient saved assessment also passes semantic readback without promoting the mark',async()=>{
 const snapshot=await source({style:'先行できない・不明'}),x=await build(snapshot);assert.equal(x.status,'INSUFFICIENT');assert.equal((await verifyNarDiamondScenarioResearch(x,{snapshot,raceId})).status,'VERIFIED');assert.equal(x.originalMark,'💎💎💎');
});
