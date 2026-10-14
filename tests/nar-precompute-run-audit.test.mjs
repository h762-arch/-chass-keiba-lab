import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeNarPrecomputeRunAudit,publicNarRunAuditFields,readNarPrecomputeRunAudit,writeNarPrecomputeRunAudit} from '../src/prediction/nar-precompute-run-audit.mjs';

function memoryDb({throwOnRead=false}={}){
 const rows=new Map();
 return {rows,prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async run(){
  if(!sql.startsWith('INSERT OR IGNORE INTO nar_precompute_run_audit'))throw Error('unexpected run');
  const [scheduled_at,run_date,run_status,reason,attempted,saved,auto_result_processed,events_json,recorded_at]=this.args;
  if(rows.has(scheduled_at))return {success:true,meta:{changes:0}};
  rows.set(scheduled_at,{scheduled_at,run_date,run_status,reason,attempted,saved,auto_result_processed,events_json,recorded_at});
  return {success:true,meta:{changes:1}};
 },async first(){
  if(throwOnRead)throw Error('no table');
  if(sql.includes('WHERE scheduled_at=?'))return rows.get(this.args[0])||null;
  if(sql.includes('WHERE run_date=?'))return [...rows.values()].filter(row=>row.run_date===this.args[0]).sort((a,b)=>b.scheduled_at.localeCompare(a.scheduled_at))[0]||null;
  throw Error('unexpected first');
 }};}};
}

test('normalizes scheduler result with JST date and bounded public events',()=>{
 const audit=normalizeNarPrecomputeRunAudit({scheduledAt:'2026-10-13T22:05:00.000Z',autoResultProcessed:3,result:{status:'SKIPPED',reason:'AUTO_RESULT_PRIORITY',attempted:9,saved:2,events:[{raceId:'20261014-NAR-21-01',track:'川崎',reason:'DEADLINE',ignored:'secret'}]}});
 assert.equal(audit.runDate,'2026-10-14');
 assert.equal(audit.runStatus,'SKIPPED');
 assert.equal(audit.reason,'AUTO_RESULT_PRIORITY');
 assert.equal(audit.autoResultProcessed,3);
 assert.deepEqual(audit.events,[{raceId:'20261014-NAR-21-01',track:'川崎',reason:'DEADLINE'}]);
});

test('writes and reads latest NAR scheduler audit',async()=>{
 const DB=memoryDb();
 await writeNarPrecomputeRunAudit(DB,{scheduledAt:'2026-10-13T22:05:00.000Z',result:{status:'COMPLETED',attempted:3,saved:1,events:[{raceId:'R1',reason:'SAVED'}]}});
 await writeNarPrecomputeRunAudit(DB,{scheduledAt:'2026-10-13T22:10:00.000Z',result:{status:'COMPLETED',attempted:3,saved:0,events:[{raceId:'R2',reason:'SOURCE_OR_SAVE_FAILED'}]}});
 const audit=await readNarPrecomputeRunAudit(DB,{date:'2026-10-14'});
 assert.equal(audit.status,'RECORDED');
 assert.equal(audit.scheduledAt,'2026-10-13T22:10:00.000Z');
 assert.equal(audit.saved,0);
 assert.equal(audit.events[0].reason,'SOURCE_OR_SAVE_FAILED');
});

test('duplicate scheduled time is immutable and returns original readback',async()=>{
 const DB=memoryDb(),scheduledAt='2026-10-13T22:15:00.000Z';
 await writeNarPrecomputeRunAudit(DB,{scheduledAt,result:{status:'SKIPPED',reason:'AUTO_RESULT_PRIORITY'}});
 const duplicate=await writeNarPrecomputeRunAudit(DB,{scheduledAt,result:{status:'COMPLETED',saved:3}});
 assert.equal(duplicate.runStatus,'SKIPPED');
 assert.equal(duplicate.reason,'AUTO_RESULT_PRIORITY');
 assert.equal(duplicate.saved,0);
});

test('distinguishes no recorded run from unavailable audit schema',async()=>{
 const empty=await readNarPrecomputeRunAudit(memoryDb(),{date:'2026-10-14'});
 assert.equal(empty.status,'NO_RUN_RECORDED');
 const unavailable=await readNarPrecomputeRunAudit(memoryDb({throwOnRead:true}),{date:'2026-10-14'});
 assert.equal(unavailable.status,'UNAVAILABLE');
 assert.equal(unavailable.reason,'AUDIT_SCHEMA_UNAVAILABLE');
});

test('public fields expose last NAR run without claiming a save',()=>{
 const fields=publicNarRunAuditFields({status:'RECORDED',scheduledAt:'2026-10-13T22:20:00.000Z',runStatus:'COMPLETED',reason:null,attempted:3,saved:0,events:[{reason:'MEETING_UNAVAILABLE'}]});
 assert.equal(fields.lastNarRunAt,'2026-10-13T22:20:00.000Z');
 assert.equal(fields.lastNarStatus,'COMPLETED');
 assert.equal(fields.lastNarSaved,0);
 assert.deepEqual(fields.lastNarEvents,[{reason:'MEETING_UNAVAILABLE'}]);
});

test('migration provisions only the dedicated NAR scheduler audit table',()=>{
 const sql=readFileSync(new URL('../migrations/0015_nar_precompute_run_audit.sql',import.meta.url),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS nar_precompute_run_audit/);
 assert.match(sql,/scheduled_at TEXT PRIMARY KEY/);
 assert.match(sql,/idx_nar_precompute_run_audit_date/);
 assert.match(sql,/nar_precompute_run_audit_no_update/);
 assert.match(sql,/nar_precompute_run_audit_no_delete/);
 assert.doesNotMatch(sql,/precomputed_race_snapshots\s*\(/);
});
