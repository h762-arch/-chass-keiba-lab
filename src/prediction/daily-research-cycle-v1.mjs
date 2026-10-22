/** Default-off orchestration; genuine acquisition precedes the analysis start. */
import {runDailyImageIntake} from './daily-image-intake-v1.mjs';
import {runDailyAnalysis,dailyScheduleDue} from './daily-analysis-worker-v1.mjs';
import {readDailyCpsiDriveInputs} from './cpsi-drive-reader-v1.mjs';
import {archiveDailyAnalysis} from './daily-drive-archive-v1.mjs';
import {jstDate} from './daily-analysis-v1.mjs';
export async function runDailyResearchCycle(env={},options={}){
 if(env.ENABLE_DAILY_ANALYSIS_V1!=='true')return {status:'DISABLED'};
 const clock=options.clock||Date.now,date=jstDate(clock());
 let intake,analysis={status:'NOT_DUE'};
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
