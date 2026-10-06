import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditFrozenSignalCohort} from '../src/research/signal-rule-cohort-audit.mjs';
import {runFrozenSignalAuditCli,frozenSignalAuditExitCode} from '../scripts/audit-frozen-signals.mjs';
const policyVersion='CHASS-SIGNAL-v1.0';
function entry(no=1){
 const raceId=`20261010-JRA-TOKYO-${String(no).padStart(2,'0')}`;
 return {raceId,record:{marketSnapshot:{raceId,signalSnapshot:{schemaVersion:1,policyVersion,status:'frozen',
  frozenAt:'2026-10-10T00:00:00.000Z',horses:[{horseNo:1,valueMark:'💎',popularityAtFreeze:6,
   oddsAtFreeze:20,evAtFreeze:120,longshotScenario:{policyVersion,level:'place',scenario:'差し脚で2〜3着',
    evidence:[{code:'LAST3F',label:'上がり能力',strength:2}],marketValue:true}},
   {horseNo:2,valueMark:'',warningMark:''}]}}}};
}
const target=e=>e.record.marketSnapshot.signalSnapshot.horses[0];

test('cohort counts structural passes and violations while denying production and EARLY proof',()=>{
 const a=entry(1),b=entry(2);target(b).popularityAtFreeze=5;
 const r=auditFrozenSignalCohort([b,a]);
 assert.equal(r.status,'READY');assert.equal(r.productionActivationReady,false);
 assert.equal(r.summary.auditedRaceCount,2);assert.equal(r.summary.checkedHorseCount,4);
 assert.equal(r.summary.applicableHorseCount,2);assert.equal(r.summary.passHorseCount,1);
 assert.equal(r.summary.violationHorseCount,1);
 assert.equal(r.summary.reasonCounts.DIAMOND_POPULARITY_OUT_OF_RANGE,1);
 assert.equal(r.summary.observations[0].raceId,a.raceId);
 assert.equal(r.summary.predictionStage,'NOT_VERIFIED');assert.equal(r.summary.preRaceTiming,'NOT_VERIFIED');
 assert.equal(r.summary.scenarioQuality,'NOT_EVALUATED');assert.equal(frozenSignalAuditExitCode(r),2);
});
test('bounded cohorts and duplicate race identities fail closed',()=>{
 for(const x of [null,[],Array.from({length:101},(_,i)=>entry(i+1)),[{raceId:'invalid'}],
  [{raceId:'20260230-JRA-TOKYO-01'}],[{raceId:'20261010-JRA-TOKYO-00'}]])
  assert.equal(auditFrozenSignalCohort(x).status,'REJECTED');
 assert.equal(auditFrozenSignalCohort([entry(),entry()]).reason,'DUPLICATE_RACE_ID');
});
test('missing, provisional, conflicting and malformed saved signals are excluded separately',()=>{
 const a=entry(1),b=entry(2),c=entry(3),d=entry(4);
 delete a.record.marketSnapshot.signalSnapshot;
 b.record.marketSnapshot.signalSnapshot.status='provisional';
 c.record.marketSnapshot.raceId='20261010-NAR-OHI-01';
 d.record.marketSnapshot.signalSnapshot.horses.push(target(d));
 const r=auditFrozenSignalCohort([a,b,c,d]);
 assert.equal(r.summary.auditedRaceCount,0);assert.equal(r.summary.excludedRaceCount,4);
 assert.deepEqual(r.summary.excluded.map(e=>e.reason),['SIGNAL_SNAPSHOT_MISSING','SIGNAL_PROVISIONAL',
  'RACE_IDENTITY_MISMATCH','INVALID_HORSE_IDENTITY']);assert.equal(frozenSignalAuditExitCode(r),3);
});
test('legacy snapshot market facts stay unverified despite current and result market data',()=>{
 const e=entry();delete target(e).popularityAtFreeze;
 e.record.horses=[{horseNo:1,popularity:6,odds:20,ev:120}];
 e.record.resultMarketSnapshot={horses:e.record.horses};
 const r=auditFrozenSignalCohort([e]);assert.equal(r.summary.unverifiedHorseCount,1);
 assert.equal(r.summary.passHorseCount,0);assert.equal(frozenSignalAuditExitCode(r),3);
});
test('auditing never rewrites stored records and returns immutable observations',()=>{
 const entries=[entry()];const before=JSON.stringify(entries),r=auditFrozenSignalCohort(entries);
 assert.equal(JSON.stringify(entries),before);assert.ok(Object.isFrozen(r.summary.observations[0].audit.rows));
 assert.ok(Object.isFrozen(r.summary.reasonCounts));assert.equal(frozenSignalAuditExitCode(r),0);
});
test('offline CLI rejects bad files and arguments and leaves input bytes untouched',()=>{
 const dir=mkdtempSync(join(tmpdir(),'chass-signal-audit-')),file=join(dir,'cohort.json');
 try{
  const bytes=JSON.stringify([entry()]);writeFileSync(file,bytes);
  assert.equal(runFrozenSignalAuditCli(['--file',file]).status,'READY');
  assert.equal(readFileSync(file,'utf8'),bytes);
  assert.equal(runFrozenSignalAuditCli(['--file',file,'--extra','x']).reason,'INVALID_CLI_ARGUMENTS');
  writeFileSync(file,'not json');assert.equal(runFrozenSignalAuditCli(['--file',file]).reason,'COHORT_FILE_READ_FAILED');
  assert.equal(frozenSignalAuditExitCode(runFrozenSignalAuditCli([])),1);
  writeFileSync(file,' '.repeat(2*1024*1024+1));assert.equal(runFrozenSignalAuditCli(['--file',file]).status,'REJECTED');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
