import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeNarPrecomputeRunAudit,publicNarRunAuditFields} from '../src/prediction/nar-precompute-run-audit.mjs';
import {narStatusSourceUrl,narStatusSnapshotPath} from '../src/research/nar-status-mirror-audit.mjs';
import {auditNarCollectionRun} from '../src/research/nar-collection-run-audit.mjs';
import {runNarCollectionAuditCli} from '../scripts/audit-nar-collection-run.mjs';
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
const audit=(b,o={})=>auditNarCollectionRun(b,{expectedDate:date,now,...o});
function change(b,mutate){const p=b.snapshot.payload;mutate(p.narRunAudit);Object.assign(p,publicNarRunAuditFields(p.narRunAudit));return refresh(b);}
function savedFixture(){
 const b=fixture({status:'COMPLETED',attempted:1,saved:1,events:[{raceId:'20261016-NAR-21-01',reason:'SAVED'}]});
 b.snapshot.payload.savedRaceCount=1;b.snapshot.payload.races=[{raceId:'20261016-NAR-21-01'}];return refresh(b);
}
test('mirror VERIFIED and runner COMPLETED do not hide recorded three-route 404 and zero acquisition',()=>{
 const r=audit(fixture());assert.equal(r.mirrorAudit.status,'VERIFIED');assert.equal(r.run.runStatus,'COMPLETED');
 assert.equal(r.status,'HOLD');assert.ok(r.reasonCodes.includes('MEETING_SOURCE_UNAVAILABLE'));
 assert.equal(r.collectionOutcome,'NO_ATTEMPT_RECORDED');assert.equal(r.run.attempted,0);assert.equal(r.run.saved,0);
 assert.deepEqual(r.run.events[0].meetingAttempts.map(a=>a.httpStatus),[404,404,404]);
});
test('recorded save is observable without certifying acquisition or full meeting coverage',()=>{
 const r=audit(savedFixture());assert.equal(r.status,'OBSERVED');assert.equal(r.collectionOutcome,'SAVE_RECORDED');
 assert.equal(r.run.saved,1);assert.equal(r.savedRaceCount,1);assert.equal(r.acquisitionCertified,false);
 assert.equal(r.eventCoverage,'LATEST_RECORD_RETAINED_EVENTS_ONLY_NOT_FULL_RUN_HISTORY');
});
test('explicit already-saved and non-meeting events explain no new attempt without inventing new saves',()=>{
 for(const reason of ['ALREADY_SAVED','NON_MEETING']){
  const r=audit(fixture({status:'COMPLETED',events:[{track:'川崎',reason}]}));assert.equal(r.status,'OBSERVED');
  assert.equal(r.collectionOutcome,'NO_ATTEMPT_RECORDED');assert.equal(r.run.saved,0);assert.equal(r.acquisitionCertified,false);
 }
});
test('empty events with zero attempts HOLD rather than infer non-meeting or completion',()=>{
 const r=audit(fixture({status:'COMPLETED',events:[]}));assert.equal(r.status,'HOLD');assert.ok(r.reasonCodes.includes('ZERO_ATTEMPT_REASON_UNAVAILABLE'));
});
test('attempts without saves and partial attempt/save gap stay explicit HOLD',()=>{
 const b=fixture({status:'COMPLETED',attempted:2,saved:0});assert.ok(audit(b).reasonCodes.includes('NO_SAVE_RECORDED'));
 const c=savedFixture();change(c,r=>r.attempted=2);assert.ok(audit(c).reasonCodes.includes('ATTEMPT_SAVE_GAP_RECORDED'));
});
test('partial save plus recorded source failure remains HOLD while preserving nonzero saves',()=>{
 const b=savedFixture();change(b,r=>r.events.push({track:'金沢',reason:'MEETING_SOURCE_UNAVAILABLE'}));
 const r=audit(b);assert.equal(r.status,'HOLD');assert.equal(r.run.saved,1);assert.equal(r.collectionOutcome,'SAVE_RECORDED');
});
test('fresh mirror can contain an independently stale run audit',()=>{
 const b=fixture();change(b,r=>{r.scheduledAt='2026-10-15T22:00:00.000Z';});
 const r=audit(b);assert.equal(r.mirrorAudit.status,'VERIFIED');assert.equal(r.status,'HOLD');assert.ok(r.reasonCodes.includes('RECORDED_RUN_STALE'));
});
test('recorded-run age boundary is inclusive at thirty minutes',()=>{
 const b=fixture({status:'COMPLETED',events:[{track:'川崎',reason:'NON_MEETING'}]});
 change(b,r=>r.scheduledAt=new Date(now-1800000).toISOString());assert.equal(audit(b).status,'OBSERVED');
 assert.ok(audit(b,{now:now+1}).reasonCodes.includes('RECORDED_RUN_STALE'));
});
test('stale, future, failed-latest and hash-inconsistent mirror inputs stop before run interpretation',()=>{
 for(const mutate of [b=>b.snapshot.payload.savedRaceCount=2,b=>b.snapshot.capturedAt='2026-10-16T01:00:00.000Z',b=>b.attempt.status='FAILED']){
  const b=fixture();mutate(b);const r=audit(b);assert.deepEqual(r.reasonCodes,['SOURCE_MIRROR_HOLD']);assert.equal(r.run,null);
 }
 assert.deepEqual(audit(fixture(),{now:now+3600000}).reasonCodes,['SOURCE_MIRROR_HOLD']);
});
test('unavailable and absent run audits do not normalize unknown counters to zero',()=>{
 for(const status of ['NO_RUN_RECORDED','UNAVAILABLE']){
  const b=fixture();b.snapshot.payload.narRunAudit={status};refresh(b);const r=audit(b);
  assert.equal(r.status,'HOLD');assert.equal(r.run,null);assert.deepEqual(r.reasonCodes,[status==='NO_RUN_RECORDED'?'NO_RUN_RECORDED':'RUN_AUDIT_UNAVAILABLE']);
 }
});
test('run date, JST date, future run and noncanonical timestamps are rejected',()=>{
 for(const patch of [{runDate:'2026-10-15'},{scheduledAt:'2026-10-15T00:50:18.556Z'},{scheduledAt:'2026-10-16T00:52:00.000Z'},{scheduledAt:'2026-10-16T00:50:18Z'}]){
  const b=fixture();change(b,r=>Object.assign(r,patch));assert.deepEqual(audit(b).reasonCodes,['RUN_TIME_INVALID']);
 }
});
test('missing, string, negative, impossible and oversized counters hold without fabricated zeros',()=>{
 for(const patch of [{attempted:null},{attempted:'0'},{saved:-1},{saved:1},{autoResultProcessed:1000001}]){
  const b=fixture();change(b,r=>Object.assign(r,patch));assert.deepEqual(audit(b).reasonCodes,['RUN_COUNTS_INVALID']);
 }
});
test('public last-run aliases must match the same recorded audit',()=>{
 for(const key of ['lastNarRunAt','lastNarStatus','lastNarReason','lastNarAttempted','lastNarSaved','lastNarEvents']){
  const b=fixture();b.snapshot.payload[key]='PRIVATE_SECRET';refresh(b);
  const r=audit(b);assert.deepEqual(r.reasonCodes,['RUN_PUBLIC_FIELDS_INVALID']);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('blocked, skipped and unknown run statuses cannot become collection success',()=>{
 for(const runStatus of ['BLOCKED','SKIPPED','PRIVATE_SECRET']){
  const b=fixture();change(b,r=>{r.runStatus=runStatus;r.reason='PRIVATE_SECRET';});const r=audit(b);
  assert.equal(r.status,'HOLD');assert.ok(r.reasonCodes.includes('RUN_NOT_COMPLETED'));assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('unrecognized event reasons are retained as explicit review rather than silently dropped',()=>{
 const b=fixture();change(b,r=>r.events=[{reason:'PRIVATE_SECRET'}]);const r=audit(b);
 assert.equal(r.run.events[0].reason,'UNRECOGNIZED_RECORDED_REASON');assert.equal(r.status,'HOLD');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('route order, duplicate routes, HTTP status types and unsupported reasons hold',()=>{
 for(const attempts of [[{route:'foreign',reason:'SOURCE_HTTP',httpStatus:404}],[{route:'RaceList',reason:'SOURCE_HTTP',httpStatus:'404'}],[{route:'RaceList',reason:'SOURCE_DEADLINE',httpStatus:404}],[{route:'RaceList',reason:'PRIVATE_SECRET'}],[{route:'RaceList_mobile',reason:'SOURCE_HTTP',httpStatus:404},{route:'RaceList',reason:'SOURCE_HTTP',httpStatus:404}]]){
  const b=fixture();change(b,r=>r.events[0].meetingAttempts=attempts);assert.deepEqual(audit(b).reasonCodes,['RUN_ATTEMPTS_INVALID']);
 }
});
test('race/track identity and retained event/reference bounds hold',()=>{
 for(const patch of [{raceId:'20261015-NAR-21-01'},{raceId:'20261016-NAR-22-01',track:'川崎'},{track:'PRIVATE_SECRET'}]){
  const b=fixture();change(b,r=>Object.assign(r.events[0],patch));assert.deepEqual(audit(b).reasonCodes,['RUN_EVENTS_INVALID']);
 }
 const b=fixture();change(b,r=>r.events=Array.from({length:65},()=>({reason:'NON_MEETING'})));assert.deepEqual(audit(b).reasonCodes,['RUN_EVENTS_INVALID']);
 const c=fixture();change(c,r=>r.events[0].meetingAttempts=Array.from({length:4},()=>({route:'RaceList',reason:'SOURCE_HTTP',httpStatus:404})));assert.deepEqual(audit(c).reasonCodes,['RUN_ATTEMPTS_INVALID']);
});
test('free text and arbitrary fields are excluded while input and original flags remain unchanged',()=>{
 const b=fixture();change(b,r=>{r.privateNote='PRIVATE_SECRET';r.events[0].url='PRIVATE_SECRET';r.events[0].meetingAttempts[0].body='PRIVATE_SECRET';});
 const before=JSON.stringify(b),r=audit(b);assert.equal(JSON.stringify(b),before);assert.deepEqual(r,audit(b));assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.formalKpiEligible,false);
});
test('throwing getters and prebuilt mirror verdicts cannot bypass raw-bundle revalidation',()=>{
 const b=fixture();Object.defineProperty(b.snapshot.payload,'narRunAudit',{enumerable:true,get(){throw Error('PRIVATE_SECRET');}});
 const r=audit(b);assert.equal(r.status,'HOLD');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 assert.equal(audit({status:'VERIFIED'}).status,'HOLD');
});
async function file(t,value){const root=await mkdtemp(path.join(tmpdir(),'collection-audit-'));t.after(()=>rm(root,{recursive:true,force:true}));const p=path.join(root,'bundle.json');await writeFile(p,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value));return ['--bundle',p,'--date',date];}
test('local CLI preserves collection HOLD separately from verified mirror',async t=>{
 const args=await file(t,fixture()),r=runNarCollectionAuditCli(args,{now});assert.equal(r.status,'HOLD');assert.equal(r.mirrorAudit.status,'VERIFIED');
 assert.equal(runNarCollectionAuditCli(await file(t,savedFixture()),{now}).status,'OBSERVED');
});
test('CLI refuses arbitrary URLs, credentials, historical and clock overrides',async t=>{
 const args=await file(t,fixture());for(const extra of [['--url','https://example.invalid/'],['--token','PRIVATE_SECRET'],['--historical'],['--now','0']])assert.equal(runNarCollectionAuditCli([...args,...extra],{now}).status,'HOLD');
});
test('CLI enforces independent regular-file, byte-size, UTF8, JSON and date boundaries',async t=>{
 for(const value of ['{',' '.repeat(1000001),new Uint8Array([255])])assert.deepEqual(runNarCollectionAuditCli(await file(t,value),{now}).reasonCodes,['BUNDLE_READ_UNAVAILABLE']);
 assert.equal(runNarCollectionAuditCli(['--bundle','/missing','--date',date],{now}).status,'HOLD');
 assert.equal(runNarCollectionAuditCli(['--bundle','/missing','--date','2026-02-30'],{now}).status,'HOLD');
});
