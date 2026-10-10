import test from 'node:test';
import assert from 'node:assert/strict';
import {runJraMarketQueue} from '../src/prediction/jra-market-queue.mjs';
import {createJraMarketQueueWorkerRunner} from '../src/prediction/jra-market-queue-worker.mjs';
const jobs=Array.from({length:24},(_,i)=>({organization:'JRA',date:'2026-10-10',track:i<12?'東京':'京都',raceNo:i%12+1,raceId:`20261010-JRA-${i<12?'東京':'京都'}-${String(i%12+1).padStart(2,'0')}`}));
function setup(overrides={}){
 const events=[],calls=[];let time=0;
 const options={enabled:true,jobs,selectionTurn:0,runId:'run-1',maxInspections:24,maxAttempts:24,deadline:5000,now:()=>time,
  inspect:async()=>({reason:'READY'}),runner:async j=>{calls.push(j.raceId);time+=10;return {status:'FROZEN',saved:true}},record:async e=>{events.push(e)},...overrides};
 return {events,calls,options,run:()=>runJraMarketQueue(options),tick:t=>{time=t}};
}
test('OFF performs zero clock, inspection, runner and recorder calls',async()=>{
 const forbidden=()=>assert.fail('OFF must be inert');
 assert.equal((await runJraMarketQueue({enabled:false,now:forbidden,inspect:forbidden,runner:forbidden,record:forbidden})).status,'DISABLED');
 assert.equal(createJraMarketQueueWorkerRunner({}),undefined);
});
test('all 24 races can Freeze in one invocation independent of DATA caps',async()=>{
 const s=setup(),r=await s.run();assert.equal(r.savedCount,24);assert.equal(s.calls.length,24);
 assert.equal(s.events.filter(e=>e.phase==='TERMINAL').length,24);
 assert.equal(s.events.filter(e=>e.phase==='ATTEMPT_STARTED').length,24);
 for(const e of s.events.filter(e=>e.phase==='TERMINAL')){assert.equal(e.selected,true);assert.equal(e.reason,'FROZEN');assert.equal(e.runnerElapsedMs,10)}
});
test('already frozen races consume no attempt cap and unfrozen races fill available slots',async()=>{
 const s=setup({maxAttempts:2,inspect:async j=>({reason:j.raceNo===12?'READY':'ALREADY_FROZEN'})});
 const r=await s.run();assert.equal(r.savedCount,2);assert.equal(s.calls.length,2);assert.equal(s.events.filter(e=>e.reason==='ALREADY_FROZEN').length,22);
});
test('HOLD falls through to following eligible races while honoring the separate attempt cap',async()=>{
 let count=0;const s=setup({maxAttempts:3,runner:async()=>++count===1?{status:'HOLD',reason:'ODDS_INCOMPLETE',saved:false}:{status:'FROZEN',saved:true}});
 const r=await s.run();assert.equal(r.attemptedCount,3);assert.equal(r.savedCount,2);
 assert.equal(s.events.filter(e=>e.reason==='NOT_SELECTED_LIMIT').length,21);
 assert.equal(s.events.filter(e=>e.reason==='ODDS_INCOMPLETE').length,1);
});
test('DATA and pre-race eligibility reasons are distinct and do not invoke MARKET runner',async()=>{
 const s=setup({inspect:async j=>({reason:['DATA_MISSING','POST_TIME_UNKNOWN','POST_TIME_REACHED','DATA_IDENTITY'][(j.raceNo-1)%4]})});
 assert.equal((await s.run()).attemptedCount,0);assert.equal(s.calls.length,0);
 for(const reason of ['DATA_MISSING','POST_TIME_UNKNOWN','POST_TIME_REACHED','DATA_IDENTITY'])assert.equal(s.events.filter(e=>e.reason===reason).length,6);
});
test('inspection cap labels uninspected races instead of claiming missing odds',async()=>{
 const s=setup({maxInspections:4});const r=await s.run();assert.equal(r.savedCount,4);
 assert.equal(s.events.filter(e=>e.reason==='NOT_SELECTED_INSPECTION_LIMIT').length,20);
});
test('deadline before inspection yields 24 explicit unselected outcomes and no runner',async()=>{
 const s=setup({deadline:0});assert.equal((await s.run()).attemptedCount,0);
 assert.equal(s.events.filter(e=>e.reason==='NOT_SELECTED_DEADLINE').length,24);
});
test('deadline reached after attempt-start journal prevents MARKET invocation',async()=>{
 const s=setup({jobs:jobs.slice(0,1),deadline:100});s.options.record=async e=>{s.events.push(e);if(e.phase==='ATTEMPT_STARTED')s.tick(100)};
 const r=await s.run();assert.equal(r.attemptedCount,0);assert.equal(s.events.at(-1).reason,'DEADLINE');assert.equal(s.calls.length,0);
});
test('audit failure before STARTED prevents any MARKET save',async()=>{
 const s=setup();s.options.record=async e=>{if(e.phase==='ATTEMPT_STARTED')throw Error('write failed');s.events.push(e)};
 const r=await s.run();assert.equal(r.status,'INTERRUPTED');assert.equal(s.calls.length,0);
});
test('audit failure after successful save retains unresolved STARTED evidence',async()=>{
 const s=setup({jobs:jobs.slice(0,1)});s.options.record=async e=>{if(e.phase==='TERMINAL')throw Error('write failed');s.events.push(e)};
 const r=await s.run();assert.equal(r.status,'INTERRUPTED');assert.equal(r.savedCount,1);assert.equal(s.events.at(-1).phase,'ATTEMPT_STARTED');assert.equal(s.events.at(-1).saved,null);
});
test('runner failures and save conflicts are recorded; later candidates continue',async()=>{
 let n=0;const s=setup({maxAttempts:3,runner:async()=>{n++;if(n===1)throw Error('private raw error');return n===2?{status:'HOLD',reason:'MARKET_SAVE_CONFLICT'}:{status:'FROZEN',saved:true}}});
 const r=await s.run();assert.equal(r.savedCount,1);assert.ok(s.events.some(e=>e.reason==='RUNNER_FAILED'));assert.ok(s.events.some(e=>e.reason==='SAVE_CONFLICT'));
 assert.equal(s.events.find(e=>e.reason==='RUNNER_FAILED').saved,null);
 assert.ok(!JSON.stringify(s.events).includes('private raw error'));
});
test('single-inspection rotation eventually reaches all 24 independent candidates',async()=>{
 const seen=new Set();for(let turn=0;turn<24;turn++){const s=setup({selectionTurn:turn,maxInspections:1,maxAttempts:1});await s.run();seen.add(s.calls[0])}assert.equal(seen.size,24);
});
test('duplicate jobs and missing limits fail before any audit I/O',async()=>{
 const s=setup({jobs:[jobs[0],jobs[0]]});await assert.rejects(s.run());assert.equal(s.events.length,0);
 const b=setup({maxAttempts:undefined});await assert.rejects(b.run());assert.equal(b.events.length,0);
});
test('Worker refuses parallel legacy bridge and requires explicit MARKET limits',async()=>{
 const DB={prepare(){assert.fail('invalid settings must not query DB')}};
 await assert.rejects(createJraMarketQueueWorkerRunner({ENABLE_JRA_MARKET_QUEUE:'true',ENABLE_JRA_PRECOMPUTED_MARKET_BRIDGE:'true',DB})(),/legacy_bridge_off/);
 await assert.rejects(createJraMarketQueueWorkerRunner({ENABLE_JRA_MARKET_QUEUE:'true',JRA_PRECOMPUTE_SOURCE_MODE:'official-cache',DB})(),/explicit_limits/);
});
