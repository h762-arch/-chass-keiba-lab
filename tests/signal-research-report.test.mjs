import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runFrozenSignalComparisonCli} from '../scripts/compare-frozen-signals.mjs';
import {runFrozenSignalReportCli} from '../scripts/report-frozen-signals.mjs';
async function sample(check,{pending=false,invalidSignal=false,raceId='20261010-JRA-東京-01'}={}){
 const dir=mkdtempSync(join(tmpdir(),'chass-report-')),backupFile=join(dir,'backup.json'),cacheFile=join(dir,'cache.json'),comparisonFile=join(dir,'comparison.json');
 const policyVersion='CHASS-SIGNAL-v1.0',track=raceId.slice(13,-3);
 const signal={schemaVersion:1,policyVersion,status:'frozen',frozenAt:'2026-10-10T00:02:00Z',horses:[{horseNo:1,valueMark:'💎',
  popularityAtFreeze:invalidSignal?5:6,oddsAtFreeze:20,evAtFreeze:120,longshotScenario:{policyVersion,level:'place',scenario:'2〜3着',marketValue:true,
  evidence:[{code:'LAST3F',strength:2,label:'上がり能力'}]}}]};
 const backup={format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:1,races:{[raceId]:{marketSnapshot:{raceId,signalSnapshot:signal}}}};
 const cache={schemaVersion:'CHASS-JRA-SIGNAL-CACHE-1',snapshotRows:[{organization:'JRA',race_id:raceId,revision:1,
  source_validated_at:'2026-10-10T00:00:00Z',data_calculated_at:'2026-10-10T00:01:00Z',calculation_version:'jra-ability-data-v2',
  model_version:'10.0.1-jra-drive1-ability',status:'PARTIAL',data_json:JSON.stringify({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
  race:{date:'2026-10-10',racecourse:track,raceNo:1,postTime:'10:05'},horses:[1,2,3,4].map(horseNo=>({horseNo,horseName:`馬${horseNo}`,
  abilityRank:horseNo,overall:80,win:20,place:40}))})}],resultRows:pending?[]:[{organization:'JRA',race_date:'2026-10-10',track,race_no:1,
  fetched_at:'2026-10-10T02:00:00Z',payload_json:JSON.stringify({ok:true,organization:'JRA',source:'JRA_OFFICIAL',date:'2026-10-10',track,race:1,
  quality:{complete:true,finishOrderCount:3},finishOrder:[2,1,3],results:[2,1,3,4].map((horseNo,i)=>({horseNo,position:i+1}))})}]};
 try{
  writeFileSync(backupFile,JSON.stringify(backup));writeFileSync(cacheFile,JSON.stringify(cache));
  const saved=await runFrozenSignalComparisonCli(['--backup',backupFile,'--cache',cacheFile,'--race-ids',raceId,'--now','2026-10-10T03:00:00Z']);
  assert.equal(saved.status,'READY');writeFileSync(comparisonFile,JSON.stringify(saved));
  await check({saved,args:['--backup',backupFile,'--cache',cacheFile,'--comparison',comparisonFile],backupFile,cacheFile,comparisonFile});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('verified report distinguishes diamond target from win rate and preserves inputs',async()=>{
 await sample(async f=>{
  const before=[f.backupFile,f.cacheFile,f.comparisonFile].map(p=>readFileSync(p,'utf8'));
  const r=await runFrozenSignalReportCli(f.args);assert.equal(r.status,'READY');assert.equal(r.comparisonExitCode,0);
  assert.match(r.report,/\| 💎 \| 1 \| 1 \| 1\/1 \(100\.00%\) \| 0\/1 \(0\.00%\) \| 1\/1 \(100\.00%\) \|/);
  assert.match(r.report,/NO-GO/);assert.match(r.report,/LOCAL_FILES_NOT_AUTHENTICATED/);assert.match(r.report,/シナリオ品質：NOT_EVALUATED/);
  assert.match(r.report,new RegExp(f.saved.backupSha256));assert.match(r.report,new RegExp(f.saved.cacheSha256));
  assert.deepEqual([f.backupFile,f.cacheFile,f.comparisonFile].map(p=>readFileSync(p,'utf8')),before);
  const child=spawnSync(process.execPath,['scripts/report-frozen-signals.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,0);assert.equal(child.stdout,r.report);assert.equal(child.stderr,'');
 });
});
test('pending report names missing results, shows unobserved rates and exits 2',async()=>{
 await sample(async f=>{
  const r=await runFrozenSignalReportCli(f.args);assert.equal(r.comparisonExitCode,2);
  assert.match(r.report.replaceAll('\\_','_'),/OFFICIAL_RESULT_NOT_FOUND/);assert.match(r.report,/0\/0 \(未観測\)/);
  assert.doesNotMatch(r.report,/\(0\.00%\)/);
  const child=spawnSync(process.execPath,['scripts/report-frozen-signals.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,2);assert.equal(child.stdout,r.report);
 },{pending:true});
});
test('invalid frozen signal horses are listed as exclusions rather than losses',async()=>{
 await sample(async f=>{
  const r=await runFrozenSignalReportCli(f.args);assert.equal(r.comparisonExitCode,2);
  assert.match(r.report.replaceAll('\\_','_'),/SIGNAL_VIOLATION/);assert.match(r.report.replaceAll('\\_','_'),/DIAMOND_POPULARITY_OUT_OF_RANGE/);
  assert.match(r.report,/\| 除外馬（比較監査済みレース内） \| 1 \|/);
  assert.match(r.report,/0\/0 \(未観測\)/);
 },{invalidSignal:true});
});
test('tampered comparison and changed input refuse reports with empty CLI stdout',async()=>{
 await sample(async f=>{
  const altered=structuredClone(f.saved);altered.summary.groups[0].scenarioHits=0;writeFileSync(f.comparisonFile,JSON.stringify(altered));
  const r=await runFrozenSignalReportCli(f.args);assert.equal(r.status,'REJECTED');assert.equal(r.report,null);
  const child=spawnSync(process.execPath,['scripts/report-frozen-signals.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(JSON.parse(child.stderr).reason,'COMPARISON_REPLAY_MISMATCH');
 });
 await sample(async f=>{
  writeFileSync(f.backupFile,readFileSync(f.backupFile,'utf8')+'\n');
  assert.equal((await runFrozenSignalReportCli(f.args)).report,null);
 });
 assert.equal((await runFrozenSignalReportCli([])).reason,'INVALID_CLI_ARGUMENTS');
});
test('race labels cannot introduce raw HTML or extra Markdown table cells',async()=>{
 await sample(async f=>{
  const r=await runFrozenSignalReportCli(f.args);assert.equal(r.status,'READY');
  assert.doesNotMatch(r.report,/<script>/);assert.match(r.report,/&lt;script&gt;\\\|x/);
 },{pending:true,raceId:'20261010-JRA-<script>|x-01'});
});
