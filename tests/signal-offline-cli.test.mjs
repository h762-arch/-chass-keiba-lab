import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createOfflineSignalOutcomeDb,runFrozenSignalComparisonCli,frozenSignalComparisonExitCode} from '../scripts/compare-frozen-signals.mjs';
const raceId='20261010-JRA-東京-01',policyVersion='CHASS-SIGNAL-v1.0';
function inputs(){
 const horses=Array.from({length:4},(_,i)=>({horseNo:i+1,horseName:`馬${i+1}`,abilityRank:i+1,overall:80-i,win:20-i,place:40-i,predictedTime:'1:20.0'}));
 return {backup:{format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:1,races:{[raceId]:{marketSnapshot:{raceId,signalSnapshot:{
  schemaVersion:1,policyVersion,status:'frozen',frozenAt:'2026-10-10T00:02:00Z',horses:[{horseNo:1,valueMark:'💎',
  popularityAtFreeze:6,oddsAtFreeze:20,evAtFreeze:120,longshotScenario:{policyVersion,level:'place',scenario:'2〜3着',marketValue:true,
  evidence:[{code:'LAST3F',strength:2,label:'上がり能力'}]}}]}}}}},
 cache:{schemaVersion:'CHASS-JRA-SIGNAL-CACHE-1',snapshotRows:[{organization:'JRA',race_id:raceId,revision:1,
 source_validated_at:'2026-10-10T00:00:00Z',data_calculated_at:'2026-10-10T00:01:00Z',calculation_version:'jra-ability-data-v2',
 model_version:'10.0.1-jra-drive1-ability',status:'PARTIAL',data_json:JSON.stringify({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
 race:{date:'2026-10-10',racecourse:'東京',raceNo:1,postTime:'10:05'},horses})}],
 resultRows:[{organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:1,fetched_at:'2026-10-10T02:00:00Z',payload_json:JSON.stringify({
 ok:true,organization:'JRA',source:'JRA_OFFICIAL',date:'2026-10-10',track:'東京',race:1,quality:{complete:true,finishOrderCount:3},
 finishOrder:[2,1,3],results:[2,1,3,4].map((horseNo,i)=>({horseNo,position:i+1}))})}]}};
}
async function withFiles(change,check){
 const dir=mkdtempSync(join(tmpdir(),'chass-offline-')),backupFile=join(dir,'backup.json'),cacheFile=join(dir,'cache.json'),p=inputs();
 try{
  change(p);const backupBytes=JSON.stringify(p.backup),cacheBytes=JSON.stringify(p.cache);
  writeFileSync(backupFile,backupBytes);writeFileSync(cacheFile,cacheBytes);
  const args=['--backup',backupFile,'--cache',cacheFile,'--race-ids',raceId,'--now','2026-10-10T03:00:00Z'];
  await check(await runFrozenSignalComparisonCli(args),{args,backupFile,cacheFile,backupBytes,cacheBytes});
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('offline CLI joins original signals with cache rows, hashes exact inputs and never modifies files',async()=>{
 await withFiles(()=>{},(r,f)=>{
  assert.equal(r.status,'READY');assert.equal(r.summary.groups[0].scenarioHitRate,1);assert.equal(r.readQueryCount,2);
  assert.equal(r.inputProvenance,'LOCAL_FILES_NOT_AUTHENTICATED');assert.equal(r.productionActivationReady,false);
  assert.equal(r.summary.formalKpiEligible,false);assert.equal(frozenSignalComparisonExitCode(r),0);
  for(const [file,bytes,key] of [[f.backupFile,f.backupBytes,'backupSha256'],[f.cacheFile,f.cacheBytes,'cacheSha256']]){
   assert.equal(readFileSync(file,'utf8'),bytes);assert.equal(r[key],createHash('sha256').update(bytes).digest('hex'));
  }
  const processResult=spawnSync(process.execPath,['scripts/compare-frozen-signals.mjs',...f.args],{encoding:'utf8'});
  assert.equal(processResult.status,0);assert.equal(JSON.parse(processResult.stdout).summary.observedHorseCount,1);
 });
});
test('missing official cache rows remain pending with null hit rates and incomplete exit code',async()=>{
 await withFiles(p=>{p.cache.resultRows=[];},r=>{
  assert.equal(r.summary.pendingRaceCount,1);assert.equal(r.summary.groups[0].scenarioHitRate,null);
  assert.equal(frozenSignalComparisonExitCode(r),2);
 });
});
test('cache row duplicates, mixed organizations and invalid formats are rejected',()=>{
 for(const change of [c=>{c.snapshotRows.push(c.snapshotRows[0]);},c=>{c.resultRows.push(c.resultRows[0]);},
  c=>{c.snapshotRows[0].organization='NAR';},c=>{c.schemaVersion='unknown';},c=>{c.resultRows[0].race_date='2026-02-30';}]){
  const c=inputs().cache;change(c);assert.throws(()=>createOfflineSignalOutcomeDb(c),/CACHE_INPUT_INVALID/);
 }
 assert.throws(()=>createOfflineSignalOutcomeDb(inputs().cache).prepare('DELETE FROM races'),/OFFLINE_QUERY_NOT_ALLOWED/);
});
test('malformed earliest DATA and future cache timestamps are not replaced by later usable rows',async()=>{
 await withFiles(p=>{
  p.cache.snapshotRows.push({...p.cache.snapshotRows[0],revision:2});p.cache.snapshotRows[0].data_json='malformed';
 },r=>{assert.equal(r.readerExclusions[0].reason,'EARLY_MALFORMED_DATA');assert.equal(r.summary.observedHorseCount,0);});
 await withFiles(p=>{p.cache.resultRows[0].fetched_at='2026-10-10T04:00:00Z';},r=>{
  assert.equal(r.summary.observedHorseCount,0);assert.equal(frozenSignalComparisonExitCode(r),2);
 });
});
test('CLI requires all explicit arguments and rejects malformed or absent files',async()=>{
 for(const args of [[],['--now','tomorrow'],['--file','x'],['--backup','x','--backup','y']])
  assert.equal((await runFrozenSignalComparisonCli(args)).reason,'INVALID_CLI_ARGUMENTS');
 await withFiles(()=>{},async(r,f)=>{
  assert.equal((await runFrozenSignalComparisonCli([...f.args,'--extra','x'])).reason,'INVALID_CLI_ARGUMENTS');
  assert.equal((await runFrozenSignalComparisonCli([...f.args.slice(0,-1),'2026-02-30T03:00:00Z'])).reason,'INVALID_CLI_ARGUMENTS');
  writeFileSync(f.cacheFile,'malformed');const invalid=await runFrozenSignalComparisonCli(f.args);
  assert.equal(invalid.reason,'INPUT_FILE_READ_FAILED');assert.equal(frozenSignalComparisonExitCode(invalid),1);
 });
});
test('adapter isolates its cache bytes and never invents an official source for local files',async()=>{
 await withFiles(p=>{
  const result=JSON.parse(p.cache.resultRows[0].payload_json);result.source='MANUAL';
  p.cache.resultRows[0].payload_json=JSON.stringify(result);
 },r=>{assert.equal(r.summary.observedHorseCount,0);assert.equal(r.readerExclusions[0].reason,'RESULT_INTEGRITY_FAILED');});
 const p=inputs(),before=JSON.stringify(p.cache);createOfflineSignalOutcomeDb(p.cache);
 assert.equal(JSON.stringify(p.cache),before);
});
