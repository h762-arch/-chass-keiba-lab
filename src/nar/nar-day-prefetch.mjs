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

async function mapLimit(items,limit,mapper){
  const results=new Array(items.length);
  let nextIndex=0;
  async function worker(){
    while(true){
      const index=nextIndex++;
      if(index>=items.length)return;
      results[index]=await mapper(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return results;
}

export async function handleNarDayPrefetchRequest(request,env,{raceCardParser=null}={}){
  const u=new URL(request.url);
  if(u.pathname!=='/api/nar/history/prefetch-day')return null;

  const date=u.searchParams.get('date');
  const track=u.searchParams.get('track')||'';
  const code=u.searchParams.get('code')||NAR_TRACK_CODES[track]||null;
  const fromRace=Math.max(1,Math.min(12,Number(u.searchParams.get('fromRace')||1)));
  const toRace=Math.max(fromRace,Math.min(12,Number(u.searchParams.get('toRace')||12)));
  const raceConcurrency=Math.max(1,Math.min(3,Number(u.searchParams.get('raceConcurrency')||2)));
  const horseConcurrency=Math.max(1,Math.min(6,Number(u.searchParams.get('horseConcurrency')||4)));
  const maxAgeHours=Math.max(0.1,Number(u.searchParams.get('maxAgeHours')||24));
  const refresh=u.searchParams.get('refresh')==='1';

  if(!date||!code){
    return json({
      ok:false,
      error:'date and resolvable NAR track code are required',
      status:400,
      received:{date,track,code}
    },400);
  }

  const raceNumbers=Array.from({length:toRace-fromRace+1},(_,i)=>fromRace+i);
  const startedAt=Date.now();

  const races=await mapLimit(raceNumbers,raceConcurrency,async race=>{
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
      const payload=await response.json();
      if(!response.ok||payload?.ok===false){
        return {
          race,
          ok:false,
          status:payload?.status||response.status||500,
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
    }catch(error){
      return {
        race,
        ok:false,
        status:error?.status||500,
        error:error?.message||String(error)
      };
    }
  });

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

  return json({
    ok:failed.length===0,
    apiVersion:'nar-day-prefetch-v1',
    purpose:'warm-recent10-cache-for-chat-analysis',
    date,
    track:track||null,
    code:String(code),
    fromRace,
    toRace,
    requestedRaceCount:raceNumbers.length,
    successfulRaceCount:successful.length,
    failedRaceCount:failed.length,
    allResolved:failed.length===0&&totals.unresolvedHorseCount===0,
    ...totals,
    raceConcurrency,
    horseConcurrency,
    refresh,
    durationMs:Date.now()-startedAt,
    races,
    generatedAt:new Date().toISOString()
  },failed.length===raceNumbers.length?502:200);
}
