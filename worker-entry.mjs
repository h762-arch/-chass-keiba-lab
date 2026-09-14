import baseWorker,{parseRaceCard} from './worker.js';
import {handleNarRecentHistoryRequest} from './src/nar/nar-recent-history.mjs';
import {handleNarDayPrefetchRequest} from './src/nar/nar-day-prefetch.mjs';
import {handleNarPrefetchSchedulerRequest,runNarTomorrowPrefetch} from './src/nar/nar-prefetch-scheduler.mjs';

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

function compactRun(run={}){
  return {
    date:run.date??null,track:run.track??null,raceName:run.raceName??null,
    className:run.className??null,surface:run.surface??null,distance:run.distance??null,
    going:run.going??null,fieldSize:run.fieldSize??null,popularity:run.popularity??null,
    finish:run.finish??null,finishText:run.finishText??null,time:run.time??null,
    timeSec:run.timeSec??null,margin:run.margin??null,last3f:run.last3f??null,
    bodyWeight:run.bodyWeight??null,jockey:run.jockey??null,weightCarried:run.weightCarried??null
  };
}

function compactHistoryHorse(horse={},runsLimit=10){
  return {
    lineageCode:horse.lineageCode??null,runCount:horse.runCount??0,summary:horse.summary??{},
    runs:Array.isArray(horse.runs)?horse.runs.slice(0,runsLimit).map(compactRun):[],
    fetchedAt:horse.fetchedAt??null,cacheHit:Boolean(horse.cacheHit),fingerprint:horse.fingerprint??null
  };
}

async function buildNarRaceContext(request,env,ctx){
  const u=new URL(request.url);
  const date=u.searchParams.get('date');
  const track=u.searchParams.get('track');
  const race=u.searchParams.get('race');
  const organization=(u.searchParams.get('organization')||'NAR').toUpperCase();
  const code=u.searchParams.get('code')||NAR_TRACK_CODES[track]||null;
  const runsLimit=Math.min(10,Math.max(1,Number(u.searchParams.get('runs')||10)));

  if(organization!=='NAR')return json({ok:false,error:'race_context_currently_supports_NAR_only',status:400},400);
  if(!date||!track||!race||!code){
    return json({ok:false,error:'date,track,race and resolvable NAR track code are required',status:400,received:{date,track,race,code}},400);
  }

  const abilityUrl=new URL(request.url);
  abilityUrl.pathname='/api/chass/v1/public/race';
  abilityUrl.searchParams.set('date',date);
  abilityUrl.searchParams.set('track',track);
  abilityUrl.searchParams.set('race',race);
  abilityUrl.searchParams.set('organization','NAR');
  abilityUrl.searchParams.set('format','compact');
  abilityUrl.searchParams.delete('code');
  abilityUrl.searchParams.delete('runs');

  const historyUrl=new URL(request.url);
  historyUrl.pathname='/api/nar/history/race';
  historyUrl.search='';
  historyUrl.searchParams.set('code',code);
  historyUrl.searchParams.set('date',date);
  historyUrl.searchParams.set('race',race);
  if(u.searchParams.get('refresh')==='1')historyUrl.searchParams.set('refresh','1');
  if(u.searchParams.get('maxAgeHours'))historyUrl.searchParams.set('maxAgeHours',u.searchParams.get('maxAgeHours'));
  if(u.searchParams.get('concurrency'))historyUrl.searchParams.set('concurrency',u.searchParams.get('concurrency'));

  const [abilityResponse,historyResponse]=await Promise.all([
    baseWorker.fetch(new Request(abilityUrl.toString(),request),env,ctx),
    handleNarRecentHistoryRequest(new Request(historyUrl.toString(),request),env,{raceCardParser:parseRaceCard})
  ]);

  let abilityPayload=null,historyPayload=null;
  try{abilityPayload=await abilityResponse.json()}catch{return json({ok:false,error:'ability_payload_invalid_json',status:502},502);}
  try{historyPayload=await historyResponse.json()}catch{return json({ok:false,error:'history_payload_invalid_json',status:502},502);}

  if(!abilityResponse.ok||abilityPayload?.ok===false){
    return json({ok:false,error:'ability_api_failed',status:abilityResponse.status||502,ability:abilityPayload},abilityResponse.status||502);
  }
  if(!historyResponse.ok||historyPayload?.ok===false){
    return json({ok:false,error:'history_api_failed',status:historyResponse.status||502,
      abilityMeta:{apiVersion:abilityPayload?.apiVersion??null,probabilityValid:abilityPayload?.validation?.probabilityValid??null},
      history:historyPayload},historyResponse.status||502);
  }

  const abilityHorses=Array.isArray(abilityPayload?.horses)?abilityPayload.horses:[];
  const historyHorses=Array.isArray(historyPayload?.horses)?historyPayload.horses:[];
  const abilityByNo=new Map(abilityHorses.map(h=>[Number(h.horseNumber),h]));
  const historyByNo=new Map(historyHorses.map(h=>[Number(h.horseNo),h]));
  const horseNos=[...new Set([...abilityByNo.keys(),...historyByNo.keys()])].filter(Number.isFinite).sort((a,b)=>a-b);

  const horses=horseNos.map(horseNo=>{
    const a=abilityByNo.get(horseNo)||{};
    const h=historyByNo.get(horseNo)||{};
    return {
      horseNumber:horseNo,horseName:a.horseName||h.horseName||null,
      ability:{
        abilityRank:a.abilityRank??null,score:a.score??null,winProb:a.winProb??null,top3Prob:a.top3Prob??null,
        predictedTime:a.predictedTime??null,predictedTimeSec:a.predictedTimeSec??null,mark:a.mark??null,
        runningStyle:a.runningStyle??null,distanceScore:a.distanceScore??null,courseScore:a.courseScore??null,
        paceScore:a.paceScore??null,conditionScore:a.conditionScore??null,runnerStatus:a.runnerStatus??null
      },
      history:compactHistoryHorse(h,runsLimit)
    };
  });

  const unresolved=Array.isArray(historyPayload?.unresolved)?historyPayload.unresolved:[];
  return json({
    ok:true,apiVersion:'chass-race-context-v1',purpose:'chat-fast-analysis',organization:'NAR',
    date,track,code:String(code),race:Number(race),raceName:abilityPayload?.raceName??null,
    targetDistance:historyPayload?.targetDistance??null,status:historyPayload?.status||'unknown',
    horseCount:horses.length,resolvedHorseCount:historyPayload?.resolvedHorseCount??historyHorses.length,
    unresolvedHorseCount:historyPayload?.unresolvedHorseCount??unresolved.length,
    cacheHits:historyPayload?.cacheHits??null,cacheMisses:historyPayload?.cacheMisses??null,
    concurrency:historyPayload?.concurrency??null,probabilityValid:abilityPayload?.validation?.probabilityValid??null,
    predictionGeneratedAt:abilityPayload?.predictionGeneratedAt??null,raceDataUpdatedAt:abilityPayload?.raceDataUpdatedAt??null,
    horses,unresolved,generatedAt:new Date().toISOString()
  });
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==='/api/chass/v1/public/race-context')return buildNarRaceContext(request,env,ctx);

    if(u.pathname==='/api/nar/history/prefetch-auto'||u.pathname==='/api/nar/history/prefetch-auto-track'){
      const response=await handleNarPrefetchSchedulerRequest(request,env);
      if(response)return response;
    }

    if(u.pathname==='/api/nar/history/prefetch-day'){
      const response=await handleNarDayPrefetchRequest(request,env,{raceCardParser:parseRaceCard});
      if(response)return response;
    }
    if(u.pathname==='/api/nar/history/horse'||u.pathname==='/api/nar/history/race'){
      const response=await handleNarRecentHistoryRequest(request,env,{raceCardParser:parseRaceCard});
      if(response)return response;
    }
    return baseWorker.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){
    if(controller?.cron==='0 9 * * *'||controller?.cron==='30 9 * * *'){
      return ctx.waitUntil(runNarTomorrowPrefetch(env));
    }
    if(typeof baseWorker.scheduled==='function')return baseWorker.scheduled(controller,env,ctx);
  }
};
