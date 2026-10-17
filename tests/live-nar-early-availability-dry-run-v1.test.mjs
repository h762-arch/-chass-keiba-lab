import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  evaluateLiveNarEarlyAvailabilityDryRun as run,
  MAX_WAIT_MS,
  VERSION
} from '../scripts/live-nar-early-availability-dry-run-v1.mjs';

const raceId='2026-10-18|川崎|1';
const started=Date.parse('2026-10-18T00:00:10Z');
const cutoff='2026-10-18T00:00:20Z';

const appSource=String.raw`(() => {
  async function acquireNarEarlyResearchRecord({raceId,enabled=false}={}){
    if(enabled!==true)throw Error('disabled');
    const res=await fetch('/api/nar/race?code=21&date=2026-10-18&race=1',{cache:'no-store'});
    const payload=await res.json();
    const generatedAt=new Date().toISOString();
    const race={raceDate:'2026-10-18',track:'川崎',raceNo:1,postTime:'15:00'};
    const horses=payload.horses.map(h=>({horseNo:h.horseNo,horseName:h.horseName}));
    const record={
      raceId,organization:'NAR',dataCalculatedAt:generatedAt,
      layers:{
        SOURCE:{raceId,race,horses:structuredClone(horses),acquiredAt:payload.acquiredAt},
        DATA:{raceId,race:structuredClone(race),horses:structuredClone(horses),cpsi:{status:'NOT_APPLICABLE'}},
        MARKET:{raceId,acquiredAt:generatedAt},
        FINAL:{raceId,createdAt:generatedAt,ranking:horses.map((h,i)=>({horseNo:h.horseNo,rank:i+1}))},
        RESULT:payload.result??null
      }
    };
    return {
      record,
      acquiredAt:payload.acquiredAt,
      acquisitionKind:'fresh',
      sourceReceipt:{
        scope:'ALL_RUNNERS',
        raceId,
        horseNos:horses.map(h=>h.horseNo),
        capturedAt:payload.acquiredAt,
        sourceRef:'/api/nar/race?code=21&date=2026-10-18&race=1'
      }
    };
  }
  window.CHASS_TEST={acquireNarEarlyResearchRecord};
  return;
})();`;

function harness({result=null,expected=6,cutoffAt=cutoff,networkError=false,start=started}={}){
  let now=start,requests=0,slept=0;
  const payload={
    acquiredAt:new Date(start+1_000).toISOString(),
    horses:[1,2,3,4,5,6].map(horseNo=>({horseNo,horseName:`合成馬${horseNo}`})),
    result,
    privateSentinel:'DO_NOT_EMIT_PRIVATE_PAYLOAD'
  };
  const fetchImpl=async url=>{
    requests++;
    assert.equal(url,'https://example.test/api/nar/race?code=21&date=2026-10-18&race=1');
    if(networkError)throw Error('network');
    now=start+1_000;
    return {ok:true,status:200,json:async()=>structuredClone(payload)};
  };
  const sleep=async ms=>{slept+=ms;now+=ms;};
  return {
    input:{
      baseUrl:'https://example.test',
      raceId,
      freezeAt:cutoffAt,
      expectedRunnerCount:expected,
      fetchImpl,
      clock:()=>now,
      sleep,
      appSource
    },
    stats:()=>({now,requests,slept})
  };
}

test('live NAR acquisition reaches existing read-only Dry Run without any save authority',async()=>{
  const h=harness(),r=await run(h.input),s=h.stats();
  assert.equal(VERSION,'CHASS_LIVE_NAR_EARLY_AVAILABILITY_DRY_RUN_V1');
  assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');
  assert.equal(r.mappedPredictionReadiness,'FINAL5_READY_DEGRADED');
  assert.equal(r.liveCapture,true);
  assert.equal(r.acquisitionKind,'fresh');
  assert.equal(r.sourceReceiptScope,'ALL_RUNNERS');
  assert.equal(r.sourceReceiptHorseCount,6);
  assert.equal(r.saved,false);
  assert.equal(r.freezeExecuted,false);
  assert.equal(r.freezeExecutionAuthorized,false);
  assert.equal(r.formalKpiReadiness,'HOLD');
  assert.equal(r.probabilityDecision,'MODEL_HOLD');
  assert.equal(r.productionActivationDecision,'NO-GO');
  assert.equal(s.requests,1);
  assert.equal(s.slept,9_000);
  const text=JSON.stringify(r);
  assert.ok(!text.includes('DO_NOT_EMIT_PRIVATE_PAYLOAD'));
  assert.ok(!text.includes('/api/nar/race?'));
  assert.ok(!text.includes('https://example.test'));
});

test('cutoff already passed fails before any network acquisition',async()=>{
  const h=harness({cutoffAt:'2026-10-18T00:00:09Z'}),r=await run(h.input);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('CUTOFF_ALREADY_PASSED_BEFORE_CAPTURE'));
  assert.equal(h.stats().requests,0);
});

test('cutoff too far away does not turn the CLI into a long-running monitor',async()=>{
  const h=harness({cutoffAt:new Date(started+MAX_WAIT_MS+1).toISOString()}),r=await run(h.input);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('CUTOFF_TOO_FAR_FOR_LIVE_DRY_RUN'));
  assert.equal(h.stats().requests,0);
});

test('capture that completes after the declared cutoff is HOLD',async()=>{
  const h=harness({cutoffAt:new Date(started+500).toISOString()}),r=await run(h.input);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('CAPTURE_COMPLETED_AFTER_CUTOFF'));
});

test('runner coverage mismatch remains HOLD',async()=>{
  const h=harness({expected:7}),r=await run(h.input);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.length>0);
});

test('result-bearing live record cannot be laundered into a pre-start success',async()=>{
  const h=harness({result:{finishOrder:[6,5,4],private:'RESULT_PRIVATE_SENTINEL'}}),r=await run(h.input);
  assert.equal(r.status,'HOLD');
  const text=JSON.stringify(r);
  assert.ok(!text.includes('RESULT_PRIVATE_SENTINEL'));
});

test('network failure is a bounded HOLD and exposes no implementation exception',async()=>{
  const h=harness({networkError:true}),r=await run(h.input);
  assert.equal(r.status,'HOLD');
  assert.deepEqual(r.reasons,['LIVE_CAPTURE_FAILED']);
  assert.equal(h.stats().requests,1);
});

test('unsafe base URLs and malformed inputs fail before acquisition',async()=>{
  for(const bad of [
    {...harness().input,baseUrl:'http://example.test'},
    {...harness().input,baseUrl:'https://user:pass@example.test'},
    {...harness().input,expectedRunnerCount:1},
    {...harness().input,freezeAt:'2026-02-30T00:00:00Z'}
  ]){
    const r=await run(bad);
    assert.equal(r.status,'HOLD');
  }
});

// Repository review: original tests above use a replacement appSource. The
// following tests also execute the actual repository app acquisition and its
// pre-09:30 JST timer path. Network responses remain synthetic, not official.
function realPayload(){return {ok:true,raceSuccess:true,organization:'NAR',source:'NAR公式',code:'21',date:'2026-10-18',track:'川崎',race:1,postTime:'15:00',distance:1200,surface:'ダート',trackCondition:'良',acquiredAt:new Date(started+1000).toISOString(),horses:[1,2,3,4,5,6].map(horseNo=>({horseNo,horseName:`合成馬${horseNo}`,abilityWinRate:20+horseNo*5,abilityScore:60+horseNo,dataConfidence:80,predictedTime:'1:16.0',predictedTimeType:'実績',features:{evidence:{runs:3}}})),odds:[]};}
test('review: actual app + sourceReceipt + Mapping executes before 09:30 without leaving background timers',async()=>{
 const url=new URL('../scripts/live-nar-early-availability-dry-run-v1.mjs',import.meta.url).href;
 const script=`import {evaluateLiveNarEarlyAvailabilityDryRun as run} from ${JSON.stringify(url)};
 let at=${started};const payload=${JSON.stringify(realPayload())};
 const report=await run({baseUrl:'https://example.test',raceId:${JSON.stringify(raceId)},freezeAt:${JSON.stringify(cutoff)},expectedRunnerCount:6,clock:()=>at,sleep:async ms=>{at+=ms},fetchImpl:async()=>{at+=1000;return {ok:true,status:200,json:async()=>payload}}});
 process.stdout.write(JSON.stringify(report));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:8000});
 assert.equal(child.error,undefined);assert.equal(child.status,0);assert.equal(child.stderr,'');
 const r=JSON.parse(child.stdout);assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');assert.equal(r.mappedPredictionReadiness,'FINAL5_READY_DEGRADED');assert.equal(r.testAppSourceOverride,false);assert.equal(r.acquisitionCompleted,true);
 const actual=await readFile(new URL('../app.js',import.meta.url),'utf8');assert.equal(r.appSourceSha256,createHash('sha256').update(actual).digest('hex'));
});
test('review: real app rejects results in the API before snapshot construction',async()=>{
 const h=harness(),payload={...realPayload(),resultSnapshot:{finishOrder:[6,5,4],private:'PRIVATE_RESULT'}};
 delete h.input.appSource;let at=started;h.input.clock=()=>at;h.input.fetchImpl=async()=>{at+=1000;return {ok:true,status:200,json:async()=>payload};};
 const r=await run(h.input);assert.equal(r.status,'HOLD');assert.equal(r.acquisitionCompleted,false);assert.ok(!JSON.stringify(r).includes('PRIVATE_RESULT'));
});
test('review: equal cutoff is rejected before network access',async()=>{const h=harness({cutoffAt:new Date(started).toISOString()}),r=await run(h.input);assert.equal(r.status,'HOLD');assert.equal(h.stats().requests,0);});
test('review: non-current JST race is rejected before network access',async()=>{const h=harness();h.input.raceId='2026-10-17|川崎|1';const r=await run(h.input);assert.ok(r.reasons.includes('NOT_CURRENT_JST_RACE_DATE'));assert.equal(h.stats().requests,0);});
test('review: never-settling fetch is timed out and aborted',async()=>{
 const h=harness();let signal;h.input.fetchImpl=async(url,init)=>{signal=init.signal;return new Promise(()=>{});};h.input.captureTimeoutMs=20;
 const r=await run(h.input);assert.deepEqual(r.reasons,['LIVE_CAPTURE_TIMEOUT']);assert.equal(signal.aborted,true);assert.equal(r.acquisitionCompleted,false);
});
test('review: never-settling response body is covered by capture timeout',async()=>{
 const h=harness();h.input.fetchImpl=async()=>({ok:true,status:200,json:()=>new Promise(()=>{})});h.input.captureTimeoutMs=20;
 const r=await run(h.input);assert.deepEqual(r.reasons,['LIVE_CAPTURE_TIMEOUT']);
});
test('review: real fetch request is credential-free GET with redirects disabled',async()=>{
 const h=harness(),fetch=h.input.fetchImpl;h.input.fetchImpl=async(url,init)=>{assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);return fetch(url,init);};
 assert.equal((await run(h.input)).status,'LOCAL_PRESTART_MAPPING_READY');
});
for(const [name,change] of [
 ['POST',s=>s.replace("{cache:'no-store'}","{cache:'no-store',method:'POST'}")],
 ['other origin',s=>s.replace("'/api/nar/race?","'https://other.test/api/nar/race?")],
 ['other path',s=>s.replace('/api/nar/race?','/api/nar/result?')],
 ['wrong date',s=>s.replace('date=2026-10-18','date=2026-10-17')],
 ['extra query',s=>s.replace('race=1\'',"race=1&write=1'")]
])test(`review: ${name} is blocked before forwarding a fetch`,async()=>{const h=harness();h.input.appSource=change(appSource);const r=await run(h.input);assert.equal(r.status,'HOLD');assert.equal(h.stats().requests,0);});
test('review: a second app fetch is blocked',async()=>{const h=harness();h.input.appSource=appSource.replace('const payload=await res.json();',"await fetch('/api/nar/race?code=21&date=2026-10-18&race=1');const payload=await res.json();");assert.equal((await run(h.input)).status,'HOLD');assert.equal(h.stats().requests,1);});
test('review: injected redirected response cannot be accepted',async()=>{const h=harness(),fetch=h.input.fetchImpl;h.input.fetchImpl=async(...args)=>({...await fetch(...args),redirected:true});assert.equal((await run(h.input)).status,'HOLD');});
test('review: swallowed localStorage write is still detected',async()=>{
 const h=harness();h.input.appSource=appSource.replace('const generatedAt=',"try{localStorage.setItem('PRIVATE','PRIVATE')}catch{} const generatedAt=");
 const r=await run(h.input);assert.deepEqual(r.reasons,['LIVE_DRY_RUN_STORAGE_WRITE_FORBIDDEN']);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('review: a non-fresh acquisition cannot become a live success',async()=>{const h=harness();h.input.appSource=appSource.replace("acquisitionKind:'fresh'","acquisitionKind:'cached'");assert.deepEqual((await run(h.input)).reasons,['LIVE_CAPTURE_RECEIPT_INVALID']);});
test('review: clock reversal during acquisition is HOLD without waiting',async()=>{
 const h=harness();let n=0;h.input.clock=()=>++n<=2?started:started-1;const r=await run(h.input);assert.deepEqual(r.reasons,['LIVE_CAPTURE_CLOCK_INVALID']);assert.equal(h.stats().slept,0);
});
test('review: non-advancing wait clock is HOLD',async()=>{const h=harness();h.input.sleep=async()=>{};assert.deepEqual((await run(h.input)).reasons,['LIVE_CAPTURE_CLOCK_INVALID']);});
test('review: waiting is split into at most one-second steps',async()=>{const h=harness(),sleep=h.input.sleep;let count=0;h.input.sleep=async ms=>{assert.ok(ms<=1000);count++;return sleep(ms);};assert.equal((await run(h.input)).status,'LOCAL_PRESTART_MAPPING_READY');assert.equal(count,9);});
test('review: VM console messages cannot pollute the report stream',async()=>{const h=harness();h.input.appSource=appSource.replace('const generatedAt=',"console.log('PRIVATE_PAYLOAD');const generatedAt=");const r=await run(h.input);assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');assert.ok(!JSON.stringify(r).includes('PRIVATE_PAYLOAD'));});
test('review: base URL paths and timeout overrides are validated',async()=>{for(const patch of [{baseUrl:'https://example.test/path'},{captureTimeoutMs:0},{captureTimeoutMs:10001}]){const h=harness();assert.equal((await run({...h.input,...patch})).status,'HOLD');assert.equal(h.stats().requests,0);}});
test('review: CLI rejects replay flags and emits fixed authority on HOLD',()=>{const path=fileURLToPath(new URL('../scripts/live-nar-early-availability-dry-run-v1.mjs',import.meta.url));const r=spawnSync(process.execPath,[path,'--now','PRIVATE'],{encoding:'utf8',timeout:5000});assert.equal(r.status,2);assert.equal(r.stderr,'');const report=JSON.parse(r.stdout);assert.equal(report.formalKpiEligible,false);assert.equal(report.productionActivationDecision,'NO-GO');assert.ok(!r.stdout.includes('PRIVATE'));});
test('review: actual Response stream feeds the real app path',async()=>{const h=harness();delete h.input.appSource;let at=started;h.input.clock=()=>at;h.input.sleep=async ms=>{at+=ms};h.input.fetchImpl=async()=>{at+=1000;return new Response(JSON.stringify(realPayload()),{status:200});};const r=await run(h.input);assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');assert.equal(r.testAppSourceOverride,false);});
test('review: oversized response stream is rejected before app calculation',async()=>{const h=harness();h.input.fetchImpl=async()=>new Response(' '.repeat(1000001),{status:200});assert.equal((await run(h.input)).status,'HOLD');});
test('review: too many runners are rejected before app calculation',async()=>{const h=harness();h.input.fetchImpl=async()=>({ok:true,status:200,json:async()=>({...realPayload(),horses:Array.from({length:31},(_,i)=>({horseNo:i+1}))})});assert.equal((await run(h.input)).status,'HOLD');});
