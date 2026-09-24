import {createJraPrecomputeMeetingProvider} from './jra-precompute-meeting-provider.mjs';
import {createPrecomputeRuntimeRunner} from './precompute-runtime-adapter.mjs';
import {createJraPrecomputeSourceLoader} from './jra-precompute-source-loader.mjs';
import {createPrecomputeSourceBoundary} from './precompute-source-boundary.mjs';
import {createIsolatedJraDataRaceRunner} from './jra-data-race-runner-adapter.mjs';
import {readLatestPrecomputedSnapshot,savePrecomputedSnapshot} from './precomputed-store.mjs';

// Explicit caller versions are the sole version authority for this composition.
// Creating it has no side effects. No Worker or scheduler imports this module.
export function createJraPrecomputeProductionComposition({
 DB,date,fetchImpl,sourceTimeoutMs,maxJobs,deadline,now,versions,cryptoImpl,
 readLatest=readLatestPrecomputedSnapshot,saveSnapshot=savePrecomputedSnapshot,
 setTimer,clearTimer,AbortControllerImpl
}={}){
 if(!DB||typeof DB.prepare!=='function')throw new TypeError('invalid_jra_precompute_db');
 if(typeof now!=='function')throw new TypeError('invalid_jra_precompute_clock');
 if(!Number.isSafeInteger(maxJobs)||maxJobs<0)throw new TypeError('invalid_precompute_max_jobs');
 if(typeof deadline!=='number'||!Number.isFinite(deadline))throw new TypeError('invalid_precompute_execution_deadline');
 if(typeof readLatest!=='function'||typeof saveSnapshot!=='function')throw new TypeError('invalid_jra_precompute_store');

 // Meeting discovery and the execution budget use epoch milliseconds.
 // SOURCE and snapshot timestamps use the same caller clock in ISO form.
 const nowIso=()=>{
  const value=now();
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('invalid_jra_precompute_clock');
  return new Date(value).toISOString();
 };
 const loadMeetings=createJraPrecomputeMeetingProvider({DB,date,now});
 const isolatedSourceLoader=createJraPrecomputeSourceLoader({fetchImpl,now:nowIso});
 const boundaryOptions={loadSource:isolatedSourceLoader,timeoutMs:sourceTimeoutMs};
 if(setTimer!==undefined)boundaryOptions.setTimer=setTimer;
 if(clearTimer!==undefined)boundaryOptions.clearTimer=clearTimer;
 if(AbortControllerImpl!==undefined)boundaryOptions.AbortControllerImpl=AbortControllerImpl;
 const loadSource=createPrecomputeSourceBoundary(boundaryOptions);
 const raceRunner=createIsolatedJraDataRaceRunner({
  versions,loadSource,
  loadLatest:(organization,raceId)=>readLatest(DB,organization,raceId),
  save:snapshot=>saveSnapshot(DB,snapshot),
  now:nowIso,cryptoImpl
 });
 return createPrecomputeRuntimeRunner({
  organization:'JRA',loadMeetings,maxJobs,deadline,now,raceRunner
 });
}
