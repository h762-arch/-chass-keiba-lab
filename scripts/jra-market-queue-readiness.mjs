import {validDate} from '../jra-meeting-discovery.mjs';
import {createJraPrecomputeMeetingProvider} from '../src/prediction/jra-precompute-meeting-provider.mjs';
import {discoverPrecomputeRaceJobs} from '../src/prediction/precompute-job-discovery.mjs';
import {inspectMarketQueueJob} from '../src/prediction/jra-market-queue-worker.mjs';
import {createJraPrecomputedMarketBridge} from '../src/prediction/jra-precomputed-market-bridge.mjs';

const columns={run_id:['TEXT',1,1],event_no:['INTEGER',1,2],race_id:['TEXT',1,0],target_date:['TEXT',1,0],recorded_at:['TEXT',1,0],event_json:['TEXT',1,0],event_hash:['TEXT',1,0]};
export function marketQueueReadinessQueries(date){
 if(!validDate(date))throw Error('invalid_market_readiness_date');
 return {
  schema:"SELECT name,type,\"notnull\" AS required,pk FROM pragma_table_info('jra_market_queue_events')",
  objects:"SELECT name,type,sql FROM sqlite_master WHERE tbl_name='jra_market_queue_events' ORDER BY type,name",
  odds:`SELECT kind,cache_key,payload_json,source_url,fetched_at,expires_at,parser_version,content_hash FROM jra_official_cache WHERE kind='odds' AND cache_key LIKE 'odds|${date}|%'`
 };
}
export function marketQueueSchemaReadiness(rows,objects){
 if(!Array.isArray(rows)||!Array.isArray(objects))return {status:'UNKNOWN',issues:['SCHEMA_RESULT_INVALID']};
 if(!rows.length)return {status:'MISSING',issues:['MIGRATION_0013_REQUIRED']};
 const issues=[];
 for(const [name,[type,required,pk]] of Object.entries(columns)){
  const row=rows.find(r=>r.name===name);
  if(!row||row.type?.toUpperCase()!==type||row.required!==required||row.pk!==pk)issues.push('COLUMN_'+name);
 }
 if(rows.length!==Object.keys(columns).length)issues.push('EXTRA_COLUMNS');
 const table=objects.find(r=>r.type==='table'&&r.name==='jra_market_queue_events');
 if(!/CHECK\s*\(\s*event_no\s*>\s*0\s*\)/i.test(table?.sql||''))issues.push('EVENT_NUMBER_CHECK');
 for(const [name,fields] of [['idx_jra_market_queue_date','target_date,recorded_at,run_id,event_no'],['idx_jra_market_queue_race','race_id,recorded_at']]){
  const index=objects.find(r=>r.type==='index'&&r.name===name);
  const normalized=(index?.sql||'').replace(/\s+/g,'').toLowerCase();
  if(!normalized.endsWith(`onjra_market_queue_events(${fields})`))issues.push('INDEX_'+name);
 }
 if(objects.some(r=>r.type==='trigger'))issues.push('UNREVIEWED_TRIGGER');
 return {status:issues.length?'MISMATCH':'MATCH',issues};
}

// Captured SELECT rows only. Unsupported SQL and every write API fail closed.
export function createCapturedMarketReadDB({meetingRows,snapshotRows,oddsRows}){
 if([meetingRows,snapshotRows,oddsRows].some(r=>!Array.isArray(r)))throw Error('invalid_captured_market_rows');
 const rows=structuredClone({meetingRows,snapshotRows,oddsRows});
 return {prepare(sql){
  const q=sql.replace(/\s+/g,' ').trim();
  const meeting='SELECT date, status, meetings_json, checked_at, next_refresh_at, source, parser_version, error_code FROM jra_meeting_calendar WHERE date = ?';
  const latest='SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id=? ORDER BY revision DESC LIMIT 1';
  const prior='SELECT revision FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND market_json IS NOT NULL ORDER BY revision ASC LIMIT 1';
  const odds="SELECT payload_json,source_url,fetched_at,expires_at,parser_version,content_hash FROM jra_official_cache WHERE kind='odds' AND cache_key=?";
  if(![meeting,latest,prior,odds].includes(q))throw Error('READINESS_SQL_REJECTED');
  return {bind(...args){return {async first(){
   let matches;
   if(q===meeting){if(args.length!==1)throw Error('READINESS_BIND_REJECTED');matches=rows.meetingRows.filter(r=>r.date===args[0]);}
   else if(q===odds){if(args.length!==1)throw Error('READINESS_BIND_REJECTED');matches=rows.oddsRows.filter(r=>r.kind==='odds'&&r.cache_key===args[0]);}
   else {if(args.length!==2)throw Error('READINESS_BIND_REJECTED');matches=rows.snapshotRows.filter(r=>r.organization===args[0]&&r.race_id===args[1]&&(q!==prior||r.market_json!=null)).sort((a,b)=>q===prior?a.revision-b.revision:b.revision-a.revision);}
   if((q===meeting||q===odds)&&matches.length>1)throw Error('READINESS_DUPLICATE_ROWS');
   return structuredClone(matches[0]||null);
  },run(){throw Error('READINESS_WRITE_REJECTED')}}},run(){throw Error('READINESS_WRITE_REJECTED')}};
 }};
}

export async function profileCapturedMarketQueue({date,meetingRows,snapshotRows,oddsRows,now=Date.now,clock=()=>performance.now()}={}){
 if(!validDate(date)||typeof now!=='function'||typeof clock!=='function')throw Error('invalid_market_profile');
 const started=clock();let last=started;
 const tick=()=>{const t=clock();if(!Number.isFinite(t)||t<last)throw Error('invalid_profile_clock');last=t;return t;};
 if(!Number.isFinite(started))throw Error('invalid_profile_clock');
 const observedAt=now();if(!Number.isFinite(observedAt))throw Error('invalid_profile_time');
 const DB=createCapturedMarketReadDB({meetingRows,snapshotRows,oddsRows});
 const meetings=await createJraPrecomputeMeetingProvider({DB,date,now})({organization:'JRA'});
 const jobs=discoverPrecomputeRaceJobs(meetings);
 if(!jobs.length||jobs.length>24)throw Error('READINESS_COHORT_UNKNOWN');
 let simulatedSaves=0;
 const bridge=createJraPrecomputedMarketBridge({DB,now,deadline:Number.MAX_SAFE_INTEGER,
  save:async()=>{simulatedSaves++;return {status:'WOULD_FREEZE',reason:'WOULD_FREEZE',saved:false};}});
 const races=[];
 for(const job of jobs){
  const start=tick();let reason,bridgeEvaluated=false;
  try{
   const state=await inspectMarketQueueJob(DB,job,now);reason=state.reason;
   if(reason==='READY'){bridgeEvaluated=true;const result=await bridge(job);reason=result.reason||result.status;}
  }catch{reason='VALIDATION_FAILED';}
  races.push({raceId:job.raceId,reason,bridgeEvaluated,saved:false,validationElapsedMs:tick()-start});
 }
 const counts={};for(const r of races)counts[r.reason]=(counts[r.reason]||0)+1;
 const finishedAt=now();if(!Number.isFinite(finishedAt)||finishedAt<observedAt)throw Error('invalid_profile_time');
 return {status:'OBSERVED',targetDate:date,observedAt:new Date(observedAt).toISOString(),finishedAt:new Date(finishedAt).toISOString(),
  expectedCount:jobs.length,races,reasonCounts:counts,simulatedSaveCount:simulatedSaves,productionSaveCount:0,
  validationElapsedMs:tick()-started,measurementContext:'CAPTURED_ROWS_NODE_VALIDATION',
  workerD1TimingMeasured:false,saveTimingMeasured:false,auditWriteTimingMeasured:false,budgetDecision:'UNDECIDED',
  limitation:'SELECTs are separate observations, not one atomic snapshot. WOULD_FREEZE is validation only; no save, audit write, deadline trial or production throughput guarantee.'};
}

export async function readMarketQueueReadiness(date,{execute,meetingRows,snapshotRows,now=Date.now,clock=()=>performance.now()}={}){
 const queries=marketQueueReadinessQueries(date),readTimings=[];
 const read=async(name)=>{const start=clock();const rows=await execute(queries[name]);const elapsedMs=clock()-start;if(!Number.isFinite(elapsedMs)||elapsedMs<0)throw Error('invalid_read_clock');readTimings.push({query:name,elapsedMs});return rows;};
 let schema={status:'UNKNOWN',issues:['SCHEMA_READ_FAILED']};
 try{schema=marketQueueSchemaReadiness(await read('schema'),await read('objects'));}catch{}
 try{
  const oddsRows=await read('odds');
  const profile=await profileCapturedMarketQueue({date,meetingRows,snapshotRows,oddsRows,now,clock});
  return {...profile,schema,readTimings,readTimingContext:'REMOTE_EXECUTOR_INCLUDING_CLI_OVERHEAD',activationReady:false};
 }catch{return {status:'BLOCKED',targetDate:date,schema,readTimings,reason:'READINESS_READ_OR_VALIDATION_FAILED',activationReady:false,budgetDecision:'UNDECIDED',productionSaveCount:0};}
}
export function marketQueueReadinessSummary(r){
 return `\n## Phase108 MARKET Queue read-only readiness\n- Status: ${r.status}; audit schema: ${r.schema.status}\n- Reason counts: ${JSON.stringify(r.reasonCounts||{})}\n- Captured-data validation ms: ${r.validationElapsedMs??'UNKNOWN'}\n- Remote SELECT ms (includes CLI overhead): ${JSON.stringify(r.readTimings)}\n- Production saves: 0; audit writes: 0\n- Worker D1/save/audit-write timing: NOT MEASURED\n- Budget decision: UNDECIDED; Activation Ready: NO\n`;
}
