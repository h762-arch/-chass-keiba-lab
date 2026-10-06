import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,truncateSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runFrozenSignalCacheImportCli} from '../scripts/import-frozen-signal-cache.mjs';
import {createOfflineSignalOutcomeDb} from '../scripts/compare-frozen-signals.mjs';
const snapshot={organization:'JRA',race_id:'20261010-JRA-東京-01',revision:1,
 calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',
 source_validated_at:'2026-10-10T00:00:00Z',data_calculated_at:null,data_json:'{broken'};
const result={organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:1,
 fetched_at:'2026-10-10T12:00:00+09:00',payload_json:'{"source":"UNVERIFIED"}'};
function sample(snapshots,results,format,check){
 const dir=mkdtempSync(join(tmpdir(),'chass-import-')),s=join(dir,'snapshots.json'),r=join(dir,'results.json');
 writeFileSync(s,JSON.stringify(snapshots));writeFileSync(r,JSON.stringify(results));
 try{check({s,r,args:['--snapshots',s,'--results',r,'--format',format]});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test('raw rows preserve malformed earliest DATA, source, timestamps and input bytes',async()=>{
 sample([snapshot,{...snapshot,revision:2,data_json:'{"valid":true}'}],[result],'rows',f=>{
  const before=[f.s,f.r].map(p=>readFileSync(p));
  const imported=runFrozenSignalCacheImportCli(f.args);assert.equal(imported.status,'READY');
  assert.deepEqual(imported.cache.snapshotRows,[snapshot,{...snapshot,revision:2,data_json:'{"valid":true}'}]);
  assert.deepEqual(imported.cache.resultRows,[result]);
  assert.equal(imported.cache.exportProvenance.snapshotExportSha256,createHash('sha256').update(before[0]).digest('hex'));
  assert.equal(imported.cache.exportProvenance.inputProvenance,'LOCAL_FILES_NOT_AUTHENTICATED');
  assert.deepEqual([f.s,f.r].map(p=>readFileSync(p)),before);
  assert.equal(imported.formalKpiEligible,false);assert.equal(imported.productionActivationReady,false);
  const child=spawnSync(process.execPath,['scripts/import-frozen-signal-cache.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),imported.cache);assert.equal(child.stderr,'');
 });
});
test('one successful D1 envelope preserves pending results and works with offline reader',async()=>{
 let cache;
 sample([{success:true,results:[snapshot],meta:{duration:1}}],[{success:true,results:[]}],'d1-json',f=>{
  const imported=runFrozenSignalCacheImportCli(f.args);assert.equal(imported.status,'READY');cache=imported.cache;
  assert.deepEqual(cache.resultRows,[]);
 });
 const db=createOfflineSignalOutcomeDb(cache);
 const sql="SELECT organization,race_date,track,race_no,payload_json,fetched_at FROM jra_official_cache WHERE kind='result' AND cache_key=?";
 assert.equal(await db.prepare(sql).bind('result|2026-10-10|東京|1').first(),null);
});
test('ambiguous, failed and mismatched envelope formats refuse output',()=>{
 for(const value of [[],[{success:false,results:[]}],[{success:true,results:[],error:'failure'}],
  [{success:true,results:[],errors:['failure']}],[{success:true,results:[]},{success:true,results:[]}],{results:[]}]){
  sample(value,[{success:true,results:[]}],'d1-json',f=>{
   assert.equal(runFrozenSignalCacheImportCli(f.args).reason,'EXPORT_FORMAT_INVALID');
   const child=spawnSync(process.execPath,['scripts/import-frozen-signal-cache.mjs',...f.args],{encoding:'utf8'});
   assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(JSON.parse(child.stderr).cache,null);
  });
 }
 sample([{success:true,results:[]}],[],'rows',f=>assert.equal(runFrozenSignalCacheImportCli(f.args).reason,'CACHE_INPUT_INVALID'));
});
test('duplicates, invalid row identities and row limits are rejected rather than filtered',()=>{
 for(const rows of [[snapshot,snapshot],[{...snapshot,organization:'NAR'}],Array.from({length:1001},(_,i)=>({...snapshot,revision:i+1}))])
  sample(rows,[],'rows',f=>assert.equal(runFrozenSignalCacheImportCli(f.args).reason,'CACHE_INPUT_INVALID'));
 sample([snapshot],[result,result],'rows',f=>assert.equal(runFrozenSignalCacheImportCli(f.args).reason,'CACHE_INPUT_INVALID'));
});
test('invalid arguments, unreadable JSON and oversize files fail closed',()=>{
 assert.equal(runFrozenSignalCacheImportCli([]).reason,'INVALID_CLI_ARGUMENTS');
 sample([],[],'rows',f=>{
  assert.equal(runFrozenSignalCacheImportCli([...f.args,'--format','rows']).reason,'INVALID_CLI_ARGUMENTS');
  writeFileSync(f.s,'{');assert.equal(runFrozenSignalCacheImportCli(f.args).reason,'EXPORT_FILE_READ_FAILED');
  truncateSync(f.s,32*1024*1024+1);assert.equal(runFrozenSignalCacheImportCli(f.args).reason,'EXPORT_FILE_READ_FAILED');
 });
});
