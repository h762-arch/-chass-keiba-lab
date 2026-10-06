import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runFrozenSignalExportPlanCli} from '../scripts/plan-frozen-signal-export.mjs';
const first='20261010-JRA-東京-01',second='20261011-JRA-京都-12';
function sample(ids,check,records={}){
 const dir=mkdtempSync(join(tmpdir(),'chass-plan-')),file=join(dir,'backup.json');
 const bytes=JSON.stringify({format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:1,
  races:Object.fromEntries(ids.map(id=>[id,records[id]??{}]))});
 writeFileSync(file,bytes);
 try{check({file,bytes,args:['--backup',file,'--race-ids',ids.join(',')]});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test('explicit saved IDs produce SELECT plans with all revisions and canonical cache keys',()=>{
 sample([second,first],f=>{
  const r=runFrozenSignalExportPlanCli(f.args);assert.equal(r.status,'READY');
  assert.deepEqual(r.requestedRaceIds,[first,second]);
  assert.equal(r.races[1].resultCacheKey,'result|2026-10-11|京都|12');
  assert.match(r.queries.snapshots,/ORDER BY race_id,revision ASC;/);assert.doesNotMatch(r.queries.snapshots,/LIMIT/);
  assert.match(r.queries.snapshots,/jra-ability-data-v2/);assert.match(r.queries.results,/organization='JRA'/);
  assert.equal(r.backupSha256,createHash('sha256').update(f.bytes).digest('hex'));
  assert.equal(readFileSync(f.file,'utf8'),f.bytes);assert.equal(r.formalKpiEligible,false);assert.equal(r.productionActivationReady,false);
  assert.equal(r.signalAudit.excludedRaceCount,2);assert.equal(r.signalAudit.reasonCounts.SIGNAL_SNAPSHOT_MISSING,2);
  const child=spawnSync(process.execPath,['scripts/plan-frozen-signal-export.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),r);assert.equal(child.stderr,'');
 });
});
test('missing, duplicate, NAR, invalid dates and out of range IDs fail closed',()=>{
 sample([first],f=>{
  for(const ids of [first+','+first,'20261010-JRA-東京-02','20260230-JRA-東京-01'])
   assert.equal(runFrozenSignalExportPlanCli(['--backup',f.file,'--race-ids',ids]).status,'REJECTED');
 });
 for(const id of ['20261010-NAR-大井-01','20261010-JRA-東京-13','20261010-JRA-東|京-01','20261010-JRA-東\t京-01'])
  sample([id],f=>assert.equal(runFrozenSignalExportPlanCli(f.args).status,'REJECTED'));
});
test('quotes in labels remain inside SQL literals',()=>{
 const track="東'); DELETE FROM jra_official_cache; --京",id=`20261010-JRA-${track}-01`;
 sample([id],f=>{
  const r=runFrozenSignalExportPlanCli(f.args);assert.equal(r.status,'READY');
  const literals=sql=>sql.replace(/'(?:''|[^'])*'/g,"''");
  for(const sql of Object.values(r.queries)){
   assert.match(sql,/東''\); DELETE/);assert.doesNotMatch(literals(sql),/DELETE|--/);
   assert.equal((literals(sql).match(/;/g)??[]).length,1);
  }
 });
});
test('identity mismatch refuses SQL while missing signals remain diagnostic targets',()=>{
 sample([first],f=>assert.equal(runFrozenSignalExportPlanCli(f.args).reason,'SIGNAL_RACE_IDENTITY_MISMATCH'),
  {[first]:{marketSnapshot:{raceId:second}}});
 sample([first],f=>{
  const r=runFrozenSignalExportPlanCli(f.args);assert.equal(r.status,'READY');
  assert.equal(r.signalAudit.reasonCounts.SIGNAL_PROVISIONAL,1);assert.deepEqual(r.requestedRaceIds,[first]);
 },{[first]:{marketSnapshot:{signalSnapshot:{status:'provisional'}}}});
});
test('invalid arguments, unreadable and malformed backups produce rejection JSON',()=>{
 assert.equal(runFrozenSignalExportPlanCli([]).reason,'INVALID_CLI_ARGUMENTS');
 sample([first],f=>{
  assert.equal(runFrozenSignalExportPlanCli([...f.args,'--backup',f.file]).reason,'INVALID_CLI_ARGUMENTS');
  writeFileSync(f.file,'{');assert.equal(runFrozenSignalExportPlanCli(f.args).reason,'BACKUP_FILE_READ_FAILED');
  writeFileSync(f.file,'{}');assert.equal(runFrozenSignalExportPlanCli(f.args).reason,'INVALID_RESEARCH_BACKUP');
  const child=spawnSync(process.execPath,['scripts/plan-frozen-signal-export.mjs',...f.args],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(JSON.parse(child.stdout).queries,null);
 });
});
