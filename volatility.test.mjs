import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function loadCore(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const memory=new Map(),window={__CHASS_TEST__:true};
  const context={window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});return window.CHASS_TEST;
}

function horses({bunched=false,timeClose=false,marketGap=false,warnings=0,longshots=0}={}){
  const wins=bunched?[22,20,18,16,14]:[48,22,12,8,5],times=timeClose?['1:40.0','1:40.2','1:40.4','1:40.6','1:41.0']:['1:39.0','1:40.5','1:41.0','1:42.4','1:43.0'];
  return wins.map((win,i)=>({horseNo:i+1,horseName:`馬${i+1}`,win,place:bunched?55-i*3:75-i*12,overall:bunched?84-i:96-i*10,abilityScore:bunched?88-i:98-i*12,predictedTime:times[i],popularity:marketGap?[5,1,8,2,10][i]:i+1,odds:i+2,ev:i<longshots?150:95,warningMark:i<warnings?'⚠️':'',valueMark:i<longshots?'💎':'',longshotScore:i<longshots?75:20,runningStyle:['逃げ','先行','差し','追込','先行'][i]}));
}

function record(date,opts={},finish=[1,2,3]){
  const hs=horses(opts),race={raceDate:date,track:'大井',raceNo:8,distance:1400,surface:'ダート',trackCondition:'良',category:'地方競馬'};
  return {race,predictionSnapshot:{createdAt:`${date}T01:00:00Z`,race,horses:hs},marketSnapshot:{horses:hs},resultSnapshot:{finishOrder:finish,horses:finish.map((horseNo,i)=>({horseNo,position:i+1}))},validated:true};
}

test('ability leader separation and large TIME gap lower volatility',async()=>{
  const core=await loadCore(),stable=core.calculateVolatilityIndex(record('2026-08-30'),[]),mixed=core.calculateVolatilityIndex(record('2026-08-30',{bunched:true,timeClose:true}),[]);
  assert.ok(stable.volatilityIndex<mixed.volatilityIndex);
  assert.ok(stable.stabilityScore>mixed.stabilityScore);
});

test('AI bunching, market gaps, dangerous favorites and longshots raise volatility',async()=>{
  const core=await loadCore(),base=core.calculateVolatilityIndex(record('2026-08-30'),[]),upset=core.calculateVolatilityIndex(record('2026-08-30',{bunched:true,timeClose:true,marketGap:true,warnings:3,longshots:3}),[]);
  assert.ok(upset.volatilityIndex>base.volatilityIndex);
  assert.ok(upset.upsetScore>base.upsetScore);
  assert.ok(upset.reasons.length<=3);
});

test('similar upset history raises index and orderly history lowers it',async()=>{
  const core=await loadCore(),current=record('2026-08-30',{bunched:true,timeClose:true}),upsetHistory=[],stableHistory=[];
  for(let i=1;i<=24;i++){const day=String(i).padStart(2,'0');upsetHistory.push(record(`2026-07-${day}`,{bunched:true,timeClose:true},[5,4,3]));stableHistory.push(record(`2026-06-${day}`,{bunched:true,timeClose:true},[1,2,3]))}
  const high=core.calculateVolatilityIndex(current,upsetHistory),low=core.calculateVolatilityIndex(current,stableHistory);
  assert.ok(high.similarRaceCount>=20);assert.ok(high.similarUpsetRate>low.similarUpsetRate);assert.ok(high.volatilityIndex>low.volatilityIndex);
});

test('actual upset label detects 7th and 10th popularity top-three entries',async()=>{
  const core=await loadCore(),hs=Array.from({length:10},(_,i)=>({horseNo:i+1,win:20-i,place:40-i,popularity:i+1})),r={race:{},predictionSnapshot:{horses:hs},marketSnapshot:{horses:hs},resultSnapshot:{finishOrder:[10,7,3]}};
  const actual=core.actualUpsetScore(r);assert.equal(actual.upset,true);assert.ok(actual.score>=45);assert.ok(actual.reasons.some(x=>x.includes('10人気以下')));
});

test('small similar sample keeps confidence low and shrinks extreme index',async()=>{
  const core=await loadCore(),history=[record('2026-07-01',{bunched:true,timeClose:true},[5,4,3])],v=core.calculateVolatilityIndex(record('2026-08-30',{bunched:true,timeClose:true,marketGap:true,warnings:3,longshots:3}),history);
  assert.equal(v.confidenceLabel,'低');assert.ok(v.volatilityIndex>=35&&v.volatilityIndex<=65);
});

test('walk-forward excludes future and same-race records',async()=>{
  const core=await loadCore(),current=record('2026-08-30'),past=record('2026-08-01'),future=record('2026-09-01'),same=record('2026-08-30');
  assert.equal(core.volatilityHistoryBefore(current,[past,future,same]).length,1);
});

test('calibration reads only prediction-time volatility snapshots',async()=>{
  const core=await loadCore(),high=record('2026-07-01',{},[5,4,3]),low=record('2026-07-02',{},[1,2,3]),legacy=record('2026-07-03',{},[5,4,3]);
  high.predictionSnapshot.horses[4].popularity=10;high.marketSnapshot.horses[4].popularity=10;
  high.predictionSnapshot.volatility={volatilityIndex:80};low.predictionSnapshot.volatility={volatilityIndex:20};
  const c=core.volatilityCalibration([high,low,legacy]);assert.equal(c.samples.length,2);assert.equal(c.high.upset,1);assert.equal(c.low.orderly,1);
});
