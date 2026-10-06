import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractFrozenSignalsFromBackup} from '../src/research/signal-backup-reader.mjs';
import {auditFrozenSignalCohort} from '../src/research/signal-rule-cohort-audit.mjs';
import {runFrozenSignalAuditCli,frozenSignalAuditExitCode} from '../scripts/audit-frozen-signals.mjs';
const id='20261010-JRA-TOKYO-01',other='20261010-NAR-OHI-02',policyVersion='CHASS-SIGNAL-v1.0';
function backup(){return {format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:1,races:{[id]:{
 marketSnapshot:{raceId:id,signalSnapshot:{schemaVersion:1,policyVersion,status:'frozen',
 frozenAt:'2026-10-10T00:00:00.000Z',horses:[{horseNo:1,valueMark:'💎',popularityAtFreeze:6,
 oddsAtFreeze:20,evAtFreeze:120,longshotScenario:{policyVersion,level:'place',scenario:'2〜3着',
 evidence:[{code:'LAST3F',label:'上がり能力',strength:2}],marketValue:true}}]}},
 horses:[{horseNo:1,popularity:1,odds:1.1,ev:13.2}],resultSnapshot:{finishOrder:[1]},
 resultMarketSnapshot:{odds:1.1}},[other]:{marketSnapshot:{signalSnapshot:{status:'provisional'}}}},
 oddsHistory:{latest:1.1},currentRace:other};}

test('only selected original signals are copied from the app backup, without later data',()=>{
 const b=backup(),before=JSON.stringify(b),r=extractFrozenSignalsFromBackup(b,[id]);
 assert.equal(r.status,'READY');assert.equal(r.entries.length,1);assert.equal(r.productionActivationReady,false);
 assert.deepEqual(Object.keys(r.entries[0].record),['marketSnapshot']);
 assert.equal(r.entries[0].record.marketSnapshot.signalSnapshot.horses[0].oddsAtFreeze,20);
 assert.equal(JSON.stringify(b),before);
 const audit=auditFrozenSignalCohort(r.entries);assert.equal(audit.summary.passHorseCount,1);
 r.entries[0].record.marketSnapshot.signalSnapshot.horses[0].oddsAtFreeze=99;
 assert.equal(b.races[id].marketSnapshot.signalSnapshot.horses[0].oddsAtFreeze,20);
});
test('backup format, version and explicit bounded race selection fail closed',()=>{
 for(const b of [null,{}, {...backup(),schemaVersion:2},{...backup(),races:[]}])
  assert.equal(extractFrozenSignalsFromBackup(b,[id]).reason,'INVALID_RESEARCH_BACKUP');
 for(const ids of [null,[],['bad'],['20260230-JRA-TOKYO-01'],Array(101).fill(id)])
  assert.equal(extractFrozenSignalsFromBackup(backup(),ids).reason,'INVALID_RACE_IDS');
 assert.equal(extractFrozenSignalsFromBackup(backup(),[id,id]).reason,'DUPLICATE_RACE_ID');
});
test('missing and malformed selected records are not silently omitted',()=>{
 assert.equal(extractFrozenSignalsFromBackup(backup(),['20261010-JRA-TOKYO-03']).reason,'BACKUP_RACE_MISSING');
 const b=backup();b.races[id]=null;
 assert.equal(extractFrozenSignalsFromBackup(b,[id]).reason,'INVALID_BACKUP_RECORD');
 const inherited={...backup(),races:Object.create(backup().races)};
 assert.equal(extractFrozenSignalsFromBackup(inherited,[id]).reason,'BACKUP_RACE_MISSING');
});
test('legacy missing signals and provisional warnings are preserved for cohort exclusion',()=>{
 const b=backup();delete b.races[id].marketSnapshot.signalSnapshot;
 const r=auditFrozenSignalCohort(extractFrozenSignalsFromBackup(b,[other,id]).entries);
 assert.equal(r.summary.excludedRaceCount,2);assert.equal(r.summary.auditedRaceCount,0);
 assert.equal(r.summary.reasonCounts.SIGNAL_SNAPSHOT_MISSING,1);
 assert.equal(r.summary.reasonCounts.SIGNAL_PROVISIONAL,1);
});
test('identity conflicts and missing frozen market remain detectable after extraction',()=>{
 const b=backup();b.races[id].marketSnapshot.raceId=other;
 assert.equal(auditFrozenSignalCohort(extractFrozenSignalsFromBackup(b,[id]).entries).summary.reasonCounts.RACE_IDENTITY_MISMATCH,1);
 b.races[id].marketSnapshot.raceId=id;
 delete b.races[id].marketSnapshot.signalSnapshot.horses[0].popularityAtFreeze;
 assert.equal(auditFrozenSignalCohort(extractFrozenSignalsFromBackup(b,[id]).entries).summary.unverifiedHorseCount,1);
});
test('CLI audits explicit backup IDs offline while preserving old cohort mode and file bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'chass-backup-audit-')),file=join(dir,'backup.json');
 try{
  const b=backup(),bytes=JSON.stringify(b);writeFileSync(file,bytes);
  const r=runFrozenSignalAuditCli(['--file',file,'--race-ids',id]);
  assert.equal(r.summary.passHorseCount,1);assert.equal(frozenSignalAuditExitCode(r),0);
  assert.equal(readFileSync(file,'utf8'),bytes);
  assert.equal(runFrozenSignalAuditCli(['--file',file]).status,'REJECTED');
  assert.equal(runFrozenSignalAuditCli(['--file',file,'--race-ids','']).reason,'INVALID_CLI_ARGUMENTS');
  assert.equal(runFrozenSignalAuditCli(['--file',file,'--race-ids',id+',']).reason,'INVALID_RACE_IDS');
  writeFileSync(file,JSON.stringify(extractFrozenSignalsFromBackup(b,[id]).entries));
  assert.equal(runFrozenSignalAuditCli(['--file',file]).summary.passHorseCount,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
