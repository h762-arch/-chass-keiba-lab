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

test('scheduled order and call counts remain result, meeting, history, research, gate',async()=>{
 const calls=[];
 const once=name=>async()=>{calls.push(name);return {processed:name==='meeting'?1:0}};
 const result=await runScheduledTasks({}, {
  env:{},resultRunner:once('result'),meetingRunner:once('meeting'),historicalRunner:once('history'),researchRunner:once('research'),
  precomputeGate:async()=>{calls.push('gate');return {status:'DISABLED',enabled:false,ran:false}}
 });
 assert.deepEqual(calls,['result','meeting','history','research','gate']);
 assert.equal(result.jraMeeting.processed,1);
 assert.equal(result.precompute.status,'DISABLED');
});

test('result queue priority still skips other scheduled work before the gate',async()=>{
 const calls=[];
 const result=await runScheduledTasks({}, {
  env:{},resultRunner:async()=>{calls.push('result');return {processed:3}},
  meetingRunner:async()=>{calls.push('meeting')},historicalRunner:async()=>{calls.push('history')},researchRunner:async()=>{calls.push('research')},
  precomputeGate:async()=>{calls.push('gate');return {status:'DISABLED',enabled:false,ran:false}}
 });
 assert.deepEqual(calls,['result','gate']);
 assert.equal(result.jraMeeting.reason,'auto_result_priority');
 assert.equal(result.historical.reason,'auto_result_priority');
 assert.equal(result.research.reason,'auto_result_priority');
});

test('precompute failures are contained after existing scheduled tasks complete',async()=>{
 const direct=await runScheduledPrecomputeGate({ENABLE_BACKGROUND_PRECOMPUTE:true},{runner:async()=>{throw Object.assign(new Error('gate_boom'),{code:'gate_test_failure'})}});
 assert.deepEqual(direct,{status:'FAILED',enabled:true,ran:true,error:'gate_test_failure'});
 const calls=[];
 const result=await runScheduledTasks({}, {
  env:{ENABLE_BACKGROUND_PRECOMPUTE:true},resultRunner:async()=>{calls.push('result');return {processed:0}},meetingRunner:async()=>{calls.push('meeting');return {processed:0}},historicalRunner:async()=>{calls.push('history');return {processed:0}},researchRunner:async()=>{calls.push('research');return {processed:0}},
  precomputeGate:async()=>{calls.push('gate');throw new Error('control_plane_failure')}
 });
 assert.deepEqual(calls,['result','meeting','history','research','gate']);
 assert.deepEqual(result.precompute,{status:'FAILED',enabled:true,ran:false,error:'control_plane_failure'});
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
 assert.match(wrangler,/"ENABLE_BACKGROUND_PRECOMPUTE"\s*:\s*"false"/);
 assert.match(wrangler,/"ENABLE_PRECOMPUTED_VIEWER"\s*:\s*"false"/);
});
