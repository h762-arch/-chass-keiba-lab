import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {calculateJraAbility} from '../src/prediction/jra-ability-core.mjs';
import {projectJraAbilityResult} from '../src/prediction/jra-ability-result-projector.mjs';
import {calculateJraData,projectJraAbilityInput} from '../src/prediction/jra-data-calculator.mjs';

const html=fs.readFileSync(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const source=parseJraRaceCard(html,{date:'2026-09-05',track:'中山',race:5});
// The race-card fixture is a debut race; add a representative official past-run time.
source.horses[0].pastRuns.push({date:'2026-08-01',racecourse:'中山',surface:'芝',distance:2000,trackCondition:'良',raceClass:'新馬',finish:2,fieldSize:10,time:'2:00.3',margin:.2,cornerPositions:[3,3],last3F:35.2,weightCarried:55});
const copy=value=>structuredClone(value);
const marketField=/^(odds|popularity|ev|evConfidence|fair|marketGapScore|longshotScore|longshotClass|longshotReasons|valueMark|valueType|warningMark|warningReasons|marketHeat|favoriteCollapseRate|finalMark|modelVersion|calculationVersion|normalizedAt|timestamp)$/i;
function inspect(value){
 if(Array.isArray(value)){for(const child of value)inspect(child);return}
 if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){assert.doesNotMatch(key,marketField);inspect(child)}
}
function normalizedBrowserInput(raw){
 const context=vm.createContext({Date});
 vm.runInContext(fs.readFileSync(new URL('../jra-normalizer.js',import.meta.url),'utf8'),context);
 return context.CHASS_JRA_NORMALIZER.normalizeJraData({race:raw.race,horses:raw.horses.filter(h=>h.runningStatus==='active')});
}
test('official time projects to seconds and matches browser ability projection',()=>{
 const projected=projectJraAbilityInput(source);
 assert.equal(projected.horses[0].pastRuns[0].timeSeconds,120.3);
 const browser=normalizedBrowserInput(source);
 const expected=projectJraAbilityResult(calculateJraAbility(browser)).map(({dataMode,...horse})=>horse);
 const actual=calculateJraData(source);
 assert.ok(projected.horses.some(h=>h.pastRuns.some(r=>r.timeSeconds>0)));
 for(const horse of projected.horses.filter(h=>h.runningStatus==='active')){
  const b=browser.horses.find(x=>x.horseNo===horse.horseNo);
  assert.deepStrictEqual(horse.pastRuns.map(r=>r.timeSeconds),Array.from(b.pastRuns,r=>r.timeSeconds));
 }
 assert.deepStrictEqual(actual.horses,expected);
 assert.ok(actual.horses.some(h=>h.predictedTime));
});
test('market and timestamp changes cannot change DATA, including nested historical market fields',()=>{
 const changed=copy(source);changed.normalizedAt='2099-01-01';
 changed.horses.forEach((h,i)=>{h.odds=500+i;h.popularity=i+1;h.marketGap=99;h.pastRuns.forEach(run=>{run.odds=1.1;run.popularity=1})});
 assert.deepStrictEqual(calculateJraData(changed),calculateJraData(source));
});
test('scratched and excluded SOURCE additions do not affect active DATA',()=>{
 const changed=copy(source);
 changed.horses.push({...copy(source.horses[0]),horseNo:98,runningStatus:'scratched'});
 changed.horses.push({...copy(source.horses[1]),horseNo:99,runningStatus:'excluded'});
 assert.deepStrictEqual(calculateJraData(changed),calculateJraData(source));
});
test('official SOURCE runner order does not change DATA',()=>{
 const changed=copy(source);changed.horses.reverse();
 assert.deepStrictEqual(calculateJraData(changed),calculateJraData(source));
});
test('status fails closed and fewer than two active runners are rejected',()=>{
 for(const status of [undefined,'unknown']){
  const changed=copy(source);changed.horses[0].runningStatus=status;
  assert.throws(()=>calculateJraData(changed),/invalid_official_running_status/);
 }
 const onlyOne=copy(source);onlyOne.horses.slice(1).forEach(h=>h.runningStatus='scratched');
 assert.throws(()=>calculateJraData(onlyOne),/no_active_jra_runners/);
});
test('DATA is JSON-safe, ability-only, and does not own model version',()=>{
 const data=calculateJraData(source);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(data)),data);
 inspect(data);
 assert.ok(data.horses.every(h=>Number.isInteger(h.abilityRank)&&h.jraIndices&&h.raw&&h.scores));
 assert.ok(!('modelVersion' in data)&&!('calculationVersion' in data));
});
