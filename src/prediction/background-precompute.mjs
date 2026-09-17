import {appendLayerRevision,createPrecomputedIdentity,createPrecomputedSnapshot,normalizedVersions} from './precomputed-snapshot.mjs';

export const PRECOMPUTE_RUNNER_CONTRACTS=Object.freeze({
  calculation:Object.freeze({owns:Object.freeze(['SOURCE','DATA']),rule:'Identical semantic inputHash short-circuits calculate; this runner never writes MARKET, FINAL or RESULT.'}),
  market:Object.freeze({owns:Object.freeze(['MARKET']),rule:'Odds, popularity and EV revisions are created by a separate market runner before FINAL; changed MARKET invalidates FINAL and RESULT.'}),
  finalization:Object.freeze({owns:Object.freeze(['FINAL']),rule:'FINAL is created by a separate finalization runner only after MARKET exists.'}),
  result:Object.freeze({owns:Object.freeze(['RESULT']),rule:'Official results are appended by a separate result runner only after FINAL exists.'})
});

export async function runMarketRevision(snapshot,market,options){
  return appendLayerRevision(snapshot,'MARKET',market,options);
}

export async function runFinalizationRevision(snapshot,final,options){
  return appendLayerRevision(snapshot,'FINAL',final,options);
}

export async function runResultRevision(snapshot,result,options){
  return appendLayerRevision(snapshot,'RESULT',result,options);
}

export function raceJobKey({organization,date,track,raceNo}){
  if(!['JRA','NAR'].includes(organization))throw new Error('invalid_organization');
  const day=String(date).replace(/\D/g,'').slice(0,8),number=Number(raceNo);
  if(!/^\d{8}$/.test(day)||!track||!Number.isInteger(number)||number<1||number>12)throw new Error('invalid_race_job');
  return `${day}-${organization}-${track}-${String(number).padStart(2,'0')}`;
}

export function backgroundPrecomputeEnabled(env={}){
  return String(env.ENABLE_BACKGROUND_PRECOMPUTE||'').toLowerCase()==='true';
}

export async function runRacePrecomputeJob(job,{enabled=false,loadSource,calculate,loadLatest,save,versions,now=new Date().toISOString(),cryptoImpl=globalThis.crypto}={}){
  if(!enabled)return {status:'DISABLED',saved:false};
  const raceId=raceJobKey(job);
  try{
    for(const [name,fn] of Object.entries({loadSource,calculate,loadLatest,save}))if(typeof fn!=='function')throw new Error(`missing_dependency:${name}`);
    const source=await loadSource(job);
    const declaredVersions=normalizedVersions(versions||job.versions||{});
    const identity=await createPrecomputedIdentity({organization:job.organization,source,versions:declaredVersions,cryptoImpl});
    const existing=await loadLatest(job.organization,raceId);
    if(existing?.inputHash===identity.inputHash&&existing?.layers?.DATA){
      const validated=await appendLayerRevision(existing,'SOURCE',source,{at:now,cryptoImpl});
      const persisted=await save(validated);
      if(persisted?.saved===false)return {status:persisted.reason||'UNCHANGED',saved:false,reason:persisted.reason||'UNCHANGED',revision:persisted.revision,raceId,inputHash:identity.inputHash,snapshotHash:validated.snapshotHash,sourceValidatedAt:validated.sourceValidatedAt};
      return {status:'SOURCE_VALIDATED',saved:true,raceId,inputHash:identity.inputHash,snapshotHash:validated.snapshotHash,sourceValidatedAt:validated.sourceValidatedAt,revision:persisted?.revision};
    }
    const computed=await calculate(source,job);
    if(computed?.MARKET!=null||computed?.FINAL!=null||computed?.RESULT!=null)throw new Error('calculation_runner_layer_violation');
    for(const key of ['calculationVersion','modelVersion','clusterVersion','signalRuleVersion']){
      if(computed?.versions?.[key]!=null&&computed.versions[key]!==declaredVersions[key])throw new Error(`version_mismatch:${key}`);
    }
    const snapshot=await createPrecomputedSnapshot({raceId,organization:job.organization,source,data:computed.DATA,market:null,final:null,result:null,versions:declaredVersions,now,sourceValidatedAt:now,cryptoImpl});
    const persisted=await save(snapshot);
    if(persisted?.saved===false)return {status:persisted.reason||'UNCHANGED',saved:false,reason:persisted.reason||'UNCHANGED',revision:persisted.revision,raceId,inputHash:snapshot.inputHash,snapshotStatus:snapshot.status};
    return {status:'SAVED',saved:true,raceId,inputHash:snapshot.inputHash,snapshotStatus:snapshot.status,revision:persisted?.revision};
  }catch(error){
    return {status:'FAILED',saved:false,raceId,error:error?.code||error?.message||'unknown_error'};
  }
}

export async function runRaceJobs(jobs,deps){
  const results=[];
  for(const job of jobs)results.push(await runRacePrecomputeJob(job,deps));
  return results;
}
