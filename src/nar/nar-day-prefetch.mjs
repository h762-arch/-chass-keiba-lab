import {handleNarRecentHistoryRequest} from './nar-recent-history.mjs';

const NAR_TRACK_CODES={
  '帯広':'3','盛岡':'10','水沢':'11','浦和':'18','船橋':'19','大井':'20',
  '川崎':'21','笠松':'22','金沢':'23','名古屋':'24','園田':'27','姫路':'28',
  '高知':'31','佐賀':'32','門別':'36'
};

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

function html(body,status=200){
  return new Response(body,{
    status,
    headers:{
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

function clampInt(value,min,max,fallback){
  const n=Number(value);
  if(!Number.isFinite(n))return fallback;
  return Math.max(min,Math.min(max,Math.trunc(n)));
}

function raceSummary(payload,responseStatus,race){
  if(!payload||payload.ok===false){
    return {
      race,
      ok:false,
      status:payload?.status||responseStatus||500,
      error:payload?.error||'history_prefetch_failed'
    };
  }
  return {
    race,
    ok:true,
    status:payload.status,
    horseCount:payload.horseCount??0,
    resolvedHorseCount:payload.resolvedHorseCount??0,
    unresolvedHorseCount:payload.unresolvedHorseCount??0,
    cacheHits:payload.cacheHits??0,
    cacheMisses:payload.cacheMisses??0,
    generatedAt:payload.generatedAt??null
  };
}

function aggregateRaces(races=[]){
  const successful=races.filter(r=>r.ok);
  const failed=races.filter(r=>!r.ok);
  const totals=successful.reduce((acc,r)=>{
    acc.horseCount+=Number(r.horseCount||0);
    acc.resolvedHorseCount+=Number(r.resolvedHorseCount||0);
    acc.unresolvedHorseCount+=Number(r.unresolvedHorseCount||0);
    acc.cacheHits+=Number(r.cacheHits||0);
    acc.cacheMisses+=Number(r.cacheMisses||0);
    return acc;
  },{horseCount:0,resolvedHorseCount:0,unresolvedHorseCount:0,cacheHits:0,cacheMisses:0});
  return {successful,failed,totals};
}

function buildChunkUrl(request,{date,track,code,fromRace,toRace,horseConcurrency,maxAgeHours,refresh}){
  const u=new URL(request.url);
  u.search='';
  u.searchParams.set('date',date);
  if(track)u.searchParams.set('track',track);
  u.searchParams.set('code',String(code));
  u.searchParams.set('chunk','1');
  u.searchParams.set('fromRace',String(fromRace));
  u.searchParams.set('toRace',String(toRace));
  u.searchParams.set('horseConcurrency',String(horseConcurrency));
  u.searchParams.set('maxAgeHours',String(maxAgeHours));
  if(refresh)u.searchParams.set('refresh','1');
  return u.toString();
}

function buildRunnerUrl(request,{date,track,code,chunkSize,horseConcurrency,maxAgeHours,refresh}){
  const u=new URL(request.url);
  u.search='';
  u.searchParams.set('date',date);
  if(track)u.searchParams.set('track',track);
  u.searchParams.set('code',String(code));
  u.searchParams.set('run','1');
  u.searchParams.set('chunkSize',String(chunkSize));
  u.searchParams.set('horseConcurrency',String(horseConcurrency));
  u.searchParams.set('maxAgeHours',String(maxAgeHours));
  if(refresh)u.searchParams.set('refresh','1');
  return u.toString();
}

function buildRunnerHtml(request,params){
  const {
    date,track,code,chunkSize,horseConcurrency,maxAgeHours,refresh
  }=params;
  const chunks=[];
  for(let fromRace=1;fromRace<=12;fromRace+=chunkSize){
    chunks.push({
      fromRace,
      toRace:Math.min(12,fromRace+chunkSize-1),
      url:buildChunkUrl(request,{
        date,track,code,
        fromRace,
        toRace:Math.min(12,fromRace+chunkSize-1),
        horseConcurrency,maxAgeHours,refresh
      })
    });
  }

  const config=JSON.stringify({
    apiVersion:'nar-day-prefetch-v2',
    date,track:track||null,code:String(code),
    chunkSize,horseConcurrency,maxAgeHours,refresh,chunks
  }).replace(/</g,'\\u003c');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CHASS NAR Day Prefetch v2</title>
<style>
body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0b0f14;color:#e6edf3;margin:0;padding:18px}
h1{font-size:18px;margin:0 0 12px}
#status{margin:0 0 12px;color:#9da7b3}
pre{white-space:pre-wrap;word-break:break-word;background:#111820;border:1px solid #27313d;border-radius:10px;padding:14px;font-size:12px;line-height:1.45}
.ok{color:#3fb950}.ng{color:#f85149}
</style>
</head>
<body>
<h1>CHASS NAR Day Prefetch v2</h1>
<div id="status">開始しています…</div>
<pre id="output"></pre>
<script>
const cfg=${config};
const statusEl=document.getElementById('status');
const outputEl=document.getElementById('output');

function aggregate(races){
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
  return {successful,failed,totals};
}

(async()=>{
  const startedAt=Date.now();
  const races=[];
  for(let i=0;i<cfg.chunks.length;i++){
    const chunk=cfg.chunks[i];
    statusEl.textContent='取得中: '+chunk.fromRace+'R〜'+chunk.toRace+'R ('+(i+1)+'/'+cfg.chunks.length+')';
    try{
      const response=await fetch(chunk.url,{cache:'no-store'});
      const payload=await response.json();
      if(Array.isArray(payload.races))races.push(...payload.races);
      else races.push({race:chunk.fromRace,ok:false,status:response.status,error:'chunk_payload_invalid'});
    }catch(error){
      for(let race=chunk.fromRace;race<=chunk.toRace;race++){
        races.push({race,ok:false,status:500,error:String(error)});
      }
    }
    outputEl.textContent=JSON.stringify({progress:races},null,2);
  }

  races.sort((a,b)=>a.race-b.race);
  const {successful,failed,totals}=aggregate(races);
  const result={
    ok:failed.length===0,
    apiVersion:'nar-day-prefetch-v2',
    executionMode:'browser-separated-worker-invocations',
    date:cfg.date,
    track:cfg.track,
    code:cfg.code,
    requestedRaceCount:12,
    successfulRaceCount:successful.length,
    failedRaceCount:failed.length,
    allResolved:failed.length===0&&totals.unresolvedHorseCount===0,
    ...totals,
    chunkSize:cfg.chunkSize,
    horseConcurrency:cfg.horseConcurrency,
    refresh:cfg.refresh,
    durationMs:Date.now()-startedAt,
    races,
    generatedAt:new Date().toISOString()
  };
  statusEl.className=result.ok&&result.allResolved?'ok':'ng';
  statusEl.textContent=result.ok&&result.allResolved?'完了: 12Rすべて保存成功':'完了: 一部失敗あり';
  outputEl.textContent=JSON.stringify(result,null,2);
})();
</script>
</body>
</html>`;
}

async function processChunk(request,env,{
  raceCardParser,date,track,code,fromRace,toRace,horseConcurrency,maxAgeHours,refresh
}){
  const startedAt=Date.now();
  const races=[];

  // IMPORTANT: v2 deliberately runs races sequentially inside a chunk.
  // Each browser chunk request is a separate Worker invocation, resetting
  // Cloudflare's per-invocation subrequest counter.
  for(let race=fromRace;race<=toRace;race++){
    const raceUrl=new URL(request.url);
    raceUrl.pathname='/api/nar/history/race';
    raceUrl.search='';
    raceUrl.searchParams.set('code',String(code));
    raceUrl.searchParams.set('date',date);
    raceUrl.searchParams.set('race',String(race));
    raceUrl.searchParams.set('concurrency',String(horseConcurrency));
    raceUrl.searchParams.set('maxAgeHours',String(maxAgeHours));
    if(refresh)raceUrl.searchParams.set('refresh','1');

    try{
      const response=await handleNarRecentHistoryRequest(
        new Request(raceUrl.toString(),request),
        env,
        {raceCardParser}
      );
      let payload=null;
      try{payload=await response.json()}catch{
        races.push({race,ok:false,status:502,error:'history_payload_invalid_json'});
        continue;
      }
      races.push(raceSummary(payload,response.status,race));
    }catch(error){
      races.push({
        race,
        ok:false,
        status:error?.status||500,
        error:error?.message||String(error)
      });
    }
  }

  const {successful,failed,totals}=aggregateRaces(races);
  return json({
    ok:failed.length===0,
    apiVersion:'nar-day-prefetch-v2-chunk',
    executionMode:'single-worker-safe-chunk',
    date,
    track:track||null,
    code:String(code),
    fromRace,
    toRace,
    requestedRaceCount:toRace-fromRace+1,
    successfulRaceCount:successful.length,
    failedRaceCount:failed.length,
    allResolved:failed.length===0&&totals.unresolvedHorseCount===0,
    ...totals,
    horseConcurrency,
    refresh,
    durationMs:Date.now()-startedAt,
    races,
    generatedAt:new Date().toISOString()
  },failed.length===races.length?502:200);
}

export async function handleNarDayPrefetchRequest(request,env,{raceCardParser=null}={}){
  const u=new URL(request.url);
  if(u.pathname!=='/api/nar/history/prefetch-day')return null;

  const date=u.searchParams.get('date');
  const track=u.searchParams.get('track')||'';
  const code=u.searchParams.get('code')||NAR_TRACK_CODES[track]||null;
  const horseConcurrency=clampInt(u.searchParams.get('horseConcurrency'),1,6,4);
  const maxAgeRaw=Number(u.searchParams.get('maxAgeHours')||24);
  const maxAgeHours=Number.isFinite(maxAgeRaw)?Math.max(0.1,maxAgeRaw):24;
  const refresh=u.searchParams.get('refresh')==='1';
  const chunkSize=clampInt(u.searchParams.get('chunkSize'),1,2,2);

  if(!date||!code){
    return json({
      ok:false,
      error:'date and resolvable NAR track code are required',
      status:400,
      received:{date,track,code}
    },400);
  }

  if(u.searchParams.get('run')==='1'){
    return html(buildRunnerHtml(request,{
      date,track,code,chunkSize,horseConcurrency,maxAgeHours,refresh
    }));
  }

  if(u.searchParams.get('chunk')==='1'){
    const fromRace=clampInt(u.searchParams.get('fromRace'),1,12,1);
    const requestedTo=clampInt(u.searchParams.get('toRace'),fromRace,12,fromRace+chunkSize-1);
    // Hard safety limit: at most 2 races per Worker invocation.
    const toRace=Math.min(requestedTo,fromRace+1);
    return processChunk(request,env,{
      raceCardParser,date,track,code,fromRace,toRace,
      horseConcurrency,maxAgeHours,refresh
    });
  }

  const chunks=[];
  for(let fromRace=1;fromRace<=12;fromRace+=chunkSize){
    const toRace=Math.min(12,fromRace+chunkSize-1);
    chunks.push({
      fromRace,
      toRace,
      url:buildChunkUrl(request,{
        date,track,code,fromRace,toRace,
        horseConcurrency,maxAgeHours,refresh
      })
    });
  }

  return json({
    ok:true,
    apiVersion:'nar-day-prefetch-v2',
    purpose:'warm-recent10-cache-for-chat-analysis',
    executionMode:'chunk-plan',
    reason:'avoid Cloudflare per-Worker subrequest limit',
    date,
    track:track||null,
    code:String(code),
    requestedRaceCount:12,
    chunkSize,
    chunkCount:chunks.length,
    horseConcurrency,
    refresh,
    runnerUrl:buildRunnerUrl(request,{
      date,track,code,chunkSize,horseConcurrency,maxAgeHours,refresh
    }),
    chunks,
    note:'Open runnerUrl once in a browser to execute all chunks as separate Worker invocations.'
  });
}
