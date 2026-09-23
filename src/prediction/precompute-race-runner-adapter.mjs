import {runRacePrecomputeJob} from './background-precompute.mjs';

const SUCCESS_STATUSES=new Set(['SAVED','SOURCE_VALIDATED','UNCHANGED','SUPERSEDED']);

export function createPrecomputeRaceRunnerAdapter({
  runJob=runRacePrecomputeJob,
  loadSource,
  calculate,
  loadLatest,
  save,
  versions,
  now,
  cryptoImpl
}={}){
  if(typeof runJob!=='function')throw new Error('invalid_precompute_job_runner');
  for(const [name,dependency] of Object.entries({loadSource,calculate,loadLatest,save})){
    if(typeof dependency!=='function')throw new Error(`invalid_precompute_dependency:${name}`);
  }
  if(typeof now!=='function')throw new Error('invalid_precompute_job_clock');
  if(!versions||typeof versions!=='object'||Array.isArray(versions))throw new Error('invalid_precompute_versions');

  return async function raceRunner(job){
    const timestamp=now();
    const parsedTimestamp=typeof timestamp==='string'?Date.parse(timestamp):NaN;
    if(!Number.isFinite(parsedTimestamp)){
      throw new Error('invalid_precompute_job_timestamp');
    }
    const result=await runJob(job,{
      enabled:true,loadSource,calculate,loadLatest,save,versions,now:new Date(parsedTimestamp).toISOString(),cryptoImpl
    });
    if(result?.status==='FAILED'){
      const error=new Error('precompute_race_job_failed');
      error.code=String(result.error||'precompute_race_job_failed');
      throw error;
    }
    if(!SUCCESS_STATUSES.has(result?.status))throw new Error('unexpected_precompute_race_job_status');
    return result;
  };
}
