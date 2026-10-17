import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runNarInitialEvidenceRehearsalV1 as rehearse} from '../scripts/nar-initial-evidence-rehearsal-v1.mjs';
import {readNarSqliteEvidenceV1 as read} from '../src/research/nar-sqlite-evidence-reader-v1.mjs';
import {readNarSqliteEvidenceCliV1 as cli} from '../scripts/read-nar-sqlite-evidence-v1.mjs';
const raceId='2026-10-07|園田|7';
async function fixture(t,scenario='baseline'){
 const directory=mkdtempSync(join(tmpdir(),'chass-sql-evidence-test-')),path=join(directory,'evidence.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const r=await rehearse(scenario);assert.equal(r.status,'PASS');const e=r.evidence,db=new DatabaseSync(path);
 for(const table of ['research_nar_early_snapshots','research_nar_initial_bundles','research_nar_commit_observations'])db.exec(`CREATE TABLE ${table}(storage_key TEXT PRIMARY KEY NOT NULL,snapshot_json TEXT NOT NULL)`);
 db.prepare('INSERT INTO research_nar_initial_bundles VALUES (?,?)').run(e.bundleKey,e.bundleRawJson);
 if(e.receiptRawJson!==null)db.prepare('INSERT INTO research_nar_commit_observations VALUES (?,?)').run(e.receiptKey,e.receiptRawJson);
 db.close();return {directory,path,e};
}
const config=(path,id=raceId)=>JSON.stringify({dbPath:path,raceId:id});
function safe(r){assert.equal(r.formalReadiness,'HOLD');assert.equal(r.formalKpiEligible,false);assert.equal(r.productionEvidenceVerified,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');}
for(const scenario of ['baseline','late_ack','lost_ack','missing_receipt','tampered_bundle'])test(`read existing file and audit: ${scenario}`,async t=>{
 const f=await fixture(t,scenario),bytes=readFileSync(f.path),files=readdirSync(f.directory),r=await read(config(f.path));
 assert.equal(r.status,scenario==='baseline'?'CONTENT_READ_AND_MATCHED':'HOLD');assert.equal(r.storeReadPerformed,true);safe(r);
 assert.deepEqual(readFileSync(f.path),bytes);assert.deepEqual(readdirSync(f.directory),files);
 assert.equal(r.evidence.bundleRawJson,f.e.bundleRawJson);assert.equal(r.evidence.receiptRawJson,f.e.receiptRawJson);
 assert.equal(r.audit.storeReadPerformed,false);assert.equal(r.audit.inputProvenance,'UNAUTHENTICATED');
});
test('wrong race reads no latest fallback',async t=>{const f=await fixture(t),r=await read(config(f.path,'2026-10-07|園田|8'));assert.equal(r.reason,'INITIAL_BUNDLE_MISSING');safe(r);});
test('legacy content blocks automatic namespace substitution',async t=>{const f=await fixture(t),db=new DatabaseSync(f.path);db.prepare('INSERT INTO research_nar_early_snapshots VALUES (?,?)').run('nar-early:v1:'+raceId,'{}');db.close();assert.equal((await read(config(f.path))).reason,'LEGACY_EARLY_REQUIRES_SEPARATE_AUDIT');});
test('missing tables are not created or repaired',async t=>{const f=await fixture(t),db=new DatabaseSync(f.path);db.exec('DROP TABLE research_nar_commit_observations');db.close();const bytes=readFileSync(f.path);assert.equal((await read(config(f.path))).reason,'EVIDENCE_TABLES_REQUIRED');assert.deepEqual(readFileSync(f.path),bytes);});
test('views are not used as evidence tables',async t=>{const f=await fixture(t),db=new DatabaseSync(f.path);db.exec('DROP TABLE research_nar_commit_observations; CREATE VIEW research_nar_commit_observations AS SELECT storage_key,snapshot_json FROM research_nar_initial_bundles');db.close();assert.equal((await read(config(f.path))).reason,'EVIDENCE_TABLES_REQUIRED');});
test('missing path is never auto-created',async t=>{const f=await fixture(t),path=join(f.directory,'missing.sqlite');assert.equal((await read(config(path))).reason,'SQLITE_FILE_MISSING');assert.equal(existsSync(path),false);});
test('directories and symlink targets hold',async t=>{const f=await fixture(t),alias=join(f.directory,'alias.sqlite');symlinkSync(f.path,alias);for(const path of [f.directory,alias])assert.equal((await read(config(path))).reason,'SQLITE_REGULAR_FILE_REQUIRED');});
test('WAL, shared memory and journal sidecars block opening',async t=>{const f=await fixture(t);for(const suffix of ['-wal','-shm','-journal']){const path=f.path+suffix;writeFileSync(path,'synthetic sidecar');assert.equal((await read(config(f.path))).reason,'QUIESCENT_SQLITE_COPY_REQUIRED');rmSync(path);}});
test('WAL header blocks opening even with no sidecars',async t=>{const f=await fixture(t),header=readFileSync(f.path);header[18]=header[19]=2;writeFileSync(f.path,header);const files=readdirSync(f.directory);assert.equal((await read(config(f.path))).reason,'QUIESCENT_SQLITE_COPY_REQUIRED');assert.deepEqual(readdirSync(f.directory),files);});
test('invalid file header and oversized stored text hold',async t=>{const f=await fixture(t),bad=join(f.directory,'bad.sqlite');writeFileSync(bad,'PRIVATE_SECRET');const r=await read(config(bad));assert.equal(r.reason,'SQLITE_HEADER_INVALID');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);const db=new DatabaseSync(f.path);db.prepare('UPDATE research_nar_initial_bundles SET snapshot_json=?').run('x'.repeat(300001));db.close();assert.equal((await read(config(f.path))).reason,'BUNDLE_TEXT_OUT_OF_BOUNDS');});
test('invalid dates, URL paths, nonstrings and callback inputs hold',async()=>{let calls=0;const cb={toJSON(){calls++;throw Error();}};for(const raw of [null,cb,'{','[]',config('https://example.invalid/file'),config('local.sqlite','2026-02-30|園田|7'),config('local.sqlite','2026-10-07|園田|7 OR 1=1'),JSON.stringify({dbPath:12,raceId})]){const r=await read(raw);assert.equal(r.reason,'INVALID_READER_CONFIG');safe(r);}assert.equal(calls,0);});
test('CLI is explicit and exports stored bytes in a separate process',async t=>{const f=await fixture(t);for(const args of [[],['--db',f.path],['--url','https://example.invalid','--race-id',raceId]]){const r=await cli(args);assert.equal(r.status,'HOLD');safe(r);}const path=new URL('../scripts/read-nar-sqlite-evidence-v1.mjs',import.meta.url).pathname,p=spawnSync(process.execPath,[path,'--db',f.path,'--race-id',raceId],{encoding:'utf8',timeout:15000});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.status,'CONTENT_READ_AND_MATCHED');assert.equal(r.evidence.bundleRawJson,f.e.bundleRawJson);safe(r);});
