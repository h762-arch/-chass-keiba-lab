/** Default-off orchestration; genuine acquisition precedes the analysis start. */
import {runDailyImageIntake} from './daily-image-intake-v1.mjs';
import {runDailyAnalysis,dailyScheduleDue} from './daily-analysis-worker-v1.mjs';
import {readDailyCpsiDriveInputs} from './cpsi-drive-reader-v1.mjs';
import {archiveDailyAnalysis} from './daily-drive-archive-v1.mjs';
import {jstDate} from './daily-analysis-v1.mjs';
import {retryPrefix,validRetryId} from './daily-retry-v1.mjs';
export async function runQueuedDailyRetry(env={},options={}){
 if(env.ENABLE_DAILY_ANALYSIS_V1!=='true'||env.ENABLE_DAILY_IMAGE_INTAKE_V1!=='true'||!env.DB?.prepare)return null;
 const clock=options.clock||Date.now,date=jstDate(clock()),db=env.DB;
 const job=await db.prepare('SELECT job_id,summary_json FROM chass_daily_analysis_jobs WHERE job_id GLOB ? AND status=? ORDER BY started_at,job_id LIMIT 1').bind(retryPrefix(date)+'*','QUEUED').first();
 if(!job||!validRetryId(job.job_id,date))return null;
 const id=job.job_id,claim=await db.prepare('UPDATE chass_daily_analysis_jobs SET status=?,started_at=? WHERE job_id=? AND status=?').bind('PROCESSING',new Date(clock()).toISOString(),id,'QUEUED').run();
 if(claim.meta?.changes!==1)return null;
 try{
  const intake=await (options.intake||runDailyImageIntake)(env,{date,clock,retryId:id,fetchImpl:options.fetchImpl});
  const analysis=await runDailyAnalysis(env,{clock,retryId:id,retryRequestedAt:JSON.parse(job.summary_json||'{}').requestedAt,intakeReport:intake,readInputs:async()=>intake.rows||[]});
  return {status:analysis.status,analysis,archive:{status:'DISABLED'},intake:{status:intake.status,readbackVerifiedCount:intake.readbackVerifiedCount,issues:intake.issues}};
 }catch{
  const summary={...JSON.parse(job.summary_json||'{}'),issues:[{reason:'DAILY_RETRY_PROCESS_FAILED'}]};
  await db.prepare('UPDATE chass_daily_analysis_jobs SET status=?,completed_at=?,summary_json=? WHERE job_id=? AND status IN (?,?)').bind('HOLD',new Date(clock()).toISOString(),JSON.stringify(summary),id,'PROCESSING','RUNNING').run();
  return {status:'HOLD',analysis:{status:'HOLD',jobId:id},archive:{status:'DISABLED'}};
 }
}
export async function runDailyResearchCycle(env={},options={}){
 if(env.ENABLE_DAILY_ANALYSIS_V1!=='true')return {status:'DISABLED'};
 const clock=options.clock||Date.now,date=jstDate(clock());
 let intake,analysis={status:'NOT_DUE'};
 if(!dailyScheduleDue(options.scheduledTime,clock())){const retry=await runQueuedDailyRetry(env,options);if(retry)return retry;}
 if(dailyScheduleDue(options.scheduledTime,clock())){
  // Intake is once-per-date and persists actual observation times. Analyze only
  // after capture, never backdate new Freeze to the nominal 09:00 trigger.
  if(env.ENABLE_DAILY_IMAGE_INTAKE_V1==='true')intake=await (options.intake||runDailyImageIntake)(env,{date,clock,fetchImpl:options.fetchImpl});
  if(intake?.status==='IN_PROGRESS')return {status:'WAITING_FOR_IMAGE_INTAKE',analysis:{status:'NOT_STARTED'},archive:await (options.archive||archiveDailyAnalysis)(env,{date,clock,fetchImpl:options.fetchImpl})};
  analysis=await runDailyAnalysis(env,{scheduledTime:options.scheduledTime,clock,intakeReport:intake,readInputs:async()=>{
   let rows=[];
   try{rows=await (options.readInputs||readDailyCpsiDriveInputs)(env,{date,clock,fetchImpl:options.fetchImpl});}
   catch(e){if(!intake?.rows?.length)throw e;intake.issues.push({reason:'IMAGE_REGISTERED_FEED_UNAVAILABLE'});}
   return [...rows,...(intake?.rows||[])];
  }});
 }
 const archive=await (options.archive||archiveDailyAnalysis)(env,{date,clock,fetchImpl:options.fetchImpl});
 return {status:analysis.status,analysis,archive,...(intake?{intake:{status:intake.status,readbackVerifiedCount:intake.readbackVerifiedCount,issues:intake.issues}}:{})};
}
