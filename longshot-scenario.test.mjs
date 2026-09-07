import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
await import('../longshot-scenario.js');
const {buildLongshotScenario,validateLongshotScenario}=globalThis.CHASS_LONGSHOT_SCENARIO;

function horses(){return [
 {horseNo:1,horseName:'本命馬',popularity:1,odds:2.2,win:35,place:68,overall:88,valueMark:'',features:{frontRealizationRate:.6,remainingRate:.5},runningStyle:'先行',dataConfidence:80},
 {horseNo:8,horseName:'残り穴',popularity:9,odds:28,win:5,place:27,overall:67,valueMark:'',marketGapScore:42,timeRank:3,features:{frontRealizationRate:.62,remainingRate:.31,distanceFit:76},runningStyle:'逃げ',dataConfidence:72},
 {horseNo:10,horseName:'差し穴',popularity:11,odds:45,win:3,place:22,overall:60,valueMark:'💎',features:{closingRate:.28,last3fAbility:78,courseFit:73},runningStyle:'差し',dataConfidence:66}
]}

test('scenario engine is shadow-only and never mutates official prediction values',()=>{const input=horses(),before=JSON.stringify(input),result=buildLongshotScenario(input,{raceType:'JRA'});assert.equal(JSON.stringify(input),before);assert.equal(result.mode,'shadow');assert.equal(result.adopted,false);assert.equal(result.scenarioVersion,'LSI-1.0');assert.equal(result.candidates.some(x=>x.horseNo===8),true)});
test('four supplemental types use only available evidence',()=>{const result=buildLongshotScenario(horses(),{raceType:'JRA'}),front=result.allHorses.find(x=>x.horseNo===8),closing=result.allHorses.find(x=>x.horseNo===10);assert.ok(front.longshotTypes.includes('先行残り穴'));assert.ok(front.longshotTypes.includes('能力穴'));assert.ok(front.longshotTypes.includes('条件変化穴'));assert.ok(closing.longshotTypes.includes('差し込み穴'))});
test('missing probabilities stay null instead of being fabricated',()=>{const result=buildLongshotScenario([{horseNo:12,horseName:'不足馬',popularity:12,odds:80,win:1,place:5,overall:45,runningStyle:'先行'}],{raceType:'NAR'}),h=result.allHorses[0];assert.equal(h.frontProbability,null);assert.equal(h.survivalProbability,null);assert.equal(h.closingProbability,null);assert.equal(h.scenario,null);assert.equal(h.reviewCandidate,false)});
test('inactive runners are excluded from shadow scan',()=>{const input=horses();input[1].horseStatus='excluded';const result=buildLongshotScenario(input,{raceType:'JRA'});assert.equal(result.allHorses.some(x=>x.horseNo===8),false)});
test('Missing Longshot uses frozen pre-race evidence only',()=>{const scenario=buildLongshotScenario(horses(),{raceType:'JRA'}),validation=validateLongshotScenario(scenario,{finishOrder:[8,1,10]});const missed=validation.missingLongshots.find(x=>x.horseNo===8);assert.ok(missed);assert.ok(missed.causes.includes('Front/Survival underestimation'));assert.equal(validation.missingLongshots.some(x=>x.horseNo===10),false)});
test('browser integration stores shadow data without replacing current longshot logic',async()=>{const [app,index]=await Promise.all([readFile(new URL('../app.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);assert.match(index,/longshot-scenario\.js/);assert.match(index,/CHASS LONGSHOT SCAN/);assert.match(app,/buildLongshotScenario/);assert.match(app,/function evaluateLongshots/);assert.doesNotMatch(app,/longshotScenario[^\n]*\.win\s*=/)});
