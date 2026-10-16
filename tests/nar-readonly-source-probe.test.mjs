import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {versionedSaveFixture} from './fixtures/nar/phase1409-versioned-save-fixtures.mjs';
import {runNarReadOnlySourceProbe as run,runNarReadOnlySourceProbeWithControl as compare,narProbeExecutionContext as context} from '../scripts/run-nar-readonly-source-probe.mjs';
import {observeNarProductionMeetingControl as control} from '../src/research/nar-production-meeting-control.mjs';
const date='2026-10-16',now=Date.parse('2026-10-15T22:00:00.000Z'),sha='1'.repeat(40);
const args=['--date',date,'--code','21','--race','1'];
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'h762-arch/-chass-keiba-lab',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:sha,GITHUB_RUN_ID:'123456789',GITHUB_RUN_ATTEMPT:'2'});
const page=url=>{const u=new URL(url);if(u.searchParams.get('k_babaCode')==='21'){u.searchParams.set('k_babaCode','22');return versionedSaveFixture(u.toString()).replaceAll('金沢','川崎').replaceAll('k_babaCode=22','k_babaCode=21');}return versionedSaveFixture(u.toString());};
const html=text=>new Response(text,{headers:{'content-type':'text/html'}});
const options=()=>({wallNow:()=>now,fetchImpl:async url=>html(page(url))});

test('real existing parsers observe meeting-to-card and stop before separate direct inspection',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('GLOBAL_FETCH_FORBIDDEN');});const calls=[];
 const r=await run(args,{...options(),fetchImpl:async(url,init)=>{calls.push({url,init});return html(page(url));}});
 assert.equal(r.status,'MEETING_TO_CARD_OBSERVED');assert.equal(r.requestCount,2);assert.equal(r.directCard,null);assert.equal(calls.length,2);
 assert.ok(calls[0].url.includes('/RaceList?'));assert.ok(calls[1].url.includes('/DebaTableSmall?'));assert.equal(r.preflight.meeting.selectedRaceLinkMatched,true);
 for(const c of calls){assert.equal(c.init.method,'GET');assert.equal(c.init.redirect,'manual');assert.equal(c.init.credentials,'omit');}
 assert.equal(r.directCardStatus,'NOT_PERFORMED_STOPPED_AFTER_PREFLIGHT_SUCCESS');
});
test('meeting HTTP failure permits one independent direct check but never fabricates meeting success',async()=>{
 const calls=[];const r=await run(args,{...options(),fetchImpl:async url=>{calls.push(url);return url.includes('/RaceList?')?new Response('',{status:404}):html(page(url));}});
 assert.equal(r.status,'DIRECT_CARD_ONLY_OBSERVED');assert.equal(r.meetingToCardStatus,'NOT_OBSERVED');assert.equal(r.preflight.meeting,null);
 assert.deepEqual(r.preflight.reasonCodes,['SOURCE_HTTP']);assert.equal(r.directCard.meetingVerified,false);assert.equal(r.directCard.status,'DIRECT_CARD_PARSE_OBSERVED');assert.equal(r.requestCount,2);assert.equal(calls.length,2);
});
test('card failure after valid meeting gets only one separate card inspection: maximum three GETs',async()=>{
 let n=0;const calls=[];const r=await run(args,{...options(),fetchImpl:async url=>{calls.push(url);return ++n===2?new Response('',{status:404}):html(page(url));}});
 assert.equal(r.status,'DIRECT_CARD_ONLY_OBSERVED');assert.equal(r.preflight.status,'HOLD');assert.equal(r.requestCount,3);assert.equal(calls.length,3);assert.equal(calls[1],calls[2]);
});
test('unavailable sources remain HOLD without sweep, retry or alternate URLs',async()=>{
 const calls=[];const r=await run(args,{...options(),fetchImpl:async url=>{calls.push(url);return new Response('',{status:404});}});
 assert.equal(r.status,'HOLD');assert.deepEqual(r.reasonCodes,['NO_CARD_PARSE_OBSERVED']);assert.equal(r.requestCount,2);assert.equal(calls.length,2);assert.equal(r.directCard.card,null);
 for(const url of calls)assert.equal(new URL(url).origin,'https://www.keiba.go.jp');
});
test('observed card is never promoted to production collection or formal probability',async()=>{
 for(const fetchImpl of [options().fetchImpl,async()=>new Response('',{status:404})]){
  const r=await run(args,{...options(),fetchImpl});assert.equal(r.acquisitionCertified,false);assert.equal(r.currentStatusEligible,false);assert.equal(r.formalKpiEligible,false);
  assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.productionSourceChanged,false);assert.equal(r.snapshotCreated,false);
  assert.equal(r.collectionStatus,'NOT_EVALUATED');assert.equal(r.mirrorFreshness,'NOT_EVALUATED');assert.equal(r.savedDataVerification,'NOT_PERFORMED');assert.equal(r.workerReplay,'NOT_PERFORMED');assert.equal(r.production404Cause,'NOT_ESTABLISHED');
 }
});
test('local declaration has no fabricated Actions run URL or source SHA',async()=>{
 const r=await run(args,options());assert.deepEqual(r.execution,{executionEnvironment:'LOCAL_DECLARED',sourceSha:null,runUrl:null});
});
test('Actions declaration records exact run, attempt and checked-out source metadata only',async()=>{
 const r=await run(args,{...options(),env:{...env(),SECRET_TOKEN:'PRIVATE_SECRET'}});
 assert.deepEqual(r.execution,{executionEnvironment:'GITHUB_ACTIONS_DECLARED',sourceSha:sha,runId:'123456789',runAttempt:'2',runUrl:'https://github.com/h762-arch/-chass-keiba-lab/actions/runs/123456789'});
 assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('invalid Actions repository, ref, event or identifiers stop before all network',async()=>{
 assert.equal(context(null),null);assert.equal(context([]),null);assert.equal(context({...env(),GITHUB_RUN_ID:123}),null);
 for(const patch of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'PRIVATE_SECRET'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_EVENT_NAME:'schedule'},{GITHUB_SHA:'main'},{GITHUB_RUN_ID:'0'},{GITHUB_RUN_ID:'bad'},{GITHUB_RUN_ATTEMPT:'0'}]){
  let calls=0;const r=await run(args,{...options(),env:{...env(),...patch},fetchImpl:async()=>{calls++;}});assert.deepEqual(r.reasonCodes,['EXECUTION_CONTEXT_INVALID']);assert.equal(r.execution,null);assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('no historical or future date can dispatch official requests',async()=>{
 for(const d of ['2026-10-15','2026-10-17']){let calls=0;const r=await run(['--date',d,'--code','21','--race','1'],{...options(),fetchImpl:async()=>{calls++;}});assert.deepEqual(r.reasonCodes,['CURRENT_JST_DATE_REQUIRED']);assert.equal(calls,0);}
});
test('malformed or extra CLI identities, URLs, credentials and save flags cause zero GETs',async()=>{
 for(const input of [null,[],['--date','2026-02-30','--code','21','--race','1'],['--date',date,'--code','021','--race','1'],['--date',date,'--code','99','--race','1'],['--date',date,'--code','21','--race','01'],['--date',date,'--code','21','--race','21'],[...args,'--url','https://example.invalid'],[...args,'--token','PRIVATE_SECRET'],[...args,'--save'],[...args,'--now','0']]){
  let calls=0;const r=await run(input,{...options(),fetchImpl:async()=>{calls++;}});assert.deepEqual(r.reasonCodes,['CLI_ARGUMENTS_INVALID']);assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('invalid callable configuration causes zero requests',async()=>{
 assert.deepEqual((await run(['--date',date,'--code','21','--race',1],options())).reasonCodes,['CLI_ARGUMENTS_INVALID']);
 for(const patch of [{fetchImpl:null},{wallNow:null}])assert.deepEqual((await run(args,{...options(),...patch})).reasonCodes,['CLI_ARGUMENTS_INVALID']);
});
test('22 and 23 routing uses the unchanged real fixture parser identities',async()=>{
 for(const [code,track] of [['22','金沢'],['23','笠松']]){const r=await run(['--date',date,'--code',code,'--race','1'],options());assert.equal(r.status,'MEETING_TO_CARD_OBSERVED');assert.equal(r.preflight.card.track,track);}
});
test('clock is shared across both existing tools and fails on between-stage regression',async()=>{
 let n=0,calls=0;const r=await run(args,{...options(),wallNow:()=>++n<4?now:now-1,fetchImpl:async()=>{calls++;return new Response('',{status:404});}});
 assert.deepEqual(r.reasonCodes,['CLOCK_INVALID']);assert.equal(calls,1);assert.equal(r.requestCount,1);
});
test('invalid initial clock never reaches a source',async()=>{
 let calls=0;const r=await run(args,{...options(),wallNow:()=>NaN,fetchImpl:async()=>{calls++;}});assert.deepEqual(r.reasonCodes,['CLOCK_INVALID']);assert.equal(calls,0);
});
test('date rollover after failed meeting cannot start the separate card GET',async()=>{
 let n=0,calls=0;const next=Date.parse('2026-10-16T15:00:00.000Z');
 const r=await run(args,{...options(),wallNow:()=>++n<5?next-1:next,fetchImpl:async()=>{calls++;return new Response('',{status:404});}});
 assert.equal(r.status,'HOLD');assert.equal(calls,1);assert.equal(r.requestCount,1);
});
test('completion at post time cannot report meeting-to-card observation',async()=>{
 const post=Date.parse('2026-10-16T06:00:00.000Z');const r=await run(args,{...options(),wallNow:()=>post});assert.equal(r.status,'HOLD');assert.ok(r.preflight.reasonCodes.includes('POST_TIME_REACHED'));assert.ok(r.directCard.reasonCodes.includes('POST_TIME_REACHED'));assert.equal(r.requestCount,3);
});
test('untrusted HTML and exceptions are absent from nested output',async()=>{
 const r=await run(args,{...options(),fetchImpl:async url=>html(page(url)+'<script>PRIVATE_SECRET</script>')});assert.equal(r.status,'MEETING_TO_CARD_OBSERVED');
 for(const s of ['PRIVATE_SECRET','合成22試験','abilityScore','predictedTime'])assert.equal(JSON.stringify(r).includes(s),false);
 const failed=await run(args,{...options(),fetchImpl:async()=>{throw Error('PRIVATE_SECRET');}});assert.equal(failed.status,'HOLD');assert.equal(JSON.stringify(failed).includes('PRIVATE_SECRET'),false);
});
test('wrong card identity remains HOLD in both real reader paths',async()=>{
 const r=await run(args,{...options(),fetchImpl:async url=>html(url.includes('/DebaTableSmall?')?page(url).replace('第1競走','第2競走'):page(url))});assert.equal(r.status,'HOLD');assert.deepEqual(r.preflight.reasonCodes,['CARD_IDENTITY_INVALID']);assert.deepEqual(r.directCard.reasonCodes,['CARD_IDENTITY_INVALID']);
});
test('executable creates exact JSON evidence plus a matching separate digest on HOLD',()=>{
 const cwd=mkdtempSync(path.join(tmpdir(),'chass-probe-'));try{
  const child=spawnSync(process.execPath,[path.resolve('scripts/run-nar-readonly-source-probe.mjs')],{cwd,env:{},encoding:'utf8'});assert.equal(child.status,1);
  const bytes=readFileSync(path.join(cwd,'artifacts/nar-readonly-source-probe.json'));assert.equal(bytes.toString(),child.stdout);assert.deepEqual(JSON.parse(bytes).reasonCodes,['CLI_ARGUMENTS_INVALID']);
  assert.equal(readFileSync(path.join(cwd,'artifacts/nar-readonly-source-probe.sha256'),'utf8'),createHash('sha256').update(bytes).digest('hex')+'  nar-readonly-source-probe.json\n');
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
test('workflow uses manual dispatch, exact commit, minimal access and no persisted checkout credential',()=>{
 const s=readFileSync('docs/workflows/CHASS-NAR-ReadOnly-Source-Probe-v1.yml','utf8');assert.match(s,/workflow_dispatch:/);assert.doesNotMatch(s,/\b(schedule|push|pull_request|secrets|environment):/);
 assert.match(s,/permissions:\n  contents: read/);assert.doesNotMatch(s,/\bwrite\b.*:/);assert.match(s,/ref: \$\{\{ github.sha \}\}/);assert.match(s,/persist-credentials: false/);assert.match(s,/timeout-minutes: 5/);
 assert.match(s,/test "\$PROBE_REF" = refs\/heads\/main/);assert.doesNotMatch(s,/npm (?:ci|install)|wrangler|curl|git push|secrets\./);
});
test('workflow transports inputs through quoted environment variables and preserves HOLD artifacts',()=>{
 const s=readFileSync('docs/workflows/CHASS-NAR-ReadOnly-Source-Probe-v1.yml','utf8');
 for(const line of s.split('\n').filter(x=>/^\s*run:/.test(x)))assert.doesNotMatch(line,/\$\{\{/);
 assert.match(s,/--date "\$PROBE_DATE" --code "\$PROBE_CODE" --race "\$PROBE_RACE"/);assert.match(s,/if: always\(\)/);assert.match(s,/if-no-files-found: error/);assert.match(s,/retention-days: 14/);
 assert.match(s,/nar-readonly-source-probe\.json/);assert.match(s,/nar-readonly-source-probe\.sha256/);assert.match(s,/cancel-in-progress: false/);
});

const controlOptions=()=>({date,code:'21',race:1,postTime:'15:00',notBeforeMs:now,wallNow:()=>now,fetchImpl:async url=>html(page(url))});
const menu=()=>page('https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=21&k_raceDate=2026/10/16');
test('unchanged production helper uses its encoded-date PC URL and original fetch options',async()=>{
 const calls=[];const r=await control({...controlOptions(),fetchImpl:async(url,init)=>{calls.push({url,init});return html(menu());}});
 assert.equal(r.status,'PRODUCTION_HELPER_MEETING_OBSERVED');assert.equal(r.requestCount,1);assert.equal(r.meeting.sourceRoute,'RaceList');
 assert.equal(calls[0].url,'https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=21&k_raceDate=2026%2F10%2F16');
 assert.equal(calls[0].init.redirect,'manual');assert.equal(calls[0].init.headers,undefined);assert.equal(calls[0].init.signal.aborted,true);assert.equal(r.requests[0].status,'MEETING_PARSED');
});
test('the helper retains its IPAT fallback after a PC HTTP failure',async()=>{
 const urls=[];const r=await control({...controlOptions(),fetchImpl:async url=>{urls.push(url);return urls.length===1?new Response('',{status:404}):html(menu());}});
 assert.equal(r.status,'PRODUCTION_HELPER_MEETING_OBSERVED');assert.equal(r.meeting.sourceRoute,'RaceList_ipat');assert.equal(urls.length,2);assert.ok(urls[1].includes('/KeibaWeb_IPAT/TodayRaceInfo/RaceList_ipat?'));
});
test('the helper retains the mobile third route and unchanged mobile parser',async()=>{
 const urls=[];const body='<h1>川崎競馬 2026年10月16日</h1><a href="/KeibaWebSP/TodayRaceInfo/S_DebaTable?k_babaCode=21&amp;k_raceDate=2026/10/16&amp;k_raceNo=1">1R</a>';
 const r=await control({...controlOptions(),fetchImpl:async url=>{urls.push(url);return urls.length<3?new Response('',{status:404}):html(body);}});
 assert.equal(r.status,'PRODUCTION_HELPER_MEETING_OBSERVED');assert.equal(r.meeting.sourceRoute,'RaceList_mobile');assert.equal(urls.length,3);assert.equal(new URL(urls[2]).origin,'https://sp.keiba.go.jp');
});
test('all three HTTP failures retain bounded original reason codes without repeating routes',async()=>{
 const calls=[];const r=await control({...controlOptions(),fetchImpl:async url=>{calls.push(url);return new Response('PRIVATE_SECRET',{status:404});}});
 assert.deepEqual(r.reasonCodes,['MEETING_SOURCE_UNAVAILABLE']);assert.equal(r.requestCount,3);assert.equal(new Set(calls).size,3);assert.equal(r.requests.every(x=>x.reason==='SOURCE_HTTP'&&x.httpStatus===404),true);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('wrong meeting identity cannot promote a control observation',async()=>{
 const r=await control({...controlOptions(),fetchImpl:async()=>html(menu().replaceAll('川崎','名古屋'))});assert.equal(r.status,'HOLD');assert.equal(r.meeting,null);assert.equal(r.requestCount,1);assert.deepEqual(r.reasonCodes,['CONTROL_MEETING_NOT_CONFIRMED']);
});
test('an explicit non-meeting response remains a nonpositive control result',async()=>{
 const r=await control({...controlOptions(),fetchImpl:async()=>html('<h1>2026年10月16日 川崎競馬 当日メニュー</h1>開催はありません')});assert.deepEqual(r.reasonCodes,['CONTROL_MEETING_NOT_CONFIRMED']);assert.equal(r.requestCount,1);assert.equal(r.meeting,null);
});
test('control meeting must contain the selected candidate race',async()=>{
 const r=await control({...controlOptions(),race:2});assert.deepEqual(r.reasonCodes,['CONTROL_MEETING_NOT_CONFIRMED']);assert.equal(r.requestCount,1);
});
test('invalid control config never calls network or echoes supplied identities',async()=>{
 for(const patch of [{date:'2026-02-30'},{code:'PRIVATE_SECRET'},{code:'__proto__'},{code:'constructor'},{race:0},{race:'1'},{postTime:'25:00'},{notBeforeMs:NaN},{wallNow:null},{fetchImpl:null}]){
  let calls=0;const r=await control({...controlOptions(),fetchImpl:async()=>{calls++;},...patch});assert.deepEqual(r.reasonCodes,['CONTROL_CONFIGURATION_INVALID']);assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('old/future date and the exact post boundary stop the control before GET',async()=>{
 for(const n of [now-86400000,now+86400000,Date.parse('2026-10-16T06:00:00.000Z')]){
  let calls=0;const r=await control({...controlOptions(),notBeforeMs:n,wallNow:()=>n,fetchImpl:async()=>{calls++;}});assert.equal(r.status,'HOLD');assert.equal(calls,0);
 }
});
test('clock regression relative to candidate completion rejects control execution',async()=>{
 const r=await control({...controlOptions(),notBeforeMs:now+1});assert.deepEqual(r.reasonCodes,['CONTROL_CLOCK_INVALID']);assert.equal(r.requestCount,0);
});
test('rollover during the first fetch blocks actual fallback requests',async()=>{
 let n=0,calls=0;const next=Date.parse('2026-10-16T15:00:00.000Z');
 const r=await control({...controlOptions(),wallNow:()=>++n<3?now:next,fetchImpl:async()=>{calls++;return html(menu());}});assert.equal(r.status,'HOLD');assert.equal(calls,1);assert.equal(r.requestCount,1);assert.deepEqual(r.reasonCodes,['CONTROL_DATE_CHANGED']);
});
test('late first-route response is cancelled without changing returned control evidence',async()=>{
 let resolve,cancelled=0,n=0;
 const r=await control({...controlOptions(),fetchImpl:async()=>++n===1?await new Promise(done=>{resolve=done;}):html(menu())});
 assert.equal(r.status,'PRODUCTION_HELPER_MEETING_OBSERVED');assert.equal(r.meeting.sourceRoute,'RaceList_ipat');
 const before=JSON.stringify(r);resolve(html(new ReadableStream({cancel(){cancelled++;}})));await new Promise(done=>setTimeout(done,0));assert.equal(cancelled,1);assert.equal(JSON.stringify(r),before);
});
test('control remains standalone research regardless of observed meeting or failures',async()=>{
 for(const fetchImpl of [controlOptions().fetchImpl,async()=>new Response('',{status:404})]){
  const r=await control({...controlOptions(),fetchImpl});assert.equal(r.acquisitionCertified,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.productionSourceChanged,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.executionBasis,'STANDALONE_NOT_WORKER_REPLAY');
 }
});
test('arbitrary exception text, raw HTML and horse names are never emitted by the control',async()=>{
 const r=await control({...controlOptions(),fetchImpl:async()=>{throw Error('PRIVATE_SECRET');}});assert.equal(r.status,'HOLD');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 const ok=await control({...controlOptions(),fetchImpl:async()=>html(menu()+'<script>PRIVATE_SECRET</script>')});assert.equal(ok.status,'PRODUCTION_HELPER_MEETING_OBSERVED');assert.equal(JSON.stringify(ok).includes('PRIVATE_SECRET'),false);
});
test('comparison uses two candidate GETs plus one unchanged-helper GET and preserves separate timing',async()=>{
 const calls=[];const r=await compare(args,{...options(),fetchImpl:async url=>{calls.push(url);return html(page(url));}});
 assert.equal(r.status,'MEETING_TO_CARD_OBSERVED');assert.equal(r.comparisonStatus,'BOTH_MEETING_PATHS_OBSERVED');assert.equal(r.candidateRequestCount,2);assert.equal(r.requestCount,3);assert.equal(calls.length,3);assert.ok(calls[2].includes('2026%2F10%2F16'));assert.equal(r.finishedAt,r.productionMeetingControl.finishedAt);assert.ok(r.candidateFinishedAt);
});
test('failed control preserves candidate success but cannot claim both paths were observed',async()=>{
 const r=await compare(args,{...options(),fetchImpl:async url=>url.includes('2026%2F10%2F16')?new Response('',{status:404}):html(page(url))});
 assert.equal(r.status,'MEETING_TO_CARD_OBSERVED');assert.equal(r.comparisonStatus,'CANDIDATE_ONLY_CONTROL_HOLD');assert.equal(r.requestCount,5);assert.equal(r.productionMeetingControl.status,'HOLD');assert.equal(r.workerReplay,'NOT_PERFORMED');assert.equal(r.acquisitionCertified,false);
});
test('candidate HOLD never schedules the production control or extra requests',async()=>{
 let calls=0;const r=await compare(args,{...options(),fetchImpl:async()=>{calls++;return new Response('',{status:404});}});assert.equal(r.status,'HOLD');assert.equal(r.comparisonStatus,'NOT_PERFORMED_CANDIDATE_NOT_OBSERVED');assert.equal(r.productionMeetingControl,null);assert.equal(calls,2);
});
test('invalid args or Actions context skip the control with zero network',async()=>{
 for(const [input,config] of [[[],{}],[args,{env:{...env(),GITHUB_EVENT_NAME:'schedule'}}]]){let calls=0;const r=await compare(input,{...options(),...config,fetchImpl:async()=>{calls++;}});assert.equal(r.status,'HOLD');assert.equal(r.productionMeetingControl,null);assert.equal(calls,0);}
});
test('post time reached between successful candidate and control makes no third GET',async()=>{
 let n=0,calls=0;const post=Date.parse('2026-10-16T06:00:00.000Z');
 const r=await compare(args,{...options(),wallNow:()=>++n<9?now:post,fetchImpl:async url=>{calls++;return html(page(url));}});assert.equal(r.status,'MEETING_TO_CARD_OBSERVED');assert.equal(r.comparisonStatus,'CANDIDATE_ONLY_CONTROL_HOLD');assert.deepEqual(r.productionMeetingControl.reasonCodes,['CONTROL_POST_TIME_REACHED']);assert.equal(calls,2);
});
test('source-probe executable explicitly opts into comparison without changing workflow inputs',()=>{
 const s=readFileSync('scripts/run-nar-readonly-source-probe.mjs','utf8');assert.match(s,/const report=await runNarReadOnlySourceProbeWithControl\(process.argv.slice\(2\)/);assert.match(s,/report.comparisonStatus==='BOTH_MEETING_PATHS_OBSERVED'\?0:1/);
});
