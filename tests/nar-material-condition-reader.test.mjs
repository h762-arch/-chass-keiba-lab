import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {diagnoseNarRestoredRaceBatch} from '../src/prediction/nar-quality-diagnostics.mjs';
import {compactNarPrecomputeStatus} from '../src/prediction/nar-status-compact.mjs';
import {narStatusSourceUrl,narStatusSnapshotPath} from '../src/research/nar-status-mirror-audit.mjs';
import {readNarMaterialDiagnostics} from '../src/research/nar-material-diagnostic-reader.mjs';
import {reportNarMaterialConditions} from '../src/research/nar-material-condition-report.mjs';
import {runNarDiagnosticReaderCli} from '../scripts/read-nar-material-diagnostics.mjs';
const date='2026-10-15',now=Date.parse('2026-10-15T13:40:00.000Z'),id='20261015-NAR-21-01';
function refresh(b){b.snapshot.payloadSha256=createHash('sha256').update(JSON.stringify(b.snapshot.payload)).digest('hex');const {payload,...a}=b.snapshot;b.attempt={...a,snapshotPath:narStatusSnapshotPath(date)};b.manifest={ok:true,schemaVersion:'chass-chat-mirror-manifest-v1',branch:'chass-data',statusMirror:{latestAttemptPath:'chat-snapshot/status/latest-attempt.json',latestAttempt:structuredClone(b.attempt)}};return b;}
function fixture(){
 const episode={observationKey:'o',contentHash:'h',facts:{distance:2000,timeSec:130,originCircuit:'JRA',dateText:'09.30',venue:'川崎'}};
 const data={race:{distance:1400},horses:[{horseNo:1,horseName:'PRIVATE_HORSE',runnerStatus:'active',predictedTime:null,evidence:{schemaVersion:1,runCount:1,sameDistanceCount:0,sameTrackCount:1,timeMissingReason:'time_missing_unknown'},history:{body:{schemaVersion:2,parsedCount:1,retainedCount:1,episodes:[episode],identity:{references:[{observationKey:'o',contentHash:'h',status:'HOLD',reasonCode:'EPISODE_LINK_UNMATCHED'}]}}}},{horseNo:2,horseName:'OTHER',runnerStatus:'active',predictedTime:'1:26.0',history:{body:{schemaVersion:2,identity:{references:[]}}}}],historyLinks:{body:{rows:[{horseNo:1,horseName:'PRIVATE_HORSE',pastRaceReferences:[{date:'2026-09-30',code:'21'}]}]}}};
 const row={raceId:id,track:'川崎',raceNo:1,horseCount:2,abilityCount:2,timeCount:1,quality:{schemaVersion:1,horseCount:2,activeHorseCount:2,activeAbilityCount:2,activeTimeCount:1},historyLinkAudit:{heldEpisodeCount:1},historyStoreAudit:{heldEpisodeCount:0,unresolvedObservationCount:1},preAnalysisStatus:'PARTIAL',preAnalysisPackHash:'a'.repeat(64)};
 const b=refresh({commitSha:'b'.repeat(40),snapshot:{schemaVersion:'chass-nar-status-snapshot-v1',status:'CAPTURED',date,sourceUrl:narStatusSourceUrl(date),attemptedAt:'2026-10-15T13:35:53.000Z',capturedAt:'2026-10-15T13:35:54.000Z',hashBasis:'UTF8_JSON_STRINGIFY_PAYLOAD',readOnlyCapture:true,payload:{ok:true,date,schemaReady:true,historyStoreSchemaReady:true,savedRaceCount:1,rejectedRowCount:0,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,races:[row]}}});
 const response=compactNarPrecomputeStatus({...structuredClone(b.snapshot.payload),qualityDiagnostics:diagnoseNarRestoredRaceBatch([{raceId:id,data}])});return {b,response};
}
const opts=f=>({expectedDate:date,wallNow:()=>now,fetchImpl:async()=>Response.json(f.response),includeConditionReport:true});
test('one fixed GET produces acceptance and an independently reproducible condition report',async()=>{
 const f=fixture();let calls=0;
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),fetchImpl:async(url,o)=>{
  calls++;assert.equal(url,narStatusSourceUrl(date)+'&diagnostics=1');
  assert.equal(o.method,'GET');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'manual');assert.deepEqual(o.headers,{accept:'application/json'});
  return Response.json(f.response);
 }});
 assert.equal(calls,1);assert.equal(r.readAudit.requestCount,1);assert.equal(r.status,'CONDITION_REPORT_READY');
 assert.equal(r.acceptance.status,'INSPECTION_READY');
 assert.deepEqual(r.conditionReport,reportNarMaterialConditions(f.b,f.response,{expectedDate:date,now}));
 assert.equal(r.conditionReport.totals.historyOrigins.JRA,1);
});
test('default mode keeps the original reader status and omits the report field',async()=>{
 const f=fixture(),o=opts(f);delete o.includeConditionReport;
 const r=await readNarMaterialDiagnostics(f.b,o);
 assert.equal(r.status,'INSPECTION_READY');assert.equal('conditionReport' in r,false);
});
test('false explicitly preserves the existing acceptance-only result',async()=>{
 const f=fixture(),r=await readNarMaterialDiagnostics(f.b,{...opts(f),includeConditionReport:false});
 assert.equal(r.status,'INSPECTION_READY');assert.equal('conditionReport' in r,false);
});
test('report configuration requires a boolean and fails before any network',async()=>{
 const f=fixture();for(const value of [null,0,1,'true',{}]){
  let calls=0;const r=await readNarMaterialDiagnostics(f.b,{...opts(f),includeConditionReport:value,fetchImpl:async()=>{calls++;}});
  assert.equal(r.status,'HOLD');assert.deepEqual(r.reasonCodes,['READ_CONFIGURATION_INVALID']);assert.equal(calls,0);
 }
});
test('ordinary stale input holds with a null report before network',async()=>{
 const f=fixture();let calls=0;
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),wallNow:()=>now+3600000,fetchImpl:async()=>{calls++;}});
 assert.equal(r.status,'HOLD');assert.equal(r.conditionReport,null);assert.equal(calls,0);
});
test('historical reporting retains stale source HOLD, original capture and no activation',async()=>{
 const f=fixture(),at=now+3600000;
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),mode:'HISTORICAL',wallNow:()=>at});
 assert.equal(r.status,'HISTORICAL_CONDITION_REPORT_READY');assert.equal(r.acceptance.status,'HISTORICAL_INSPECTION_READY');
 assert.equal(r.conditionReport.sourceMirrorDecision,'HOLD');assert.deepEqual(r.conditionReport.sourceMirrorReasons,['SNAPSHOT_STALE']);
 assert.equal(r.conditionReport.sourceReference.capturedAt,f.b.snapshot.capturedAt);assert.equal(r.conditionReport.currentStatusEligible,false);
});
test('completion-time source revalidation holds after crossing the freshness boundary',async()=>{
 const f=fixture(),capture=Date.parse(f.b.snapshot.capturedAt),times=[capture+1800000-1,capture+1800000+1];
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),wallNow:()=>times.shift()});
 assert.equal(r.status,'HOLD');assert.equal(r.readAudit.status,'CAPTURED');assert.equal(r.conditionReport,null);
 assert.deepEqual(r.acceptance.reasonCodes,['SOURCE_PLAN_HOLD']);
});
test('report audit uses the exact same completion timestamp as acceptance and HTTP audit',async()=>{
 const f=fixture(),times=[now,now+5000];
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),wallNow:()=>times.shift()});
 assert.equal(r.status,'CONDITION_REPORT_READY');assert.equal(r.conditionReport.sourceReference.auditedAt,new Date(now+5000).toISOString());
 assert.equal(r.conditionReport.sourceReference.auditedAt,r.acceptance.sourceReference.auditedAt);
 assert.equal(r.readAudit.finishedAt,r.conditionReport.sourceReference.auditedAt);
});
test('no diagnostic tasks means zero GET, null totals and unresolved ability review retained',async()=>{
 const f=fixture(),row=f.b.snapshot.payload.races[0];row.timeCount=2;row.quality.activeTimeCount=2;
 row.historyLinkAudit.heldEpisodeCount=0;row.historyStoreAudit.unresolvedObservationCount=0;
 row.abilityCount=1;row.quality.activeAbilityCount=1;refresh(f.b);let calls=0;
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),fetchImpl:async()=>{calls++;}});
 assert.equal(r.status,'NO_DIAGNOSTIC_TASKS');assert.equal(calls,0);assert.equal(r.acceptance,null);
 assert.equal(r.readAudit.status,'NOT_REQUIRED');assert.equal(r.conditionReport.totals,null);
 assert.equal(r.conditionReport.remainingTasks[0].kind,'REVIEW_ABILITY_SOURCE');
});
test('bad source integrity cannot be bypassed by historical reporting',async()=>{
 const f=fixture();f.b.snapshot.payloadSha256='0'.repeat(64);let calls=0;
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),mode:'HISTORICAL',fetchImpl:async()=>{calls++;}});
 assert.equal(r.status,'HOLD');assert.equal(r.conditionReport,null);assert.equal(calls,0);
});
test('response row drift has captured transport but no report or fabricated counts',async()=>{
 const f=fixture();f.response.races[0].preAnalysisPackHash='c'.repeat(64);
 const r=await readNarMaterialDiagnostics(f.b,opts(f));
 assert.equal(r.readAudit.status,'CAPTURED');assert.equal(r.status,'HOLD');assert.equal(r.conditionReport,null);
});
test('malformed history conditions cannot be turned into a report',async()=>{
 const f=fixture();f.response.qualityDiagnostics.races[0].diagnostics.horses[0].conditions.history.references[0].origin='PRIVATE_SECRET';
 const r=await readNarMaterialDiagnostics(f.b,opts(f));assert.equal(r.status,'HOLD');assert.equal(r.conditionReport,null);
 assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('transport timeout cannot emit a report, including after a late fetch',async()=>{
 const f=fixture();let resolve;
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),timeoutMs:5,fetchImpl:()=>new Promise(r=>{resolve=r;})});
 assert.equal(r.status,'HOLD');assert.equal(r.conditionReport,null);assert.deepEqual(r.reasonCodes,['READ_TIMEOUT']);
 resolve(Response.json(f.response));await new Promise(r=>setTimeout(r,0));assert.equal(r.conditionReport,null);
});
test('HTTP, content-type and JSON failures do not retry or produce report totals',async()=>{
 const f=fixture();for(const response of [new Response('PRIVATE_SECRET',{status:302}),new Response('PRIVATE_SECRET'),new Response('{',{headers:{'content-type':'application/json'}})]){
  let calls=0;const r=await readNarMaterialDiagnostics(f.b,{...opts(f),fetchImpl:async()=>{calls++;return response;}});
  assert.equal(r.status,'HOLD');assert.equal(r.conditionReport,null);assert.equal(calls,1);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('pinned bundle is shared by acceptance and reporting despite external mutation during GET',async()=>{
 const f=fixture(),sourceHash=f.b.snapshot.payloadSha256;
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),fetchImpl:async()=>{
  f.b.snapshot.payload.races[0].preAnalysisPackHash='c'.repeat(64);refresh(f.b);return Response.json(f.response);
 }});
 assert.equal(r.status,'CONDITION_REPORT_READY');assert.equal(r.conditionReport.sourceReference.payloadSha256,sourceHash);
 assert.equal(r.acceptance.sourceReference.payloadSha256,sourceHash);
});
test('received byte hash and report JSON hash retain different, explicit evidence bases',async()=>{
 const f=fixture(),raw=JSON.stringify(f.response,null,2);
 const r=await readNarMaterialDiagnostics(f.b,{...opts(f),fetchImpl:async()=>new Response(raw,{headers:{'content-type':'application/json'}})});
 assert.equal(r.readAudit.responseBytesSha256,createHash('sha256').update(raw).digest('hex'));
 assert.equal(r.conditionReport.responseSha256,createHash('sha256').update(JSON.stringify(f.response)).digest('hex'));
 assert.notEqual(r.readAudit.responseBytesSha256,r.conditionReport.responseSha256);
 assert.equal(r.readAudit.transportBasis,'FIXED_PUBLIC_ENDPOINT_GET');assert.equal(r.conditionReport.transportVerification,'NOT_PERFORMED_BY_THIS_REPORT');
});
test('raw bodies and caller report fields do not leak; input and fixed gates remain unchanged',async()=>{
 const f=fixture();f.response.privateNote='PRIVATE_SECRET';f.response.conditionReport={productionActivationDecision:'GO'};
 const before=JSON.stringify(f),r=await readNarMaterialDiagnostics(f.b,opts(f));assert.equal(JSON.stringify(f),before);
 assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);assert.equal(JSON.stringify(r).includes('PRIVATE_HORSE'),false);
 for(const layer of [r,r.acceptance,r.conditionReport]){assert.equal(layer.probabilityDecision,'MODEL_HOLD');assert.equal(layer.productionActivationDecision,'NO-GO');assert.equal(layer.acquisitionCertified,false);}
});
async function file(t,f){const root=await mkdtemp(path.join(tmpdir(),'condition-reader-'));t.after(()=>rm(root,{recursive:true,force:true}));const p=path.join(root,'bundle.json');await writeFile(p,JSON.stringify(f.b));return ['--bundle',p,'--date',date];}
test('CLI requires --conditions, never enabling reporting from bundle or injected options',async t=>{
 const f=fixture();f.b.includeConditionReport=true;const args=await file(t,f);
 const a=await runNarDiagnosticReaderCli(args,opts(f));assert.equal(a.status,'INSPECTION_READY');assert.equal('conditionReport' in a,false);
 const b=await runNarDiagnosticReaderCli([...args,'--conditions'],{...opts(f),includeConditionReport:false});assert.equal(b.status,'CONDITION_REPORT_READY');
});
test('CLI accepts both explicit historical/conditions orders without implicit stale fallback',async t=>{
 const f=fixture(),args=await file(t,f),o={...opts(f),wallNow:()=>now+3600000};
 assert.equal((await runNarDiagnosticReaderCli([...args,'--conditions'],o)).status,'HOLD');
 for(const flags of [['--conditions','--historical'],['--historical','--conditions']])assert.equal((await runNarDiagnosticReaderCli([...args,...flags],o)).status,'HISTORICAL_CONDITION_REPORT_READY');
});
test('CLI rejects duplicates, flag values, URLs, credentials and clock overrides before network',async t=>{
 const f=fixture(),args=await file(t,f);for(const flags of [['--conditions','--conditions'],['--historical','--historical'],['--conditions','true'],['--conditions','--url'],['--now','0'],['--token','PRIVATE_SECRET']]){
  let calls=0;const r=await runNarDiagnosticReaderCli([...args,...flags],{...opts(f),fetchImpl:async()=>{calls++;}});
  assert.equal(r.status,'HOLD');assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
