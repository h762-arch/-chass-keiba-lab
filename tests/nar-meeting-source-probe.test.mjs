import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeNarPrecomputeRunAudit,publicNarRunAuditFields} from '../src/prediction/nar-precompute-run-audit.mjs';
import {narStatusSourceUrl,narStatusSnapshotPath} from '../src/research/nar-status-mirror-audit.mjs';
import {probeNarMeetingSources as probe} from '../src/research/nar-meeting-source-probe.mjs';
import {runNarMeetingProbeCli} from '../scripts/probe-nar-meeting-sources.mjs';
const date='2026-10-16',now=Date.parse('2026-10-16T00:55:30.000Z');
function refresh(b){
 b.snapshot.payloadSha256=createHash('sha256').update(JSON.stringify(b.snapshot.payload)).digest('hex');
 const {payload,...metadata}=b.snapshot;b.attempt={...metadata,snapshotPath:narStatusSnapshotPath(date)};
 b.manifest={ok:true,schemaVersion:'chass-chat-mirror-manifest-v1',branch:'chass-data',statusMirror:{latestAttemptPath:'chat-snapshot/status/latest-attempt.json',latestAttempt:structuredClone(b.attempt)}};
 return b;
}
function fixture(result={status:'COMPLETED',attempted:0,saved:0,events:[{track:'川崎',reason:'MEETING_SOURCE_UNAVAILABLE',meetingAttempts:['RaceList','RaceList_ipat','RaceList_mobile'].map(route=>({route,reason:'SOURCE_HTTP',httpStatus:404}))}]}){
 const audit={status:'RECORDED',...normalizeNarPrecomputeRunAudit({scheduledAt:'2026-10-16T00:50:18.556Z',result})};
 return refresh({commitSha:'a'.repeat(40),snapshot:{schemaVersion:'chass-nar-status-snapshot-v1',status:'CAPTURED',date,sourceUrl:narStatusSourceUrl(date),attemptedAt:'2026-10-16T00:51:23.000Z',capturedAt:'2026-10-16T00:51:24.947Z',hashBasis:'UTF8_JSON_STRINGIFY_PAYLOAD',readOnlyCapture:true,payload:{ok:true,date,schemaReady:true,historyStoreSchemaReady:true,savedRaceCount:0,rejectedRowCount:0,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,races:[],...publicNarRunAuditFields(audit)}}});
}
function source(){const b=fixture();b.snapshot.payload.trackCodes=['21'];return refresh(b);}
const desktop=(track='川崎',d=date)=>`<h1>${d.slice(0,4)}年${Number(d.slice(5,7))}月${Number(d.slice(8,10))}日 ${track}競馬 当日メニュー</h1><a href="?k_raceNo=1&x=1">1R</a><a href="?k_raceNo=2&x=1">2R</a>`;
const mobile=()=>'<h1>川崎競馬 2026年10月16日</h1><a href="/KeibaWebSP/TodayRaceInfo/S_DebaTable?k_babaCode=21&k_raceDate=2026/10/16&k_raceNo=1">1R</a>';
const html=value=>new Response(value,{headers:{'content-type':'text/html; charset=utf-8'}});
const options=()=>({expectedDate:date,code:'21',wallNow:()=>now,fetchImpl:async url=>html(url.includes('KeibaWebSP')?mobile():desktop())});
test('four fixed route/encoding GETs use existing parsers without retry, credentials or redirect following',async()=>{
 const calls=[],r=await probe(source(),{...options(),fetchImpl:async(url,o)=>{calls.push({url,o});return html(url.includes('KeibaWebSP')?mobile():desktop());}});
 assert.equal(r.status,'MEETING_RESPONSE_OBSERVED');assert.equal(r.requestCount,4);assert.equal(calls.length,4);
 assert.deepEqual(r.observations.map(o=>o.route),['RaceList','RaceList_raw_slash_comparison','RaceList_ipat','RaceList_mobile']);
 assert.equal(calls[0].url,'https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=21&k_raceDate=2026%2F10%2F16');
 assert.equal(calls[1].url,'https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=21&k_raceDate=2026/10/16');
 for(const {o} of calls){assert.equal(o.method,'GET');assert.equal(o.redirect,'manual');assert.equal(o.credentials,'omit');assert.equal(o.signal.aborted,true);assert.equal('headers' in o,false);}
 assert.deepEqual(r.observations[0].meeting.raceNumbers,[1,2]);assert.deepEqual(r.observations[3].meeting.raceNumbers,[1]);
});
test('same encoding outcomes do not authorize source switching or production success',async()=>{
 const r=await probe(source(),options());assert.equal(r.encodingComparison,'SAME_RECORDED_OUTCOME');assert.equal(r.recordedCollectionDecision,'HOLD');
 assert.equal(r.recordedFailureNotResolved,true);assert.equal(r.automaticSourceSwitchAllowed,false);assert.equal(r.acquisitionCertified,false);
});
test('different raw-slash outcome is recorded as a comparison, never a proven causal fix',async()=>{
 const r=await probe(source(),{...options(),fetchImpl:async url=>url.endsWith('2026/10/16')?html(desktop()):new Response('not found',{status:404})});
 assert.equal(r.status,'MEETING_RESPONSE_OBSERVED');assert.equal(r.encodingComparison,'DIFFERENT_RECORDED_OUTCOME');assert.equal(r.diagnosisStatus,'NOT_ESTABLISHED');assert.equal(r.recordedFailureNotResolved,true);
});
test('HTTP 404 metadata and hashes are retained without inferring non-meeting or exposing raw body',async()=>{
 const r=await probe(source(),{...options(),fetchImpl:async()=>html404()});
 assert.equal(r.status,'HOLD');assert.deepEqual(r.reasonCodes,['MEETING_NOT_CONFIRMED']);assert.equal(r.probeCompleteness,'COMPLETE');
 assert.equal(r.observations.every(o=>o.httpStatus===404&&o.meeting.status==='NOT_PARSED'),true);
 assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
function html404(){return new Response('PRIVATE_SECRET',{status:404,headers:{'content-type':'text/html'}});}
test('redirect target is classified without following or copying arbitrary location URLs',async()=>{
 const locations=['/private/PRIVATE_SECRET','https://example.invalid/PRIVATE_SECRET','javascript:PRIVATE_SECRET',null];let i=0;
 const r=await probe(source(),{...options(),fetchImpl:async()=>{const location=locations[i++];return new Response('PRIVATE_SECRET',{status:302,headers:location?{location}:{}});}});
 assert.equal(i,4);assert.deepEqual(r.observations.map(o=>o.redirectTarget),['SAME_ORIGIN','OTHER_ORIGIN','INVALID','MISSING']);
 assert.equal(r.status,'HOLD');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('HTML-looking JSON or unknown content type cannot become a confirmed meeting',async()=>{
 for(const type of ['application/json','text/plain','']){
  const r=await probe(source(),{...options(),fetchImpl:async()=>new Response(desktop(),{headers:{'content-type':type}})});
  assert.equal(r.status,'HOLD');assert.equal(r.observations.every(o=>o.meeting.status==='NOT_PARSED'),true);
 }
});
test('wrong venue or date never becomes a meeting for the requested track/date',async()=>{
 for(const body of [desktop('名古屋'),desktop('川崎','2026-10-15')]){
  const r=await probe(source(),{...options(),fetchImpl:async()=>html(body)});assert.equal(r.status,'HOLD');
  assert.equal(r.observations.some(o=>o.meeting?.status==='meeting'),false);
 }
});
test('explicit non-meeting parser observation does not resolve the recorded collector failure',async()=>{
 const r=await probe(source(),{...options(),fetchImpl:async()=>html('2026年10月16日 川崎競馬 当日メニュー 開催はありません')});
 assert.equal(r.status,'HOLD');assert.equal(r.observations[0].meeting.status,'non_meeting');assert.equal(r.recordedFailureNotResolved,true);
});
test('bad source hash, future capture or failed latest attempt stop before all requests',async()=>{
 for(const mutate of [b=>b.snapshot.payload.savedRaceCount=2,b=>b.snapshot.capturedAt='2026-10-16T01:00:00.000Z',b=>b.attempt.status='FAILED']){
  const b=source();mutate(b);let calls=0;const r=await probe(b,{...options(),fetchImpl:async()=>{calls++;}});
  assert.equal(r.status,'HOLD');assert.equal(calls,0);assert.equal(r.requestCount,0);
 }
});
test('stale mirror and stale recorded run cannot be probed by silently opting into history',async()=>{
 let calls=0;const r=await probe(source(),{...options(),mode:'HISTORICAL',wallNow:()=>now+3600000,fetchImpl:async()=>{calls++;}});
 assert.deepEqual(r.reasonCodes,['SOURCE_RUN_NOT_PROBEABLE']);assert.equal(calls,0);
});
test('only the configured track with a recorded unavailable meeting is eligible',async()=>{
 for(const mutate of [b=>b.snapshot.payload.trackCodes=['22'],b=>{b.snapshot.payload.narRunAudit.events=[{track:'川崎',reason:'NON_MEETING'}];Object.assign(b.snapshot.payload,publicNarRunAuditFields(b.snapshot.payload.narRunAudit));}]){
  const b=source();mutate(b);refresh(b);let calls=0;const r=await probe(b,{...options(),fetchImpl:async()=>{calls++;}});
  assert.deepEqual(r.reasonCodes,['TRACK_FAILURE_NOT_RECORDED']);assert.equal(calls,0);
 }
});
test('arbitrary URLs inside the source are never request targets',async()=>{
 const b=source();b.snapshot.payload.url='https://example.invalid/PRIVATE_SECRET';refresh(b);const calls=[];
 const r=await probe(b,{...options(),fetchImpl:async url=>{calls.push(url);return html404();}});
 assert.equal(calls.length,4);assert.equal(calls.every(u=>['www.keiba.go.jp','sp.keiba.go.jp'].includes(new URL(u).hostname)),true);
 assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('invalid configuration and clocks hold before network without leaking supplied values',async()=>{
 for(const patch of [{code:21},{code:'021'},{code:'PRIVATE_SECRET'},{perRequestTimeoutMs:0},{perRequestTimeoutMs:5001},{perRequestTimeoutMs:1.5},{fetchImpl:null},{wallNow:()=>NaN},{wallNow:()=>1e20}]){
  let calls=0;const r=await probe(source(),{...options(),fetchImpl:async()=>{calls++;},...patch});assert.equal(r.status,'HOLD');assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('unresponsive fetch and body streams are bounded separately for each of the four probes',async()=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}}),{headers:{'content-type':'text/html'}})]){
  const r=await probe(source(),{...options(),perRequestTimeoutMs:5,fetchImpl});assert.equal(r.requestCount,4);assert.equal(r.status,'HOLD');
  assert.equal(r.probeCompleteness,'PARTIAL');assert.equal(r.observations.every(o=>o.reasonCode==='PROBE_TIMEOUT'),true);
 }
});
test('late fetches after timeout are cancelled and cannot mutate returned observations',async()=>{
 const pending=[];let cancelled=0;
 const r=await probe(source(),{...options(),perRequestTimeoutMs:5,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});const before=JSON.stringify(r);
 pending.forEach(resolve=>resolve(new Response(new ReadableStream({cancel(){cancelled++;}}))));await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(cancelled,4);assert.equal(JSON.stringify(r),before);
});
test('declared and streamed body limits are enforced independently',async()=>{
 for(const make of [()=>new Response('x',{headers:{'content-type':'text/html','content-length':'1000001'}}),()=>html(' '.repeat(1000001))]){
  const r=await probe(source(),{...options(),fetchImpl:async()=>make()});assert.equal(r.observations.every(o=>o.reasonCode==='BODY_LIMIT'),true);assert.equal(r.status,'HOLD');
 }
});
test('malformed UTF8 and missing bodies cannot produce parsed meetings',async()=>{
 for(const make of [()=>new Response(new Uint8Array([255]),{headers:{'content-type':'text/html'}}),()=>new Response(null,{headers:{'content-type':'text/html'}})]){
  const r=await probe(source(),{...options(),fetchImpl:async()=>make()});assert.equal(r.status,'HOLD');assert.equal(r.observations.every(o=>o.status==='HOLD'),true);
 }
});
test('received-byte fingerprint is exact and neither raw text nor exception messages are emitted',async()=>{
 const body=desktop()+'PRIVATE_SECRET',r=await probe(source(),{...options(),fetchImpl:async()=>html(body)});
 assert.equal(r.observations[0].responseBytesSha256,createHash('sha256').update(body).digest('hex'));assert.equal(r.observations[0].responseBytes,Buffer.byteLength(body));assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 const error=await probe(source(),{...options(),fetchImpl:async()=>{throw Error('PRIVATE_SECRET');}});assert.equal(JSON.stringify(error).includes('PRIVATE_SECRET'),false);
});
test('source is pinned before IO and external mutation cannot replace the compared run',async()=>{
 const b=source(),hash=b.snapshot.payloadSha256;
 const r=await probe(b,{...options(),fetchImpl:async()=>{b.snapshot.payload.savedRaceCount=99;refresh(b);return html(desktop());}});
 assert.equal(r.sourceReference.payloadSha256,hash);assert.equal(r.collectionAudit.savedRaceCount,0);
});
test('ordinary probe leaves input unchanged and keeps model, activation and recorded source HOLD gates',async()=>{
 const b=source(),before=JSON.stringify(b),r=await probe(b,options());assert.equal(JSON.stringify(b),before);
 assert.equal(r.collectionAudit.status,'HOLD');assert.equal(r.executionBasis,'STANDALONE_FETCH_NOT_WORKER_REPLAY');
 assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.currentStatusEligible,false);
});
test('backward clock stops immediately after the affected request',async()=>{
 const times=[now,now,now-1];let calls=0;
 const r=await probe(source(),{...options(),wallNow:()=>times.shift(),fetchImpl:async()=>{calls++;return html(desktop());}});
 assert.deepEqual(r.reasonCodes,['PROBE_CLOCK_INVALID']);assert.equal(calls,1);assert.equal(r.requestCount,1);
});
test('completion-time freshness is rechecked and expired source is not presented as verified',async()=>{
 const b=source();let calls=0;const expired=Date.parse(b.snapshot.capturedAt)+1800000+1;
 const r=await probe(b,{...options(),wallNow:()=>++calls<10?now:expired});assert.equal(r.requestCount,4);
 assert.deepEqual(r.reasonCodes,['SOURCE_STALE_AFTER_PROBE']);assert.equal(r.collectionAudit.mirrorAudit.status,'HOLD');
});
async function file(t,value){const root=await mkdtemp(path.join(tmpdir(),'meeting-probe-'));t.after(()=>rm(root,{recursive:true,force:true}));const p=path.join(root,'bundle.json');await writeFile(p,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value));return ['--bundle',p,'--date',date,'--code','21'];}
test('CLI pins explicit date/code and accepts no URLs, credentials, timeout, clock or historical flags',async t=>{
 const args=await file(t,source());const r=await runNarMeetingProbeCli(args,{...options(),code:'22',expectedDate:'2026-10-15'});assert.equal(r.status,'MEETING_RESPONSE_OBSERVED');
 for(const extra of [['--url','https://example.invalid/'],['--token','PRIVATE_SECRET'],['--timeout','1'],['--now','0'],['--historical']]){
  let calls=0;const result=await runNarMeetingProbeCli([...args,...extra],{...options(),fetchImpl:async()=>{calls++;}});assert.equal(result.status,'HOLD');assert.equal(calls,0);
 }
});
test('CLI rejects oversized files, malformed UTF8/JSON, absent files, invalid dates and code shapes',async t=>{
 for(const value of ['{',' '.repeat(1000001),new Uint8Array([255])])assert.deepEqual((await runNarMeetingProbeCli(await file(t,value),options())).reasonCodes,['BUNDLE_READ_UNAVAILABLE']);
 assert.equal((await runNarMeetingProbeCli(['--bundle','/missing','--date',date,'--code','21'],options())).status,'HOLD');
 assert.equal((await runNarMeetingProbeCli(['--bundle','/missing','--date','2026-02-30','--code','21'],options())).status,'HOLD');
 assert.equal((await runNarMeetingProbeCli(['--bundle','/missing','--date',date,'--code','021'],options())).status,'HOLD');
});
