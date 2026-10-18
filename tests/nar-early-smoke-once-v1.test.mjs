import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planNarSmokeOnce,runNarSmokeOnce,BASE_URL,CHILD_TIMEOUT_MS} from '../scripts/run-live-nar-early-smoke-once-v1.mjs';

const commit='b'.repeat(40),at=Date.parse('2026-10-18T09:00:00Z');
const input={'--race-id':'2026-10-18|高知|7','--post-at':'2026-10-18T18:40:00+09:00','--expected-runner-count':'12','--expected-commit':commit};
const args=x=>Object.entries(x).flat();
const report={status:'HOLD',reasons:['LIVE_CAPTURE_FAILED'],saved:false,freezeExecuted:false,
 formalKpiReadiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
function harness(){
 let calls=0,launches=0,clockCalls=0;let captured;
 return {deps:{clock:()=>at+(clockCalls++?100:0),
  readFileImpl:async path=>String(path).endsWith('wrangler.jsonc')?JSON.stringify({vars:{CHASS_PUBLIC_ORIGIN:BASE_URL}}):'APP_BYTES',
  execImpl:(cmd,a)=>a[0]==='rev-parse'?commit:'',
  onLaunch:m=>{launches++;assert.equal(calls,0);assert.equal(m.freezeAt,'2026-10-18T09:00:30.000Z');},
  spawnImpl:(cmd,a,options)=>{calls++;captured={cmd,args:a,options};return {status:2,stdout:JSON.stringify(report),stderr:'PRIVATE_CHILD_STDERR'};}
 },stats:()=>({calls,launches,captured})};
}
test('one-shot: pins one +30 second cutoff and delegates exact original runner CLI once',async()=>{
 const h=harness(),r=await runNarSmokeOnce(args(input),h.deps),s=h.stats();
 assert.equal(r.status,'HOLD');assert.equal(s.calls,1);assert.equal(s.launches,1);
 assert.deepEqual(s.captured.args,['scripts/live-nar-early-availability-dry-run-v1.mjs','--base-url',BASE_URL,'--race-id',input['--race-id'],'--freeze-at','2026-10-18T09:00:30.000Z','--expected-runner-count','12']);
 assert.equal(s.captured.options.timeout,CHILD_TIMEOUT_MS);assert.equal(s.captured.options.shell,undefined);
 assert.equal(r.execution.runnerExitCode,2);assert.equal(r.execution.acquisitionInputSha256,null);
 assert.match(r.execution.appSourceSha256,/^[a-f0-9]{64}$/);assert.match(r.execution.invocationSha256,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(r.productionActivationDecision,'NO-GO');
});
for(const [name,change,reason] of [
 ['past date',{'--race-id':'2026-10-17|高知|7'},'NOT_CURRENT_JST_RACE_DATE'],
 ['after post',{'--post-at':'2026-10-18T17:59:00+09:00'},'NOT_PRESTART_AT_LAUNCH'],
 ['too near post',{'--post-at':'2026-10-18T18:00:30+09:00'},'INSUFFICIENT_PRESTART_WINDOW'],
 ['wrong post date',{'--post-at':'2026-10-19T18:40:00+09:00'},'POST_DATE_CONFLICT'],
 ['wrong commit',{'--expected-commit':'c'.repeat(40)},'COMMIT_MISMATCH'],
 ['invalid runner count',{'--expected-runner-count':'31'},'ONE_SHOT_INPUT_INVALID']
])test(`one-shot: ${name} is HOLD without child launch`,async()=>{
 const h=harness(),r=await runNarSmokeOnce(args({...input,...change}),h.deps);
 assert.deepEqual(r.reasons,[reason]);assert.equal(h.stats().calls,0);
});
test('one-shot: dirty worktree is rejected before child launch',async()=>{
 const h=harness();h.deps.execImpl=(cmd,a)=>a[0]==='rev-parse'?commit:' M app.js';
 const r=await runNarSmokeOnce(args(input),h.deps);assert.deepEqual(r.reasons,['WORKTREE_NOT_CLEAN']);assert.equal(h.stats().calls,0);
});
test('one-shot: changed origin is rejected rather than routed elsewhere',async()=>{
 const h=harness();h.deps.readFileImpl=async()=>'{"CHASS_PUBLIC_ORIGIN":"https://private.invalid"}';
 assert.deepEqual((await runNarSmokeOnce(args(input),h.deps)).reasons,['BASE_ORIGIN_NOT_CONFIRMED']);assert.equal(h.stats().calls,0);
});
test('one-shot: child timeout never retries or emits partial stdout',async()=>{
 const h=harness();let calls=0;h.deps.spawnImpl=()=>{calls++;return {error:{code:'ETIMEDOUT'},stdout:'PRIVATE_RAW',stderr:'PRIVATE_RAW',signal:'SIGTERM'}};
 const r=await runNarSmokeOnce(args(input),h.deps);assert.deepEqual(r.reasons,['CHILD_PROCESS_TIMEOUT']);assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('one-shot: malformed child JSON is not exposed or repaired',async()=>{
 const h=harness();h.deps.spawnImpl=()=>({status:2,stdout:'PRIVATE_RAW',stderr:''});
 const r=await runNarSmokeOnce(args(input),h.deps);assert.deepEqual(r.reasons,['RUNNER_JSON_INVALID']);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('one-shot: exit-code mismatch is HOLD',async()=>{
 const h=harness();h.deps.spawnImpl=()=>({status:0,stdout:JSON.stringify(report)});
 assert.deepEqual((await runNarSmokeOnce(args(input),h.deps)).reasons,['RUNNER_EXIT_CONFLICT']);
});
test('one-shot: success preserves DEGRADED and fixed hold authorities',async()=>{
 const h=harness();h.deps.spawnImpl=()=>({status:0,stdout:JSON.stringify({...report,status:'LOCAL_PRESTART_MAPPING_READY',mappedPredictionReadiness:'FINAL5_READY_DEGRADED',snapshotSha256:'a'.repeat(64)})});
 const r=await runNarSmokeOnce(args(input),h.deps);assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');assert.equal(r.runnerReport.mappedPredictionReadiness,'FINAL5_READY_DEGRADED');
 assert.equal(r.execution.acquisitionInputSha256,'a'.repeat(64));assert.equal(r.formalKpiReadiness,'HOLD');
});
test('one-shot: CLI has no replay, base URL override or test override flag',()=>{
 const path=fileURLToPath(new URL('../scripts/run-live-nar-early-smoke-once-v1.mjs',import.meta.url));
 const child=spawnSync(process.execPath,[path,'--now','PRIVATE'],{encoding:'utf8',timeout:5000});
 assert.equal(child.status,2);assert.equal(child.stderr,'');assert.deepEqual(JSON.parse(child.stdout).reasons,['ONE_SHOT_ARGUMENTS_INVALID']);assert.ok(!child.stdout.includes('PRIVATE'));
});
