import {createJraPrecomputeMeetingProvider} from './jra-precompute-meeting-provider.mjs';
import {discoverPrecomputeRaceJobs} from './precompute-job-discovery.mjs';
import {createJraPrecomputeOfficialCacheSource} from './jra-precompute-official-cache-source.mjs';
import {selectJraPrecomputeCacheJobs} from './jra-precompute-cache-job-selection.mjs';
import {runBoundedPrecomputeJobs} from './precompute-execution-budget.mjs';
import {createIsolatedJraDataRaceRunner} from './jra-data-race-runner-adapter.mjs';
import {readLatestPrecomputedSnapshot,savePrecomputedSnapshot} from './precomputed-store.mjs';

// Isolated composition: construction does no I/O, and only the strict reader
// may touch the official race cache. Neither Worker nor scheduler imports it.
export function createJraPrecomputeCacheOnlyComposition({
 DB,date,maxJobs,deadline,now,versions,cryptoImpl,
 readLatest=readLatestPrecomputedSnapshot,saveSnapshot=savePrecomputedSnapshot
}={}){
 if(!DB||typeof DB.prepare!=='function')throw new TypeError('invalid_jra_precompute_db');
 if(typeof now!=='function')throw new TypeError('invalid_jra_precompute_clock');
 if(!Number.isSafeInteger(maxJobs)||maxJobs<0)throw new TypeError('invalid_precompute_max_jobs');
 if(typeof deadline!=='number'||!Number.isFinite(deadline))throw new TypeError('invalid_precompute_execution_deadline');
 if(typeof readLatest!=='function'||typeof saveSnapshot!=='function')throw new TypeError('invalid_jra_precompute_store');
 if(!versions||typeof versions.calculationVersion!=='string'||!versions.calculationVersion.trim()||
    typeof versions.modelVersion!=='string'||!versions.modelVersion.trim()){
  throw new TypeError('jra_explicit_versions_required');
 }
 const declaredVersions=Object.freeze({...versions});
 const loadMeetings=createJraPrecomputeMeetingProvider({DB,date,now});
 const loadFreshSource=createJraPrecomputeOfficialCacheSource({DB,now,cryptoImpl});
 const nowIso=()=>{
  const value=now();
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('invalid_jra_precompute_clock');
  return new Date(value).toISOString();
 };

 // selectionTurn is caller authority. No implicit clock-derived turn is used.
 return async function runCacheOnlyComposition({selectionTurn}={}){
  if(!Number.isSafeInteger(selectionTurn)||selectionTurn<0)throw new TypeError('invalid_jra_precompute_selection_turn');
  const meetings=await loadMeetings({organization:'JRA'});
  const jobs=discoverPrecomputeRaceJobs(meetings);
  const selection=await selectJraPrecomputeCacheJobs({
   jobs,maxJobs,selectionTurn,loadFreshSource,
   readLatest:job=>readLatest(DB,'JRA',job.raceId),
   versions:declaredVersions,cryptoImpl
  });

  // The budget canonicalizes job objects. Bind its raceId back to the exact
  // SOURCE already checked by the selector; never query the race cache again.
  const selectedSources=new Map(selection.selected.map(({job,source})=>[job.raceId,{job,source}]));
  const raceRunner=createIsolatedJraDataRaceRunner({
   versions:declaredVersions,
   loadSource:async job=>{
    const selected=selectedSources.get(job?.raceId);
    if(!selected||job.organization!==selected.job.organization||job.date!==selected.job.date||
       job.track!==selected.job.track||job.raceNo!==selected.job.raceNo){
     throw new TypeError('jra_precompute_unselected_source');
    }
    return selected.source;
   },
   loadLatest:(organization,raceId)=>readLatest(DB,organization,raceId),
   save:snapshot=>saveSnapshot(DB,snapshot),
   now:nowIso,cryptoImpl
  });
  const execution=await runBoundedPrecomputeJobs({
   organization:'JRA',jobs:selection.selected.map(item=>item.job),
   runner:raceRunner,deadline,now
  });
  // Keep SOURCE payloads private to this invocation; return planning metadata.
  return Object.freeze({
   organization:'JRA',discoveredCount:jobs.length,
   selection:Object.freeze({
    selectedJobs:Object.freeze(selection.selected.map(item=>item.job)),
    deferredJobs:Object.freeze(selection.deferred.map(item=>item.job)),
    unavailable:selection.unavailable,
    eligibleCount:selection.eligibleCount,selectedCount:selection.selectedCount,
    selectionTurn
   }),execution
  });
 };
}
