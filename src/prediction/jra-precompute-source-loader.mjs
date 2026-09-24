import {JRA_TRACKS,validDate} from '../../jra-meeting-discovery.mjs';
import {discoverRaceCardUrl,fetchDirectCard,parseJraRaceCard} from '../../jra-race-fetch.mjs';
import {raceJobKey} from './background-precompute.mjs';

const TRACKS=new Set(JRA_TRACKS);

function assertActive(signal){
  if(signal.aborted)throw new DOMException('The operation was aborted','AbortError');
}

function checkedJob(job){
  if(!job||typeof job!=='object'||Array.isArray(job)||job.organization!=='JRA'||
     !validDate(job.date)||!TRACKS.has(job.track)||
     !Number.isInteger(job.raceNo)||job.raceNo<1||job.raceNo>12){
    throw new Error('invalid_jra_precompute_source_job');
  }
  let identity;
  try{identity=raceJobKey(job);}catch{throw new Error('invalid_jra_precompute_source_job');}
  if(job.raceId!==identity)throw new Error('jra_precompute_source_identity_mismatch');
  return identity;
}

function acquiredAt(now){
  const value=now();
  const time=value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;
  if(!Number.isFinite(time))throw new Error('invalid_jra_precompute_source_clock');
  return new Date(time).toISOString();
}

export function projectJraPrecomputeSource(parsed,{raceId,acquiredAt:time}){
  if(!parsed||!parsed.race||!Array.isArray(parsed.horses)||!parsed.quality||
     parsed.source!=='JRA_OFFICIAL'||!parsed.parserVersion||!parsed.dataConfidence){
    throw new Error('invalid_jra_precompute_source_card');
  }
  const horses=parsed.horses.map(({odds:_odds,popularity:_popularity,...horse})=>horse);
  return {organization:'JRA',raceId,race:parsed.race,horses,quality:parsed.quality,
    source:parsed.source,parserVersion:parsed.parserVersion,
    dataConfidence:parsed.dataConfidence,acquiredAt:time};
}

export function createJraPrecomputeSourceLoader({fetchImpl,now}={}){
  if(typeof fetchImpl!=='function')throw new Error('invalid_jra_precompute_source_fetch');
  if(typeof now!=='function')throw new Error('invalid_jra_precompute_source_clock');

  return async function loadSource(job,{signal}={}){
    const raceId=checkedJob(job);
    if(!signal||typeof signal.aborted!=='boolean')throw new Error('invalid_jra_precompute_source_signal');
    assertActive(signal);
    const context={date:job.date,track:job.track,race:job.raceNo};
    const {sourceUrl}=await discoverRaceCardUrl(fetchImpl,context,signal);
    assertActive(signal);
    const html=await fetchDirectCard(fetchImpl,sourceUrl,signal);
    assertActive(signal);
    const parsed=parseJraRaceCard(html,context);
    assertActive(signal);
    const source=projectJraPrecomputeSource(parsed,{raceId,acquiredAt:acquiredAt(now)});
    assertActive(signal);
    return source;
  };
}
