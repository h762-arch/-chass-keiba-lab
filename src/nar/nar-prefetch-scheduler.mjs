const TRACKS=[
  {track:'帯広',code:'3'},{track:'盛岡',code:'10'},{track:'水沢',code:'11'},
  {track:'浦和',code:'18'},{track:'船橋',code:'19'},{track:'大井',code:'20'},
  {track:'川崎',code:'21'},{track:'笠松',code:'22'},{track:'金沢',code:'23'},
  {track:'名古屋',code:'24'},{track:'園田',code:'27'},{track:'姫路',code:'28'},
  {track:'高知',code:'31'},{track:'佐賀',code:'32'},{track:'門別',code:'36'}
];

const AUTO_PATH='/api/nar/history/prefetch-auto';
const TRACK_PATH='/api/nar/history/prefetch-auto-track';
const DAY_PATH='/api/nar/history/prefetch-day';

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
    requestedRaceCount:payload.requestedRaceCount??0,
    successfulRaceCount:payload.successfulRaceCount??0,
    failedRaceCount:payload.failedRaceCount??0,
    horseCount:payload.horseCount??0,
    resolvedHorseCount:payload.resolvedHorseCount??0,
    unresolvedHorseCount:payload.unresolvedHorseCount??0,
    cacheHits:payload.cacheHits??0,
    cacheMisses:payload.cacheMisses??0,
    durationMs:payload.durationMs??null
  };
}

function aggregateTracks(results=[]){
  const active=results.filter(r=>r.active);
  const successful=active.filter(r=>r.ok&&r.failedRaceCount===0);
  const failed=active.filter(r=>!r.ok||r.failedRaceCount>0);
  const totals=active.reduce((a,r)=>{
    a.requestedRaceCount+=Number(r.requestedRaceCount||0);
    a.successfulRaceCount+=Number(r.successfulRaceCount||0);
    a.failedRaceCount+=Number(r.failedRaceCount||0);
    a.horseCount+=Number(r.horseCount||0);
    a.resolvedHorseCount+=Number(r.resolvedHorseCount||0);
    a.unresolvedHorseCount+=Number(r.unresolvedHorseCount||0);
    a.cacheHits+=Number(r.cacheHits||0);
    a.cacheMisses+=Number(r.cacheMisses||0);
    return a;
  },{requestedRaceCount:0,successfulRaceCount:0,failedRaceCount:0,horseCount:0,resolvedHorseCount:0,unresolvedHorseCount:0,cacheHits:0,cacheMisses:0});
  return {active,successful,failed,totals};
}

async function runTrack(origin,{date,track,code,maxAgeHours=24}){
  const startedAt=Date.now();

  // Cheap active-meeting detection: try race 1 through the existing history endpoint.
  // If the venue is inactive, no 12-race fan-out is created.
  const probe=new URL(origin+'/api/nar/history/race');
  probe.searchParams.set('code',code);
  probe.searchParams.set('date',date);
  probe.searchParams.set('race','1');
  probe.searchParams.set('concurrency','1');
  probe.searchParams.set('maxAgeHours',String(maxAgeHours));

  let probeResult;
  try{probeResult=await fetchJson(probe.toString());}
  catch(error){
    return json({ok:false,active:false,track,code,date,status:502,error:'meeting_probe_failed',detail:String(error)},502);
  }

  const p=probeResult.payload;
  const active=Boolean(probeResult.response.ok&&p?.ok!==false&&Number(p?.horseCount||0)>0);
  if(!active){
    return json({
      ok:true,active:false,track,code,date,status:'no-meeting',
      requestedRaceCount:0,successfulRaceCount:0,failedRaceCount:0,
      horseCount:0,resolvedHorseCount:0,unresolvedHorseCount:0,
      cacheHits:0,cacheMisses:0,durationMs:Date.now()-startedAt
    });
  }

  // One race per child Worker invocation. This is intentionally conservative:
  // it fully resets Cloudflare's per-invocation subrequest budget for every race.
  const calls=[];
  for(let race=1;race<=12;race++){
    const u=new URL(origin+DAY_PATH);
    u.searchParams.set('date',date);
    u.searchParams.set('track',track);
    u.searchParams.set('code',code);
    u.searchParams.set('chunk','1');
    u.searchParams.set('fromRace',String(race));
    u.searchParams.set('toRace',String(race));
    u.searchParams.set('horseConcurrency','4');
    u.searchParams.set('maxAgeHours',String(maxAgeHours));
    calls.push(fetchJson(u.toString()).then(({response,payload})=>({race,response,payload})).catch(error=>({race,error})));
  }

  const settled=await Promise.all(calls);
  const races=settled.map(item=>{
    if(item.error)return {race:item.race,ok:false,status:502,error:String(item.error)};
    const payload=item.payload;
    const r=Array.isArray(payload?.races)?payload.races[0]:null;
    if(r)return r;
    return {race:item.race,ok:false,status:item.response?.status||502,error:payload?.error||'chunk_payload_invalid'};
  }).sort((a,b)=>a.race-b.race);

  const successful=races.filter(r=>r.ok);
  const failed=races.filter(r=>!r.ok);
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
    apiVersion:'nar-prefetch-scheduler-v3-track',
    track,code,date,
    status:failed.length===0?'complete':'partial',
    requestedRaceCount:12,
    successfulRaceCount:successful.length,
    failedRaceCount:failed.length,
    allResolved:failed.length===0&&totals.unresolvedHorseCount===0,
    ...totals,
    races,
    durationMs:Date.now()-startedAt,
    generatedAt:new Date().toISOString()
  },failed.length===12?502:200);
}

async function runAll(origin,date,{maxAgeHours=24}={}){
  const startedAt=Date.now();
  const requests=TRACKS.map(({track,code})=>{
    const u=new URL(origin+TRACK_PATH);
    u.searchParams.set('date',date);
    u.searchParams.set('track',track);
    u.searchParams.set('code',code);
    u.searchParams.set('maxAgeHours',String(maxAgeHours));
    return fetchJson(u.toString())
      .then(({response,payload})=>summarizeTrack(track,code,payload,response.status))
      .catch(error=>({track,code,active:false,ok:false,status:502,error:String(error)}));
  });

  // Parent invocation makes only 15 child requests. Each child track invocation
  // owns its own subrequest budget and fans out to 12 one-race invocations.
  const tracks=await Promise.all(requests);
  const {active,successful,failed,totals}=aggregateTracks(tracks);

  return {
    ok:failed.length===0,
    apiVersion:'nar-prefetch-scheduler-v3',
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
    const date=parseDateOnly(u.searchParams.get('date'))||tomorrowJst();
    const maxAgeHours=Math.max(0.1,Number(u.searchParams.get('maxAgeHours')||24));
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
