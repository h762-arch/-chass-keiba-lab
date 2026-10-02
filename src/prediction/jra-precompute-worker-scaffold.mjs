import {backgroundPrecomputeEnabled} from './background-precompute.mjs';
import {jraPrecomputeSchedule,jraPrecomputeWallNow} from './jra-precompute-scheduling-contract.mjs';
import {createJraPrecomputePlanningIntegration} from './jra-precompute-planning-integration.mjs';
import {parseJraPrecomputeSoakGuard,inspectJraPrecomputeSoakGuard} from './jra-precompute-soak-guard.mjs';

const SNAPSHOT_SCHEMA_COLUMNS='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at';

function contractError(code,cause){
 const error=new Error(code,{cause});
 error.code=code;
 return error;
}

function positiveSetting(value,code){
 if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))){
  throw contractError(code);
 }
 return Number(value);
}

// The Worker owns the version values. No generic snapshot defaults are accepted here.
export function createJraPrecomputeWorkerRunner(env={}, {
 scheduledTime,wallNow=()=>Date.now(),
 compose=createJraPrecomputePlanningIntegration
}={}){
 if(!backgroundPrecomputeEnabled(env))return undefined;

 // Deliberately defer every validation, DB query, and composition construction
 // until the scheduled gate actually invokes this runner.
 return async function runJraPrecomputeFromWorker(){
  const calculationVersion=env.JRA_PRECOMPUTE_CALCULATION_VERSION;
  const modelVersion=env.JRA_PRECOMPUTE_MODEL_VERSION;
  if(typeof calculationVersion!=='string'||!calculationVersion.trim()||
     typeof modelVersion!=='string'||!modelVersion.trim()){
   throw contractError('jra_explicit_versions_required');
  }
  if(env.JRA_PRECOMPUTE_SOURCE_MODE!=='official-cache'){
   throw contractError('jra_precompute_source_mode_not_approved');
  }
  const maxPlanningJobs=positiveSetting(env.JRA_PRECOMPUTE_MAX_PLANNING_JOBS,'jra_precompute_max_planning_jobs_invalid');
  const maxJobs=positiveSetting(env.JRA_PRECOMPUTE_MAX_JOBS,'jra_precompute_max_jobs_invalid');
  const planningWindowMs=positiveSetting(env.JRA_PRECOMPUTE_PLANNING_WINDOW_MS,'jra_precompute_planning_window_invalid');
  const totalWindowMs=positiveSetting(env.JRA_PRECOMPUTE_TOTAL_WINDOW_MS,'jra_precompute_total_window_invalid');
  if(totalWindowMs<=planningWindowMs)throw contractError('jra_precompute_total_window_invalid');
  let schedule;
try{schedule=jraPrecomputeSchedule(scheduledTime)}
catch(error){throw contractError('invalid_jra_precompute_scheduled_time',error)}

let soakGuard;
try{soakGuard=parseJraPrecomputeSoakGuard(env)}
catch(error){throw contractError(error?.code||'jra_precompute_canary_guard_invalid',error)}

if(soakGuard&&schedule.targetDate!==soakGuard.targetDate){
 return Object.freeze({
  status:'CANARY_DATE_MISMATCH',
  targetDate:schedule.targetDate,
  canaryTargetDate:soakGuard.targetDate,
  ran:false
 });
}
  if(typeof wallNow!=='function')throw contractError('invalid_jra_precompute_clock');
  if(!env.DB||typeof env.DB.prepare!=='function')throw contractError('invalid_jra_precompute_db');
  let startedAt;
  try{startedAt=jraPrecomputeWallNow(wallNow)}
  catch(error){throw contractError('invalid_jra_precompute_clock',error)}
  const planningDeadline=startedAt+planningWindowMs;
  const executionDeadline=startedAt+totalWindowMs;
  if(!Number.isSafeInteger(planningDeadline)||!Number.isSafeInteger(executionDeadline)||
     !Number.isFinite(new Date(executionDeadline).getTime())){
   throw contractError('invalid_jra_precompute_deadline');
  }
  // Carry the start-time floor across the scaffold/integration boundary.
  const liveNow=()=>{
   const current=jraPrecomputeWallNow(wallNow);
   if(current<startedAt)throw contractError('jra_precompute_wall_clock_reversed');
   return current;
  };
  try{
   const statement=env.DB.prepare(`SELECT ${SNAPSHOT_SCHEMA_COLUMNS} FROM precomputed_race_snapshots LIMIT 0`);
   if(!statement||typeof statement.first!=='function')throw new TypeError('invalid_d1_statement');
   await statement.first();
  }catch(error){
   throw contractError('jra_precompute_snapshot_schema_unavailable',error);
  }
if(soakGuard){
 let guardState;
 try{
  guardState=await inspectJraPrecomputeSoakGuard({
   DB:env.DB,
   guard:soakGuard,
   scheduledTargetDate:schedule.targetDate,
   calculationVersion,
   modelVersion
  });
 }catch(error){
  throw contractError(error?.code||'jra_precompute_canary_guard_unavailable',error);
 }

 if(guardState.status==='CAP_REACHED'){
  return Object.freeze({
   status:'CANARY_CAP_REACHED',
   targetDate:guardState.targetDate,
   distinctRaces:guardState.distinctRaces,
   maxDistinctRaces:guardState.maxDistinctRaces,
   ran:false
  });
 }
}
  const runner=compose({
   DB:env.DB,sourceMode:'official-cache',
   now:liveNow,versions:{calculationVersion,modelVersion},
   maxPlanningJobs,maxJobs,planningDeadline,executionDeadline
  });
  return runner({scheduledTime});
 };
}
