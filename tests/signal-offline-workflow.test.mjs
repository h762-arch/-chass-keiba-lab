import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const raceId='20261010-JRA-東京-01',now='2026-10-10T03:00:00Z';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function cli(name,args,expected){
 const r=spawnSync(process.execPath,[`scripts/${name}.mjs`,...args],{encoding:'utf8',timeout:5000});
 assert.equal(r.error,undefined);assert.equal(r.status,expected,r.stderr);return r;
}
// Synthetic evidence only: no meeting existence, Production provenance or prediction quality claim.
function sample({format='rows',pending=false,badEarliest=false}={},check){
 const dir=mkdtempSync(join(tmpdir(),'chass-workflow-'));
 const files=Object.fromEntries(['backup','snapshots','results','cache','comparison'].map(k=>[k,join(dir,`${k}.json`)]));
 const policyVersion='CHASS-SIGNAL-v1.0';
 const signal={schemaVersion:1,policyVersion,status:'frozen',frozenAt:'2026-10-10T00:02:00Z',horses:[{
  horseNo:1,valueMark:'💎',popularityAtFreeze:6,oddsAtFreeze:20,evAtFreeze:120,
  longshotScenario:{policyVersion,level:'place',scenario:'2〜3着',marketValue:true,
   evidence:[{code:'LAST3F',strength:2,label:'合成テスト用の能力根拠'}]}}]};
 const backup={format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:1,races:{[raceId]:{marketSnapshot:{raceId,signalSnapshot:signal}}}};
 const row={organization:'JRA',race_id:raceId,revision:1,source_validated_at:'2026-10-10T00:00:00Z',
  data_calculated_at:'2026-10-10T00:01:00Z',calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',
  status:'PARTIAL',data_json:JSON.stringify({schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
   race:{date:'2026-10-10',racecourse:'東京',raceNo:1,postTime:'10:05'},
   horses:[1,2,3,4].map(horseNo=>({horseNo,horseName:`合成馬${horseNo}`,abilityRank:horseNo,overall:80,win:20,place:40}))})};
 const snapshotRows=badEarliest?[{...row,data_json:'{malformed'},{...row,revision:2}]:[row];
 const resultRows=pending?[]:[{organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:1,fetched_at:'2026-10-10T02:00:00Z',
  payload_json:JSON.stringify({ok:true,organization:'JRA',source:'JRA_OFFICIAL',date:'2026-10-10',track:'東京',race:1,
   quality:{complete:true,finishOrderCount:3},finishOrder:[2,1,3],results:[2,1,3,4].map((horseNo,i)=>({horseNo,position:i+1}))})}];
 const wrap=rows=>format==='rows'?rows:[{success:true,results:rows,meta:{synthetic:true}}];
 writeFileSync(files.backup,JSON.stringify(backup));writeFileSync(files.snapshots,JSON.stringify(wrap(snapshotRows)));
 writeFileSync(files.results,JSON.stringify(wrap(resultRows)));
 const originals=[files.backup,files.snapshots,files.results].map(p=>readFileSync(p));
 try{
  const plan=JSON.parse(cli('plan-frozen-signal-export',['--backup',files.backup,'--race-ids',raceId],0).stdout);
  assert.equal(plan.backupSha256,hash(files.backup));assert.equal(plan.races[0].resultCacheKey,'result|2026-10-10|東京|1');
  const imported=cli('import-frozen-signal-cache',['--snapshots',files.snapshots,'--results',files.results,'--format',format],0);
  writeFileSync(files.cache,imported.stdout);const cache=JSON.parse(imported.stdout);
  assert.equal(cache.exportProvenance.snapshotExportSha256,hash(files.snapshots));
  assert.equal(cache.exportProvenance.resultExportSha256,hash(files.results));assert.deepEqual(cache.snapshotRows,snapshotRows);
  const expected=pending||badEarliest?2:0;
  const compared=cli('compare-frozen-signals',['--backup',files.backup,'--cache',files.cache,'--race-ids',raceId,'--now',now],expected);
  writeFileSync(files.comparison,compared.stdout);const comparison=JSON.parse(compared.stdout);
  assert.equal(comparison.cacheSha256,hash(files.cache));assert.equal(comparison.summary.formalKpiEligible,false);
  assert.equal(comparison.productionActivationReady,false);
  const args=['--backup',files.backup,'--cache',files.cache,'--comparison',files.comparison];
  const verified=JSON.parse(cli('verify-frozen-signal-comparison',args,0).stdout);
  assert.equal(verified.status,'VERIFIED');assert.equal(verified.comparisonExitCode,expected);
  const report=cli('report-frozen-signals',args,expected).stdout;
  assert.match(report,/NO-GO/);assert.match(report,/LOCAL_FILES_NOT_AUTHENTICATED/);
  assert.deepEqual([files.backup,files.snapshots,files.results].map(p=>readFileSync(p)),originals);
  check({files,args,comparison,verified,report});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
for(const format of ['rows','d1-json'])test(`full offline workflow with ${format} preserves evidence and reports diamond place hit`,()=>{
 sample({format},f=>{
  assert.equal(f.comparison.summary.observedHorseCount,1);
  assert.match(f.report,/\| 💎 \| 1 \| 1 \| 1\/1 \(100\.00%\) \| 0\/1 \(0\.00%\) \| 1\/1 \(100\.00%\) \|/);
 });
});
test('pending official results remain unobserved throughout the complete workflow',()=>{
 sample({pending:true},f=>{
  assert.equal(f.comparison.summary.pendingRaceCount,1);assert.equal(f.comparison.summary.observedHorseCount,0);
  assert.match(f.report.replaceAll('\\_','_'),/OFFICIAL_RESULT_NOT_FOUND/);
  assert.match(f.report,/0\/0 \(未観測\)/);assert.doesNotMatch(f.report,/\(0\.00%\)/);
 });
});
test('malformed earliest DATA is preserved and never replaced by a later valid revision',()=>{
 sample({badEarliest:true},f=>{
  assert.equal(f.comparison.summary.observedHorseCount,0);
  assert.match(f.report.replaceAll('\\_','_'),/EARLY_MALFORMED_DATA/);
  assert.match(f.report,/0\/0 \(未観測\)/);
 });
});
test('changed comparison or original backup refuses final reports after a successful workflow',()=>{
 sample({},f=>{
  const original=readFileSync(f.files.comparison,'utf8'),changed=JSON.parse(original);
  changed.summary.groups[0].scenarioHits=0;writeFileSync(f.files.comparison,JSON.stringify(changed));
  const refused=cli('report-frozen-signals',f.args,1);assert.equal(refused.stdout,'');
  assert.equal(JSON.parse(refused.stderr).reason,'COMPARISON_REPLAY_MISMATCH');
  assert.equal(JSON.parse(cli('verify-frozen-signal-comparison',f.args,1).stdout).status,'REJECTED');
  writeFileSync(f.files.comparison,original);writeFileSync(f.files.backup,readFileSync(f.files.backup,'utf8')+'\n');
  const changedInput=cli('report-frozen-signals',f.args,1);assert.equal(changedInput.stdout,'');
  assert.equal(JSON.parse(changedInput.stderr).reason,'COMPARISON_REPLAY_MISMATCH');
 });
});
