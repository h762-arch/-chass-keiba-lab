import {
  JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,
  JRA_PRECOMPUTED_VIEWER_MAX_AGE_MS,
  JRA_PRECOMPUTED_VIEWER_MODEL_VERSION,
  precomputedViewerEnabled,
  projectJraPrecomputedViewerRace,
  readJraPrecomputedViewerRace
} from './jra-precomputed-viewer-reader.mjs';

const VIEWER_MODE='precomputed-early-data-only';
const JRA_TRACKS=new Set(['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉']);
const SUPPORTED_PATHS=new Set([
  '/api/chass/v1/public/races',
  '/api/chass/v1/public/day',
  '/api/chass/v1/public/race'
]);
const SAFE_COLUMNS='organization,race_id,revision,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,status,data_json';
const READABLE_STATUSES=new Set(['PARTIAL','CALCULATED']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);

function validDate(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!match)return false;
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
  return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3]);
}

function raceIdentity(raceId){
  const match=/^(\d{8})-JRA-(.+)-(\d{2})$/.exec(String(raceId||''));
  if(!match)return null;
  const raceNo=Number(match[3]);
  if(!Number.isInteger(raceNo)||raceNo<1||raceNo>12||!JRA_TRACKS.has(match[2]))return null;
  return {date:match[1],track:match[2],raceNo};
}

function rowRejectReason(row,{now,maxAgeMs}){
  if(row?.organization!=='JRA'||!raceIdentity(row?.race_id))return 'IDENTITY_MISMATCH';
  if(row.calculation_version!==JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION||row.model_version!==JRA_PRECOMPUTED_VIEWER_MODEL_VERSION)return 'VERSION_MISMATCH';
  if(!READABLE_STATUSES.has(row.status))return 'SNAPSHOT_NOT_READABLE';
  const validatedAt=Date.parse(row.source_validated_at||'');
  if(!Number.isFinite(validatedAt))return 'INVALID_FRESHNESS';
  const age=now-validatedAt;
  if(age<0||age>maxAgeMs)return 'STALE';
  return null;
}

function projectionReason(error){
  return {
    version_mismatch:'VERSION_MISMATCH',
    identity_mismatch:'IDENTITY_MISMATCH',
    data_identity_mismatch:'IDENTITY_MISMATCH',
    data_missing:'DATA_MISSING',
    malformed_data_json:'MALFORMED_DATA',
    invalid_snapshot_status:'SNAPSHOT_NOT_READABLE'
  }[error?.message]||'MALFORMED_DATA';
}

export async function readJraPrecomputedViewerRaces({
  env={},DB=env?.DB,date,track='',now=Date.now(),maxAgeMs=JRA_PRECOMPUTED_VIEWER_MAX_AGE_MS
}={}){
  if(!precomputedViewerEnabled(env))return Object.freeze({status:'DISABLED',reason:'VIEWER_FLAG_OFF',races:Object.freeze([])});
  if(!DB?.prepare)return Object.freeze({status:'REJECTED',reason:'D1_UNAVAILABLE',races:Object.freeze([])});
  if(!validDate(date))return Object.freeze({status:'REJECTED',reason:'INVALID_DATE',races:Object.freeze([])});
  if(track&&!JRA_TRACKS.has(track))return Object.freeze({status:'REJECTED',reason:'INVALID_TRACK',races:Object.freeze([])});
  if(!finite(now)||!finite(maxAgeMs)||maxAgeMs<0)return Object.freeze({status:'REJECTED',reason:'INVALID_READER_CLOCK',races:Object.freeze([])});

  const compactDate=date.replaceAll('-','');
  const prefix=`${compactDate}-JRA-`;
  const sql=`SELECT ${SAFE_COLUMNS}\n    FROM precomputed_race_snapshots\n    WHERE organization=? AND race_id>=? AND race_id<? AND calculation_version=? AND model_version=?\n    ORDER BY race_id ASC,revision DESC`;
  let rows;
  try{
    const result=await DB.prepare(sql).bind(
      'JRA',prefix,`${prefix}\uffff`,JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,JRA_PRECOMPUTED_VIEWER_MODEL_VERSION
    ).all();
    rows=Array.isArray(result?.results)?result.results:[];
  }catch{
    return Object.freeze({status:'REJECTED',reason:'D1_READ_FAILED',races:Object.freeze([])});
  }

  const latest=[];
  const seen=new Set();
  for(const row of rows){
    if(seen.has(row?.race_id))continue;
    seen.add(row?.race_id);
    const identity=raceIdentity(row?.race_id);
    if(!identity||identity.date!==compactDate)continue;
    if(track&&identity.track!==track)continue;
    const rejected=rowRejectReason(row,{now,maxAgeMs});
    if(rejected)return Object.freeze({status:'REJECTED',reason:rejected,races:Object.freeze([])});
    try{latest.push(projectJraPrecomputedViewerRace(row,{raceId:row.race_id}));}
    catch(error){return Object.freeze({status:'REJECTED',reason:projectionReason(error),races:Object.freeze([])});}
  }
  latest.sort((a,b)=>String(a.race.track||'').localeCompare(String(b.race.track||''),'ja')||Number(a.race.raceNo)-Number(b.race.raceNo));
  return Object.freeze({status:'READY',reason:null,races:Object.freeze(latest)});
}

function headers(){
  return {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'access-control-allow-origin':'*',
    'access-control-allow-methods':'GET, HEAD, OPTIONS',
    'access-control-allow-headers':'content-type',
    'X-CHASS-Viewer-Mode':VIEWER_MODE
  };
}

function response(payload,status=200,{head=false}={}){
  return new Response(head?null:JSON.stringify(payload),{status,headers:headers()});
}

function apiError(code,message,status,{head=false}={}){
  return response({ok:false,error:{code,message},viewerMode:VIEWER_MODE},status,{head});
}

function summary(item){
  const race=item.race;
  return {
    organization:'JRA',raceId:race.raceId,date:race.date,track:race.track,raceNo:race.raceNo,
    raceName:race.raceName,startTime:race.startTime,surface:race.surface,distance:race.distance,
    going:race.going,fieldSize:race.fieldSize,predictionAvailable:true,
    updatedAt:item.raceDataUpdatedAt||item.predictionGeneratedAt||null
  };
}

function dayPayload(items,{date,track}){
  return {
    ok:true,apiVersion:'1',mode:'read-only',viewerMode:VIEWER_MODE,marketEvaluation:'disabled',
    date,track,organization:'JRA',count:items.length,generatedAt:new Date().toISOString(),races:items
  };
}

function raceIdFor({date,track,raceNo}){
  return `${date.replaceAll('-','')}-JRA-${track}-${String(raceNo).padStart(2,'0')}`;
}

export async function handleJraPrecomputedViewerPublicApi(request,env,DB,{head=request?.method==='HEAD',now=Date.now()}={}){
  if(!precomputedViewerEnabled(env))return null;
  const url=new URL(request.url);
  if(!SUPPORTED_PATHS.has(url.pathname))return null;
  if(String(url.searchParams.get('organization')||'').trim().toUpperCase()!=='JRA')return null;

  const date=url.searchParams.get('date')||'';
  const track=url.searchParams.get('track')||'';
  if(!validDate(date))return apiError('INVALID_PARAMETER','date must be a valid YYYY-MM-DD value.',400,{head});
  if(track&&!JRA_TRACKS.has(track))return apiError('INVALID_PARAMETER','track must be a supported JRA track.',400,{head});

  if(url.pathname.endsWith('/race')){
    const raceNo=Number(url.searchParams.get('race'));
    if(!track||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)return apiError('INVALID_PARAMETER','track and race are required.',400,{head});
    const read=await readJraPrecomputedViewerRace({env,DB,raceId:raceIdFor({date,track,raceNo}),now});
    if(read.status==='READY')return response(read.race,200,{head});
    if(read.reason==='DATA_NOT_FOUND')return apiError('RACE_NOT_FOUND','Precomputed EARLY DATA was not found.',404,{head});
    return apiError('PRECOMPUTED_VIEWER_UNAVAILABLE',read.reason||'READ_REJECTED',503,{head});
  }

  if(url.pathname.endsWith('/day')&&!track)return apiError('INVALID_PARAMETER','track is required.',400,{head});
  const read=await readJraPrecomputedViewerRaces({env,DB,date,track,now});
  if(read.status!=='READY')return apiError('PRECOMPUTED_VIEWER_UNAVAILABLE',read.reason||'READ_REJECTED',503,{head});

  if(url.pathname.endsWith('/races')){
    const races=read.races.map(summary);
    return response({
      ok:true,apiVersion:'1',mode:'read-only',viewerMode:VIEWER_MODE,marketEvaluation:'disabled',
      date,track:track||null,organization:'JRA',count:races.length,generatedAt:new Date().toISOString(),races
    },200,{head});
  }

  if(!read.races.length)return apiError('RACE_NOT_FOUND','Precomputed EARLY DATA for the requested day was not found.',404,{head});
  return response(dayPayload(read.races,{date,track}),200,{head});
}

export {VIEWER_MODE as JRA_PRECOMPUTED_VIEWER_MODE};
