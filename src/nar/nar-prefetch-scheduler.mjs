const TRACKS=[
  {track:'帯広',code:'3'},{track:'盛岡',code:'10'},{track:'水沢',code:'11'},
  {track:'浦和',code:'18'},{track:'船橋',code:'19'},{track:'大井',code:'20'},
  {track:'川崎',code:'21'},{track:'笠松',code:'22'},{track:'金沢',code:'23'},
  {track:'名古屋',code:'24'},{track:'園田',code:'27'},{track:'姫路',code:'28'},
  {track:'高知',code:'31'},{track:'佐賀',code:'32'},{track:'門別',code:'36'}
];

const NAR_SP_BASE='https://sp.keiba.go.jp';
const AUTO_PATH='/api/nar/history/prefetch-auto';
const TRACK_PATH='/api/nar/history/prefetch-auto-track';
const DAY_PATH='/api/nar/history/prefetch-day';
const MISSING_RACE_ERRORS=new Set([
  'horse_lineage_refs_not_found',
  'race_card_not_found',
  'race_not_found'
]);

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

function jstDateParts(date=new Date()){
  const ms=date.getTime()+9*60*60*1000;
  const d=new Date(ms);
  return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,day:d.getUTCDate()};
}

function addDaysYmd(ymd,days){
  const d=new Date(Date.UTC(ymd.y,ymd.m-1,ymd.day+days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

export function tomorrowJst(now=new Date()){
  return addDaysYmd(jstDateParts(now),1);
}

function parseDateOnly(value){
  return /^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:null;
}

function narDate(value){
  return String(value||'').replaceAll('-','/');
}

function originOf(env){
  const raw=String(env?.CHASS_PUBLIC_ORIGIN||'https://chass-keiba-lab7.h7625421.workers.dev').trim();
  return raw.replace(/\/+$/,'');
}

async function fetchJson(url,init={}){
  const response=await fetch(url,{...init,headers:{...(init.headers||{}),'cache-control':'no-store'}});
  let payload=null;
  try{payload=await response.json()}catch{}
  return {response,payload};
}

async function fetchText(url){
  const response=await fetch(url,{
    headers:{
      'cache-control':'no-store',
      'user-agent':'Mozilla/5.0 (compatible; CHASS-NAR-Prefetch/3.4)',
      'accept':'text/html,application/xhtml+xml',
      'accept-language':'ja'
    },
    redirect:'follow'
  });
  if(!response.ok){
    const error=new Error(`NAR race-list HTTP ${response.status}`);
    error.status=response.status;
    throw error;
  }
  return response.text();
}

export function extractRaceNosFromRaceListHtml(html=''){
  const found=new Set();
  const re=/k_raceNo=(\d{1,2})/gi;
  let m;
  while((m=re.exec(String(html)))){
    const race=Number(m[1]);
    if(Number.isInteger(race)&&race>=1&&race<=12)found.add(race);
  }
  return [...found].sort((a,b)=>a-b);
}

async function discoverMeetingRaceNos({date,code}){
  const u=new URL(NAR_SP_BASE+'/KeibaWebSP/TodayRaceInfo/S_RaceList');
  u.searchParams.set('k_babaCode',String(code));
  u.searchParams.set('k_raceDate',narDate(date));
  const html=await fetchText(u.toString());
  return {
    raceNos:extractRaceNosFromRaceListHtml(html),
    sourceUrl:u.toString()
  };
}

function summarizeTrack(track,code,payload,responseStatus){
  if(!payload||payload.ok===false){
    return {
      track,code,active:Boolean(payload?.active),
      ok:false,status:payload?.status||responseStatus||500,
      error:payload?.error||'prefetch_track_failed'
    };
  }
  return {
    track,code,active:Boolean(payload.active),ok:true,
    status:payload.status||'complete',
    discoveredRaceCount:payload.discoveredRaceCount??0,
    probedRaceCount:payload.probedRaceCount??0,
    requestedRaceCount:payload.requestedRaceCount??0,
    successfulRaceCount:payload.successfulRaceCount??0,
    skippedRaceCount:payload.skippedRaceCount??0,
    failedRaceCount:payload.failedRaceCount??0,
    horseCount:payload.horseCount??0,
    resolvedHorseCount:payload.resolvedHorseCount??0,
    unresolvedHorseCount:payload.unresolvedHorseCount??0,
    cacheHits:payload.cacheHits??0,
    cacheMisses:payload.cacheMisses??0,
    durationMs:payload.durationMs??null
  };
}

export function aggregateTracks(results=[]){
  const active=results.filter(r=>r.active);
  const successful=active.filter(r=>r.ok&&r.failedRaceCount===0);
  const failed=results.filter(r=>!r.ok||(r.active&&r.failedRaceCount>0));
  const totals=active.reduce((a,r)=>{
    a.discoveredRaceCount+=Number(r.discoveredRaceCount||0);
    a.probedRaceCount+=Number(r.probedRaceCount||0);
    a.requestedRaceCount+=Number(r.requestedRaceCount||0);
    a.successfulRaceCount+=Number(r.successfulRaceCount||0);
    a.skippedRaceCount+=Number(r.skippedRaceCount||0);
    a.failedRaceCount+=Number(r.failedRaceCount||0);
    a.horseCount+=Number(r.horseCount||0);
    a.resolvedHorseCount+=Number(r.resolvedHorseCount||0);
    a.unresolvedHorseCount+=Number(r.unresolvedHorseCount||0);
    a.cacheHits+=Number(r.cacheHits||0);
    a.cacheMisses+=Number(r.cacheMisses||0);
    return a;
  },{
    discoveredRaceCount:0,probedRaceCount:0,requestedRaceCount:0,successfulRaceCount:0,skippedRaceCount:0,
    failedRaceCount:0,horseCount:0,resolvedHorseCount:0,unresolvedHorseCount:0,
    cacheHits:0,cacheMisses:0
  });
  return {active,successful,failed,totals};
}

function missingRaceError(value){
  return MISSING_RACE_ERRORS.has(String(value||''));
}

export function classifyTailNoRace(input=[]){
  const races=(Array.isArray(input)?input:[]).map(r=>({...r})).sort((a,b)=>a.race-b.race);
  const lastSuccessful=races.reduce((max,r)=>r?.ok&&!r?.skipped?Math.max(max,Number(r.race)||0):max,0);

  for(let i=races.length-1;i>=0;i--){
    const r=races[i];
    const raceNo=Number(r?.race)||0;
    if(raceNo<=lastSuccessful)break;
    if(r?.ok&&!r?.skipped)break;
    if(!missingRaceError(r?.error))break;
    races[i]={
      ...r,
      ok:true,
      skipped:true,
      status:'no-race',
      originalStatus:r?.status??null,
      error:null
    };
  }
  return races;
}

async function runTrack(origin,{date,track,code,maxAgeHours=24}){
  const startedAt=Date.now();

  // v3.4: discover the actual meeting and exact race numbers from NAR RaceList.
  // Future-day HorseMark/RaceMark data can lag behind RaceList, so history/race
  // is not a reliable meeting detector on the previous evening.
  let discovery;
  try{
    discovery=await discoverMeetingRaceNos({date,code});
  }catch(error){
    return json({
      ok:false,active:false,track,code,date,status:502,
      error:'meeting_race_list_failed',
      detail:String(error),
      durationMs:Date.now()-startedAt
    },502);
  }

  const raceNos=discovery.raceNos;
  if(raceNos.length===0){
    return json({
      ok:true,active:false,track,code,date,status:'no-meeting',
      discoverySource:'nar-race-list',
      discoveryUrl:discovery.sourceUrl,
      discoveredRaceCount:0,probedRaceCount:0,requestedRaceCount:0,
      successfulRaceCount:0,skippedRaceCount:0,failedRaceCount:0,
      horseCount:0,resolvedHorseCount:0,unresolvedHorseCount:0,
      cacheHits:0,cacheMisses:0,durationMs:Date.now()-startedAt
    });
  }

  const calls=raceNos.map(race=>{
    const u=new URL(origin+DAY_PATH);
    u.searchParams.set('date',date);
    u.searchParams.set('track',track);
    u.searchParams.set('code',code);
    u.searchParams.set('chunk','1');
    u.searchParams.set('fromRace',String(race));
    u.searchParams.set('toRace',String(race));
    u.searchParams.set('horseConcurrency','4');
    u.searchParams.set('maxAgeHours',String(maxAgeHours));
    return fetchJson(u.toString())
      .then(({response,payload})=>({race,response,payload}))
      .catch(error=>({race,error}));
  });

  const settled=await Promise.all(calls);
  const rawRaces=settled.map(item=>{
    if(item.error)return {race:item.race,ok:false,status:502,error:String(item.error)};
    const payload=item.payload;
    const r=Array.isArray(payload?.races)?payload.races[0]:null;
    if(r)return r;
    return {race:item.race,ok:false,status:item.response?.status||502,error:payload?.error||'chunk_payload_invalid'};
  }).sort((a,b)=>a.race-b.race);

  // Defensive fallback only. RaceList already supplies the exact race numbers.
  const races=classifyTailNoRace(rawRaces);
  const successful=races.filter(r=>r.ok&&!r.skipped);
  const skipped=races.filter(r=>r.skipped);
  const failed=races.filter(r=>!r.ok);
  const scheduled=races.filter(r=>!r.skipped);

  const totals=successful.reduce((a,r)=>{
    a.horseCount+=Number(r.horseCount||0);
    a.resolvedHorseCount+=Number(r.resolvedHorseCount||0);
    a.unresolvedHorseCount+=Number(r.unresolvedHorseCount||0);
    a.cacheHits+=Number(r.cacheHits||0);
    a.cacheMisses+=Number(r.cacheMisses||0);
    return a;
  },{horseCount:0,resolvedHorseCount:0,unresolvedHorseCount:0,cacheHits:0,cacheMisses:0});

  return json({
    ok:failed.length===0,
    active:true,
    apiVersion:'nar-prefetch-scheduler-v3.4-track',
    track,code,date,
    status:failed.length===0?'complete':'partial',
    discoverySource:'nar-race-list',
    discoveryUrl:discovery.sourceUrl,
    discoveredRaceCount:raceNos.length,
    probedRaceCount:races.length,
    requestedRaceCount:scheduled.length,
    successfulRaceCount:successful.length,
    skippedRaceCount:skipped.length,
    failedRaceCount:failed.length,
    allResolved:failed.length===0&&totals.unresolvedHorseCount===0,
    ...totals,
    races,
    durationMs:Date.now()-startedAt,
    generatedAt:new Date().toISOString()
  },failed.length===scheduled.length&&scheduled.length>0?502:200);
}

async function runAll(origin,date,{maxAgeHours=24}={}){
  const startedAt=Date.now();
  const requests=TRACKS.map(({track,code})=>{
    const u=new URL(origin+AUTO_PATH);
    u.searchParams.set('mode','track');
    u.searchParams.set('date',date);
    u.searchParams.set('track',track);
    u.searchParams.set('code',code);
    u.searchParams.set('maxAgeHours',String(maxAgeHours));
    return fetchJson(u.toString())
      .then(({response,payload})=>summarizeTrack(track,code,payload,response.status))
      .catch(error=>({track,code,active:false,ok:false,status:502,error:String(error)}));
  });

  const tracks=await Promise.all(requests);
  const {active,successful,failed,totals}=aggregateTracks(tracks);

  return {
    ok:failed.length===0,
    apiVersion:'nar-prefetch-scheduler-v3.4',
    purpose:'prefetch-tomorrow-nar-recent10-at-18-jst',
    date,
    checkedTrackCount:TRACKS.length,
    activeTrackCount:active.length,
    successfulTrackCount:successful.length,
    failedTrackCount:failed.length,
    allResolved:failed.length===0&&totals.unresolvedHorseCount===0,
    ...totals,
    tracks,
    durationMs:Date.now()-startedAt,
    generatedAt:new Date().toISOString()
  };
}

export async function handleNarPrefetchSchedulerRequest(request,env){
  const u=new URL(request.url);
  const origin=originOf(env);

  if(u.pathname===TRACK_PATH){
    const date=parseDateOnly(u.searchParams.get('date'));
    const track=u.searchParams.get('track')||'';
    const code=u.searchParams.get('code')||'';
    const maxAgeHours=Math.max(0.1,Number(u.searchParams.get('maxAgeHours')||24));
    if(!date||!track||!code)return json({ok:false,error:'date, track and code are required',status:400},400);
    return runTrack(origin,{date,track,code,maxAgeHours});
  }

  if(u.pathname===AUTO_PATH){
    const mode=u.searchParams.get('mode')||'all';
    const maxAgeHours=Math.max(0.1,Number(u.searchParams.get('maxAgeHours')||24));

    if(mode==='track'){
      const date=parseDateOnly(u.searchParams.get('date'));
      const track=u.searchParams.get('track')||'';
      const code=u.searchParams.get('code')||'';
      if(!date||!track||!code)return json({ok:false,error:'date, track and code are required',status:400},400);
      return runTrack(origin,{date,track,code,maxAgeHours});
    }

    const date=parseDateOnly(u.searchParams.get('date'))||tomorrowJst();
    const result=await runAll(origin,date,{maxAgeHours});
    return json(result,result.ok?200:207);
  }

  return null;
}

export async function runNarTomorrowPrefetch(env){
  if(String(env?.ENABLE_NAR_PREFETCH||'true').toLowerCase()!=='true'){
    return {ok:true,skipped:true,reason:'ENABLE_NAR_PREFETCH_disabled'};
  }
  const date=tomorrowJst();
  return runAll(originOf(env),date,{maxAgeHours:24});
}
