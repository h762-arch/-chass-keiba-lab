import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createJraPrecomputeMeetingProvider} from '../src/prediction/jra-precompute-meeting-provider.mjs';
import {createJraPrecomputeOfficialCacheSource} from '../src/prediction/jra-precompute-official-cache-source.mjs';
import {discoverPrecomputeRaceJobs} from '../src/prediction/precompute-job-discovery.mjs';

const TABLE='precomputed_race_snapshots';
const COLUMNS='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at'.split(',');
const OPTIONAL=new Set(['source_acquired_at','data_calculated_at','calculated_at','cluster_version','signal_rule_version','data_json','market_json','final_json','result_json']);
const TEXT_COLUMNS=new Set(COLUMNS.filter(name=>name!=='revision'));
const INDEXES={
 idx_precomputed_input_lookup:{unique:false,columns:['organization','race_id','input_hash','model_version','calculation_version']},
 idx_precomputed_revision_idempotent:{unique:true,columns:['organization','race_id','snapshot_hash']},
 idx_precomputed_latest:{unique:false,columns:['organization','race_id','revision']}
};

export function validTargetDate(date){
 return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&
  !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))&&
  new Date(`${date}T00:00:00.000Z`).toISOString().slice(0,10)===date;
}

// Only these statements are passed to D1. The date is checked before it enters SQL.
export function preflightQueries(date){
 if(!validTargetDate(date))throw new TypeError('invalid_target_date');
 return Object.freeze({
  migrationColumns:"PRAGMA table_info('d1_migrations')",
  migration:"SELECT name FROM d1_migrations WHERE name LIKE '0012%'",
  columns:`PRAGMA table_info('${TABLE}')`,
  indexes:`PRAGMA index_list('${TABLE}')`,
  ...Object.fromEntries(Object.keys(INDEXES).map(name=>[name,`PRAGMA index_info('${name}')`])),
  meeting:`SELECT date,status,meetings_json,checked_at,next_refresh_at,source,parser_version,error_code FROM jra_meeting_calendar WHERE date='${date}'`,
  race:`SELECT kind,cache_key,organization,race_date,track,race_no,payload_json,source_url,fetched_at,expires_at,parser_version,content_hash FROM jra_official_cache WHERE kind='race' AND race_date='${date}'`
 });
}

function readOnlyDb(meetingRows,raceRows){
 const races=new Map(raceRows.map(row=>[row.cache_key,row]));
 return {prepare(sql){
  if(sql.includes('FROM jra_meeting_calendar'))return {bind(date){return {first:async()=>meetingRows.find(row=>row.date===date)??null}}};
  if(sql.includes('FROM jra_official_cache'))return {bind(key){return {first:async()=>races.get(key)??null}}};
  throw new Error('unexpected_preflight_query');
 }};
}

export async function evaluatePreflight({date,now,rows}){
 if(!validTargetDate(date)||!Number.isFinite(now))throw new TypeError('invalid_preflight_inputs');
 const issues=[];
 const migrationColumns=rows.migrationColumns??[];
 const migration=migrationColumns.some(c=>c.name==='name')&&
  (rows.migration??[]).some(r=>/^0012(?:_|\b)/.test(r.name))?'PASS':'FAIL';
 if(migration==='FAIL')issues.push('migration_0012_missing');

 const columns=rows.columns??[];
 const missingColumns=COLUMNS.filter(name=>!columns.some(c=>c.name===name));
 const mismatchedColumns=COLUMNS.filter(name=>{
  const c=columns.find(row=>row.name===name);
  return c&&(
   String(c.type).toUpperCase()!==(TEXT_COLUMNS.has(name)?'TEXT':'INTEGER')||
   Boolean(Number(c.notnull))===OPTIONAL.has(name)||
   Number(c.pk)!==({organization:1,race_id:2,revision:3}[name]??0)
  );
 });
 const schema=missingColumns.length===0&&mismatchedColumns.length===0&&columns.length===COLUMNS.length?'PASS':'FAIL';
 if(schema==='FAIL')issues.push('snapshot_schema_mismatch');
 const indexList=rows.indexes??[];
 const indexResults=Object.fromEntries(Object.entries(INDEXES).map(([name,want])=>{
  const meta=indexList.find(i=>i.name===name);
  const actual=(rows[name]??[]).slice().sort((a,b)=>a.seqno-b.seqno).map(i=>i.name);
  return [name,Boolean(meta)&&Boolean(Number(meta.unique))===want.unique&&
   JSON.stringify(actual)===JSON.stringify(want.columns)?'PASS':'FAIL'];
 }));
 const indexes=Object.values(indexResults).every(x=>x==='PASS')?'PASS':'FAIL';
 if(indexes==='FAIL')issues.push('snapshot_indexes_mismatch');

 let meeting='FAIL',race='NOT_YET_PROVEN',expectedRaceCount=null;
 const counts={fresh:null,missing:null,expired:null,invalid:null,corrupt:null};
 const DB=readOnlyDb(rows.meeting??[],rows.race??[]);
 try{
  const loadMeetings=createJraPrecomputeMeetingProvider({DB,date,now:()=>now});
  const meetings=await loadMeetings({organization:'JRA'});
  const jobs=discoverPrecomputeRaceJobs(meetings);
  if(jobs.length===0)throw new Error('jra_precompute_no_race_jobs');
  expectedRaceCount=jobs.length;
  meeting='PASS';
  Object.keys(counts).forEach(k=>{counts[k]=0});
  const readSource=createJraPrecomputeOfficialCacheSource({DB,now:()=>now});
  for(const job of jobs){
   try{await readSource(job);counts.fresh++}
   catch(error){
    const code=error?.code;
    if(code==='jra_precompute_cache_missing')counts.missing++;
    else if(code==='jra_precompute_cache_expired')counts.expired++;
    else if(code==='jra_precompute_cache_corrupt')counts.corrupt++;
    else counts.invalid++;
   }
  }
  race=counts.fresh===expectedRaceCount?'PASS':'NOT_YET_PROVEN';
 }catch(error){issues.push(error?.code||error?.message||'meeting_validation_failed')}
 if(meeting!=='PASS')issues.push('meeting_not_fresh');
 if(race!=='PASS')issues.push('race_supply_not_proven');
 return {targetDate:date,checkedAt:new Date(now).toISOString(),migration,schema,missingColumns,mismatchedColumns,
  indexes,indexResults,meeting,race,expectedRaceCount,counts,issues:[...new Set(issues)],
  productionActivationReady:false};
}

export function parseWranglerRows(output){
 const parsed=JSON.parse(output);
 if(!Array.isArray(parsed)||parsed.length!==1||parsed[0]?.success!==true||!Array.isArray(parsed[0].results)){
  throw new Error('invalid_remote_d1_result');
 }
 return parsed[0].results;
}

export async function runPreflight(date,{execute,now=()=>Date.now()}={}){
 const queries=preflightQueries(date);
 const rows={};
 // A failed query is BLOCKED, never an empty/missing table result.
 for(const [key,sql] of Object.entries(queries)){
  try{rows[key]=await execute(sql)}
  catch{throw new Error(`preflight_query_blocked:${key}`)}
 }
 return evaluatePreflight({date,now:now(),rows});
}

function summary(report){
 const lines=['# JRA Production READ-ONLY preflight',`- Target date: ${report.targetDate}`,
  `- Checked at: ${report.checkedAt}`,
  `- Migration 0012: ${report.migration}`,
  `- Snapshot 21 columns: ${report.schema}`,
  `- Missing columns: ${report.missingColumns.join(', ')||'none'}`,
  `- Mismatched columns: ${report.mismatchedColumns.join(', ')||'none'}`,
  `- Snapshot indexes: ${report.indexes}`,
  ...Object.entries(report.indexResults).map(([name,status])=>`- ${name}: ${status}`),
  `- Meeting fresh: ${report.meeting}`,
  `- Race fresh/completeness: ${report.race}`,
  `- Expected: ${report.expectedRaceCount??'UNKNOWN'}`,
  `- Fresh / missing / expired / invalid / corrupt: ${Object.values(report.counts).map(v=>v??'UNKNOWN').join(' / ')}`,
  '- Production Activation Ready: NO',
  '- Runtime flags, versions, SOURCE_MODE and budget settings: NOT CHECKED by this D1 workflow.'];
 return lines.join('\n')+'\n';
}

if(process.argv[1]&&new URL(`file://${process.argv[1]}`).href===import.meta.url){
 const date=process.env.TARGET_DATE;
 const database=process.env.D1_DATABASE_NAME;
 if(!validTargetDate(date)||database!=='chass-keiba-research-db'||
    !process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID){
  throw new Error('preflight_configuration_invalid');
 }
 const execute=sql=>parseWranglerRows(execFileSync('npx',[
  '-y','wrangler@4','d1','execute',database,'--remote','--json','--command',sql
 ],{encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']}));
 try{
  const report=await runPreflight(date,{execute});
  const body=summary(report);
  console.log(body);
  if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,body,{flag:'a'});
  if([report.migration,report.schema,report.indexes].includes('FAIL'))process.exitCode=1;
 }catch(error){
  // Never emit raw D1/CLI errors: they may include data or credentials.
  const query=String(error?.message||'').match(/^preflight_query_blocked:([A-Za-z_]+)$/)?.[1]??'unknown';
  const body=`# JRA Production READ-ONLY preflight\n- Target date: ${date}\n- Query result: BLOCKED (${query})\n- Production Activation Ready: NO\n`;
  console.error(body);
  if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,body,{flag:'a'});
  process.exitCode=1;
 }
}
