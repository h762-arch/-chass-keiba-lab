(() => {
 'use strict';
 window.CHASS_JRA_ODDS_CLIENT={create({isActive,getSelection,getGeneration,apply}){
  const button=document.getElementById('liveOddsSync'),status=document.getElementById('liveOddsStatus');let active=false,token=0,controller;
  const cancel=()=>{token++;controller?.abort();controller=null;if(active){button.disabled=false;button.textContent='JRA公式から現在オッズを取得'}};
  async function load(){
   cancel();if(!active||!isActive())return;const own=token,generation=getGeneration(),selection=getSelection();controller=new AbortController();button.disabled=true;button.textContent='オッズ取得中…';status.textContent='JRA公式の単勝オッズを確認中…';const timeout=setTimeout(()=>controller.abort(),10000);
   try{const q=new URLSearchParams({date:selection.date,track:selection.track,race:String(selection.race)}),response=await fetch('/api/jra/odds?'+q,{cache:'no-store',signal:controller.signal}),data=await response.json();if(own!==token||!active||!isActive()||generation!==getGeneration())return;if(!response.ok||!data.ok)throw Error(data.error||'JRA_OFFICIAL_UNAVAILABLE');if(!data.odds?.length||!data.quality?.oddsHorseCount)throw Error('JRA_ODDS_UNAVAILABLE');apply(data,generation);status.textContent=`JRA公式 単勝オッズ ${data.quality.oddsHorseCount}/${data.quality.activeHorseCount}頭反映｜${data.oddsSnapshotType==='final'?'最終':'現在'}オッズ`;}
   catch(error){if(own!==token||!active||!isActive())return;const code=error.name==='AbortError'?'JRA_FETCH_TIMEOUT':error.message;status.textContent=code==='JRA_ODDS_FETCH_DISABLED'?'JRAオッズ取得は現在OFFです。WorkerのENABLE_JRA_ODDS_FETCHをtrueにしてください。':code==='JRA_ODDS_UNAVAILABLE'?'JRA単勝オッズはまだ公開されていません。':`JRAオッズ取得エラー｜${code}`;}
   finally{clearTimeout(timeout);if(own===token){controller=null;button.disabled=false;button.textContent='JRA公式から現在オッズを取得'}}
  }
  return {load,cancel,setActive(value){active=value;if(!value)cancel();else{button.disabled=false;button.textContent='JRA公式から現在オッズを取得';status.textContent='JRA出馬表取得後に、必要な時だけ手動で更新します。'}}};
 }};
})();
