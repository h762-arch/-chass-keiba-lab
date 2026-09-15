import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const appPath=path.resolve(here,'../app.js');
const source=fs.readFileSync(appPath,'utf8');
const sandbox={
  window:{__CHASS_TEST__:true,CHASS_FEATURES:{}},console,
  setTimeout,clearTimeout,setInterval,clearInterval,
  Date,Math,JSON,Number,String,Boolean,Array,Object,Map,Set,RegExp,URL,URLSearchParams,
  TextEncoder,TextDecoder,AbortController,Promise
};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'app.js'});
const T=sandbox.window.CHASS_TEST;

function baseHorse(no,extra={}){
  return {
    horseNo:no,horseName:`H${no}`,horseStatus:'active',eligible:true,
    overall:60-no,win:Math.max(2,14-no),place:Math.max(12,45-no*2),
    dataConfidence:70,runningStyle:'差し',predictedTime:`1:${String(21+no).padStart(2,'0')}.0`,predictedTimeType:'実績',
    popularity:no,odds:10+no,ev:(10+no)*Math.max(2,14-no),fair:100/Math.max(2,14-no),
    features:{distanceFit:60,courseFit:60,recentFormScore:60,consistencyScore:60,paceFit:60,last3fAbility:60},
    scores:{distanceFit:6,courseFit:6},abilityMark:'',finalMark:'',valueMark:'',warningMark:'',
    ...extra
  };
}
function strongLongshot(popularity,{win=12,place=38,odds=20}={}){
  const target=baseHorse(1,{
    horseName:'TARGET',popularity,overall:90,win,place,odds,ev:odds*win,fair:100/win,dataConfidence:90,
    predictedTime:'1:19.0',runningStyle:'先行',
    features:{distanceFit:92,courseFit:90,recentFormScore:88,consistencyScore:86,paceFit:90,last3fAbility:88,reboundScore:84,weightEffect:65,trainerJockeyScore:70},
    scores:{distanceFit:9.2,courseFit:9.0}
  });
  const pops=Array.from({length:10},(_,i)=>i+1).filter(p=>p!==popularity);
  const others=pops.map((p,i)=>baseHorse(i+2,{popularity:p,overall:66-i,win:11-i*.5,place:35-i,odds:Math.max(2,12-i),ev:80,features:{distanceFit:55,courseFit:55,recentFormScore:55,consistencyScore:55,paceFit:55,last3fAbility:55}}));
  return [target,...others];
}

test('fixed policy marker is present and legacy EV-only warning rule is removed',()=>{
  assert.match(source,/SIGNAL_POLICY_VERSION='CHASS-SIGNAL-v1\.0'/);
  assert.doesNotMatch(source,/popularity>=1&&popularity<=3&&h\.ev!=null&&h\.ev<75/);
});

test('low EV or price heat alone never creates ⚠️',()=>{
  const h=baseHorse(1,{popularity:1,ev:35,odds:2,fair:4,place:62,predictionAxes:{paceFitScore:70,distanceChangeFit:70,placeStabilityScore:70,conditionProgressScore:70,candidatePlaceRate:62}});
  const warning=T.warningScenarioFor(h,[h,baseHorse(2),baseHorse(3)],{});
  assert.equal(warning,null);
  T.evaluateLongshots([h,baseHorse(2),baseHorse(3)],{chaos:50});
  assert.equal(h.warningMark,'');
  assert.ok(h.marketHeat.includes('期待値低め'));
});

test('⚠️ requires top-3 popularity plus a concrete 4th-or-worse scenario',()=>{
  const risky=baseHorse(1,{popularity:1,place:34,predictionAxes:{paceFitScore:28,distanceChangeFit:32,placeStabilityScore:34,conditionProgressScore:38,candidatePlaceRate:34}});
  const warning=T.warningScenarioFor(risky,[risky,baseHorse(2),baseHorse(3),baseHorse(4)],{});
  assert.ok(warning);
  assert.equal(warning.targetBasis,'market_top3');
  assert.ok(warning.factors.length>=2);
  assert.match(warning.scenario,/4着以下/);
  const sameRiskButFourth={...risky,popularity:4,horseNo:4};
  assert.equal(T.warningScenarioFor(sameRiskButFourth,[risky,baseHorse(2),baseHorse(3),sameRiskButFourth],{}),null);
});

test('when pre-race odds are absent, only ability TOP3 may enter ⚠️ review',()=>{
  const top=baseHorse(1,{popularity:null,odds:null,ev:null,overallRank:2,place:32,predictionAxes:{paceFitScore:30,distanceChangeFit:34,placeStabilityScore:32,candidatePlaceRate:32}});
  const fourth={...top,horseNo:4,overallRank:4};
  assert.equal(T.warningScenarioFor(top,[top,baseHorse(2),baseHorse(3),fourth],{})?.targetBasis,'ability_top3');
  assert.equal(T.warningScenarioFor(fourth,[top,baseHorse(2),baseHorse(3),fourth],{}),null);
});

test('⚠️ is completely exclusive with ◎○▲△ and FINAL ranking',()=>{
  const warned=baseHorse(1,{warningMark:'⚠️',abilityMark:'◎',finalMark:'◎',valueMark:'💎'});
  const safe2=baseHorse(2,{overall:80,win:20});
  const safe3=baseHorse(3,{overall:75,win:18});
  T.enforceSignalMarkExclusion([warned,safe2,safe3]);
  assert.equal(warned.warningMark,'⚠️');
  assert.equal(warned.abilityMark,'');
  assert.equal(warned.finalMark,'');
  assert.equal(warned.valueMark,'');
  const ranked=T.rankFinalFor([warned,safe2,safe3]);
  assert.ok(!ranked.some(h=>h.horseNo===1));
});

test('💎 family is never assigned above 5th popularity and starts at 6th',()=>{
  const field5=strongLongshot(5);
  T.evaluateLongshots(field5,{chaos:60});
  assert.equal(field5[0].valueMark,'');
  const field6=strongLongshot(6,{win:3.5,place:32,odds:32});
  T.evaluateLongshots(field6,{chaos:60});
  assert.equal(field6[0].valueMark,'💎');
  assert.equal(field6[0].longshotScenario?.level,'place');
});

test('💎💎 requires a win scenario; 💎💎💎 additionally requires 9th popularity or lower and strong evidence',()=>{
  const eight=strongLongshot(8,{win:12,place:38,odds:20});
  T.evaluateLongshots(eight,{chaos:65});
  assert.equal(eight[0].valueMark,'💎💎');
  assert.equal(eight[0].longshotScenario?.level,'win');
  const nine=strongLongshot(9,{win:12,place:38,odds:20});
  T.evaluateLongshots(nine,{chaos:65});
  assert.equal(nine[0].valueMark,'💎💎💎');
  assert.equal(nine[0].longshotScenario?.level,'big_win');
});

test('Signal Freeze restores Original Signal after later market changes',()=>{
  const horses=strongLongshot(9,{win:12,place:38,odds:20});
  T.evaluateLongshots(horses,{chaos:65,oddsType:'実オッズ'});
  const original=horses[0].valueMark;
  const snapshot=T.buildSignalSnapshot(horses,{oddsType:'実オッズ'},'2026-09-15T00:00:00.000Z');
  assert.equal(snapshot.status,'frozen');
  horses[0].valueMark='';horses[0].warningMark='⚠️⚠️⚠️';horses[0].popularity=1;horses[0].odds=1.1;horses[0].ev=13.2;
  T.applyFrozenSignalSnapshot(horses,snapshot);
  assert.equal(horses[0].valueMark,original);
  assert.equal(horses[0].warningMark,'');
});


test('no-odds ability-TOP3 warning is frozen even when a later market arrives',()=>{
  const risky=baseHorse(1,{popularity:null,odds:null,ev:null,overallRank:1,place:32,predictionAxes:{paceFitScore:28,distanceChangeFit:32,placeStabilityScore:34,conditionProgressScore:38,candidatePlaceRate:32}});
  const others=[baseHorse(2,{popularity:null,odds:null,ev:null}),baseHorse(3,{popularity:null,odds:null,ev:null}),baseHorse(4,{popularity:null,odds:null,ev:null})];
  const horses=[risky,...others];
  T.evaluateLongshots(horses,{chaos:50,oddsType:'オッズなし'});
  assert.ok(risky.warningMark);
  const provisional=T.buildSignalSnapshot(horses,{oddsType:'オッズなし'},'2026-09-15T00:00:00.000Z');
  assert.equal(provisional.status,'provisional');
  assert.ok(provisional.warningFrozenAt);
  horses.forEach((h,i)=>{h.popularity=i+4;h.odds=10+i;h.ev=(h.odds)*(h.win||1)});
  T.evaluateLongshots(horses,{chaos:50,oddsType:'実オッズ'});
  assert.equal(risky.warningMark,'');
  T.applyFrozenWarnings(horses,provisional);
  assert.ok(risky.warningMark);
  assert.equal(risky.valueMark,'');
});

test('without market data signal snapshot remains provisional until first real market',()=>{
  const horses=[baseHorse(1,{popularity:null,odds:null,ev:null}),baseHorse(2,{popularity:null,odds:null,ev:null})];
  const snapshot=T.buildSignalSnapshot(horses,{oddsType:'オッズなし'},'2026-09-15T00:00:00.000Z');
  assert.equal(snapshot.status,'provisional');
  assert.equal(snapshot.frozenAt,null);
});
