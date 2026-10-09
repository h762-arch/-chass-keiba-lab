import {raceJobKey} from './background-precompute.mjs';
import {createPrecomputedIdentity} from './precomputed-snapshot.mjs';

function validJob(job){
 try{return job?.organization==='JRA'&&typeof job.date==='string'&&typeof job.track==='string'&&
  Number.isInteger(job.raceNo)&&job.raceId===raceJobKey(job);}catch{return false;}
}

function rotateBucket(items,selectionTurn){
 if(!items.length)return [];
 const offset=selectionTurn%items.length;
 return items.slice(offset).concat(items.slice(0,offset));
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
 // Keep the primary invariant intact: every uncalculated exact SOURCE/version
 // must stay ahead of every already-calculated candidate. Rotate only inside
 // each priority bucket so a repeatedly failing uncalculated job cannot starve
 // its uncalculated peers, without allowing a calculated revisit to jump them.
 const uncalculated=eligible.filter(item=>!item.calculated);
 const calculated=eligible.filter(item=>item.calculated);
 const rotated=rotateBucket(uncalculated,selectionTurn).concat(rotateBucket(calculated,selectionTurn));
 return Object.freeze({
  selected:Object.freeze(rotated.slice(0,maxJobs)),
  deferred:Object.freeze(rotated.slice(maxJobs)),
  unavailable:Object.freeze(unavailable),
  eligibleCount:eligible.length,selectedCount:Math.min(eligible.length,maxJobs),selectionTurn
 });
}
