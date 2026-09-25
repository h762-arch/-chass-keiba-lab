import {raceJobKey} from './background-precompute.mjs';
import {createPrecomputedIdentity} from './precomputed-snapshot.mjs';

function validJob(job){
 try{return job?.organization==='JRA'&&typeof job.date==='string'&&typeof job.track==='string'&&
  Number.isInteger(job.raceNo)&&job.raceId===raceJobKey(job);}catch{return false;}
}

// Isolated planning only: no Worker, scheduler, network or snapshot writes.
// selected[].source is the exact validated payload to hand to the eventual
// runner; do not silently re-read a changed cache row after selection.
export async function selectJraPrecomputeCacheJobs({jobs,maxJobs,selectionTurn,loadFreshSource,readLatest,versions,cryptoImpl=globalThis.crypto}={}){
 if(!Array.isArray(jobs)||!Number.isSafeInteger(maxJobs)||maxJobs<0||
    !Number.isSafeInteger(selectionTurn)||selectionTurn<0||
    typeof loadFreshSource!=='function'||typeof readLatest!=='function'||
    !versions||typeof versions.calculationVersion!=='string'||!versions.calculationVersion.trim()||
    typeof versions.modelVersion!=='string'||!versions.modelVersion.trim()){
  throw new TypeError('invalid_jra_precompute_cache_selection');
 }
 const eligible=[],unavailable=[],seen=new Set();
 for(const job of jobs){
  if(!validJob(job)||seen.has(job.raceId))throw new TypeError('invalid_jra_precompute_cache_job');
  seen.add(job.raceId);
  let source;
  try{source=await loadFreshSource(job);}
  catch(error){
   if(['jra_precompute_cache_missing','jra_precompute_cache_expired'].includes(error?.code)){
    unavailable.push(Object.freeze({job,reason:error.code}));continue;
   }
   throw error;
  }
  if(source?.organization!=='JRA'||source.raceId!==job.raceId)throw new TypeError('invalid_jra_precompute_cache_source');
  const identity=await createPrecomputedIdentity({organization:'JRA',source,versions,cryptoImpl});
  const latest=await readLatest(job);
  // "calculated" means this exact semantic SOURCE under these exact versions.
  // A DATA snapshot from an older official card must remain eligible as uncomputed.
  const calculated=latest?.layers?.DATA!=null&&latest.inputHash===identity.inputHash&&
   latest.calculationVersion===versions.calculationVersion&&latest.modelVersion===versions.modelVersion;
  const checked=calculated?Date.parse(latest.sourceValidatedAt):null;
  if(calculated&&!Number.isFinite(checked))throw new TypeError('invalid_jra_precompute_snapshot_validation_time');
  eligible.push(Object.freeze({job,source,calculated,validatedAt:Number.isFinite(checked)?checked:null}));
 }
 eligible.sort((a,b)=>Number(a.calculated)-Number(b.calculated)||
  (a.validatedAt??-Infinity)-(b.validatedAt??-Infinity)||
  (a.job.raceId<b.job.raceId?-1:a.job.raceId>b.job.raceId?1:0));
 // Explicit caller-owned turn is needed: a repeatedly failing uncomputed job
 // has no successful snapshot timestamp, so a static priority sort starves peers.
 // Rotate the priority-sorted queue once per scheduling turn. The caller must
 // pass a monotonically changing turn; this module does not own scheduling.
 const offset=eligible.length?selectionTurn%eligible.length:0;
 const rotated=eligible.slice(offset).concat(eligible.slice(0,offset));
 return Object.freeze({
  selected:Object.freeze(rotated.slice(0,maxJobs)),
  deferred:Object.freeze(rotated.slice(maxJobs)),
  unavailable:Object.freeze(unavailable),
  eligibleCount:eligible.length,selectedCount:Math.min(eligible.length,maxJobs),selectionTurn
 });
}
