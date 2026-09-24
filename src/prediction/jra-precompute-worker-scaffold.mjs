import {backgroundPrecomputeEnabled} from './background-precompute.mjs';
import {tokyoDate} from '../../jra-background-refresh.mjs';
import {createJraPrecomputeProductionComposition} from './jra-precompute-production-composition.mjs';

const SNAPSHOT_SCHEMA_COLUMNS='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at';

function contractError(code,cause){
 const error=new Error(code,{cause});
 error.code=code;
 return error;
}

// The Worker owns the version values. No generic snapshot defaults are accepted here.
export function createJraPrecomputeWorkerRunner(env={}, {
 now=()=>Date.now(),fetchImpl=globalThis.fetch,
 compose=createJraPrecomputeProductionComposition
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
  // SOURCE routing is still a production decision; enabling the background
  // flag alone must never authorize direct official-site requests.
  if(env.JRA_PRECOMPUTE_SOURCE_MODE!=='direct')throw contractError('jra_precompute_source_mode_not_approved');
  if(!env.DB||typeof env.DB.prepare!=='function')throw contractError('invalid_jra_precompute_db');
  try{
   const statement=env.DB.prepare(`SELECT ${SNAPSHOT_SCHEMA_COLUMNS} FROM precomputed_race_snapshots LIMIT 0`);
   if(!statement||typeof statement.first!=='function')throw new TypeError('invalid_d1_statement');
   await statement.first();
  }catch(error){
   throw contractError('jra_precompute_snapshot_schema_unavailable',error);
  }

  const startedAt=now();
  if(typeof startedAt!=='number'||!Number.isFinite(startedAt))throw contractError('invalid_jra_precompute_clock');
  const runner=compose({
   DB:env.DB,date:tokyoDate(new Date(startedAt)),
   now,fetchImpl,versions:{calculationVersion,modelVersion},
   maxJobs:1,deadline:startedAt+8_000,sourceTimeoutMs:4_000
  });
  return runner();
 };
}
