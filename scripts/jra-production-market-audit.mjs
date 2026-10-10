import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {validDate as validTargetDate} from '../jra-meeting-discovery.mjs';
import {discoverPrecomputeRaceJobs} from '../src/prediction/precompute-job-discovery.mjs';
import {createJraPrecomputeMeetingProvider} from '../src/prediction/jra-precompute-meeting-provider.mjs';
import {readMarketQueueReadiness,marketQueueReadinessSummary} from './jra-market-queue-readiness.mjs';
import {readMarketQueueAudit} from './jra-market-queue-audit-reader.mjs';
import {d1RowToSnapshot} from '../src/prediction/precomputed-store.mjs';
import {stableHash,createSnapshotHash,createPrecomputedIdentity,assertMarketIndependentData} from '../src/prediction/precomputed-snapshot.mjs';

export function marketAuditQueries(date){
 if(!validTargetDate(date))throw new Error('invalid_target_date');
 return {
  meeting:`SELECT date,status,meetings_json,checked_at,next_refresh_at,source,parser_version,error_code FROM jra_meeting_calendar WHERE date='${date}'`,
  snapshots:`SELECT * FROM precomputed_race_snapshots WHERE organization='JRA' AND race_id LIKE '${date.replaceAll('-','')}-JRA-%' ORDER BY race_id,revision`
 };
}

export function productionMarketSummaryLines(report){
 const q=report.queueAudit;
 return `## Phase106 JRA MARKET audit\n- Date: ${report.targetDate}\n- Stored MARKET: ${report.passCount}/${report.expectedCount}\n- Missing: ${report.missingCount}; invalid: ${report.failedCount}\n- Status: ${report.status}\n- Observation: ${report.observation}\n- ${report.limitation}\n- Formal KPI/Signal adoption: NOT PERFORMED\n`+
  (report.queueReadiness?marketQueueReadinessSummary(report.queueReadiness):'')+
  (q?`\n## Phase107 MARKET Queue reason audit\n- Status: ${q.status}\n- Run: ${q.runId||'UNKNOWN'}\n- Reason counts: ${JSON.stringify(q.reasonCounts)}\n- Historical unrecorded reasons: UNKNOWN\n`:'');
}

export async function readProductionMarketAudit(date,{execute,now=Date.now(),baseline=null,profileQueue=false,profileNow=Date.now}={}){
 const q=marketAuditQueries(date);
 const meetingRows=await execute(q.meeting),snapshotRows=await execute(q.snapshots);
 const report=await auditJraProductionMarket({date,now,meetingRows,snapshotRows,baseline});
 const queueAudit=await readMarketQueueAudit(date,{execute});
 const queueReadiness=profileQueue?await readMarketQueueReadiness(date,{execute,meetingRows,snapshotRows,now:profileNow}):undefined;
 return {...report,queueAudit,...(queueReadiness?{queueReadiness}:{})};
}

function parseWranglerRows(output){
 const rows=JSON.parse(output);
 if(!Array.isArray(rows)||rows.length!==1||rows[0]?.success!==true||!Array.isArray(rows[0].results))throw Error('invalid_remote_d1_result');
 return rows[0].results;
}

async function inspect(job,rows,now){
 const markets=rows.filter(r=>r.market_json!=null);
 if(!markets.length)return {raceId:job.raceId,status:'MISSING',reason:'MARKET_NOT_SAVED'};
 try{
  const first=markets[0],s=d1RowToSnapshot(first),m=s.layers.MARKET;
  const parent=rows.find(r=>r.snapshot_hash===m?.dataSnapshotHash&&r.revision<first.revision);
  if(!parent)throw Error('PARENT_NOT_FOUND');
  const p=d1RowToSnapshot(parent),source=p.layers.SOURCE,race=source?.race;
  if(source?.organization!=='JRA'||source.raceId!==job.raceId||race?.date!==job.date||race.racecourse!==job.track||race.raceNo!==job.raceNo)throw Error('PARENT_IDENTITY');
  assertMarketIndependentData(p.layers.DATA);
  const identity=await createPrecomputedIdentity({organization:'JRA',source,versions:p});
  if(identity.sourceHash!==p.sourceHash||identity.inputHash!==p.inputHash||await createSnapshotHash(p)!==p.snapshotHash||await createSnapshotHash(s)!==s.snapshotHash)throw Error('SNAPSHOT_HASH');
  for(const key of ['sourceHash','inputHash','sourceValidatedAt','dataCalculatedAt','calculatedAt','calculationVersion','modelVersion','clusterVersion','signalRuleVersion'])if(s[key]!==p[key])throw Error('DATA_METADATA_CHANGED');
  for(const layer of ['SOURCE','DATA'])if(await stableHash(s.layers[layer])!==await stableHash(p.layers[layer]))throw Error('DATA_CHANGED');
  if(s.layers.FINAL||s.layers.RESULT||p.layers.MARKET||p.layers.FINAL||p.layers.RESULT)throw Error('FIRST_MARKET_LIFECYCLE');
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(race.postTime||''))throw Error('POST_TIME_UNKNOWN');
  const post=Date.parse(`${job.date}T${race.postTime}:00+09:00`),acquired=Date.parse(m.acquiredAt),freeze=Date.parse(m.frozenAt),saved=Date.parse(first.created_at);
  if(!Number.isFinite(acquired)||!Number.isFinite(freeze)||!Number.isFinite(saved)||acquired>freeze||freeze>=post||saved<freeze||freeze>now)throw Error('FREEZE_TIME');
  let official=false;try{official=new URL(m.sourceUrl).origin==='https://www.jra.go.jp'}catch{}
  if(!official||m.organization!=='JRA'||m.raceId!==job.raceId||m.source!=='JRA_OFFICIAL'||m.parserVersion!=='jra-official-win-odds-v1'||! /^[a-f0-9]{64}$/.test(m.contentHash||'')||m.frozen!==true||m.freezePolicy!=='FIRST_COMPLETE_MARKET_V1'||m.complete!==true||m.coverage!==1)throw Error('MARKET_METADATA');
  const active=source.horses.filter(h=>h.runningStatus==='active').map(h=>h.horseNo),horses=m.horses;
  if(active.length<2||m.activeHorseCount!==active.length||!Array.isArray(horses)||horses.length!==active.length||new Set(horses.map(h=>h.horseNo)).size!==active.length||horses.some(h=>!active.includes(h.horseNo)||!Number.isFinite(h.odds)||h.odds<1||!Number.isInteger(h.popularity)||h.popularity<1||h.popularity>active.length))throw Error('COVERAGE');
  const marketHash=await stableHash(m);
  for(const row of markets)if(await stableHash(JSON.parse(row.market_json))!==marketHash)throw Error('MARKET_REPLACED');
  return {raceId:job.raceId,status:'PASS',firstRevision:Number(first.revision),firstSnapshotHash:s.snapshotHash,marketHash,dataSnapshotHash:p.snapshotHash,acquiredAt:m.acquiredAt,frozenAt:m.frozenAt,marketRevisionCount:markets.length};
 }catch(error){return {raceId:job.raceId,status:'FAIL',reason:error.message};}
}

export async function auditJraProductionMarket({date,now,meetingRows,snapshotRows,baseline=null}){
 if(!validTargetDate(date)||!Number.isFinite(now)||!Array.isArray(snapshotRows)||!Array.isArray(meetingRows))throw Error('invalid_market_audit');
 const DB={prepare(){return {bind(value){return {first:async()=>meetingRows.find(r=>r.date===value)??null}}}}};
 const meetings=await createJraPrecomputeMeetingProvider({DB,date,now:()=>now})({organization:'JRA'});
 const jobs=discoverPrecomputeRaceJobs(meetings);
 if(!jobs.length||jobs.length>24)throw Error('MARKET_COHORT_UNKNOWN');
 const expected=new Set(jobs.map(j=>j.raceId));
 if(snapshotRows.some(r=>!expected.has(r.race_id)))throw Error('UNEXPECTED_SNAPSHOT_RACE');
 const races=[];
 for(const job of jobs)races.push(await inspect(job,snapshotRows.filter(r=>r.race_id===job.raceId).sort((a,b)=>a.revision-b.revision),now));
 let observation='NOT_COMPARED';
 if(baseline){
  if(baseline.targetDate!==date||!Array.isArray(baseline.races)||baseline.races.length!==races.length||!baseline.races.every(r=>expected.has(r.raceId))||new Set(baseline.races.map(r=>r.raceId)).size!==races.length||!Number.isFinite(Date.parse(baseline.checkedAt))||Date.parse(baseline.checkedAt)>now)throw Error('BASELINE_IDENTITY');
  observation='PASS';
  for(const before of baseline.races.filter(r=>r.status==='PASS')){
   const after=races.find(r=>r.raceId===before.raceId);
   if(after?.status!=='PASS'||['firstRevision','firstSnapshotHash','marketHash','dataSnapshotHash','acquiredAt','frozenAt'].some(k=>before[k]!==after[k]))observation='FAIL';
  }
  if(!baseline.races.some(r=>r.status==='PASS'))observation='NO_FROZEN_BASELINE';
 }
 const pass=races.filter(r=>r.status==='PASS').length,failed=races.filter(r=>r.status==='FAIL').length;
 return {targetDate:date,checkedAt:new Date(now).toISOString(),expectedCount:jobs.length,passCount:pass,missingCount:races.length-pass-failed,failedCount:failed,
  status:failed||observation==='FAIL'?'FAIL':pass===jobs.length?'PASS':'HOLD',observation,races,
  formalKpiAdopted:false,signalFreezeImplemented:false,
  limitation:'Two reads show stored evidence consistency, not proof that Cron ran between reads or source authentication.'};
}

if(process.argv[1]&&new URL(`file://${process.argv[1]}`).href===import.meta.url){
 const date=process.env.TARGET_DATE,queries=marketAuditQueries(date);
 if(process.env.D1_DATABASE_NAME!=='chass-keiba-research-db'||!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)throw Error('market_audit_configuration');
 const execute=sql=>parseWranglerRows(execFileSync('npx',['-y','wrangler@4','d1','execute','chass-keiba-research-db','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:40*1024*1024,stdio:['ignore','pipe','pipe']}));
 try{
  const meetingRows=execute(queries.meeting),snapshotRows=execute(queries.snapshots);
  const baseline=process.env.MARKET_BASELINE_PATH?JSON.parse(readFileSync(process.env.MARKET_BASELINE_PATH,'utf8')):null;
  const report=await auditJraProductionMarket({date,now:Date.now(),meetingRows,snapshotRows,baseline});
  writeFileSync(process.env.MARKET_REPORT_PATH||'market-audit.json',JSON.stringify(report,null,2));
  const summary=productionMarketSummaryLines(report);
  console.log(summary);if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,summary,{flag:'a'});
  if(report.status==='FAIL')process.exitCode=1;
 }catch{
  console.error('MARKET_AUDIT_BLOCKED');process.exitCode=1;
 }
}
