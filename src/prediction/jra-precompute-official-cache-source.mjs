import {JRA_TRACKS,validDate} from '../../jra-meeting-discovery.mjs';
import {JRA_RACE_PARSER_VERSION} from '../../jra-race-fetch.mjs';
import {raceJobKey} from './background-precompute.mjs';
import {projectJraPrecomputeSource} from './jra-precompute-source-loader.mjs';

const STATUSES=new Set(['active','scratched','excluded']);
const TRACKS=new Set(JRA_TRACKS);
const SELECT=`SELECT kind,cache_key,organization,race_date,track,race_no,payload_json,source_url,fetched_at,expires_at,parser_version,content_hash
 FROM jra_official_cache WHERE kind='race' AND cache_key=?`;

function failure(code,cause){const error=new Error(code,{cause});error.code=code;return error;}
function iso(value){const time=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(time)&&new Date(time).toISOString()===value?time:null;}
function checkedJob(job){
 if(!job||job.organization!=='JRA'||!validDate(job.date)||!TRACKS.has(job.track)||
    !Number.isInteger(job.raceNo)||job.raceNo<1||job.raceNo>12||
    job.raceId!==raceJobKey(job))throw failure('jra_precompute_cache_invalid_job');
 return `race|${job.date}|${job.track}|${job.raceNo}`;
}

// This reader never calls fetch or the public saved-base fallback. It only
// accepts the still-fresh, unmodified official payload written to D1.
export function createJraPrecomputeOfficialCacheSource({DB,now=()=>Date.now(),cryptoImpl=globalThis.crypto}={}){
 if(!DB||typeof DB.prepare!=='function')throw failure('jra_precompute_cache_invalid_db');
 if(typeof now!=='function')throw failure('jra_precompute_cache_invalid_clock');
 if(typeof cryptoImpl?.subtle?.digest!=='function')throw failure('jra_precompute_cache_invalid_crypto');
 return async function readFreshOfficialSource(job){
  const key=checkedJob(job);
  const current=now();
  if(typeof current!=='number'||!Number.isFinite(current))throw failure('jra_precompute_cache_invalid_clock');
  let row;
  try{
   const statement=DB.prepare(SELECT).bind(key);
   row=await statement.first();
  }catch(error){throw failure('jra_precompute_cache_read_failed',error);}
  if(!row)throw failure('jra_precompute_cache_missing');
  const fetched=iso(row.fetched_at),expires=iso(row.expires_at);
  if(fetched===null||expires===null||fetched>current||expires<=fetched)throw failure('jra_precompute_cache_invalid');
  if(expires<=current)throw failure('jra_precompute_cache_expired');
  if(row.kind!=='race'||row.cache_key!==key||row.organization!=='JRA'||
     row.race_date!==job.date||row.track!==job.track||Number(row.race_no)!==job.raceNo||
     row.parser_version!==JRA_RACE_PARSER_VERSION||typeof row.payload_json!=='string'||
     !/^[a-f0-9]{64}$/i.test(row.content_hash||''))throw failure('jra_precompute_cache_invalid');

  const digest=await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(row.payload_json));
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(hash!==row.content_hash.toLowerCase())throw failure('jra_precompute_cache_corrupt');
  let body;
  try{body=JSON.parse(row.payload_json);}catch(error){throw failure('jra_precompute_cache_corrupt',error);}
  let officialUrl=false;
  try{officialUrl=new URL(row.source_url).origin==='https://www.jra.go.jp';}catch{}
  if(body?.ok!==true||body.organization!=='JRA'||body.source!=='JRA_OFFICIAL'||
     body.dataConfidence!=='high'||!officialUrl||body.sourceUrl!==row.source_url||
     body.bridgeCache?.expired===true||
     body.parserVersion!==row.parser_version||body.fetchedAt!==row.fetched_at||
     body.race?.date!==job.date||body.race?.racecourse!==job.track||
     body.race?.raceNo!==job.raceNo||!body.quality?.raceParsed||
     !Array.isArray(body.horses)||body.horses.length<2||
     body.quality.horseCount!==body.horses.length||
     body.horses.some(h=>!STATUSES.has(h?.runningStatus))||
     body.quality.activeHorseCount!==body.horses.filter(h=>h.runningStatus==='active').length||
     body.horses.filter(h=>h.runningStatus==='active').length<2){
   throw failure('jra_precompute_cache_invalid');
  }
  const source=projectJraPrecomputeSource(body,{raceId:job.raceId,acquiredAt:row.fetched_at});
  return structuredClone(source);
 };
}
