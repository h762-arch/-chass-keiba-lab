import {raceJobKey} from './background-precompute.mjs';

const ORGANIZATIONS=new Set(['JRA','NAR']);
const compareText=(left,right)=>left<right?-1:left>right?1:0;

function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number),parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;
}

function canonicalRaceNo(value){
  if(typeof value!=='number'&&(typeof value!=='string'||!/^\d{1,2}$/.test(value)))throw new Error('invalid_precompute_job_race_no');
  const raceNo=Number(value);
  if(!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error('invalid_precompute_job_race_no');
  return raceNo;
}

function canonicalJob(job,organization){
  if(!job||typeof job!=='object'||Array.isArray(job))throw new Error('invalid_precompute_job_descriptor');
  if(job.organization!==organization)throw new Error('precompute_job_organization_mismatch');
  if(!validDate(job.date))throw new Error('invalid_precompute_job_date');
  if(typeof job.track!=='string'||!job.track.trim())throw new Error('invalid_precompute_job_track');
  if(typeof job.raceId!=='string'||!job.raceId)throw new Error('invalid_precompute_job_race_id');
  const track=job.track.trim(),raceNo=canonicalRaceNo(job.raceNo);
  const expectedRaceId=raceJobKey({organization,date:job.date,track,raceNo});
  if(job.raceId!==expectedRaceId)throw new Error('precompute_job_identity_mismatch');
  return Object.freeze({organization,date:job.date,track,raceNo,raceId:expectedRaceId});
}

function sameJob(left,right){
  return left.organization===right.organization&&left.date===right.date&&left.track===right.track&&left.raceNo===right.raceNo&&left.raceId===right.raceId;
}

export function selectPrecomputeJobs(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('invalid_precompute_job_budget_input');
  const {organization,jobs,maxJobs}=input;
  if(!ORGANIZATIONS.has(organization))throw new Error('unsupported_precompute_job_organization');
  if(!Array.isArray(jobs))throw new Error('invalid_precompute_jobs');
  if(!Number.isSafeInteger(maxJobs)||maxJobs<0)throw new Error('invalid_precompute_max_jobs');
  const unique=new Map();
  for(const raw of jobs){
    const job=canonicalJob(raw,organization),existing=unique.get(job.raceId);
    if(existing&&!sameJob(existing,job))throw new Error('precompute_job_identity_conflict');
    if(!existing)unique.set(job.raceId,job);
  }
  const canonical=[...unique.values()].sort((left,right)=>
    compareText(left.date,right.date)
    ||compareText(left.track,right.track)
    ||left.raceNo-right.raceNo
    ||compareText(left.raceId,right.raceId)
  );
  const selectedJobs=Object.freeze(canonical.slice(0,maxJobs));
  const deferredJobs=Object.freeze(canonical.slice(maxJobs));
  return Object.freeze({
    organization,
    selectedJobs,
    deferredJobs,
    totalJobs:canonical.length,
    selectedCount:selectedJobs.length,
    deferredCount:deferredJobs.length
  });
}
