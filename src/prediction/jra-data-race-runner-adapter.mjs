import {calculateJraData} from './jra-data-calculator.mjs';
import {createPrecomputeRaceRunnerAdapter} from './precompute-race-runner-adapter.mjs';

// The generic runner consumes a layer envelope. The calculator only owns DATA.
export function calculateJraDataLayer(source){
 return {DATA:calculateJraData(source)};
}

// Isolated composition only: no Worker, schedule, persistence implementation or flags.
export function createIsolatedJraDataRaceRunner({versions,...dependencies}={}){
 if(!versions||typeof versions!=='object'||Array.isArray(versions)){
  throw new TypeError('jra_explicit_versions_required');
 }
 for(const key of ['calculationVersion','modelVersion']){
  if(typeof versions[key]!=='string'||!versions[key].trim()){
   throw new TypeError(`jra_explicit_version_required:${key}`);
  }
 }
 const declaredVersions=Object.freeze({...versions});
 const run=createPrecomputeRaceRunnerAdapter({
  ...dependencies,versions:declaredVersions,calculate:calculateJraDataLayer
 });
 return async function isolatedJraRaceRunner(job){
  if(job?.organization!=='JRA')throw new TypeError('jra_race_job_required');
  return run(job);
 };
}
