import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateNarScenarioPremarkResearch as evaluate,projectNarScenarioAbilityInput as project} from '../src/research/nar-scenario-premark.mjs';
const now=Date.parse('2026-10-07T03:00:00Z');
function source(){return {raceId:'2026-10-07|園田|7',acquiredAt:new Date(now).toISOString(),race:{raceDate:'2026-10-07',track:'園田',raceNo:7,postTime:'13:50',pace:'標準',trackCondition:'稍重'},horses:Array.from({length:9},(_,i)=>({horseNo:i+1,horseName:`試験馬${i+1}`,runningStyle:'先行・好位',frameNo:null,predictedTime:i===8?'1:33.5':'1:34.0',predictedTimeConfidence:90,features:{distanceFit:90,courseFit:88,last3fAbility:80,evidence:{sameDistance:2,sameTrack:2,last3f:2},evidenceSources:{sameDistance:['r1','r2'],sameTrack:['r1','r2'],last3f:['r1','r2']}},valueMark:'💎',warningMark:'',popularity:9,odds:30,ev:150}))}}
const run=s=>evaluate({input:project(s),horseNo:9,now});
test('legacy marks and market changes cannot affect input hash, conditions or hypothesis',async()=>{
 const a=source(),b=structuredClone(a);b.horses.forEach(h=>Object.assign(h,{valueMark:'💎💎💎',warningMark:'⚠️',popularity:1,odds:1.1,ev:999}));b.signalSnapshot={status:'frozen'};
 const before=JSON.stringify(a),x=await run(a),y=await run(b);assert.deepEqual(x,y);assert.equal(JSON.stringify(a),before);assert.ok(Object.isFrozen(x.routes[0].conditions));assert.ok(!('candidateMark' in x));
});
test('direct market or signal fields at any accepted schema level fail closed',async()=>{
 for(const mutate of [x=>x.valueMark='💎',x=>x.signalSnapshot={},x=>x.horses[8].odds=30,x=>x.horses[8].features.ev=900,x=>x.horses[8].features.evidence.popularity=9]){const input=structuredClone(project(source()));mutate(input);assert.equal((await evaluate({input,horseNo:9,now})).status,'REJECTED')}
});
test('win and place hypotheses have different competition conditions, not just replaced finish numbers',async()=>{
 const x=await run(source()),[win,place]=x.routes;assert.equal(win.routeType,'WIN_ROUTE');assert.deepEqual(win.targetPositions,[1]);assert.deepEqual(place.targetPositions,[2,3]);assert.notDeepEqual(win.conditions,place.conditions);assert.notDeepEqual(win.failureConditions,place.failureConditions);assert.match(win.hypothesis,/後続の追撃/);assert.match(place.hypothesis,/勝ち馬に届かなくても/);
});
test('unapproved criteria prevent readiness and mark promotion even with complete model input',async()=>{
 const x=await run(source());assert.equal(x.status,'INSUFFICIENT');assert.equal(x.reviewEligibility,'REVIEW_REQUIRED');assert.equal(x.adopted,false);assert.equal(x.formalKpiEligible,false);for(const r of x.routes){assert.equal(r.status,'INSUFFICIENT');assert.ok(r.missing.some(k=>k.endsWith('CRITERIA_UNAPPROVED')))}assert.ok(x.missing.includes('MARKET_POLICY_NOT_EVALUATED'));assert.equal(x.strongIndependentSupportCount,null);
});
test('popularity and EV alone or horse-name winning prose cannot create a supported route',async()=>{
 const s=source(),h=s.horses[8];h.runningStyle='不明';h.predictedTime='';h.features={};h.horseName='勝てる💎💎💎';const x=await run(s);assert.ok(x.missing.includes('ABILITY_SUPPORT'));assert.ok(x.routes.every(r=>r.hypothesis===null));assert.ok(!('candidateMark' in x));
});
test('negated and ambiguous styles do not invent a position',async()=>{
 for(const style of ['先行できない・不明','先行または追込','差しではない','不明']){const s=source();s.horses[8].runningStyle=style;const x=await run(s);assert.ok(x.missing.includes('UNAMBIGUOUS_RUNNING_STYLE'));assert.ok(x.routes.every(r=>r.hypothesis===null&&r.conditions.length===0&&r.failureConditions.length===0))}
});
test('invalid numeric scores and fractional counts are excluded without clamping',async()=>{
 for(const [score,count] of [[999,2],[90,.5],[-1,2],[true,2],['90',2],[90,'2'],[90,0]]){const s=source();Object.assign(s.horses[8],{predictedTime:'',features:{distanceFit:score,courseFit:score,evidence:{sameDistance:count,sameTrack:count}}});const x=await run(s);assert.ok(x.missing.includes('ABILITY_SUPPORT'));assert.equal(x.evidence.length,0)}
});
test('invalid TIME confidence and closing score do not supply support',async()=>{
 const s=source();Object.assign(s.horses[8],{runningStyle:'差し・追込',predictedTimeConfidence:101,features:{last3fAbility:999,evidence:{sameDistance:2,last3f:2}}});assert.equal((await run(s)).evidence.length,0);
});
test('shared past runs are flagged as overlapping, never independent strong evidence',async()=>{
 const x=await run(source());assert.ok(x.dependencies.some(d=>d.codes.includes('DISTANCE_SUPPORT')&&d.codes.includes('COURSE_SUPPORT')&&d.relationship==='OVERLAPPING_RUNS'));assert.equal(x.strongIndependentSupportCount,null);
});
test('unknown, incomplete or disjoint provenance never proves independence',async()=>{
 for(const refs of [undefined,{sameDistance:['r1'],sameTrack:['r3','r4']},{sameDistance:['r1','r2'],sameTrack:['r3','r4']}]){const s=source();if(refs)s.horses[8].features.evidenceSources=refs;else delete s.horses[8].features.evidenceSources;const x=await run(s);assert.equal(x.strongIndependentSupportCount,null);assert.ok(x.dependencies.every(d=>['UNKNOWN','OVERLAPPING_RUNS','DISJOINT_RUNS_UNVALIDATED'].includes(d.relationship)))}
});
test('closing routes use lane and relative closing conditions; unknown context stays unknown',async()=>{
 const s=source();s.horses[8].runningStyle='差し・追込';const x=await run(s);assert.match(x.routes[0].hypothesis,/同じ差し集団/);assert.match(x.routes[1].hypothesis,/2〜3着争い/);assert.ok(x.routes.every(r=>r.unknowns.includes('PACE_FORECAST')&&r.unknowns.includes('GOING_SUITABILITY')));assert.doesNotMatch(x.routes[0].hypothesis,/内枠|稍重が有利|平均ペース/);
});
test('race identity, invalid calendar date, duplicate and missing runners are rejected',async()=>{
 for(const change of [s=>s.raceId='2026-10-07|園田|8',s=>{s.race.raceDate='2026-02-30';s.raceId='2026-02-30|園田|7'},s=>s.horses[1].horseNo=1,s=>s.horses.pop()]){const s=source();change(s);assert.equal((await run(s)).status,'REJECTED')}
});
test('future, stale, invalid and post-time evaluation use no clock repair',async()=>{
 for(const stamp of [now+1,now-60001,NaN]){const s=source();s.acquiredAt=Number.isFinite(stamp)?new Date(stamp).toISOString():'invalid';assert.equal((await run(s)).reason,'INPUT_TIME_INVALID')}
 const input=project(source());assert.equal((await evaluate({input,horseNo:9,now:Date.parse('2026-10-07T04:50:00Z')})).reason,'INPUT_TIME_INVALID');
});
test('history and results are refused by projection, non-JSON data by evaluator',async()=>{
 for(const patch of [{historicalResearch:true},{resultSnapshot:{}},{finishOrder:[1,2,3]}])assert.throws(()=>project({...source(),...patch}));const s=source();s.horses[8].result={};assert.throws(()=>project(s));const input=structuredClone(project(source()));input.horses[8].features.distanceFit=Infinity;assert.equal((await evaluate({input,horseNo:9,now})).status,'REJECTED');
});
test('valid numeric boundaries retain evidence and deterministic projection hash without I/O',async()=>{
 const s=source();Object.assign(s.horses[8],{frameNo:2,predictedTimeConfidence:100});s.horses[8].features.distanceFit=100;s.horses[8].features.courseFit=70;const x=await run(s),y=await run(s);assert.deepEqual(x,y);assert.match(x.inputProjectionSha256,/^[a-f0-9]{64}$/);assert.match(x.routes[0].hypothesis,/2枠/);assert.ok(x.evidence.some(e=>e.code==='DISTANCE_SUPPORT'));assert.ok(x.evidence.some(e=>e.code==='COURSE_SUPPORT'));
});
