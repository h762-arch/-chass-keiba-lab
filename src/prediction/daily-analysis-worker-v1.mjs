import {readDailyCpsiDriveInputs,cpsiDriveReaderAuthorized} from './cpsi-drive-reader-v1.mjs';
import {createDailyRaceArtifact,verifyDailyRaceArtifact,jstDate} from './daily-analysis-v1.mjs';
import {stableSourceJson} from './cpsi-source-recovery-v1.mjs';
import {dailyReadiness} from './daily-readiness-v1.mjs';
export const DAILY_PATH='/api/chass/v1/research/daily';
export const DAILY_SETUP_PATH=DAILY_PATH+'/setup';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','vary':'Authorization, Cookie, Origin','x-content-type-options':'nosniff'}});
const safeDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const jobId=date=>'DAILY_0900_JST:'+date;
const safeCode=e=>/^(IMAGE|DRIVE|DAILY|INPUT|SOURCE|CUTOFF|POST|INDEX|CANONICAL)_[A-Z0-9_]{1,100}$/.test(e?.code||e?.message||'')?(e.code||e.message):'DAILY_PROCESS_FAILED';
export function dailyScheduleDue(scheduledTime,now){
 const at=new Date(scheduledTime+9*3600000);
 return Number.isFinite(scheduledTime)&&Number.isFinite(now)&&at.getUTCHours()===9&&at.getUTCMinutes()===0&&now>=scheduledTime&&now-scheduledTime<=5*60000;
}
/** Default-OFF. Existing five-minute Worker cron supplies 00:00 UTC = 09:00 JST. */
export async function runDailyAnalysis(env={},options={}){
 if(env.ENABLE_DAILY_ANALYSIS_V1!=='true')return {status:'DISABLED'};
 const clock=options.clock||Date.now,start=clock(),scheduledTime=options.scheduledTime;
 if(!dailyScheduleDue(scheduledTime,start))return {status:'NOT_DUE'};
 if(!env.DB?.prepare)return {status:'HOLD',reason:'DAILY_STORAGE_NOT_CONFIGURED'};
 const date=jstDate(scheduledTime),id=jobId(date),db=env.DB;
 const claim=await db.prepare('INSERT OR IGNORE INTO chass_daily_analysis_jobs (job_id,race_date,started_at,status) VALUES (?,?,?,?)').bind(id,date,new Date(start).toISOString(),'RUNNING').run();
 if(claim.meta?.changes!==1)return {status:'ALREADY_CLAIMED',jobId:id};
 const issues=[],counts={inputCount:0,savedCount:0,completeCount:0,partialCount:0,heldCount:0};
 try{
  const rows=await (options.readInputs||readDailyCpsiDriveInputs)(env,{date,clock});
  if(options.intakeReport)for(const issue of (options.intakeReport.issues||[]).slice(0,192))issues.push({...(typeof issue.raceId==='string'?{raceId:issue.raceId}:{}),reason:safeCode({code:issue.reason})});
  if(!Array.isArray(rows)||rows.length>192)throw Error('DAILY_INPUT_COUNT_INVALID');
  counts.inputCount=rows.length;
  if(!rows.length)issues.push({reason:'DAILY_NO_REGISTERED_INPUTS'});
  const groups=new Map();
  for(const row of rows){const r=row.root?.race,key=`${r?.raceType}:${r?.raceDate}|${r?.track}|${r?.raceNo}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const candidates of groups.values()){
   const row=candidates[0],r=row.root?.race,raceId=`${r?.raceDate}|${r?.track}|${r?.raceNo}`;
   // Never pick the first of two distinct Runs or silently merge different evidence.
   if(new Set(candidates.map(x=>stableSourceJson(x.root))).size!==1){issues.push({raceId,reason:'DAILY_RUN_AMBIGUOUS'});counts.heldCount++;continue;}
   try{
    if(Date.parse(row.root?.race?.metricInputFreeze?.freezeAt)>start)throw Error('DAILY_INPUT_FROZEN_AFTER_JOB_START');
    const artifact=await createDailyRaceArtifact(row,{now:clock(),date});
    await verifyDailyRaceArtifact(artifact);
    const raw=JSON.stringify(artifact);
    if(new TextEncoder().encode(raw).length>900000)throw Error('DAILY_ARTIFACT_TOO_LARGE');
    // Actual time is checked immediately before writing, not backdated to 09:00.
    if(clock()>=Date.parse(row.root?.race?.metricInputFreeze?.postAt))throw Error('DAILY_COMPLETED_AFTER_START');
    await db.prepare('INSERT INTO chass_daily_analysis_runs (job_id,race_id,content_hash,artifact_json) VALUES (?,?,?,?)').bind(id,raceId,artifact.contentHash,raw).run();
    const stored=await db.prepare('SELECT artifact_json FROM chass_daily_analysis_runs WHERE job_id=? AND race_id=?').bind(id,raceId).first();
    if(!stored||stored.artifact_json!==raw)throw Error('DAILY_READBACK_MISMATCH');
    await verifyDailyRaceArtifact(JSON.parse(stored.artifact_json));
    if(clock()>=Date.parse(row.root.race.metricInputFreeze.postAt))throw Error('DAILY_READBACK_AFTER_START');
    counts.savedCount++;
    const status=artifact.body.result.status;
    if(status==='REVIEW_COMPLETE')counts.completeCount++;else if(status==='PARTIAL')counts.partialCount++;else counts.heldCount++;
   }catch(e){issues.push({raceId,reason:safeCode(e)});counts.heldCount++;}
  }
 }catch(e){issues.push({reason:safeCode(e)});}
 const status=counts.completeCount>0&&counts.partialCount===0&&counts.heldCount===0&&issues.length===0?'COMPLETE':counts.savedCount?'PARTIAL':'HOLD';
 const imageIntake=options.intakeReport?{status:options.intakeReport.status,scope:options.intakeReport.scope,expectedRaceCount:options.intakeReport.expectedRaceCount||0,imageFileCount:options.intakeReport.imageFileCount||0,readbackVerifiedCount:options.intakeReport.readbackVerifiedCount||0,imageOcrAttempted:options.intakeReport.imageOcrAttempted===true}:null;
 const summary={...counts,issues,inputScope:imageIntake?'REGISTERED_DRIVE_FEEDS_AND_NAR_IMAGE_FOLDERS':'REGISTERED_DRIVE_FEEDS_ONLY',allScheduledRacesConfirmed:false,imageOcrConnected:!!imageIntake?.readbackVerifiedCount,...(imageIntake?{imageIntake}:{}),driveOutputSync:false,researchOnly:true,formalKpiEligible:false};
 await db.prepare('UPDATE chass_daily_analysis_jobs SET completed_at=?,status=?,summary_json=? WHERE job_id=? AND status=?').bind(new Date(clock()).toISOString(),status,JSON.stringify(summary),id,'RUNNING').run();
 const readback=await db.prepare('SELECT status,summary_json FROM chass_daily_analysis_jobs WHERE job_id=?').bind(id).first();
 if(readback?.status!==status||readback.summary_json!==JSON.stringify(summary))throw Error('DAILY_JOB_READBACK_MISMATCH');
 return {status,jobId:id,...summary};
}
export async function handleDailyAnalysisRequest(request,env={}){
 const u=new URL(request.url);if(![DAILY_PATH,DAILY_SETUP_PATH].includes(u.pathname))return null;
 if(request.method!=='GET')return json({ok:false,code:'DAILY_METHOD_NOT_ALLOWED'},405);
 if(u.pathname===DAILY_SETUP_PATH){try{if(!await cpsiDriveReaderAuthorized(request,env))return json({ok:false,code:'DAILY_UNAUTHORIZED'},401);if(u.search) return json({ok:false,code:'DAILY_SELECTION_INVALID'},400);return json({ok:true,...await dailyReadiness(env)});}catch{return json({ok:false,code:'DAILY_SETUP_READ_FAILED'},503);}}
 if(env.ENABLE_DAILY_ANALYSIS_V1!=='true')return json({ok:false,code:'DAILY_DISABLED'},503);
 try{
  if(!await cpsiDriveReaderAuthorized(request,env))return json({ok:false,code:'DAILY_UNAUTHORIZED'},401);
  const date=u.searchParams.get('date');
  if(!safeDate(date)||u.searchParams.getAll('date').length!==1||[...u.searchParams.keys()].some(k=>k!=='date'))return json({ok:false,code:'DAILY_DATE_INVALID'},400);
  const job=await env.DB.prepare('SELECT started_at,completed_at,status,summary_json FROM chass_daily_analysis_jobs WHERE job_id=?').bind(jobId(date)).first();
  if(!job)return json({ok:true,date,status:'NOT_RUN',rows:[]});
  const summary=JSON.parse(job.summary_json||'null'),failed=new Set((summary?.issues||[]).map(x=>x.raceId));
  const records=job.status==='RUNNING'?{results:[]}:await env.DB.prepare('SELECT race_id,artifact_json FROM chass_daily_analysis_runs WHERE job_id=? ORDER BY race_id').bind(jobId(date)).all();
  const rows=[];
  for(const record of records.results||[]){if(failed.has(record.race_id))continue;try{const a=JSON.parse(record.artifact_json);await verifyDailyRaceArtifact(a);if(a.body.date!==date||a.body.result.raceId!==record.race_id)throw Error();rows.push({raceId:record.race_id,contentHash:a.contentHash,analyzedAt:a.body.analyzedAt,result:a.body.result});}catch{rows.push({raceId:record.race_id,result:{status:'HOLD',reason:'DAILY_STORED_ARTIFACT_INVALID'}});}}
  let driveArchive={status:'DISABLED'};
  if(env.ENABLE_DAILY_DRIVE_ARCHIVE_V1==='true'){
   try{
    const receipt=await env.DB.prepare('SELECT content_hash,file_id,folder_id,verified_at FROM chass_daily_drive_archives WHERE job_id=?').bind(jobId(date)).first();
    driveArchive=receipt&&receipt.folder_id===env.CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID&&/^sha256:[a-f0-9]{64}$/.test(receipt.content_hash)&&/^[A-Za-z0-9_-]{10,160}$/.test(receipt.file_id)&&Number.isFinite(Date.parse(receipt.verified_at))?{status:'PREVIOUSLY_VERIFIED',fileId:receipt.file_id,contentHash:receipt.content_hash,verifiedAt:receipt.verified_at}:{status:'PENDING'};
   }catch{driveArchive={status:'HOLD'};}
  }
  return json({ok:true,date,status:job.status,startedAt:job.started_at,completedAt:job.completed_at,summary,driveArchive,rows,researchOnly:true});
 }catch{return json({ok:false,code:'DAILY_READ_FAILED'},503);}
}
