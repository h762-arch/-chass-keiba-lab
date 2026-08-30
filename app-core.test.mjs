import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function loadCore(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const memory=new Map();
  const window={__CHASS_TEST__:true};
  const context={window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});
  return window.CHASS_TEST;
}

const horses=()=>[
  {horseNo:1,horseName:'一号馬',win:45,place:70,overall:92,ev:110,predictedTime:'1:40.0',dataConfidence:90,abilityMark:'◎',odds:2.4,popularity:1},
  {horseNo:2,horseName:'二号馬',win:30,place:58,overall:85,ev:105,predictedTime:'1:40.5',dataConfidence:85,abilityMark:'○',odds:3.5,popularity:2},
  {horseNo:3,horseName:'三号馬',win:25,place:50,overall:80,ev:98,predictedTime:'1:41.0',dataConfidence:80,abilityMark:'▲',odds:5.0,popularity:3}
];

test('race ID and TIME conversion are deterministic',async()=>{
  const core=await loadCore();
  assert.equal(core.raceId({raceDate:'2026/08/30',track:'船橋',raceNo:'4R'}),'2026-08-30|船橋|4');
  assert.equal(core.timeToSec('1:40.3'),100.3);
  assert.equal(core.timeToSec('invalid'),null);
});

test('prediction, market and FINAL snapshots stay fixed after validation',async()=>{
  const core=await loadCore();
  core.setState({race:{raceDate:'2026-08-30',track:'船橋',raceNo:4,oddsType:'実オッズ'},horses:horses(),result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null,validationCompleted:false});
  core.makeSnapshot();
  const before=JSON.stringify(core.getState().predictionSnapshot);
  const beforeFinal=JSON.stringify(core.getState().finalSnapshot);
  core.getState().horses[0].win=1;
  core.getState().validationCompleted=true;
  core.makeSnapshot();
  assert.equal(JSON.stringify(core.getState().predictionSnapshot),before);
  assert.equal(JSON.stringify(core.getState().finalSnapshot),beforeFinal);
  assert.equal(core.getState().predictionSnapshot.locked,true);
  assert.equal(core.getState().predictionSnapshot.schemaVersion,3);
});

test('same race ID updates one cache record instead of duplicating it',async()=>{
  const core=await loadCore(),id='2026-08-30|船橋|4';
  core.saveRaceRecord(id,{race:{raceNo:4},updatedAt:'2026-08-30T00:00:00Z'});
  core.saveRaceRecord(id,{race:{raceNo:4},validated:true,updatedAt:'2026-08-30T01:00:00Z'});
  assert.equal(Object.keys(core.getRaceCache()).length,1);
  assert.equal(core.getRaceCache()[id].validated,true);
});

test('track condition alone never creates a bias diagnosis',async()=>{
  const core=await loadCore(),base={race:{trackCondition:'良',bias:'',pace:'標準'},predictionSnapshot:{race:{bias:''},horses:horses()},marketSnapshot:{horses:[]},finalSnapshot:{top3:[{horseNo:1},{horseNo:2},{horseNo:3}]},resultSnapshot:{finishOrder:[1,2,3],actualTimes:{}}};
  assert.equal(core.failureReasonsForRace(base).some(x=>x.code==='BIAS_CHECK'),false);
  base.predictionSnapshot.race.bias='内有利';
  assert.equal(core.failureReasonsForRace(base).some(x=>x.code==='BIAS_CHECK'),true);
});

test('legacy record migration creates locked snapshots without changing horses',async()=>{
  const core=await loadCore(),record={race:{raceDate:'2026-08-30',track:'船橋',raceNo:4},horses:horses(),updatedAt:'2026-08-30T00:00:00Z'};
  const original=JSON.stringify(record.horses);
  assert.equal(core.migrateSnapshotRecord(record),true);
  assert.equal(record.predictionSnapshot.locked,true);
  assert.equal(JSON.stringify(record.horses),original);
  assert.equal(core.migrateSnapshotRecord(record),false);
});

test('dashboard aggregation reads frozen prediction values',async()=>{
  const core=await loadCore(),frozen=horses(),mutable=horses();
  mutable[0].win=1;
  const race={race:{distance:1500},horses:mutable,predictionSnapshot:{horses:frozen},marketSnapshot:{horses:[]},finalSnapshot:{top3:[{horseNo:1},{horseNo:2},{horseNo:3}]},resultSnapshot:{finishOrder:[1,2,3],actualTimes:{'1':'1:40.3'}}};
  const aggregate=core.aggregateAdvanced([race]);
  assert.ok(Math.abs(aggregate.winMae[0]-55)<1e-9);
  assert.equal(aggregate.top3Captured,3);
});
