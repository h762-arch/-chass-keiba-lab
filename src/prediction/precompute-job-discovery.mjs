import {raceJobKey} from './background-precompute.mjs';

const ORGANIZATIONS=new Set(['JRA','NAR']);

const compareText=(left,right)=>left<right?-1:left>right?1:0;

function normalizedDate(value){
  if(typeof value!=='string')throw new Error('invalid_race_job_date');
  const date=value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('invalid_race_job_date');
  const [year,month,day]=date.split('-').map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day));
  if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day)throw new Error('invalid_race_job_date');
  return date;
}

function normalizedOrganization(value){
  if(typeof value!=='string')throw new Error('unsupported_race_job_organization');
  const organization=value;
  if(!ORGANIZATIONS.has(organization))throw new Error('unsupported_race_job_organization');
  return organization;
}

function normalizedTrack(value){
  if(typeof value!=='string')throw new Error('invalid_race_job_track');
  const track=value.trim();
  if(!track)throw new Error('invalid_race_job_track');
  return track;
}

function normalizedRaceNo(value){
  if(typeof value!=='number'&&(typeof value!=='string'||!/^\d{1,2}$/.test(value)))throw new Error('invalid_race_job_number');
  const raceNo=Number(value);
  if(!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error('invalid_race_job_number');
  return raceNo;
}

function normalizedRaceNumbers(value,label){
  if(!Array.isArray(value))throw new Error(`invalid_${label}`);
  return value.map(normalizedRaceNo);
}

export function discoverPrecomputeRaceJobs(meetings=[]){
  if(!Array.isArray(meetings))throw new Error('invalid_race_job_meetings');
  const jobs=new Map(),cancelledJobs=new Set();
  for(const meeting of meetings){
    if(!meeting||typeof meeting!=='object'||Array.isArray(meeting))throw new Error('invalid_race_job_meeting');
    if(meeting.status!=='meeting')continue;
    const organization=normalizedOrganization(meeting.organization);
    const date=normalizedDate(meeting.date);
    const track=normalizedTrack(meeting.track);
    const raceNumbers=normalizedRaceNumbers(meeting.raceNumbers,'race_numbers');
    const cancelled=new Set(normalizedRaceNumbers(meeting.cancelledRaceNumbers??[],'cancelled_race_numbers'));
    for(const raceNo of cancelled)cancelledJobs.add(raceJobKey({organization,date,track,raceNo}));
    for(const raceNo of raceNumbers){
      const raceId=raceJobKey({organization,date,track,raceNo});
      if(!jobs.has(raceId))jobs.set(raceId,Object.freeze({organization,date,track,raceNo,raceId}));
    }
  }
  return Object.freeze([...jobs.values()].filter(job=>!cancelledJobs.has(job.raceId)).sort((left,right)=>
    compareText(left.organization,right.organization)
    ||compareText(left.date,right.date)
    ||compareText(left.track,right.track)
    ||left.raceNo-right.raceNo
  ));
}
