import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {JRA_RACE_PARSER_VERSION} from '../jra-race-fetch.mjs';
import {evaluatePreflight,parseWranglerRows,preflightQueries,runPreflight} from '../scripts/jra-production-preflight.mjs';

const date='2026-09-27',now=Date.parse('2026-09-27T04:00:00.000Z');
const names='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at'.split(',');
const optional=new Set(['source_acquired_at','data_calculated_at','calculated_at','cluster_version','signal_rule_version','data_json','market_json','final_json','result_json']);
const indexColumns={idx_precomputed_input_lookup:['organization','race_id','input_hash','model_version','calculation_version'],idx_precomputed_revision_idempotent:['organization','race_id','snapshot_hash'],idx_precomputed_latest:['organization','race_id','revision']};
function fixture(){
 const fetchedAt='2026-09-27T03:00:00.000Z',expiresAt='2026-09-27T06:00:00.000Z';
 const sourceUrl='https://www.jra.go.jp/JRADB/accessD.html';
 const body={ok:true,organization:'JRA',source:'JRA_OFFICIAL',dataConfidence:'high',sourceUrl,
  parserVersion:JRA_RACE_PARSER_VERSION,fetchedAt,
  race:{date,racecourse:'中山',raceNo:1},quality:{raceParsed:true,horseCount:2,activeHorseCount:2},
  horses:[{horseNo:1,horseName:'A',runningStatus:'active'},{horseNo:2,horseName:'B',runningStatus:'active'}]};
 const payload_json=JSON.stringify(body);
 return {
  migrationColumns:[{name:'name'}],migration:[{name:'0012_precomputed_snapshots.sql'}],
  columns:names.map((name,i)=>({name,type:name==='revision'?'INTEGER':'TEXT',notnull:optional.has(name)?0:1,
   pk:({organization:1,race_id:2,revision:3}[name]??0),cid:i})),
  indexes:Object.keys(indexColumns).map(name=>({name,unique:name==='idx_precomputed_revision_idempotent'?1:0})),
  ...Object.fromEntries(Object.entries(indexColumns).map(([name,columns])=>[name,columns.map((column,seqno)=>({seqno,name:column}))])),
  meeting:[{date,status:'complete',next_refresh_at:expiresAt,meetings_json:JSON.stringify([
   {organization:'JRA',date,track:'中山',status:'meeting',raceNumbers:[1]}
  ])}],
  race:[{kind:'race',cache_key:`race|${date}|中山|1`,organization:'JRA',race_date:date,track:'中山',race_no:1,
   payload_json,source_url:sourceUrl,fetched_at:fetchedAt,expires_at:expiresAt,
   parser_version:JRA_RACE_PARSER_VERSION,content_hash:createHash('sha256').update(payload_json).digest('hex')}],
  snapshotAudit:[{target_rows:0,target_distinct_races:0,canary_rows:0,canary_distinct_races:0,guard_distinct_races:0,
   canary_data_race_ids:'',
   canary_missing_data_rows:0,canary_invalid_data_rows:0,canary_invalid_source_rows:0,
   canary_market_rows:0,canary_final_rows:0,canary_result_rows:0,canary_revised_races:0,canary_max_revision:0}]
 };
}

test('only fixed SELECT/PRAGMA queries are produced; untrusted dates are rejected',()=>{
 const queries=Object.values(preflightQueries(date));
 assert.equal(queries.length,10);
 assert.ok(queries.every(sql=>/^(SELECT|PRAGMA)\b/.test(sql)));
 assert.ok(queries.every(sql=>!/(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|ATTACH|VACUUM)\b/i.test(sql)));
 for(const bad of [undefined,'2026-02-30',"2026-09-27';DELETE FROM x;--",'2026-9-27']){
  assert.throws(()=>preflightQueries(bad),/invalid_target_date/);
 }
 const workflow=readFileSync(new URL('../.github/workflows/CHASS-JRA-Production-Read-Only-Preflight-v1.yml',import.meta.url),'utf8');
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/\bschedule:/);
 assert.match(workflow,/persist-credentials: false/);
 const audit=preflightQueries(date).snapshotAudit;
 assert.match(audit,/COUNT\(DISTINCT/);
 assert.match(audit,/GROUP_CONCAT\(DISTINCT/);
 assert.doesNotMatch(audit,/SELECT\s+\*/i);
});

test('complete matching metadata and fresh official payload pass without SOURCE fetch or writes',async()=>{
 const report=await evaluatePreflight({date,now,rows:fixture()});
 assert.deepEqual([report.migration,report.schema,report.indexes,report.meeting,report.race],Array(5).fill('PASS'));
 assert.deepEqual(report.counts,{fresh:1,missing:0,expired:0,invalid:0,corrupt:0});
 assert.equal(report.snapshotAudit,'EMPTY');
 assert.deepEqual(report.snapshotMissingDataRaceIds,['20260927-JRA-中山-01']);
 assert.deepEqual(report.snapshotUnexpectedDataRaceIds,[]);
 assert.equal(report.productionActivationReady,false);
});

test('snapshot soak audit is aggregate-only, capped and fail-closed on canary integrity',async()=>{
 const rows=fixture();
 rows.snapshotAudit=[{target_rows:3,target_distinct_races:2,canary_rows:2,canary_distinct_races:2,guard_distinct_races:2,
  canary_data_race_ids:'20260927-JRA-中山-01,20260927-JRA-中山-02',
  canary_missing_data_rows:0,canary_invalid_data_rows:0,canary_invalid_source_rows:0,
  canary_market_rows:1,canary_final_rows:0,canary_result_rows:0,canary_revised_races:1,canary_max_revision:2}];
 let report=await evaluatePreflight({date,now,rows});
 assert.equal(report.snapshotAudit,'PASS');
 assert.deepEqual(report.snapshotAuditIntegrity,{cap:'PASS',source:'PASS',data:'PASS'});
 assert.equal(report.snapshotAuditCounts.canary_market_rows,1);
 assert.deepEqual(report.snapshotMissingDataRaceIds,[]);
 assert.deepEqual(report.snapshotUnexpectedDataRaceIds,['20260927-JRA-中山-02']);
 rows.snapshotAudit[0].canary_distinct_races=25;
 rows.snapshotAudit[0].guard_distinct_races=25;
 rows.snapshotAudit[0].canary_rows=25;
 rows.snapshotAudit[0].target_rows=25;
 rows.snapshotAudit[0].target_distinct_races=25;
 report=await evaluatePreflight({date,now,rows});
 assert.equal(report.snapshotAudit,'FAIL');
 assert.equal(report.snapshotAuditIntegrity.cap,'FAIL');
 assert.ok(report.issues.includes('snapshot_canary_audit_failed'));
 rows.snapshotAudit[0].canary_distinct_races=2;
 rows.snapshotAudit[0].guard_distinct_races=2;
 rows.snapshotAudit[0].canary_rows=2;
 rows.snapshotAudit[0].target_rows=3;
 rows.snapshotAudit[0].target_distinct_races=2;
 rows.snapshotAudit[0].canary_invalid_source_rows=1;
 report=await evaluatePreflight({date,now,rows});
 assert.equal(report.snapshotAudit,'FAIL');
 assert.equal(report.snapshotAuditIntegrity.source,'FAIL');
});

test('missing migration, schema drift and loss of UNIQUE contract fail',async()=>{
 const rows=fixture();
 rows.migration=[];
 rows.columns=rows.columns.filter(c=>c.name!=='data_json');
 rows.indexes.find(i=>i.name==='idx_precomputed_revision_idempotent').unique=0;
 const report=await evaluatePreflight({date,now,rows});
 assert.deepEqual([report.migration,report.schema,report.indexes],['FAIL','FAIL','FAIL']);
 assert.deepEqual(report.missingColumns,['data_json']);
 assert.equal(report.indexResults.idx_precomputed_revision_idempotent,'FAIL');
});

test('stale meeting cannot count as fresh supply; stale and corrupt race payloads are counted',async()=>{
 const rows=fixture();
 rows.meeting[0].next_refresh_at='2026-09-27T03:59:59.000Z';
 let report=await evaluatePreflight({date,now,rows});
 assert.equal(report.meeting,'FAIL');
 assert.equal(report.race,'NOT_YET_PROVEN');
 assert.equal(report.expectedRaceCount,null);
 rows.meeting[0].next_refresh_at='2026-09-27T06:00:00.000Z';
 rows.race[0].expires_at='2026-09-27T03:59:59.000Z';
 report=await evaluatePreflight({date,now,rows});
 assert.equal(report.counts.expired,1);
 rows.race[0].expires_at='2026-09-27T06:00:00.000Z';
 rows.race[0].content_hash='f'.repeat(64);
 report=await evaluatePreflight({date,now,rows});
 assert.equal(report.counts.corrupt,1);
 rows.race=[];
 report=await evaluatePreflight({date,now,rows});
 assert.equal(report.counts.missing,1);
});

test('query errors fail rather than silently supplying empty results',async()=>{
 await assert.rejects(runPreflight(date,{execute:async()=>{throw Error('D1 unavailable')}}),/preflight_query_blocked:migrationColumns/);
 const rows=fixture(),queries=preflightQueries(date),seen=[];
 const report=await runPreflight(date,{now:()=>now,execute:async sql=>{
  const key=Object.keys(queries).find(k=>queries[k]===sql);
  assert.ok(key);
  seen.push(key);
  return rows[key];
 }});
 assert.deepEqual(seen,Object.keys(queries));
 assert.equal(report.race,'PASS');
 assert.deepEqual(parseWranglerRows('[{"success":true,"results":[{"name":"x"}]}]'),[{name:'x'}]);
 assert.throws(()=>parseWranglerRows('[{"success":false,"results":[]}]'),/invalid_remote_d1_result/);
});
