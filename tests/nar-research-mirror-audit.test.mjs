import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {projectNarResearchChatMirror} from '../src/research/nar-research-chat-mirror.mjs';
import {auditNarResearchMirror} from '../src/research/nar-research-mirror-audit.mjs';
import {runNarResearchMirrorAuditCli} from '../scripts/audit-nar-research-mirror.mjs';
const date='2026-10-16',slug='kawasaki',capturedAt='2026-10-16T12:00:00.000Z',now=Date.parse('2026-10-16T12:05:00.000Z');
const flags={researchOnly:true,formalKpiEligible:false,productionActivationReady:false};
function syncFiles(b){const {races,...metadata}=b.day;b.raceFiles=races.map(r=>({path:`chat-snapshot/research-nar/${date}/${slug}/race-${String(r.raceNumber).padStart(2,'0')}.json`,payload:{...structuredClone(metadata),raceCount:1,totalHorseCount:r.horseCount,race:structuredClone(r)}}));return b;}
function sealStatus(b){b.snapshot.payloadSha256=createHash('sha256').update(JSON.stringify(b.snapshot.payload)).digest('hex');const {payload,...metadata}=b.snapshot;b.attempt={...metadata,snapshotPath:`chat-snapshot/status/${date}/nar-precompute-status.json`};b.manifest.statusMirror={latestAttemptPath:'chat-snapshot/status/latest-attempt.json',latestAttempt:structuredClone(b.attempt)};return b;}
function fixture(){
 const viewer={ok:true,date,track:'川崎',organization:'NAR',count:1,viewerMode:'nar-precomputed-ability-research',marketEvaluation:'disabled',...flags,races:[{raceId:'20261016-NAR-21-05',date,track:'川崎',organization:'NAR',raceNo:5,raceName:'研究用',postTime:'17:00',distance:1500,surface:'ダート',...flags,horses:[1,2].map(n=>({horseNo:n,horseName:`PRIVATE_NAME_${n}`,abilityScore:n===1?103:47,abilityRank:n,predictedTime:n===1?{text:'1:37.0'}:{},runnerStatus:'active',ability:{score:n===1?103:47},probability:{win:null,top3:null,status:'MODEL_HOLD'},market:{odds:null,popularity:null},mark:null}))}]};
 const day=projectNarResearchChatMirror(viewer,{date,slug,capturedAt});
 const payload={ok:true,date,schemaReady:true,historyStoreSchemaReady:true,savedRaceCount:1,rejectedRowCount:0,races:[{raceId:'20261016-NAR-21-05',track:'川崎',raceNo:5,horseCount:2,abilityCount:2,timeCount:1}],scheduleStatus:'SKIPPED',...flags};
 const snapshot={schemaVersion:'chass-nar-status-snapshot-v1',status:'CAPTURED',date,sourceUrl:`https://chass-keiba-lab7.h7625421.workers.dev/api/chass/v1/public/nar-precompute-status?date=${date}&format=compact`,attemptedAt:'2026-10-16T11:59:59.000Z',capturedAt,payloadSha256:'',hashBasis:'UTF8_JSON_STRINGIFY_PAYLOAD',readOnlyCapture:true,payload};
 const manifest={ok:true,schemaVersion:'chass-chat-mirror-manifest-v1',branch:'chass-data',snapshots:[{date,track:'川崎',trackSlug:slug,organization:'NAR',raceCount:1,totalHorseCount:2,latestPredictionAt:null,latestOddsAt:null,abilityOnlyFallback:true,identityMismatchCount:0,path:`chat-snapshot/research-nar/${date}/${slug}/day.json`}]};
 return sealStatus(syncFiles({commitSha:'a'.repeat(40),snapshot,manifest,day}));
}
const audit=b=>auditNarResearchMirror(b,{expectedDate:date,slug,now});
test('fresh bundle verifies consistency without certifying EARLY, origin or viewer hash',()=>{const b=fixture(),before=structuredClone(b),r=audit(b);assert.equal(r.status,'VERIFIED');assert.equal(r.consistencyStatus,'CROSS_FILE_CONSISTENT');assert.equal(r.currentStatusEligible,true);assert.deepEqual(r.totals,{horseCount:2,abilityCount:2,timeCount:1,missingTimeCount:1});assert.equal(r.fileCount,2);assert.equal(r.originAuthenticated,false);assert.equal(r.acquisitionCertified,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.readiness,'HOLD');assert.equal(r.earlyFreezeVerification,'NOT_VERIFIED');assert.equal(r.viewerPayloadHashVerification,'NOT_RECOMPUTABLE_FROM_PROJECTED_FILES');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(JSON.stringify(r).includes('PRIVATE_NAME'),false);assert.deepEqual(b,before);});
test('inclusive 30-minute boundary and actual stale HOLD preserve counts/timestamps',()=>{const b=fixture();assert.equal(auditNarResearchMirror(b,{expectedDate:date,slug,now:Date.parse(capturedAt)+1800000}).status,'VERIFIED');const r=auditNarResearchMirror(b,{expectedDate:date,slug,now:Date.parse(capturedAt)+1800001});assert.deepEqual(r.reasonCodes,['STATUS_SNAPSHOT_STALE','RESEARCH_CAPTURE_STALE']);assert.equal(r.currentStatusEligible,false);assert.equal(r.consistencyStatus,'CROSS_FILE_CONSISTENT');assert.equal(r.totals.horseCount,2);assert.equal(r.sourceReference.capturedAt,capturedAt);});
test('fresh research never promotes stale status',()=>{const b=fixture();b.snapshot.attemptedAt='2026-10-16T11:00:00.000Z';b.snapshot.capturedAt='2026-10-16T11:00:01.000Z';const r=audit(sealStatus(b));assert.deepEqual(r.reasonCodes,['STATUS_SNAPSHOT_STALE']);});
test('fresh status never promotes stale research',()=>{const b=fixture();b.day.capturedAt='2026-10-16T11:00:00.000Z';const r=audit(syncFiles(b));assert.deepEqual(r.reasonCodes,['RESEARCH_CAPTURE_STALE']);});
const invalid=[
 ['missing commit',b=>delete b.commitSha,'BUNDLE_INVALID'],
 ['symbolic commit',b=>b.commitSha='chass-data','BUNDLE_INVALID'],
 ['status hash mismatch',b=>b.snapshot.payload.races[0].timeCount=0,'STATUS_MIRROR_HOLD'],
 ['manifest attempt mismatch',b=>b.manifest.statusMirror.latestAttempt.status='FAILED','STATUS_MIRROR_HOLD'],
 ['wrong research schema',b=>b.day.schemaVersion='legacy','DAY_CONTRACT_INVALID'],
 ['unsafe KPI',b=>b.day.formalKpiEligible=true,'DAY_CONTRACT_INVALID'],
 ['production activation ready',b=>b.day.productionActivationReady=true,'DAY_CONTRACT_INVALID'],
 ['wrong source URL',b=>b.day.sourceUrl+='&token=SECRET','DAY_CONTRACT_INVALID'],
 ['wrong track',b=>b.day.track='金沢','DAY_CONTRACT_INVALID'],
 ['wrong date',b=>b.day.date='2026-10-15','DAY_CONTRACT_INVALID'],
 ['unknown day field',b=>b.day.earlyFrozen=true,'DAY_CONTRACT_INVALID'],
 ['manufactured prediction time',b=>b.day.freshness.latestPredictionAt=capturedAt,'DAY_CONTRACT_INVALID'],
 ['invalid declared source hash',b=>b.day.sourcePayloadSha256='invalid','DAY_CONTRACT_INVALID'],
 ['future research',b=>b.day.capturedAt='2026-10-16T12:06:00.000Z','DAY_TIME_INVALID'],
 ['wrong race venue',b=>b.day.races[0].raceId='20261016-NAR-22-05','RACE_INVALID'],
 ['manufactured source cutoff',b=>b.day.races[0].sourceAcquiredAt=capturedAt,'RACE_INVALID'],
 ['duplicate horse',b=>b.day.races[0].horses[1].horseNumber=1,'HORSE_INVALID'],
 ['nonfinite score',b=>b.day.races[0].horses[0].score=NaN,'HORSE_INVALID'],
 ['string score',b=>b.day.races[0].horses[0].score='103','HORSE_INVALID'],
 ['invalid TIME',b=>b.day.races[0].horses[0].predictedTime='1:99.0','HORSE_INVALID'],
 ['missing null signal',b=>delete b.day.races[0].horses[0].warning,'HORSE_INVALID'],
 ['non-null probability',b=>b.day.races[0].horses[0].winProb=.5,'SIGNAL_NOT_NULL'],
 ['non-null mark',b=>b.day.races[0].horses[0].mark='◎','SIGNAL_NOT_NULL'],
 ['non-null diamond',b=>b.day.races[0].horses[0].diamond='💎','SIGNAL_NOT_NULL'],
 ['inconsistent TIME count',b=>b.day.races[0].timeCount=2,'COUNTS_INVALID'],
 ['wrong total horses',b=>b.day.totalHorseCount=3,'COUNTS_INVALID'],
 ['missing race file',b=>b.raceFiles=[],'RACE_FILES_MISMATCH'],
 ['extra race file',b=>b.raceFiles.push(structuredClone(b.raceFiles[0])),'RACE_FILES_MISMATCH'],
 ['path escape',b=>b.raceFiles[0].path='../race-05.json','RACE_FILES_MISMATCH'],
 ['mixed race metadata',b=>b.raceFiles[0].payload.sourcePayloadSha256='b'.repeat(64),'RACE_FILES_MISMATCH'],
 ['race horse differs',b=>b.raceFiles[0].payload.race.horses[0].score=99,'RACE_FILES_MISMATCH'],
 ['manifest entry missing',b=>b.manifest.snapshots=[],'MANIFEST_RESEARCH_MISMATCH'],
 ['manifest entry duplicate',b=>b.manifest.snapshots.push(structuredClone(b.manifest.snapshots[0])),'MANIFEST_RESEARCH_MISMATCH'],
 ['manifest count mismatch',b=>b.manifest.snapshots[0].raceCount=2,'MANIFEST_RESEARCH_MISMATCH'],
 ['manifest path mismatch',b=>b.manifest.snapshots[0].path='chat-snapshot/research-nar/wrong/day.json','MANIFEST_RESEARCH_MISMATCH'],
 ['status horse mismatch',b=>{b.snapshot.payload.races[0].horseCount=3;sealStatus(b);},'STATUS_RESEARCH_MISMATCH'],
 ['status unknown TIME count',b=>{delete b.snapshot.payload.races[0].timeCount;sealStatus(b);},'STATUS_RESEARCH_MISMATCH'],
 ['status wrong race identity',b=>{b.snapshot.payload.races[0].raceId='20261016-NAR-21-07';sealStatus(b);},'STATUS_RESEARCH_MISMATCH']
];
for(const [name,change,reason] of invalid)test(name+' holds',()=>{const b=fixture();change(b);const r=audit(b);assert.equal(r.status,'HOLD');assert.deepEqual(r.reasonCodes,[reason]);assert.equal(r.currentStatusEligible,false);assert.equal(r.totals,null);});
test('matching edits to both projected copies cannot authenticate the full viewer hash',()=>{const b=fixture(),original=b.day.sourcePayloadSha256;b.day.races[0].horses[0].score=104;syncFiles(b);const r=audit(b);assert.equal(r.status,'VERIFIED');assert.equal(r.sourceReference.declaredViewerPayloadSha256,original);assert.equal(r.viewerPayloadHashVerification,'NOT_RECOMPUTABLE_FROM_PROJECTED_FILES');assert.equal(r.acquisitionCertified,false);});
test('duplicate day races and invalid audit options hold',()=>{const b=fixture();b.day.races.push(structuredClone(b.day.races[0]));b.day.raceCount=2;assert.equal(audit(b).status,'HOLD');for(const options of [{slug:'tokyo'},{expectedDate:'2026-02-30'},{now:NaN},{now:1e20}])assert.equal(auditNarResearchMirror(fixture(),{expectedDate:date,slug,now,...options}).status,'HOLD');});
test('CLI ignores bundle clock/policy claims, enforces local file bounds and strict options',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'nar-mirror-audit-')),file=path.join(dir,'bundle.json');try{const b=fixture();b.now=now;b.maxAgeMs=86400000;await writeFile(file,JSON.stringify(b));const args=['--bundle',file,'--date',date,'--slug',slug];const r=await runNarResearchMirrorAuditCli(args);assert.equal(r.status,'HOLD');assert.ok(r.reasonCodes.includes('RESEARCH_CAPTURE_STALE'));assert.equal(r.sourceReference.capturedAt,capturedAt);for(const bad of [[],[...args,'--now','0'],['--bundle','https://private','--date',date,'--slug',slug]])await assert.rejects(runNarResearchMirrorAuditCli(bad));for(const bytes of [Buffer.from([255]),Buffer.from('{'),Buffer.alloc(4*1024*1024+1)]){await writeFile(file,bytes);await assert.rejects(runNarResearchMirrorAuditCli(args));}}finally{await rm(dir,{recursive:true,force:true});}});
