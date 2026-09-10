import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {classifyPredictedTimeMissing,predictTimeFromRuns} from '../worker.js';

async function loadCore(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const memory=new Map(),window={__CHASS_TEST__:true};
  const context={window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,TextEncoder,AbortController,setTimeout,clearTimeout,parseFloat,localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});return window.CHASS_TEST;
}

test('primary and recovery success normalize to final success',async()=>{
  const c=await loadCore();
  assert.deepEqual({...c.normalizeResultFetchOutcome({primarySuccess:true,finishOrder:[2,3,7]})},{resultStatus:'success',resultOutcome:'success',resultFetchMode:'primary',finalStatus:'success_primary'});
  assert.equal(c.normalizeResultFetchOutcome({recoverySuccess:true,finishOrder:[2,3,7]}).finalStatus,'success_recovery');
  assert.equal(c.normalizeResultFetchOutcome({published:false}).resultStatus,'waiting');
  assert.equal(c.normalizeResultFetchOutcome({}).resultStatus,'retry');
});

test('result retry schedule backs off and stops after six attempts',async()=>{
  const c=await loadCore(),now=Date.parse('2026-08-31T09:00:00.000Z');
  let record={resultQueue:{attempts:0}};const mins=[];
  for(let i=0;i<5;i++){const patch=c.resultQueueRetryPatch(record,{kind:'network',now});mins.push((Date.parse(patch.nextCheckAt)-now)/60000);record={resultQueue:patch}}
  assert.deepEqual(mins,[5,5,10,15,30]);
  const final=c.resultQueueRetryPatch(record,{kind:'network',now});
  assert.equal(final.attempts,6);assert.equal(final.nextCheckAt,null);assert.equal(final.retryLimitReached,true);
});

test('unpublished and network failures remain distinct queue states',async()=>{
  const c=await loadCore(),record={resultQueue:{attempts:0}};
  assert.equal(c.resultQueueRetryPatch(record,{kind:'unpublished'}).status,'result_pending');
  assert.equal(c.resultQueueRetryPatch(record,{kind:'network'}).status,'result_retry');
});

test('TIME missing reasons are data quality states, not transport errors',()=>{
  assert.equal(classifyPredictedTimeMissing([],1400),'time_missing_no_history');
  assert.equal(classifyPredictedTimeMissing([{distance:1400,timeSec:null}],1400),'time_missing_parse');
  assert.equal(classifyPredictedTimeMissing([{distance:2000,timeSec:125}],1400),'time_missing_unknown');
  assert.equal(classifyPredictedTimeMissing([{distance:1400,timeSec:90,surface:'芝'}],1400,'ダート'),'time_missing_no_same_surface');
  assert.ok(predictTimeFromRuns([{distance:1400,timeSec:90}],1400).time);
});

test('TIME 15/16 and market 15/16 are reported as partial availability',async()=>{
  const c=await loadCore(),horses=Array.from({length:16},(_,i)=>({horseNo:i+1,abilityScore:80,predictedTime:i<15?'1:30.0':'',predictedTimeType:i<14?'実績':i===14?'補正':'',predictedTimeMissingReason:i===15?'time_missing_no_history':null,odds:i<15?3+i:null}));
  const a=c.predictionAvailability(horses);
  assert.equal(a.time,15);assert.equal(a.timeActual,14);assert.equal(a.timeAdjusted,1);assert.equal(a.market,15);assert.equal(a.timeMissing,1);assert.equal(a.missingReasons.time_missing_no_history,1);
});

test('saved result remains successful when latest refresh fails',async()=>{
  const c=await loadCore(),view=c.getResultDisplayState({race:{raceDate:'2026-08-31',track:'大井',raceNo:8},resultSnapshot:{finishOrder:[2,3,7]},resultFetchError:'network'});
  assert.equal(view.done,true);assert.equal(view.status,'fetched');assert.match(view.label,/最新更新のみ失敗/);
});

test('cloud pending is rendered as a separate post-process state',async()=>{
  const c=await loadCore(),rows=c.diagnosticRows({postFetchAudit:{success:true,cloud:'pending'}});
  assert.ok(rows.some(([key,value])=>key==='後処理・cloud'&&value==='クラウド同期待ち'));
});

test('normal NAR endpoints and prediction/volatility logic stay present',async()=>{
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),worker=await readFile(new URL('../worker.js',import.meta.url),'utf8');
  for(const route of ['/api/nar/race','/api/nar/sync','/api/nar/odds']){assert.ok(app.includes(route));assert.ok(worker.includes(route))}
  assert.match(app,/function applyPredictionAxisReinforcement/);assert.match(app,/const VOLATILITY_WEIGHTS=/);assert.match(app,/function evaluateLongshots/);
  const queue=app.slice(app.indexOf('async function runAutoResultQueue'),app.indexOf('function setAutoResult'));
  assert.match(queue,/for\(const \[id,original\]/);assert.doesNotMatch(queue,/Promise\.all/);
});
