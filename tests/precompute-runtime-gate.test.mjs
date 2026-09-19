import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runScheduledPrecomputeGate,runScheduledTasks} from '../worker.js';

test('precompute gate defaults disabled and never invokes its runner',async()=>{
 let calls=0;
 const result=await runScheduledPrecomputeGate({}, {runner:async()=>{calls++;return {ok:true}}});
 assert.deepEqual(result,{status:'DISABLED',enabled:false,ran:false});
 assert.equal(calls,0);
});

test('false precompute flags produce zero runner, D1 and external fetch I/O',async()=>{
 for(const flag of [false,'false']){
  const io={runner:0,read:0,write:0,fetch:0,source:0,calculate:0};
  const DB={prepare(){io.read++;return this},run(){io.write++}};
  const result=await runScheduledPrecomputeGate({ENABLE_BACKGROUND_PRECOMPUTE:flag,DB},{runner:async()=>{
   io.runner++;DB.prepare('SELECT 1');await DB.run();io.fetch++;io.source++;io.calculate++;
  }});
  assert.deepEqual(result,{status:'DISABLED',enabled:false,ran:false});
  assert.deepEqual(io,{runner:0,read:0,write:0,fetch:0,source:0,calculate:0});
 }
});

test('enabled gate without a configured runner returns NOT_CONFIGURED safely',async()=>{
 assert.deepEqual(await runScheduledPrecomputeGate({ENABLE_BACKGROUND_PRECOMPUTE:true}),{status:'NOT_CONFIGURED',enabled:true,ran:false});
 assert.deepEqual(await runScheduledPrecomputeGate({ENABLE_BACKGROUND_PRECOMPUTE:'true'}),{status:'NOT_CONFIGURED',enabled:true,ran:false});
});

test('enabled gate suppresses its runner when result priority is active',async()=>{
 let calls=0;
 const result=await runScheduledPrecomputeGate({ENABLE_BACKGROUND_PRECOMPUTE:true},{suppressionReason:'auto_result_priority',runner:async()=>calls++});
 assert.deepEqual(result,{status:'SUPPRESSED',enabled:true,ran:false,reason:'auto_result_priority'});
 assert.equal(calls,0);
});

test('scheduled order and call counts remain result, meeting, history, research, runner',async()=>{
 const calls=[];
 const once=name=>async()=>{calls.push(name);return {processed:name==='meeting'?1:0}};
 const result=await runScheduledTasks({}, {
  env:{ENABLE_BACKGROUND_PRECOMPUTE:true},resultRunner:once('result'),meetingRunner:once('meeting'),historicalRunner:once('history'),researchRunner:once('research'),
  precomputeRunner:async()=>{calls.push('runner');return {ok:true}}
 });
 assert.deepEqual(calls,['result','meeting','history','research','runner']);
 assert.equal(result.jraMeeting.processed,1);
 assert.equal(result.precompute.status,'COMPLETED');
 assert.deepEqual(result.precompute.result,{ok:true});
});

test('custom gate injection receives the runner only after existing scheduled work',async()=>{
 const calls=[];
 const result=await runScheduledTasks({}, {
  env:{ENABLE_BACKGROUND_PRECOMPUTE:true},resultRunner:async()=>{calls.push('result');return {processed:0}},
  meetingRunner:async()=>{calls.push('meeting');return {processed:0}},historicalRunner:async()=>{calls.push('history');return {processed:0}},researchRunner:async()=>{calls.push('research');return {processed:0}},
  precomputeRunner:async()=>{calls.push('runner');return {ok:true}},
  precomputeGate:async(_env,{runner})=>{calls.push('gate');return {status:'COMPLETED',enabled:true,ran:true,result:await runner()}}
 });
 assert.deepEqual(calls,['result','meeting','history','research','gate','runner']);
 assert.equal(result.precompute.status,'COMPLETED');
});

test('result priority suppresses runner, custom gate and all precompute IO',async()=>{
 const calls=[],io={runner:0,read:0,write:0,fetch:0,source:0,calculate:0};
 const DB={prepare(){io.read++;return this},run(){io.write++}};
 const result=await runScheduledTasks(DB, {
  env:{ENABLE_BACKGROUND_PRECOMPUTE:true},resultRunner:async()=>{calls.push('result');return {processed:3}},
  meetingRunner:async()=>{calls.push('meeting')},historicalRunner:async()=>{calls.push('history')},researchRunner:async()=>{calls.push('research')},
  precomputeRunner:async()=>{io.runner++;DB.prepare('SELECT 1');await DB.run();io.fetch++;io.source++;io.calculate++},
  precomputeGate:async(_env,{runner})=>{calls.push('gate');return runner()}
 });
 assert.deepEqual(calls,['result']);
 assert.deepEqual(io,{runner:0,read:0,write:0,fetch:0,source:0,calculate:0});
 assert.equal(result.jraMeeting.reason,'auto_result_priority');
 assert.equal(result.historical.reason,'auto_result_priority');
 assert.equal(result.research.reason,'auto_result_priority');
 assert.deepEqual(result.precompute,{status:'SUPPRESSED',enabled:true,ran:false,reason:'auto_result_priority'});
});

test('disabled flag takes precedence over result-priority suppression and custom injection',async()=>{
 for(const flag of [undefined,false,'false']){
  let gateCalls=0,runnerCalls=0;
  const result=await runScheduledTasks({}, {
   env:flag===undefined?{}:{ENABLE_BACKGROUND_PRECOMPUTE:flag},resultRunner:async()=>({processed:3}),
   precomputeRunner:async()=>runnerCalls++,precomputeGate:async()=>{gateCalls++;return {status:'unexpected'}}
  });
  assert.deepEqual(result.precompute,{status:'DISABLED',enabled:false,ran:false});
  assert.equal(gateCalls,0);
  assert.equal(runnerCalls,0);
 }
});

test('processed below result priority keeps all existing calls and runs precompute once',async()=>{
 const calls=[];
 const result=await runScheduledTasks({}, {
  env:{ENABLE_BACKGROUND_PRECOMPUTE:true},resultRunner:async()=>{calls.push('result');return {processed:2}},meetingRunner:async()=>{calls.push('meeting');return {processed:0}},historicalRunner:async()=>{calls.push('history');return {processed:0}},researchRunner:async()=>{calls.push('research');return {processed:0}},precomputeRunner:async()=>{calls.push('runner');return {ok:true}}
 });
 assert.deepEqual(calls,['result','meeting','history','research','runner']);
 assert.equal(result.precompute.status,'COMPLETED');
});

test('precompute failures are contained after existing scheduled tasks complete',async()=>{
 const direct=await runScheduledPrecomputeGate({ENABLE_BACKGROUND_PRECOMPUTE:true},{runner:async()=>{throw Object.assign(new Error('gate_boom'),{code:'gate_test_failure'})}});
 assert.deepEqual(direct,{status:'FAILED',enabled:true,ran:true,error:'gate_test_failure'});
 const calls=[];
 const result=await runScheduledTasks({}, {
  env:{ENABLE_BACKGROUND_PRECOMPUTE:true},resultRunner:async()=>{calls.push('result');return {processed:0}},meetingRunner:async()=>{calls.push('meeting');return {processed:0}},historicalRunner:async()=>{calls.push('history');return {processed:0}},researchRunner:async()=>{calls.push('research');return {processed:0}},
  precomputeRunner:async()=>{throw new Error('runner_failure')},
  precomputeGate:async()=>{calls.push('gate');throw new Error('control_plane_failure')}
 });
 assert.deepEqual(calls,['result','meeting','history','research','gate']);
 assert.deepEqual(result.precompute,{status:'FAILED',enabled:true,ran:false,error:'control_plane_failure'});
 assert.equal(result.autoResult.processed,0);
 assert.equal(result.jraMeeting.processed,0);
 assert.equal(result.historical.processed,0);
 assert.equal(result.research.processed,0);
});

test('production scheduled wiring remains control-plane only with flags off',async()=>{
 const [worker,entry,wrangler]=await Promise.all([
  readFile(new URL('../worker.js',import.meta.url),'utf8'),
  readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8')
 ]);
 assert.match(worker,/backgroundPrecomputeEnabled/);
 assert.doesNotMatch(worker,/runRacePrecomputeJob|savePrecomputedSnapshot|runMarketRevision|runFinalizationRevision|runResultRevision/);
 assert.doesNotMatch(entry,/precomput/i);
 assert.match(entry,/controller\?\.cron==='0 11 \* \* \*'/);
 assert.match(entry,/controller\?\.cron==='30 11 \* \* \*'/);
 assert.match(entry,/baseWorker\.scheduled/);
 assert.match(wrangler,/"ENABLE_BACKGROUND_PRECOMPUTE"\s*:\s*"false"/);
 assert.match(wrangler,/"ENABLE_PRECOMPUTED_VIEWER"\s*:\s*"false"/);
});
