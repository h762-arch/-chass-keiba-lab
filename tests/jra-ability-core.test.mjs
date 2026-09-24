import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {calculateJraAbility,getCourseProfiles} from '../src/prediction/jra-ability-core.mjs';
import * as abilityProjector from '../src/prediction/jra-ability-result-projector.mjs';

const fixture={race:{racecourse:'東京',distance:1800,surface:'芝',trackCondition:'良',pace:'標準',raceClass:'2勝'},horses:Array.from({length:5},(_,i)=>({horseNo:i+1,horseName:`馬${i+1}`,sexAge:'牡4',weightCarried:55+i,odds:2+i*3,popularity:i+1,pastRuns:[{distance:1800,surface:'芝',racecourse:'東京',trackCondition:'良',raceClass:'2勝',finish:i+1,fieldSize:12,timeSeconds:107+i,margin:i*.2,cornerPositions:[i+1],last3F:34+i*.2,weightCarried:55+i}]}))};
const clone=value=>structuredClone(value);
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/jra/jra-ability-baseline.json',import.meta.url),'utf8'));
function browserModel(){const context=vm.createContext({CHASS_JRA_ABILITY_CORE:{calculateJraAbility,getCourseProfiles,courseSimilarity:(a,b)=>{throw Error('unused')}},CHASS_JRA_ABILITY_RESULT_PROJECTOR:abilityProjector,console});vm.runInContext(fs.readFileSync(new URL('../jra-model.js',import.meta.url),'utf8'),context);return context.CHASS_JRA_MODEL}

test('legacy browser output matches the extraction exactly',()=>{
 const result=browserModel().calculate(clone(fixture));
 assert.deepStrictEqual(JSON.parse(JSON.stringify(result)),baseline);
});
test('ability output ignores odds and popularity',()=>{
 const before=calculateJraAbility(clone(fixture));
 const changed=clone(fixture);changed.horses.forEach((h,i)=>{h.odds=500+i;h.popularity=5-i});
 assert.deepStrictEqual(calculateJraAbility(changed),before);
});
test('official runner filtering leaves all active ability values unchanged',()=>{
 const active=clone(fixture);active.horses.forEach(h=>h.runningStatus='active');
 const before=calculateJraAbility(active,{officialSource:true});
 const changed=clone(active);changed.horses.push({...clone(changed.horses[0]),horseNo:6,runningStatus:'scratched'},{...clone(changed.horses[1]),horseNo:7,runningStatus:'excluded'});
 assert.deepStrictEqual(calculateJraAbility(changed,{officialSource:true}),before);
});
test('official runner status fails closed and manual missing status stays compatible',()=>{
 for(const status of [undefined,'unknown']){const broken=clone(fixture);broken.horses[0].runningStatus=status;assert.throws(()=>calculateJraAbility(broken,{officialSource:true}),/invalid_official_running_status/)}
 const one=clone(fixture);one.horses.forEach((h,i)=>h.runningStatus=i===0?'active':'scratched');assert.throws(()=>calculateJraAbility(one,{officialSource:true}),/no_active_jra_runners/);assert.ok(calculateJraAbility(clone(fixture)).rows.length===5);
});
test('course profiles cannot mutate the core',()=>{
 const copy=getCourseProfiles();copy.東京.straight=0;assert.equal(getCourseProfiles().東京.straight,526);
});
