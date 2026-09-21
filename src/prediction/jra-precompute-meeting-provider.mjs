import {JRA_TRACKS,validDate} from '../../jra-meeting-discovery.mjs';
import {discoverPrecomputeRaceJobs} from './precompute-job-discovery.mjs';

const TRACKS=new Set(JRA_TRACKS);
const STATUSES=new Set(['meeting','non_meeting']);

const SELECT_MEETING_CACHE=`SELECT date, status, meetings_json, checked_at, next_refresh_at, source, parser_version, error_code
  FROM jra_meeting_calendar
  WHERE date = ?`;

function contractError(code,cause){
  const error=new Error(code,{cause});
  error.code=code;
  return error;
}

function canonicalMeeting(meeting,date){
  if(!meeting||typeof meeting!=='object'||Array.isArray(meeting)){
    throw contractError('jra_precompute_meeting_cache_invalid');
  }
  if(meeting.organization!=='JRA'||meeting.date!==date||!STATUSES.has(meeting.status)){
    throw contractError('jra_precompute_meeting_cache_invalid');
  }
  if(typeof meeting.track!=='string'||!TRACKS.has(meeting.track)||!Array.isArray(meeting.raceNumbers)){
    throw contractError('jra_precompute_meeting_cache_invalid');
  }
  if(meeting.status==='non_meeting'&&meeting.raceNumbers.length!==0){
    throw contractError('jra_precompute_meeting_cache_invalid');
  }
  if(Object.hasOwn(meeting,'cancelledRaceNumbers')&&!Array.isArray(meeting.cancelledRaceNumbers)){
    throw contractError('jra_precompute_meeting_cache_invalid');
  }

  try{
    discoverPrecomputeRaceJobs([{...meeting,status:'meeting'}]);
  }catch(error){
    throw contractError('jra_precompute_meeting_cache_invalid',error);
  }

  const descriptor={
    organization:'JRA',
    date,
    track:meeting.track,
    status:meeting.status,
    raceNumbers:Object.freeze([...meeting.raceNumbers])
  };
  if(Object.hasOwn(meeting,'cancelledRaceNumbers')){
    descriptor.cancelledRaceNumbers=Object.freeze([...meeting.cancelledRaceNumbers]);
  }
  return Object.freeze(descriptor);
}

export function createJraPrecomputeMeetingProvider({DB,date,now}={}){
  if(!DB||typeof DB.prepare!=='function')throw contractError('invalid_jra_precompute_meeting_db');
  if(!validDate(date))throw contractError('invalid_jra_precompute_meeting_date');
  if(typeof now!=='function')throw contractError('invalid_jra_precompute_meeting_clock');

  return async function loadMeetings({organization}={}){
    if(organization!=='JRA')throw contractError('invalid_jra_precompute_meeting_organization');
    const currentTime=now();
    if(typeof currentTime!=='number'||!Number.isFinite(currentTime)){
      throw contractError('invalid_jra_precompute_meeting_clock');
    }

    let row;
    try{
      const statement=DB.prepare(SELECT_MEETING_CACHE);
      if(!statement||typeof statement.bind!=='function')throw new TypeError('invalid_prepare_result');
      const bound=statement.bind(date);
      if(!bound||typeof bound.first!=='function')throw new TypeError('invalid_bind_result');
      row=await bound.first();
    }catch(error){
      throw contractError('jra_precompute_meeting_cache_read_failed',error);
    }

    if(!row)throw contractError('jra_precompute_meeting_cache_missing');
    if(row.date!==date)throw contractError('jra_precompute_meeting_cache_invalid');
    if(row.status==='unknown')throw contractError('jra_precompute_meeting_cache_unknown');
    if(row.status!=='complete')throw contractError('jra_precompute_meeting_cache_invalid');

    if(typeof row.next_refresh_at!=='string'||!row.next_refresh_at){
      throw contractError('jra_precompute_meeting_cache_invalid');
    }
    const nextRefreshAt=Date.parse(row.next_refresh_at);
    if(!Number.isFinite(nextRefreshAt))throw contractError('jra_precompute_meeting_cache_invalid');
    if(nextRefreshAt<=currentTime)throw contractError('jra_precompute_meeting_cache_stale');

    let meetings;
    try{
      meetings=JSON.parse(row.meetings_json);
    }catch(error){
      throw contractError('jra_precompute_meeting_cache_invalid',error);
    }
    if(!Array.isArray(meetings)||meetings.length===0){
      throw contractError('jra_precompute_meeting_cache_invalid');
    }

    return Object.freeze(meetings.map(meeting=>canonicalMeeting(meeting,date)));
  };
}
