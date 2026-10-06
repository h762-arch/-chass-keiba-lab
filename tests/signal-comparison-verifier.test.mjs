import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {runFrozenSignalComparisonCli} from '../scripts/compare-frozen-signals.mjs';
import {verifyFrozenSignalComparisonCli} from '../scripts/verify-frozen-signal-comparison.mjs';
const raceId='20261010-JRA-東京-01',policyVersion='CHASS-SIGNAL-v1.0';
async function withComparison(check,{pending=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'chass-replay-'));
 const backupFile=join(dir,'backup.json'),cacheFile=join(dir,'cache.json'),comparisonFile=join(dir,'comparison.json');
 const backup={format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:1,races:{[raceId]:{marketSnapshot:{raceId,signalSnapshot:{
  schemaVersion:1,policyVersion,status:'frozen',frozenAt:'2026-10-10T00:02:00Z',horses:[{horseNo:1,valueMark:'💎',
  popularityAtFreeze:6,oddsAtFreeze:20,evAtFreeze:120,longshotScenario:{policyVersion,level:'place',scenario:'2〜3着',marketValue:true,
  evidence:[{code:'LAST3F',strength:2,label:'上がり能力'}]}}]}}}}};
 const cache={schemaVersion:'CHASS-JRA-SIGNAL-CACHE-1',snapshotRows:[{organization:'JRA',race_id:raceId,revision:1,
  source_validated_at:'2026-10-10T00:00:00Z',data_calculated_at:'2026-10-10T00:01:00Z',calculation_version:'jra-ability-data-v2',
  model_version:'10.0.1-jra-drive1-ability',status:'PARTIAL',data_json:JSON.stringify({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
  race:{date:'2026-10-10',racecourse:'東京',raceNo:1,postTime:'10:05'},horses:[1,2,3,4].map(horseNo=>({horseNo,horseName:`馬${horseNo}`,
  abilityRank:horseNo,overall:80,win:20,place:40}))})}],resultRows:pending?[]:[{organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:1,
  fetched_at:'2026-10-10T02:00:00Z',payload_json:JSON.stringify({ok:true,organization:'JRA',source:'JRA_OFFICIAL',date:'2026-10-10',track:'東京',race:1,
  quality:{complete:true,finishOrderCount:3},finishOrder:[2,1,3],results:[2,1,3,4].map((horseNo,i)=>({horseNo,position:i+1}))})}]};
 try{
  writeFileSync(backupFile,JSON.stringify(backup));writeFileSync(cacheFile,JSON.stringify(cache));
  const saved=await runFrozenSignalComparisonCli(['--backup',backupFile,'--cache',cacheFile,'--race-ids',raceId,'--now','2026-10-10T12:00:00+09:00']);
  assert.equal(saved.status,'READY');writeFileSync(comparisonFile,JSON.stringify(saved));
  const args=['--backup',backupFile,'--cache',cacheFile,'--comparison',comparisonFile];
  await check({saved,args,backupFile,cacheFile,comparisonFile});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('comparison verifier reproduces complete outputs and CLI preserves every input byte',async()=>{
 await withComparison(async f=>{
  const before=[f.backupFile,f.cacheFile,f.comparisonFile].map(p=>readFileSync(p,'utf8'));
  assert.equal(f.saved.evaluationNow,'2026-10-10T03:00:00.000Z');
  assert.deepEqual(f.saved.requestedRaceIds,[raceId]);
  const r=await verifyFrozenSignalComparisonCli(f.args);assert.equal(r.status,'VERIFIED');assert.equal(r.comparisonExitCode,0);
  assert.equal(r.verificationScope,'LOCAL_INPUT_REPRODUCIBILITY');assert.equal(r.formalKpiEligible,false);
  assert.equal(r.productionActivationReady,false);assert.equal(r.inputProvenance,'LOCAL_FILES_NOT_AUTHENTICATED');
  const child=spawnSync(process.execPath,['scripts/verify-frozen-signal-comparison.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).status,'VERIFIED');
  assert.deepEqual([f.backupFile,f.cacheFile,f.comparisonFile].map(p=>readFileSync(p,'utf8')),before);
 });
});
test('pending comparisons remain reproducible without claiming complete observations',async()=>{
 await withComparison(async f=>{
  const r=await verifyFrozenSignalComparisonCli(f.args);assert.equal(r.status,'VERIFIED');assert.equal(r.comparisonExitCode,2);
  assert.equal(f.saved.summary.pendingRaceCount,1);assert.equal(f.saved.summary.groups[0].scenarioHitRate,null);
 },{pending:true});
});
test('modified rates, observation flags, hashes and extra readiness claims are rejected',async()=>{
 await withComparison(async f=>{
  for(const change of [s=>{s.summary.groups[0].scenarioHitRate=0;},s=>{s.summary.observations[0].hit=false;},
   s=>{s.backupSha256='0'.repeat(64);},s=>{s.productionActivationReady=true;},s=>{s.extra='claim';}]){
   const s=structuredClone(f.saved);change(s);writeFileSync(f.comparisonFile,JSON.stringify(s));
   assert.equal((await verifyFrozenSignalComparisonCli(f.args)).reason,'COMPARISON_REPLAY_MISMATCH');
  }
 });
});
test('changed input bytes are rejected even when parsed data and observations are identical',async()=>{
 await withComparison(async f=>{
  writeFileSync(f.backupFile,readFileSync(f.backupFile,'utf8')+'\n');
  assert.equal((await verifyFrozenSignalComparisonCli(f.args)).reason,'COMPARISON_REPLAY_MISMATCH');
 });
 await withComparison(async f=>{
  writeFileSync(f.cacheFile,readFileSync(f.cacheFile,'utf8')+'\n');
  assert.equal((await verifyFrozenSignalComparisonCli(f.args)).reason,'COMPARISON_REPLAY_MISMATCH');
 });
});
test('legacy metadata, invalid clocks and changed race selection cannot be silently repaired',async()=>{
 await withComparison(async f=>{
  for(const [change,reason] of [[s=>{delete s.evidenceSchemaVersion;},'COMPARISON_METADATA_INVALID'],
   [s=>{s.evaluationNow='tomorrow';},'COMPARISON_REPLAY_FAILED'],
   [s=>{s.requestedRaceIds=[raceId,raceId];},'COMPARISON_REPLAY_FAILED'],
   [s=>{s.requestedRaceIds=['20261010-JRA-東京-02'];},'COMPARISON_REPLAY_FAILED']]){
   const s=structuredClone(f.saved);change(s);writeFileSync(f.comparisonFile,JSON.stringify(s));
   assert.equal((await verifyFrozenSignalComparisonCli(f.args)).reason,reason);
  }
 });
});
test('invalid arguments, malformed files and failed replay produce rejected JSON and CLI exit 1',async()=>{
 for(const args of [[],['--comparison','x'],['--comparison','x','--comparison','y'],['--extra','x']])
  assert.equal((await verifyFrozenSignalComparisonCli(args)).reason,'INVALID_CLI_ARGUMENTS');
 await withComparison(async f=>{
  writeFileSync(f.comparisonFile,'not json');
  assert.equal((await verifyFrozenSignalComparisonCli(f.args)).reason,'COMPARISON_FILE_READ_FAILED');
  const child=spawnSync(process.execPath,['scripts/verify-frozen-signal-comparison.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(JSON.parse(child.stdout).status,'REJECTED');
  writeFileSync(f.comparisonFile,JSON.stringify(f.saved));writeFileSync(f.cacheFile,'not json');
  assert.equal((await verifyFrozenSignalComparisonCli(f.args)).reason,'COMPARISON_REPLAY_FAILED');
 });
});
