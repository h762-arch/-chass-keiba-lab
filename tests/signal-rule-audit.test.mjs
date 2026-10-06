import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditFrozenSignalRules } from '../src/research/signal-rule-audit.mjs';

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


const frozenAt='2026-10-06T00:00:00.000Z';
function frozenDiamond(popularity=9, options={}){
  const horses=strongLongshot(popularity,options);
  T.evaluateLongshots(horses,{chaos:65,oddsType:'実オッズ'});
  return {horses,snapshot:T.buildSignalSnapshot(horses,{oddsType:'実オッズ'},frozenAt)};
}
const row=snapshot=>auditFrozenSignalRules(snapshot).audit.rows.find(r=>r.horseNo===1);

test('captured market and exclusive marks survive later market changes without rewriting current odds',()=>{
  const {horses,snapshot}=frozenDiamond();
  assert.equal(snapshot.horses[0].popularityAtFreeze,9);
  assert.equal(snapshot.horses[0].oddsAtFreeze,20);
  assert.equal(snapshot.horses[0].evAtFreeze,240);
  assert.equal(snapshot.horses[0].abilityMarkAtFreeze,'');
  assert.equal(snapshot.horses[0].finalMarkAtFreeze,'');
  horses[0].popularity=1;horses[0].odds=1.1;horses[0].ev=13.2;
  horses[0].valueMark='';
  T.applyFrozenSignalSnapshot(horses,snapshot);
  assert.equal(horses[0].valueMark,'💎💎💎');
  assert.equal(horses[0].odds,1.1);
  assert.equal(snapshot.horses[0].oddsAtFreeze,20);
  assert.equal(row(snapshot).status,'PASS');
});

test('real app snapshots pass each diamond tier with structural quality explicitly unevaluated',()=>{
  for(const [pop,options,mark] of [[6,{win:3.5,place:32,odds:32},'💎'],[8,{},'💎💎'],[9,{},'💎💎💎']]){
    const {snapshot}=frozenDiamond(pop,options);
    assert.equal(snapshot.horses[0].valueMark,mark);
    const before=JSON.stringify(snapshot),result=auditFrozenSignalRules(snapshot);
    assert.equal(row(snapshot).status,'PASS');
    assert.equal(result.audit.scenarioQuality,'NOT_EVALUATED');
    assert.equal(result.audit.mode,'research');
    assert.equal(JSON.stringify(snapshot),before);
    assert.ok(Object.isFrozen(result.audit.rows[0].reasons));
  }
});

test('frozen popularity boundaries reject diamonds even when current popularity could qualify',()=>{
  for(const [pop,below] of [[6,5],[8,5],[9,8]]){
    const {snapshot}=frozenDiamond(pop,pop===6?{win:3.5,place:32,odds:32}:{});
    snapshot.horses[0].popularityAtFreeze=below;
    snapshot.horses[0].popularity=9;
    assert.ok(row(snapshot).reasons.includes('DIAMOND_POPULARITY_OUT_OF_RANGE'));
  }
});

test('old snapshots never fill missing frozen market from later or result odds',()=>{
  const {snapshot}=frozenDiamond();
  delete snapshot.horses[0].popularityAtFreeze;
  delete snapshot.horses[0].oddsAtFreeze;
  delete snapshot.horses[0].evAtFreeze;
  Object.assign(snapshot.horses[0],{popularity:9,odds:20,ev:240,resultOdds:20});
  assert.equal(row(snapshot).status,'UNVERIFIED');
  assert.ok(row(snapshot).reasons.includes('FROZEN_MARKET_BASIS_UNAVAILABLE'));
});

test('warning audit checks scenario, frozen popularity and exclusion of every final mark',()=>{
  const risky=baseHorse(1,{place:34,predictionAxes:{paceFitScore:28,distanceChangeFit:32,placeStabilityScore:34,conditionProgressScore:38,candidatePlaceRate:34}});
  const horses=[risky,baseHorse(2),baseHorse(3),baseHorse(4)];
  T.evaluateLongshots(horses,{chaos:50});
  const snapshot=T.buildSignalSnapshot(horses,{},frozenAt);
  assert.ok(risky.warningMark);
  assert.equal(row(snapshot).status,'PASS');
  for(const mark of ['◎','○','▲','△','☆']){
    snapshot.horses[0].finalMarkAtFreeze=mark;
    assert.ok(row(snapshot).reasons.includes('WARNING_MARK_CONFLICT'));
  }
  snapshot.horses[0].finalMarkAtFreeze='';
  snapshot.horses[0].popularityAtFreeze=4;
  assert.ok(row(snapshot).reasons.includes('WARNING_POPULARITY_OUT_OF_RANGE'));
  snapshot.horses[0].warningScenario.targetBasis='ability_top3';
  assert.equal(row(snapshot).status,'UNVERIFIED');
  assert.ok(row(snapshot).reasons.includes('ORIGINAL_WARNING_BASIS_UNVERIFIED'));
  assert.ok(!row(snapshot).reasons.includes('WARNING_POPULARITY_OUT_OF_RANGE'));
  snapshot.horses[0].warningScenario.scenario='価格が高すぎる';
  assert.ok(row(snapshot).reasons.includes('WARNING_SCENARIO_OR_ABILITY_MISSING'));
});

test('market value alone and duplicated ability evidence cannot pass a big diamond',()=>{
  const {snapshot}=frozenDiamond(),s=snapshot.horses[0].longshotScenario;
  s.evidence=[{code:'MARKET_GAP',strength:2,label:'人気差'}];
  assert.ok(row(snapshot).reasons.includes('DIAMOND_ABILITY_EVIDENCE_MISSING'));
  s.evidence=[{code:'TIME_TOP',strength:2,label:'TIME 1位'},{code:'TIME_TOP',strength:2,label:'TIME 1位'}];
  assert.ok(row(snapshot).reasons.includes('BIG_DIAMOND_STRONG_EVIDENCE_MISSING'));
  s.marketValue=false;
  assert.ok(row(snapshot).reasons.includes('DIAMOND_MARKET_VALUE_UNVERIFIED'));
});

test('provisional, malformed and duplicate identities are rejected before evaluation',()=>{
  assert.equal(auditFrozenSignalRules(null).status,'REJECTED');
  const {snapshot}=frozenDiamond();
  assert.equal(auditFrozenSignalRules({...snapshot,status:'provisional'}).status,'REJECTED');
  assert.equal(auditFrozenSignalRules({...snapshot,frozenAt:null}).status,'REJECTED');
  assert.equal(auditFrozenSignalRules({...snapshot,horses:[null]}).reason,'INVALID_HORSE_IDENTITY');
  assert.equal(auditFrozenSignalRules({...snapshot,horses:[snapshot.horses[0],snapshot.horses[0]]}).reason,'INVALID_HORSE_IDENTITY');
});
