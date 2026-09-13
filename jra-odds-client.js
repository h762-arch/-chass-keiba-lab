(() => {
 'use strict';
 // CHASS-JRA-SAVED-ODDS-OVERLAY-FALLBACK-v1.9.9.2
 const formatOddsTime=value=>{
  if(!value)return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '';
  try{return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}catch{return d.toISOString()}
 };
 const oddsMeta=data=>{
  const raw=String(data?.oddsFreshness||'').toLowerCase(),snapshot=String(data?.oddsSnapshotType||'').toLowerCase();
  const freshness=snapshot==='final'||raw==='final'?'final':snapshot==='saved'||raw==='saved'?'saved':'current';
  const label=freshness==='final'?'最終オッズ':freshness==='saved'?'保存オッズ':'現在オッズ';
  const acquiredAt=data?.oddsAcquiredAt||data?.acquiredAt||'';
  return {freshness,label,acquiredAt,time:formatOddsTime(acquiredAt)};
 };
 const usableOverlayStatus=value=>['available','final','saved'].includes(String(value||'').toLowerCase());
 function savedOverlayPayload(payload,selection){
  const overlays=Array.isArray(payload?.viewerMarketOverlay)?payload.viewerMarketOverlay:[];
  const race=overlays.find(x=>Number(x?.raceNumber)===Number(selection?.race));
  if(!race||!Array.isArray(race.horses))return null;
  const rows=race.horses.filter(h=>{const odds=Number(h?.odds);return usableOverlayStatus(h?.oddsStatus)&&Number.isFinite(odds)&&odds>0});
  if(!rows.length)return null;
  const statuses=rows.map(h=>String(h?.oddsStatus||'').toLowerCase()),allFinal=statuses.every(x=>x==='final'),anySaved=statuses.some(x=>x==='saved');
  const oddsSnapshotType=allFinal?'final':anySaved?'saved':'live';
  const times=rows.map(h=>Date.parse(h?.oddsFetchedAt||'')).filter(Number.isFinite),acquiredAt=times.length?new Date(Math.max(...times)).toISOString():'';
  if(oddsSnapshotType==='saved'&&!acquiredAt)return null;
  const odds=rows.map(h=>({horseNo:Number(h.horseNumber??h.horseNo),odds:Number(h.odds),popularity:Number.isFinite(Number(h.popularity))?Number(h.popularity):null})).filter(h=>Number.isInteger(h.horseNo)&&h.horseNo>0);
  if(!odds.length)return null;
  const total=Math.max(race.horses.length,odds.length);
  return {ok:true,organization:'JRA',date:String(selection?.date||''),track:String(selection?.track||''),race:Number(selection?.race),odds,quality:{activeHorseCount:total,oddsHorseCount:odds.length,oddsCoverage:total?Number((odds.length/total).toFixed(4)):0,complete:odds.length===total},oddsSnapshotType,oddsFreshness:oddsSnapshotType==='saved'?'saved':oddsSnapshotType==='final'?'final':'current',acquiredAt,oddsAcquiredAt:acquiredAt,isSavedOdds:oddsSnapshotType==='saved',source:'CHASS_PUBLIC_VIEWER_MARKET_OVERLAY',marketDataSource:oddsSnapshotType==='saved'?'JRA_PERSISTED_SAVED_ODDS':oddsSnapshotType==='final'?'JRA_PERSISTED_FINAL_ODDS':'JRA_PERSISTED_AVAILABLE_ODDS'};
 }
 window.CHASS_JRA_ODDS_CLIENT={create({isActive,getSelection,getGeneration,apply}){
  const button=document.getElementById('liveOddsSync'),status=document.getElementById('liveOddsStatus');
  let active=false,token=0,controller,autoTimer;
  const idleLabel='JRA公式から利用可能なオッズを取得';
  const cancel=()=>{token++;clearTimeout(autoTimer);controller?.abort();controller=null;if(active&&button){button.disabled=false;button.textContent=idleLabel}};
  const showApplied=(data,generation)=>{
   if(!data?.odds?.length||!data?.quality?.oddsHorseCount)throw Error('JRA_ODDS_UNAVAILABLE');
   const applied=apply(data,generation);
   if(applied===false)throw Error('JRA_ODDS_RACE_IDENTITY_MISMATCH');
   const meta=oddsMeta(data),timePart=meta.time?`｜取得 ${meta.time}`:'',savedNote=meta.freshness==='saved'?'｜現在値ではありません':'';
   if(status)status.textContent=`JRA公式 単勝オッズ ${data.quality.oddsHorseCount}/${data.quality.activeHorseCount}頭反映｜${meta.label}${timePart}${savedNote}`;
   return true;
  };
  async function load(){
   cancel();if(!active||!isActive())return;
   const own=token,generation=getGeneration(),selection=getSelection();controller=new AbortController();
   if(button){button.disabled=true;button.textContent='オッズ取得中…'}if(status)status.textContent='JRA公式の利用可能な単勝オッズを確認中…';
   const timeout=setTimeout(()=>controller.abort(),10000);let primaryCode='JRA_OFFICIAL_UNAVAILABLE';
   try{
    const currentQ=new URLSearchParams({date:selection.date,track:selection.track,race:String(selection.race)});
    try{
     const response=await fetch('/api/jra/odds?'+currentQ,{cache:'no-store',signal:controller.signal}),data=await response.json();
     if(own!==token||!active||!isActive()||generation!==getGeneration())return;
     if(response.ok&&data?.ok&&data?.odds?.length&&data?.quality?.oddsHorseCount){showApplied(data,generation);return}
     primaryCode=data?.error||'JRA_ODDS_UNAVAILABLE';
    }catch(error){
     if(own!==token||!active||!isActive()||generation!==getGeneration())return;
     if(error?.name==='AbortError')throw error;
     primaryCode=error?.message||'JRA_OFFICIAL_UNAVAILABLE';
    }
    const savedQ=new URLSearchParams({date:selection.date,track:selection.track,organization:'JRA',format:'tabular',viewerMarket:'1'});
    const fallbackResponse=await fetch('/api/chass/v1/public/day-ai?'+savedQ,{cache:'no-store',signal:controller.signal}),fallbackJson=await fallbackResponse.json();
    if(own!==token||!active||!isActive()||generation!==getGeneration())return;
    if(fallbackResponse.ok&&fallbackJson?.ok){const fallback=savedOverlayPayload(fallbackJson,selection);if(fallback){showApplied(fallback,generation);return}}
    throw Error(primaryCode);
   }catch(error){
    if(own!==token||!active||!isActive())return;
    const code=error?.name==='AbortError'?'JRA_FETCH_TIMEOUT':error?.message||'JRA_OFFICIAL_UNAVAILABLE';
    if(status)status.textContent=code==='JRA_ODDS_FETCH_DISABLED'?'JRAオッズ取得は現在OFFです。WorkerのENABLE_JRA_ODDS_FETCHをtrueにしてください。保存オッズも確認できませんでした。':code==='JRA_ODDS_CACHE_MISS'?'JRAオッズ未取得｜現在値・取得時刻付き保存値のどちらも見つかりませんでした。':code==='JRA_ODDS_UNAVAILABLE'?'JRA単勝オッズはまだ公開されておらず、取得時刻付き保存値もありません。':code==='JRA_ODDS_RACE_IDENTITY_MISMATCH'?'選択中レースと取得オッズが一致しないため反映を中止しました。':`JRAオッズ取得エラー｜${code}`;
   }finally{clearTimeout(timeout);if(own===token){controller=null;if(button){button.disabled=false;button.textContent=idleLabel}}}
  }
  const sameSelection=(detail,current)=>String(detail?.date||'')===String(current?.date||'')&&String(detail?.track||'')===String(current?.track||'')&&Number(detail?.race)===Number(current?.race);
  const onRaceReady=event=>{if(!active||!isActive())return;const current=getSelection();if(!sameSelection(event?.detail,current))return;clearTimeout(autoTimer);if(status)status.textContent='JRA公式出馬表を取得しました。利用可能な単勝オッズを自動連動しています…';autoTimer=setTimeout(load,80)};
  if(typeof window.addEventListener==='function')window.addEventListener('chass:jra-race-ready',onRaceReady);
  return {load,cancel,setActive(value){active=value;if(!value)cancel();else{if(button){button.disabled=false;button.textContent=idleLabel}if(status)status.textContent='JRA出馬表取得後は現在オッズを優先し、未取得時は取得時刻付き保存オッズを利用します。'}}};
 }};
})();
