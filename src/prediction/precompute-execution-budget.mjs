import {raceJobKey} from './background-precompute.mjs';

const ORGANIZATIONS=new Set(['JRA','NAR']);

function canonicalJob(job,organization){
  if(!job||typeof job!=='object'||Array.isArray(job))throw new Error('invalid_precompute_execution_job');
  if(job.organization!==organization)throw new Error('precompute_execution_organization_mismatch');
  const {date,track,raceNo,raceId}=job;
  if(typeof raceId!=='string'||!raceId)throw new Error('invalid_precompute_execution_race_id');
  let expectedRaceId;
  try{expectedRaceId=raceJobKey({organization,date,track,raceNo});}
  catch{throw new Error('invalid_precompute_execution_job_identity');}
  if(raceId!==expectedRaceId)throw new Error('precompute_execution_job_identity_mismatch');
  return Object.freeze({organization,date,track,raceNo:Number(raceNo),raceId});
}

function clockValue(now){
  const value=now();
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error('invalid_precompute_execution_clock');
  return value;
}

function freezeRecord(record){
  return Object.freeze(record);
}

function result({organization,jobs,completedJobs,failedJobs,unstartedJobs,status,error}){
  const output={
    status,
    organization,
    completedJobs:Object.freeze(completedJobs),
    failedJobs:Object.freeze(failedJobs),
    unstartedJobs:Object.freeze(unstartedJobs),
    totalJobs:jobs.length,
    startedCount:completedJobs.length+failedJobs.length,
    completedCount:completedJobs.length,
    failedCount:failedJobs.length,
    unstartedCount:unstartedJobs.length
  };
  if(error)output.error=error;
  return Object.freeze(output);
}

export async function runBoundedPrecomputeJobs({organization,jobs,runner,deadline,now}={}){
  if(!ORGANIZATIONS.has(organization))throw new Error('unsupported_precompute_execution_organization');
  if(!Array.isArray(jobs))throw new Error('invalid_precompute_execution_jobs');
  if(typeof runner!=='function')throw new Error('invalid_precompute_execution_runner');
  if(typeof deadline!=='number'||!Number.isFinite(deadline))throw new Error('invalid_precompute_execution_deadline');
  if(typeof now!=='function')throw new Error('invalid_precompute_execution_clock');

  const canonical=[],identities=new Set();
  for(const raw of jobs){
    const job=canonicalJob(raw,organization);
    if(identities.has(job.raceId))throw new Error('duplicate_precompute_execution_job');
    identities.add(job.raceId);
    canonical.push(job);
  }
  Object.freeze(canonical);

  const completedJobs=[],failedJobs=[];
  let index=0,previousNow=-Infinity,nextNow=clockValue(now);
  while(index<canonical.length){
    const current=nextNow;
    if(current<previousNow){
      return result({organization,jobs:canonical,completedJobs,failedJobs,unstartedJobs:canonical.slice(index),status:'FAILED',error:'non_monotonic_precompute_execution_clock'});
    }
    previousNow=current;
    if(current>=deadline)break;
    const job=canonical[index++];
    try{
      const value=await runner(job);
      completedJobs.push(freezeRecord({job,status:'COMPLETED',value}));
    }catch(error){
      failedJobs.push(freezeRecord({job,status:'FAILED',error:error?.code||error?.message||'unknown_error'}));
    }
    if(index<canonical.length){
      try{nextNow=clockValue(now);}
      catch(error){
        return result({organization,jobs:canonical,completedJobs,failedJobs,unstartedJobs:canonical.slice(index),status:'FAILED',error:error.message});
      }
    }
  }

  const unstartedJobs=canonical.slice(index);
  const status=failedJobs.length?'FAILED':unstartedJobs.length?'PARTIAL':'COMPLETED';
  return result({organization,jobs:canonical,completedJobs,failedJobs,unstartedJobs,status});
}
