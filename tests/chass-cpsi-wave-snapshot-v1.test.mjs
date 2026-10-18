import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {projectAndCalculateMetricShadow} from '../src/prediction/chass-cpsi-wave-core-v1.mjs';
const now=Date.parse('2026-10-18T09:55:00+09:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const copy=x=>JSON.parse(JSON.stringify(x));
function state(){
 const raceId='2026-10-18|東京|1';
 const meta={organizer:'JRA',raceId,runId:'RUN',inputSnapshotId:'FREEZE',kind:'EARLY',isPreResult:true,capturedAt:'2026-10-18T09:49:00+09:00',authorityRef:'INDEX_AUTH'};
 const horses=[1,2,3,4].map(horseNo=>({horseNo,horseName:'馬'+horseNo,horseStatus:'active',win:40-horseNo,place:70-horseNo,overall:90-horseNo,ev:110-horseNo,predictedTime:'1:40.0',dataConfidence:80,abilityMark:horseNo===1?'◎':'',odds:horseNo+1,popularity:horseNo,canonicalIndex:{...meta,sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:'INDEX',peak:90-horseNo,baseline5:80-horseNo,current:70-horseNo,distance:60-horseNo,course:50-horseNo}}));
 return {race:{category:'中央競馬',raceType:'JRA',raceDate:'2026-10-18',track:'東京',raceNo:1,surface:'芝',distance:1600,waveEligibility:'JRA_STANDARD_INDEX',metricInputFreeze:{runId:'RUN',inputSnapshotId:'FREEZE',indexSnapshotId:'INDEX',marketSnapshotId:'MARKET',freezeAt:'2026-10-18T09:50:00+09:00',postAt:'2026-10-18T10:30:00+09:00'},originalEarlyMarket:{...meta,authorityRef:'MARKET_AUTH',snapshotId:'MARKET',sourceRef:'PRE_RECEIPT',sourceClass:'PREDICTED_ODDS',horses:horses.map(({horseNo,popularity,odds})=>({horseNo,popularity,odds}))}},horses,result:null,actualTimes:{},predictionSnapshot:null,marketSnapshot:null,finalSnapshot:null,validationCompleted:false};
}
async function load({enabled=true,throws=false}={}){
 const source=await readFile(new URL('../app.js',import.meta.url),'utf8');let calls=0;
 const window={__CHASS_TEST__:true};
 if(enabled)window.CHASS_CPSI_WAVE_CORE={projectAndCalculateMetricShadow:input=>{calls++;if(throws)throw Error('test');return projectAndCalculateMetricShadow(input,{now});}};
 const context={window,console,Date:Clock,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,localStorage:{getItem:()=>null,setItem:()=>{throw Error('unexpected storage write');}}};
 vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});
 return {core:window.CHASS_TEST,calls:()=>calls};
}
test('actual app.js materializes a fresh Shadow before Snapshot integrity sealing',async()=>{
 const {core,calls}=await load();core.setState(state());core.makeSnapshot();
 const s=core.getState(),shadow=s.predictionSnapshot.cpsiWaveShadow;
 assert.equal(calls(),1);assert.equal(shadow.cpsi.numericMaterializedCount,4);assert.ok(Number.isInteger(shadow.wave.waveScore));
 assert.equal(shadow.inputSnapshotId,'FREEZE');assert.equal(core.verifySnapshotIntegrity(s).status,'verified');
});
test('Shadow leaves probability, marks, EV, TIME, Final and Market outputs unchanged',async()=>{
 const a=await load(),b=await load({enabled:false});a.core.setState(state());b.core.setState(state());a.core.makeSnapshot();b.core.makeSnapshot();
 const x=copy(a.core.getState()),y=copy(b.core.getState());
 delete x.predictionSnapshot.cpsiWaveShadow;delete y.predictionSnapshot.cpsiWaveShadow;
 delete x.snapshotIntegrity;delete y.snapshotIntegrity;
 assert.deepEqual(x,y);
});
test('same Snapshot is not recomputed after market/index updates or result arrival',async()=>{
 const {core,calls}=await load();core.setState(state());core.makeSnapshot();const before=JSON.stringify(core.getState().predictionSnapshot);
 core.getState().race.originalEarlyMarket.horses[0].odds=99;core.getState().horses[0].canonicalIndex.current=999;
 core.makeSnapshot();assert.equal(calls(),1);assert.equal(JSON.stringify(core.getState().predictionSnapshot),before);
 core.getState().result={finishOrder:[1,2,3]};core.getState().validationCompleted=true;core.makeSnapshot();
 assert.equal(calls(),1);assert.equal(JSON.stringify(core.getState().predictionSnapshot),before);
});
test('existing Original EARLY without this field is never backfilled',async()=>{
 const {core,calls}=await load();core.setState(state());core.makeSnapshot();delete core.getState().predictionSnapshot.cpsiWaveShadow;
 const before=JSON.stringify(core.getState().predictionSnapshot);core.makeSnapshot();
 assert.equal(calls(),1);assert.equal(JSON.stringify(core.getState().predictionSnapshot),before);
});
test('new Snapshot with missing freeze evidence stores reasoned HOLD without inventing time',async()=>{
 const {core}=await load(),s=state();delete s.race.metricInputFreeze;core.setState(s);core.makeSnapshot();
 const shadow=core.getState().predictionSnapshot.cpsiWaveShadow;
 assert.equal(shadow.status,'HOLD');assert.deepEqual(shadow.reasons,['INPUT_FREEZE_ID_MISSING']);
 assert.equal(shadow.freezeAt,undefined);
});
test('new Snapshot after known result stores HOLD, not a reconstructed PRE score',async()=>{
 const {core}=await load(),s=state();s.result={finishOrder:[1,2,3]};core.setState(s);core.makeSnapshot();
 assert.deepEqual(core.getState().predictionSnapshot.cpsiWaveShadow.reasons,['POST_RESULT_FIELD_FORBIDDEN']);
});
test('missing or failed metric engine does not break Snapshot generation',async()=>{
 for(const options of [{enabled:false},{throws:true}]){
  const {core}=await load(options);core.setState(state());core.makeSnapshot();const s=core.getState();
  assert.equal(s.predictionSnapshot.cpsiWaveShadow.status,'HOLD');assert.equal(s.predictionSnapshot.cpsiWaveShadow.productionActivationDecision,'NO-GO');
 }
});
