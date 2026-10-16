import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {auditNarDirectStatus} from '../src/research/nar-direct-status-audit.mjs';
import {runNarDirectStatusAuditCli} from '../scripts/audit-nar-direct-status.mjs';
const expectedDate='2026-10-16',now=Date.parse('2026-10-16T06:15:00.000Z');
const seal=c=>{c.payloadSha256=createHash('sha256').update(JSON.stringify(c.payload)).digest('hex');return c;};
function fixture(){
 const run={status:'RECORDED',scheduledAt:'2026-10-16T06:10:18.556Z',runDate:expectedDate,runStatus:'SKIPPED',reason:'DAILY_WINDOW_CLOSED',attempted:0,saved:0,autoResultProcessed:0,events:[]};
 const p={ok:true,date:expectedDate,schemaReady:true,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,savedRaceCount:2,rejectedRowCount:0,enabled:true,active:false,scheduleMode:'daily',scheduleStatus:'SKIPPED',scheduleReason:'DAILY_WINDOW_CLOSED',dailyFrom:'2026-10-14',dailyUntil:'2026-10-20',dailyStartJst:'07:00',dailyStopJst:'14:55',narRunAudit:run,lastNarRunAt:run.scheduledAt,lastNarStatus:run.runStatus,lastNarReason:run.reason,lastNarAttempted:0,lastNarSaved:0,lastNarEvents:[],races:[5,7].map(n=>({raceId:`20261016-NAR-21-${String(n).padStart(2,'0')}`,track:'川崎',raceNo:n,horseCount:10,abilityCount:10,timeCount:9,quality:{schemaVersion:1,horseCount:10,activeHorseCount:10,activeAbilityCount:10,activeTimeCount:9},historyLinkAudit:{heldEpisodeCount:3},historyStoreAudit:{heldEpisodeCount:0,unresolvedObservationCount:3}}))};
 return seal({schemaVersion:'chass-nar-status-snapshot-v1',status:'CAPTURED',date:expectedDate,sourceUrl:`https://chass-keiba-lab7.h7625421.workers.dev/api/chass/v1/public/nar-precompute-status?date=${expectedDate}&format=compact`,attemptedAt:'2026-10-16T06:10:36.000Z',capturedAt:'2026-10-16T06:10:37.058Z',hashBasis:'UTF8_JSON_STRINGIFY_PAYLOAD',readOnlyCapture:true,payload:p});
}
const audit=c=>auditNarDirectStatus(c,{expectedDate,now});
test('retained rows survive the expected zero-attempt window skip; governance stays held',()=>{const c=fixture(),before=structuredClone(c),r=audit(c);assert.equal(r.status,'OBSERVED');assert.equal(r.captureIntegrityStatus,'VERIFIED');assert.equal(r.savedRaceCount,2);assert.equal(r.run.saved,0);assert.equal(r.run.interpretation,'EXPECTED_WINDOW_CLOSED_SKIP');assert.equal(r.originAuthenticated,false);assert.equal(r.acquisitionCertified,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.readiness,'HOLD');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.scope,'DECLARED_DIRECT_CAPTURE_NOT_GITHUB_MIRROR');assert.deepEqual(c,before);});
test('TIME gaps and possibly overlapping history counters remain separate',()=>{const r=audit(fixture());assert.equal(r.totals.horseCount.total,20);assert.equal(r.totals.timeCount.total,18);assert.equal(r.totals.activeTimeMissing.total,2);assert.equal(r.totals.linkHeldReferences.total,6);assert.equal(r.totals.storeUnresolvedObservations.total,6);assert.equal(r.historyCounterOverlap,'UNKNOWN_DO_NOT_ADD');assert.equal('combinedHistoryTotal' in r.totals,false);});
test('missing optional counts are unknown rather than zero',()=>{const c=fixture();delete c.payload.races[0].timeCount;delete c.payload.races[0].quality;delete c.payload.races[0].historyLinkAudit;const r=audit(seal(c));assert.equal(r.totals.timeCount.total,null);assert.equal(r.totals.timeCount.knownSubtotal,9);assert.equal(r.totals.activeTimeMissing.unknownRaceCount,1);assert.equal(r.totals.linkHeldReferences.total,null);});
test('freshness boundary is inclusive and stale captures keep original timestamp',()=>{const c=fixture(),at=Date.parse(c.capturedAt);assert.equal(auditNarDirectStatus(c,{expectedDate,now:at+1800000}).status,'OBSERVED');const r=auditNarDirectStatus(c,{expectedDate,now:at+1800001});assert.equal(r.status,'HOLD');assert.equal(r.captureIntegrityStatus,'VERIFIED');assert.equal(r.currentStatusEligible,false);assert.deepEqual(r.reasonCodes,['CAPTURE_STALE']);assert.equal(r.sourceReference.capturedAt,c.capturedAt);assert.equal(r.savedRaceCount,2);});
const cases=[
 ['hash tampering',c=>{c.payload.savedRaceCount=1;},false,'PAYLOAD_INVALID'],
 ['payload alteration',c=>{c.payload.races[0].horseName='private';},false,'PAYLOAD_HASH_MISMATCH'],
 ['canonical source mismatch',c=>{c.sourceUrl+='&token=secret';},false,'CAPTURE_INVALID'],
 ['future capture',c=>{c.capturedAt='2026-10-16T07:00:00.000Z';},false,'CAPTURE_TIME_INVALID'],
 ['attempt after capture',c=>{c.attemptedAt='2026-10-16T06:11:00.000Z';},false,'CAPTURE_TIME_INVALID'],
 ['failed capture',c=>{c.status='FAILED';},false,'CAPTURE_INVALID'],
 ['wrong date',c=>{c.date='2026-10-15';},false,'CAPTURE_INVALID'],
 ['wrong hash basis',c=>{c.hashBasis='RAW_HTTP';},false,'CAPTURE_INVALID'],
 ['duplicate race',c=>{c.payload.races[1]=structuredClone(c.payload.races[0]);},true,'RACE_INVALID'],
 ['invalid venue mapping',c=>{c.payload.races[0].raceId='20261016-NAR-22-05';},true,'RACE_INVALID'],
 ['too many runners',c=>{c.payload.races[0].horseCount=31;},true,'RACE_INVALID'],
 ['negative time count',c=>{c.payload.races[0].timeCount=-1;},true,'RACE_INVALID'],
 ['string count',c=>{c.payload.races[0].timeCount='9';},true,'RACE_INVALID'],
 ['inconsistent quality',c=>{c.payload.races[0].quality.activeTimeCount=10;},true,'QUALITY_INVALID'],
 ['inactive coverage impossible',c=>{c.payload.races[0].quality.activeHorseCount=9;c.payload.races[0].quality.activeAbilityCount=7;},true,'QUALITY_INVALID'],
 ['malformed history count',c=>{c.payload.races[0].historyLinkAudit.heldEpisodeCount=1.5;},true,'HISTORY_COUNTS_INVALID'],
 ['missing run counter',c=>{delete c.payload.narRunAudit.attempted;},true,'RUN_INVALID'],
 ['future run',c=>{c.payload.narRunAudit.scheduledAt='2026-10-16T06:11:00.000Z';},true,'RUN_INVALID'],
 ['alias discrepancy',c=>{c.payload.lastNarSaved=1;},true,'RUN_ALIAS_MISMATCH'],
 ['unbounded events',c=>{c.payload.narRunAudit.events=Array(65).fill({reason:'DEADLINE'});c.payload.lastNarEvents=c.payload.narRunAudit.events;},true,'RUN_INVALID'],
 ['wrong race event',c=>{c.payload.narRunAudit.events=[{reason:'DEADLINE',raceId:'20261016-NAR-21-99'}];c.payload.lastNarEvents=c.payload.narRunAudit.events;},true,'RUN_INVALID'],
 ['skip inside window',c=>{c.payload.dailyStopJst='22:00';},true,'WINDOW_SKIP_INCONSISTENT'],
 ['skip date outside period',c=>{c.payload.dailyUntil='2026-10-15';},true,'WINDOW_SKIP_INCONSISTENT'],
 ['skip but active',c=>{c.payload.active=true;},true,'WINDOW_SKIP_INCONSISTENT'],
 ['skip but auto-result ran',c=>{c.payload.narRunAudit.autoResultProcessed=1;},true,'WINDOW_SKIP_INCONSISTENT'],
 ['unsafe governance flag',c=>{c.payload.productionActivationReady=true;},true,'PAYLOAD_INVALID']
];
for(const [name,change,rehash,reason] of cases)test(name,()=>{const c=fixture();change(c);const r=audit(rehash?seal(c):c);assert.equal(r.status,'HOLD');assert.deepEqual(r.reasonCodes,[reason]);assert.equal(r.currentStatusEligible,false);});
test('unknown event/reason text never leaks into output',()=>{const c=fixture(),p=c.payload;p.scheduleReason=null;p.narRunAudit.runStatus='COMPLETED';p.narRunAudit.reason='private-secret';p.narRunAudit.events=[{reason:'private-secret'}];p.lastNarStatus='COMPLETED';p.lastNarReason='private-secret';p.lastNarEvents=p.narRunAudit.events;const r=audit(seal(c));assert.equal(r.status,'OBSERVED');assert.equal(r.run.reason,'OTHER_RECORDED_REASON');assert.equal(JSON.stringify(r).includes('private-secret'),false);});
test('completed latest run remains distinct from retained total',()=>{const c=fixture(),p=c.payload;p.scheduleReason=null;p.narRunAudit.runStatus='COMPLETED';p.narRunAudit.reason=null;p.narRunAudit.attempted=1;p.narRunAudit.saved=1;p.lastNarStatus='COMPLETED';p.lastNarReason=null;p.lastNarAttempted=1;p.lastNarSaved=1;const r=audit(seal(c));assert.equal(r.run.interpretation,'SAVE_RECORDED');assert.equal(r.savedRaceCount,2);});
test('CLI accepts only a local capture/date and uses current wall clock',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'nar-direct-'));try{const file=path.join(dir,'capture.json');await writeFile(file,JSON.stringify(fixture()));const r=await runNarDirectStatusAuditCli(['--capture',file,'--date',expectedDate]);assert.ok(['OBSERVED','HOLD'].includes(r.status));assert.equal(r.sourceReference.capturedAt,fixture().capturedAt);for(const args of [[],['--capture',file,'--date',expectedDate,'--now','0'],['--capture','https://private','--date',expectedDate]])await assert.rejects(runNarDirectStatusAuditCli(args));await writeFile(file,Buffer.from([0xff]));await assert.rejects(runNarDirectStatusAuditCli(['--capture',file,'--date',expectedDate]));await writeFile(file,' '.repeat(1000001));await assert.rejects(runNarDirectStatusAuditCli(['--capture',file,'--date',expectedDate]));}finally{await rm(dir,{recursive:true,force:true});}});
