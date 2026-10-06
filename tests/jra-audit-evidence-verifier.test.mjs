import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildProductionJraAuditEvidence} from '../scripts/jra-production-audit-evidence.mjs';
import {verifyJraAuditEvidence} from '../scripts/jra-audit-evidence-verifier.mjs';

const id=n=>`20261010-JRA-東京-0${n}`;
const report={targetDate:'2026-10-10',checkedAt:'2026-10-10T08:00:00.000Z',
 migration:'PASS',schema:'PASS',indexes:'PASS',meeting:'PASS',race:'PASS',snapshotAudit:'PASS',
 snapshotDataRaceIds:[id(2),id(1)],productionActivationReady:true};
const kpi={status:'READY',reason:null,summary:{requestedRaceCount:2,formalRaceCount:1,excludedRaceCount:1,
 matchedRunnerCount:5,timeSampleCount:1,timeRaceCount:1,meanRaceWinBrier:.2,meanRaceTop3Brier:.3,meanRaceTimeMaeSeconds:.4,
 included:[{raceId:id(1),earlyRevision:1,matchedRunnerCount:5,timeSampleCount:1}],
 excluded:[{raceId:id(2),status:'PENDING',reason:'OFFICIAL_RESULT_NOT_FOUND'}]}};
const shadow={status:'READY',reason:null,summary:{requestedRaceCount:2,observedRaceCount:1,excludedRaceCount:1,
 winHits:1,top3Hits:1,winHitRate:1,top3HitRate:1,
 observations:[{raceId:id(1),earlyRevision:1,horseNo:5,winHit:true,top3Hit:true}],
 excluded:[{raceId:id(2),status:'PENDING',reason:'OFFICIAL_RESULT_NOT_FOUND'}]}};
const commitSha='807245e534fffcb9e23f46ad66cb32fb973e5986';

const exported=()=>buildProductionJraAuditEvidence({report,kpi,shadow,commitSha});
const options=()=>({...exported(),targetDate:report.targetDate,commitSha});
const rehash=json=>createHash('sha256').update(json,'utf8').digest('hex');

test('exported evidence verifies offline without changing the Original Signal or authorizing Activation',()=>{
 const input=options(),before=JSON.stringify(input),oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=()=>{calls++;throw Error('network forbidden');};
 try{
  const result=verifyJraAuditEvidence(input);
  assert.equal(result.status,'VERIFIED');assert.equal(result.productionActivationReady,false);
  assert.equal(result.starFormalMarkAdopted,false);assert.equal(result.formalKpiStatus,'READY');
  assert.equal(result.scope,'CONTENT_AND_METADATA_CONSISTENCY_ONLY');
  assert.equal(JSON.stringify(input),before);assert.equal(calls,0);
 }finally{globalThis.fetch=oldFetch;}
});

test('changed bytes, missing final newline, wrong date and wrong commit are rejected',()=>{
 const input=options();
 for(const json of [input.json+' ',input.json.slice(0,-1),input.json.replace('東京','京都')])
  assert.equal(verifyJraAuditEvidence({...input,json}).reason,'HASH_MISMATCH');
 assert.equal(verifyJraAuditEvidence({...input,targetDate:'2026-10-11'}).reason,'EVIDENCE_IDENTITY_MISMATCH');
 assert.equal(verifyJraAuditEvidence({...input,commitSha:'0'.repeat(40)}).reason,'EVIDENCE_IDENTITY_MISMATCH');
});

test('a recomputed digest cannot bypass schema, NO-GO flags, counts or EARLY revision consistency',()=>{
 const input=options();
 for(const change of [
  e=>{e.productionActivationReady=true;},e=>{e.starFormalMarkAdopted=true;},
  e=>{e.calculationVersion='jra-ability-data-v1';},e=>{e.scope='ACTIVATION';},
  e=>{e.privateToken='must not appear';},e=>{e.starResearch.summary.winHits=0;},
  e=>{e.starResearch.summary.winHitRate=.5;},
  e=>{e.starResearch.summary.observations[0].earlyRevision=2;},
  e=>{e.starResearch.summary.observations[0].top3Hit=false;},
  e=>{e.formalKpi.summary.matchedRunnerCount=6;},
  e=>{e.formalKpi.summary.meanRaceWinBrier=2;},
  e=>{e.starResearch.summary.excluded[0].raceId=id(1);}
 ]){
  const e=JSON.parse(input.json);change(e);const json=JSON.stringify(e,null,2)+'\n';
  assert.equal(verifyJraAuditEvidence({...input,json,sha256:rehash(json)}).status,'REJECTED');
 }
});

test('empty and blocked evidence can have consistent content but never imply data or Activation readiness',()=>{
 for(const status of ['EMPTY','BLOCKED']){
  const empty={status,reason:status==='EMPTY'?'NO_V2_DATA':'SHADOW_READ_OR_VALIDATION_FAILED',summary:null};
  const e=buildProductionJraAuditEvidence({report:{...report,snapshotAudit:'EMPTY',snapshotDataRaceIds:[]},kpi:empty,shadow:empty,commitSha});
  const verified=verifyJraAuditEvidence({...e,targetDate:report.targetDate,commitSha});
  assert.equal(verified.status,'VERIFIED');assert.equal(verified.starResearchStatus,status);
  assert.equal(verified.productionActivationReady,false);
 }
});

test('malformed, oversized and incomplete verifier inputs fail with safe errors',()=>{
 const input=options();
 assert.equal(verifyJraAuditEvidence().reason,'INVALID_VERIFIER_INPUT');
 assert.equal(verifyJraAuditEvidence({...input,json:'x'.repeat(2*1024*1024+1)}).reason,'INVALID_VERIFIER_INPUT');
 assert.equal(verifyJraAuditEvidence({...input,json:'{broken',sha256:rehash('{broken')}).reason,'MALFORMED_EVIDENCE');
 assert.equal(verifyJraAuditEvidence({...input,sha256:'not-a-digest'}).reason,'INVALID_VERIFIER_INPUT');
});

test('CLI reads a local export unchanged, succeeds on valid input and exits nonzero on mismatch',t=>{
 const dir=mkdtempSync(join(tmpdir(),'chass-evidence-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=options(),file=join(dir,'audit.json');writeFileSync(file,input.json);
 const script=new URL('../scripts/verify-jra-audit-evidence.mjs',import.meta.url);
 const args=['--file',file,'--sha256',input.sha256,'--target-date',report.targetDate,'--commit-sha',commitSha];
 const run=extra=>spawnSync(process.execPath,[script.pathname,...extra],{encoding:'utf8',timeout:5000});
 const good=run(args);assert.equal(good.status,0);assert.equal(JSON.parse(good.stdout).status,'VERIFIED');
 const bad=run([...args.slice(0,3),'0'.repeat(64),...args.slice(4)]);
 assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stdout).reason,'HASH_MISMATCH');
 const duplicate=run([...args,'--file',file]);assert.equal(duplicate.status,1);
 assert.equal(JSON.parse(duplicate.stdout).reason,'INVALID_CLI_ARGUMENTS');
 assert.equal(readFileSync(file,'utf8'),input.json);
});
