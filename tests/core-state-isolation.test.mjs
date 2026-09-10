import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function core(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const window={__CHASS_TEST__:true};
  const document={getElementById(){return null},querySelector(){return null},querySelectorAll(){return []}};
  const context={window,document,localStorage:{getItem(){return null},setItem(){}},console,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});return window.CHASS_TEST;
}

test('JRA/NAR transient validation state clears without deleting prediction data',async()=>{
  const c=await core(),record={race:{raceType:'JRA'},horses:[{horseNo:1,actualTime:'1:59.6'}],predictionSnapshot:{horses:[{horseNo:1}]},marketSnapshot:{horses:[]},finalSnapshot:{top3:[]},result:{finishOrder:[1,2,3]},resultSnapshot:{finishOrder:[1,2,3]},validationSnapshot:{ok:true},actualTimes:{1:'1:59.6'},actualWeather:'雨',actualTrackCondition:'稍重',validated:true,validationCompleted:true};
  const prediction=record.predictionSnapshot;c.clearValidationTransient(record);
  assert.equal(record.predictionSnapshot,prediction);assert.equal(record.result,null);assert.equal(record.resultSnapshot,null);assert.equal(record.validationSnapshot,null);assert.equal(Object.keys(record.actualTimes).length,0);assert.equal(record.validated,false);assert.equal(record.horses[0].actualTime,undefined);
});

test('saved Result Snapshot alone restores actual times',async()=>{
  const c=await core(),saved={race:{raceType:'NAR'},actualTimes:{1:'9:99.9'},resultSnapshot:{finishOrder:[1,2,3],actualTimes:{1:'1:20.1'}}},restored=c.restoreSavedRace(saved);
  assert.equal(restored.actualTimes[1],'1:20.1');assert.notEqual(restored,saved);
});

test('result fetch is blocked before known post time and allowed after it',async()=>{
  const c=await core(),race={raceDate:'2026-09-07',postTime:'15:00'};
  assert.equal(c.resultFetchReadiness(race,Date.parse('2026-09-07T05:59:59Z')).allowed,false);
  assert.equal(c.resultFetchReadiness(race,Date.parse('2026-09-07T06:00:00Z')).allowed,true);
  assert.equal(c.resultFetchReadiness({raceDate:'2026-09-07',postTime:''}).reason,'post_time_unknown');
});
