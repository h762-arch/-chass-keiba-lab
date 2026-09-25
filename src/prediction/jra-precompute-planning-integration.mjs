import {createJraPrecomputeMeetingProvider} from './jra-precompute-meeting-provider.mjs';
import {discoverPrecomputeRaceJobs} from './precompute-job-discovery.mjs';
import {createJraPrecomputeOfficialCacheSource} from './jra-precompute-official-cache-source.mjs';
import {jraPrecomputeSchedule,jraPrecomputeSourceMode,jraPrecomputeWallNow,
 rotateJraPrecomputePlanningJobs} from './jra-precompute-scheduling-contract.mjs';
import {scanJraPrecomputePlanningJobs} from './jra-precompute-planning-budget.mjs';
import {selectJraPrecomputeCacheJobs} from './jra-precompute-cache-job-selection.mjs';
import {runBoundedPrecomputeJobs} from './precompute-execution-budget.mjs';
import {createIsolatedJraDataRaceRunner} from './jra-data-race-runner-adapter.mjs';
import {readLatestPrecomputedSnapshot,savePrecomputedSnapshot} from './precomputed-store.mjs';

// Isolated orchestration. No Worker/scheduled entrypoint imports this module.
// Planning owns exactly one read of each inspected SOURCE/latest pair; the
// selector and runner consume those captured values, never a second read.
export function createJraPrecomputePlanningIntegration({
 DB,sourceMode,maxPlanningJobs,maxJobs,planningDeadline,executionDeadline,
 now,versions,cryptoImpl,
 readLatest=readLatestPrecomputedSnapshot,saveSnapshot=savePrecomputedSnapshot
}={}){
 if(!DB||typeof DB.prepare!=='function')throw new TypeError('invalid_jra_precompute_db');
 if(jraPrecomputeSourceMode(sourceMode)!=='official-cache'){
  throw new TypeError('jra_precompute_direct_mode_not_approved');
 }
 if(typeof now!=='function'||!Number.isSafeInteger(maxPlanningJobs)||maxPlanningJobs<1||
    !Number.isSafeInteger(maxJobs)||maxJobs<0||
    typeof planningDeadline!=='number'||!Number.isFinite(planningDeadline)||
    typeof executionDeadline!=='number'||!Number.isFinite(executionDeadline)||
    typeof readLatest!=='function'||typeof saveSnapshot!=='function'){
  throw new TypeError('invalid_jra_precompute_planning_integration');
 }
 if(!versions||typeof versions.calculationVersion!=='string'||!versions.calculationVersion.trim()||
    typeof versions.modelVersion!=='string'||!versions.modelVersion.trim()){
  throw new TypeError('jra_explicit_versions_required');
 }
 const declaredVersions=Object.freeze({...versions});

 return async function runJraPlanningIntegration({scheduledTime}={}){
  // Invalid event identity fails before meeting/cache/snapshot I/O.
  const {targetDate,selectionTurn}=jraPrecomputeSchedule(scheduledTime);
  let previousNow=-Infinity;
  const wallNow=()=>{
   const value=jraPrecomputeWallNow(now);
   if(value<previousNow)throw new Error('jra_precompute_wall_clock_reversed');
   previousNow=value;
   return value;
  };
  const loadFreshSource=createJraPrecomputeOfficialCacheSource({DB,now:wallNow,cryptoImpl});
  const nowIso=()=>new Date(wallNow()).toISOString();
  const loadMeetings=createJraPrecomputeMeetingProvider({DB,date:targetDate,now:wallNow});
  const meetings=await loadMeetings({organization:'JRA'});
  const jobs=discoverPrecomputeRaceJobs(meetings);
  const planningOrder=rotateJraPrecomputePlanningJobs(jobs,selectionTurn,maxPlanningJobs);
  const planning=await scanJraPrecomputePlanningJobs({
   jobs:planningOrder,maxPlanningJobs,planningDeadline,now:wallNow,
   loadFreshSource,readLatest:job=>readLatest(DB,'JRA',job.raceId)
  });

  const inspected=new Map(planning.inspected.map(row=>[row.job.raceId,row]));
  const inspectedJobs=planning.inspected.map(row=>row.job);
  const checked=(job)=>{
   const row=inspected.get(job?.raceId);
   if(!row||row.job.organization!==job.organization||row.job.date!==job.date||
      row.job.track!==job.track||row.job.raceNo!==job.raceNo){
    throw new TypeError('jra_precompute_uninspected_job');
   }
   return row;
  };
  const selection=await selectJraPrecomputeCacheJobs({
   jobs:inspectedJobs,maxJobs,selectionTurn,versions:declaredVersions,cryptoImpl,
   loadFreshSource:async job=>{
    const row=checked(job);
    if(row.unavailableReason){
     throw Object.assign(new Error(row.unavailableReason),{code:row.unavailableReason});
    }
    return row.source;
   },
   readLatest:async job=>checked(job).latest
  });

  // The bounded executor canonicalizes jobs; the checked identity map also
  // keeps runner reads tied to the exact planning record.
  const selectedIds=new Set(selection.selected.map(row=>row.job.raceId));
  const selectedRow=job=>{
   const row=checked(job);
   if(!selectedIds.has(job.raceId)||row.unavailableReason){
    throw new TypeError('jra_precompute_unselected_job');
   }
   return row;
  };
  const raceRunner=createIsolatedJraDataRaceRunner({
   versions:declaredVersions,
   loadSource:async job=>selectedRow(job).source,
   loadLatest:async(organization,raceId)=>{
    if(organization!=='JRA'||!selectedIds.has(raceId)){
     throw new TypeError('jra_precompute_unselected_snapshot');
    }
    return inspected.get(raceId).latest;
   },
   save:snapshot=>saveSnapshot(DB,snapshot),now:nowIso,cryptoImpl
  });
  const execution=await runBoundedPrecomputeJobs({
   organization:'JRA',jobs:selection.selected.map(row=>row.job),
   runner:raceRunner,deadline:executionDeadline,now:wallNow
  });
  // No SOURCE or snapshot payload escapes the invocation.
  return Object.freeze({
   organization:'JRA',targetDate,selectionTurn,discoveredCount:jobs.length,
   planning:Object.freeze({status:planning.status,reason:planning.reason,
    inspectedCount:planning.inspectedCount,unscannedCount:planning.unscannedCount,
    unscannedJobs:planning.unscannedJobs}),
   selection:Object.freeze({
    selectedJobs:Object.freeze(selection.selected.map(row=>row.job)),
    deferredJobs:Object.freeze(selection.deferred.map(row=>row.job)),
    unavailable:selection.unavailable,eligibleCount:selection.eligibleCount,
    selectedCount:selection.selectedCount
   }),execution
  });
 };
}
