import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,symlinkSync,appendFileSync,renameSync,truncateSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fixture as narFixture,raceId,now} from './helpers/nar-outcome-fixture-v1.mjs';
import {auditEarlyOutcomeSqliteV1 as audit} from '../src/research/early-outcome-sqlite-audit-v1.mjs';
import {openQuiescentResearchSqliteV1 as open} from '../src/research/research-sqlite-readonly-v1.mjs';
import {auditEarlyOutcomeSqliteCliV1 as cli,earlyOutcomeSqliteExitCode as exitCode} from '../scripts/audit-early-outcome-sqlite-v1.mjs';

const jraId='20261004-JRA-東京-01',hash=b=>createHash('sha256').update(b).digest('hex');
const safe=r=>{for(const k of ['sourceOriginAuthenticated','resultOriginAuthenticated','externalAnchorAuthenticated','trustedDurableTime','formalKpiEligible','acquisitionPerformed','storageWritesPerformed','crossDatabaseAtomicSnapshot'])assert.equal(r[k],false,k);assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');};
async function fixture(t,{shared=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'chass-outcome-sqlite-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const evidence=join(dir,'evidence.sqlite'),results=shared?evidence:join(dir,'results.sqlite'),targets=join(dir,'targets.json'),n=await narFixture();
 const e=new DatabaseSync(evidence),r=shared?e:new DatabaseSync(results);
 try{
  for(const table of ['research_nar_early_snapshots','research_nar_initial_bundles','research_nar_commit_observations'])e.exec(`CREATE TABLE ${table}(storage_key TEXT PRIMARY KEY,snapshot_json TEXT NOT NULL)`);
  for(const [key,raw] of n.rows)e.prepare(`INSERT INTO ${key.startsWith('nar-initial-')?'research_nar_initial_bundles':'research_nar_commit_observations'} VALUES (?,?)`).run(key,raw);
  r.exec('CREATE TABLE races(race_id TEXT,model_version TEXT,result_acquired_at TEXT,result_json TEXT,PRIMARY KEY(race_id,model_version))');
  n.result.sourceRef='PRIVATE_RESULT_REFERENCE';r.prepare('INSERT INTO races VALUES (?,?,?,?)').run(raceId,'10.0.1',n.row.result_acquired_at,JSON.stringify(n.result));
  e.exec('CREATE TABLE precomputed_race_snapshots(organization TEXT,race_id TEXT,revision INTEGER,source_validated_at TEXT,data_calculated_at TEXT,calculated_at TEXT,calculation_version TEXT,model_version TEXT,status TEXT,data_json TEXT,PRIMARY KEY(organization,race_id,revision))');
  const data={schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',race:{date:'2026-10-04',racecourse:'東京',raceNo:1,postTime:'15:40'},horses:[1,2,3].map(horseNo=>({horseNo,horseName:'SYNTHETIC-'+horseNo,abilityRank:horseNo,overall:80,win:10,place:30,predictedTime:'1:59.0'}))};
  e.prepare('INSERT INTO precomputed_race_snapshots VALUES (?,?,?,?,?,?,?,?,?,?)').run('JRA',jraId,1,'2026-10-04T06:00:00Z','2026-10-04T06:01:00Z',null,'jra-ability-data-v2','10.0.1-jra-drive1-ability','PARTIAL',JSON.stringify(data));
  r.exec('CREATE TABLE jra_official_cache(cache_key TEXT PRIMARY KEY,kind TEXT,organization TEXT,race_date TEXT,track TEXT,race_no INTEGER,payload_json TEXT,fetched_at TEXT)');
  const payload={ok:true,organization:'JRA',date:'2026-10-04',track:'東京',race:1,source:'JRA_OFFICIAL',quality:{complete:true,finishOrderCount:3},finishOrder:[1,2,3],results:[1,2,3].map(horseNo=>({horseNo,position:horseNo,actualTime:'1:59.2'}))};
  r.prepare('INSERT INTO jra_official_cache VALUES (?,?,?,?,?,?,?,?)').run('result|2026-10-04|東京|1','result','JRA','2026-10-04','東京',1,JSON.stringify(payload),'2026-10-04T08:00:00Z');
 }finally{if(!shared)r.close();e.close();}
 const all=[{organization:'NAR',raceId},{organization:'JRA',raceId:jraId}];writeFileSync(targets,JSON.stringify(all));
 return {dir,evidence,results,targets,all,config(extra={}){return JSON.stringify({evidenceDbPath:evidence,resultsDbPath:results,targets:all,evaluatedAt:new Date(now).toISOString(),...extra});}};
}
const mutate=(path,fn)=>{const db=new DatabaseSync(path);try{fn(db);}finally{db.close();}};
test('separate SQLite copies route JRA/NAR through existing readers and preserve exact files',async t=>{
 const f=await fixture(t),a=readFileSync(f.evidence),b=readFileSync(f.results),files=readdirSync(f.dir),old=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
 try{const out=await audit(f.config());assert.equal(out.status,'READ_COMPLETE',JSON.stringify(out));safe(out);
  assert.equal(out.report.contractQualifiedRaceCount,2);assert.equal(out.report.heldRaceCount,0);assert.equal(out.report.NAR.metrics.meanRaceWinBrier,.08);
  assert.equal(out.report.JRA.metrics.meanRaceWinBrier,.276667);assert.equal(out.report.JRA.metrics.meanRaceTimeMaeSeconds,.2);
  assert.equal(out.evidenceFile.sha256,hash(a));assert.equal(out.resultsFile.sha256,hash(b));assert.equal(out.filesUnchanged,true);assert.equal(out.queryCount,6);
  assert.deepEqual(readFileSync(f.evidence),a);assert.deepEqual(readFileSync(f.results),b);assert.deepEqual(readdirSync(f.dir),files);
  assert.equal(exitCode(out),0);assert.ok(Object.isFrozen(out.report));
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE_RESULT_REFERENCE|sourceRef|finishOrder|actualTimes|horseName|snapshot_json|payload_json|\/tmp\//);
 }finally{globalThis.fetch=old;}
});
test('explicit same-file copy is supported without a second connection',async t=>{const f=await fixture(t,{shared:true}),r=await audit(f.config());assert.equal(r.status,'READ_COMPLETE');assert.equal(r.report.contractQualifiedRaceCount,2);assert.deepEqual(r.evidenceFile,r.resultsFile);safe(r);});
test('NAR-only audit does not require JRA schema',async t=>{const f=await fixture(t);mutate(f.evidence,d=>d.exec('DROP TABLE precomputed_race_snapshots'));mutate(f.results,d=>d.exec('DROP TABLE jra_official_cache'));const r=await audit(f.config({targets:[f.all[0]]}));assert.equal(r.status,'READ_COMPLETE');assert.equal(r.report.contractQualifiedRaceCount,1);});
test('missing stored result is excluded as pending with exit 1, never a loss',async t=>{const f=await fixture(t);mutate(f.results,d=>d.exec('DELETE FROM races'));const r=await audit(f.config({targets:[f.all[0]]}));assert.equal(r.status,'READ_COMPLETE');assert.equal(r.report.contractQualifiedRaceCount,0);assert.equal(r.report.heldRaceCount,1);assert.equal(r.report.excluded[0].status,'PENDING');assert.equal(r.report.NAR.metrics,null);assert.equal(exitCode(r),1);safe(r);});
test('missing early is accounted for, with no latest or synthetic substitution',async t=>{const f=await fixture(t),r=await audit(f.config({targets:[{organization:'NAR',raceId:'2026-10-07|園田|8'}]}));assert.equal(r.report.heldRaceCount,1);assert.equal(r.report.reasonCounts.NAR_INITIAL_BUNDLE_MISSING,1);});
test('malformed earliest JRA DATA is not replaced by a later usable revision',async t=>{const f=await fixture(t);mutate(f.evidence,d=>{d.exec('INSERT INTO precomputed_race_snapshots SELECT organization,race_id,2,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,status,data_json FROM precomputed_race_snapshots');d.exec("UPDATE precomputed_race_snapshots SET data_json='{' WHERE revision=1");});const r=await audit(f.config({targets:[f.all[1]]}));assert.equal(r.report.heldRaceCount,1);assert.equal(r.report.reasonCounts.EARLY_MALFORMED_DATA,1);});
test('oversized JRA text is bounded in SQL and held without repair',async t=>{const f=await fixture(t);mutate(f.evidence,d=>d.prepare('UPDATE precomputed_race_snapshots SET data_json=?').run(' '.repeat(1000001)));const r=await audit(f.config({targets:[f.all[1]]}));assert.equal(r.report.heldRaceCount,1);safe(r);});
for(const table of ['research_nar_initial_bundles','research_nar_commit_observations'])test('missing schema stays absent: '+table,async t=>{const f=await fixture(t);mutate(f.evidence,d=>d.exec(`DROP TABLE ${table}`));const bytes=readFileSync(f.evidence),r=await audit(f.config());assert.equal(r.status,'HOLD');assert.equal(r.reason,'REQUIRED_TABLE_MISSING_OR_VIEW');assert.deepEqual(readFileSync(f.evidence),bytes);assert.equal(exitCode(r),2);safe(r);});
test('views cannot masquerade as original evidence tables',async t=>{const f=await fixture(t);mutate(f.evidence,d=>d.exec('ALTER TABLE research_nar_initial_bundles RENAME TO old_bundle; CREATE VIEW research_nar_initial_bundles AS SELECT * FROM old_bundle'));assert.equal((await audit(f.config())).reason,'REQUIRED_TABLE_MISSING_OR_VIEW');});
test('unconstrained duplicate result rows are rejected before selection',async t=>{const f=await fixture(t);mutate(f.results,d=>d.exec('ALTER TABLE races RENAME TO old_races; CREATE TABLE races AS SELECT * FROM old_races; INSERT INTO races SELECT * FROM old_races'));assert.equal((await audit(f.config())).reason,'REQUIRED_UNIQUE_KEYS_MISSING');});
test('partial unique indexes do not establish complete key uniqueness',async t=>{const f=await fixture(t);mutate(f.results,d=>d.exec("ALTER TABLE races RENAME TO old_races; CREATE TABLE races AS SELECT * FROM old_races; CREATE UNIQUE INDEX partial_race ON races(race_id,model_version) WHERE model_version='10.0.1'"));assert.equal((await audit(f.config())).reason,'REQUIRED_UNIQUE_KEYS_MISSING');});
test('missing file is not created',async t=>{const f=await fixture(t),missing=join(f.dir,'missing.sqlite'),r=await audit(f.config({evidenceDbPath:missing}));assert.equal(r.reason,'SQLITE_FILE_MISSING');assert.equal(existsSync(missing),false);});
test('symlinks, parent symlinks and directories are not followed',async t=>{const f=await fixture(t),link=join(f.dir,'alias.sqlite'),parent=join(f.dir,'alias-dir');symlinkSync(f.evidence,link);symlinkSync(f.dir,parent);for(const p of [link,f.dir,join(parent,'evidence.sqlite')])assert.equal((await audit(f.config({evidenceDbPath:p}))).reason,'SQLITE_REGULAR_FILE_REQUIRED');});
for(const suffix of ['-wal','-shm','-journal'])test('sidecar blocks opening: '+suffix,async t=>{const f=await fixture(t);writeFileSync(f.evidence+suffix,'');assert.equal((await audit(f.config())).reason,'QUIESCENT_SQLITE_COPY_REQUIRED');});
test('WAL header is rejected even without sidecars',async t=>{const f=await fixture(t),raw=readFileSync(f.results);raw[18]=raw[19]=2;writeFileSync(f.results,raw);assert.equal((await audit(f.config())).reason,'QUIESCENT_SQLITE_COPY_REQUIRED');});
test('invalid header has no private error detail',async t=>{const f=await fixture(t);writeFileSync(f.results,'PRIVATE_HEADER');const r=await audit(f.config());assert.equal(r.reason,'SQLITE_HEADER_INVALID');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_HEADER|results.sqlite/);});
test('oversized sparse copy is rejected before hashing',async t=>{const f=await fixture(t);truncateSync(f.evidence,536870913);assert.equal((await audit(f.config())).reason,'SQLITE_FILE_TOO_LARGE');});
for(const role of ['evidence','results'])test('file change during async comparison discards aggregate: '+role,async t=>{const f=await fixture(t),pending=audit(f.config());appendFileSync(f[role],'X');const r=await pending;assert.equal(r.status,'HOLD');assert.equal(r.reason,'SQLITE_INPUT_CHANGED');assert.equal(r.report,null);safe(r);});
test('identical-byte replacement with a different inode is detected',async t=>{const f=await fixture(t),replacement=join(f.dir,'replacement'),bytes=readFileSync(f.evidence);writeFileSync(replacement,bytes);const pending=audit(f.config());renameSync(replacement,f.evidence);assert.equal((await pending).reason,'SQLITE_INPUT_CHANGED');});
test('sidecar appearing after open prevents success',async t=>{const f=await fixture(t),pending=audit(f.config());writeFileSync(f.results+'-journal','');const r=await pending;assert.equal(r.status,'HOLD');assert.equal(r.reason,'QUIESCENT_SQLITE_COPY_REQUIRED');});
test('shared guard enforces database readOnly and query_only',async t=>{const f=await fixture(t),bytes=readFileSync(f.evidence),lease=open(f.evidence,{hashBytes:true});try{assert.equal(lease.db.prepare('PRAGMA query_only').get().query_only,1);assert.throws(()=>lease.db.exec("INSERT INTO research_nar_early_snapshots VALUES('x','{}')"),/readonly/);lease.assertStable();}finally{lease.close();}lease.close();assert.deepEqual(readFileSync(f.evidence),bytes);});
for(const [label,extra] of [
 ['empty targets',{targets:[]}],['duplicate targets',{targets:[{organization:'NAR',raceId},{organization:'NAR',raceId}]}],
 ['unknown track',{targets:[{organization:'NAR',raceId:'2026-10-07|東京|7'}]}],['too many',{targets:Array(101).fill({organization:'NAR',raceId})}],
 ['flag injection',{sourceOriginAuthenticated:true}],['timezone missing',{evaluatedAt:'2026-10-07T15:00:00'}],
 ['URL path',{evidenceDbPath:'https://example.invalid/evidence.sqlite'}],['unknown target property',{targets:[{organization:'NAR',raceId,formalKpiEligible:true}]}],
])test('invalid config rejected before file access: '+label,async()=>{const raw=JSON.stringify({evidenceDbPath:'/no-such-file',resultsDbPath:'/no-such-file',targets:[{organization:'NAR',raceId}],evaluatedAt:new Date(now).toISOString(),...extra});const r=await audit(raw);assert.equal(r.reason,'INVALID_AUDIT_CONFIG');safe(r);});
test('non-text config cannot execute serialization callbacks',async()=>{let calls=0;assert.equal((await audit({toJSON(){calls++;}})).reason,'INVALID_AUDIT_CONFIG');assert.equal(calls,0);});
test('CLI uses one process evaluation time and records exact target bytes',async t=>{const f=await fixture(t),source=new URL('../scripts/audit-early-outcome-sqlite-v1.mjs',import.meta.url).pathname,p=spawnSync(process.execPath,[source,'--evidence-db',f.evidence,'--results-db',f.results,'--targets',f.targets],{encoding:'utf8',timeout:15000});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.clockAuthority,'LOCAL_PROCESS_CLOCK');assert.equal(r.targetsFileUtf8Sha256,hash(readFileSync(f.targets)));assert.equal(r.report.contractQualifiedRaceCount,2);safe(r);assert.doesNotMatch(p.stdout,/PRIVATE_RESULT_REFERENCE|sourceRef|finishOrder|actualTimes|horseName/);});
test('CLI rejects missing args, missing/oversized/symlink target files without discovery',async t=>{const f=await fixture(t);assert.equal(exitCode(await cli([])),2);const args=['--evidence-db',f.evidence,'--results-db',f.results,'--targets',f.targets];writeFileSync(f.targets,' '.repeat(32769));assert.equal((await cli(args)).reason,'TARGETS_FILE_INVALID');rmSync(f.targets);symlinkSync(f.evidence,f.targets);assert.equal((await cli(args)).reason,'TARGETS_FILE_INVALID');rmSync(f.targets);assert.equal((await cli(args)).reason,'TARGETS_FILE_INVALID');});
test('CLI incomplete cohort exits 1; audit setup HOLD exits 2',async t=>{const f=await fixture(t),source=new URL('../scripts/audit-early-outcome-sqlite-v1.mjs',import.meta.url).pathname;mutate(f.results,d=>d.exec('DELETE FROM races'));let p=spawnSync(process.execPath,[source,'--evidence-db',f.evidence,'--results-db',f.results,'--targets',f.targets],{encoding:'utf8',timeout:15000});assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).report.heldRaceCount,1);p=spawnSync(process.execPath,[source],{encoding:'utf8'});assert.equal(p.status,2);safe(JSON.parse(p.stdout));});
