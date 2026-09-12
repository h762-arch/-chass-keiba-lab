(() => {
  'use strict';
  window.CHASS_JRA_RACE_CLIENT={create({isActive,getSelection,getGeneration,commit}){
    const button=document.getElementById('jraOfficialLoad'),status=document.getElementById('jraStatus');let active=false,token=0,timer,controller;
    const cancel=()=>{token++;clearTimeout(timer);controller?.abort();button.disabled=false;button.textContent='JRA公式データを取得・予想開始';};
    async function load(){
      cancel();if(!active||!isActive())return;const own=token,generation=getGeneration(),selection=getSelection();controller=new AbortController();button.disabled=true;button.textContent='JRA公式データを取得中…';status.textContent='JRA公式出馬表を確認しています…';const timeout=setTimeout(()=>controller.abort(),12000);
      try{const q=new URLSearchParams({date:selection.date,track:selection.track,race:String(selection.race)}),response=await fetch('/api/jra/race?'+q,{signal:controller.signal});const data=await response.json();if(own!==token||!active||!isActive()||generation!==getGeneration())return;if(!response.ok||!data.ok)throw Error(data.error||'JRA_OFFICIAL_UNAVAILABLE');if(data.dataConfidence!=='high'||!data.quality?.raceParsed||data.quality.horseCount<2||data.quality.horseNameRate!==1||data.quality.weightRate!==1||data.quality.jockeyRate!==1)throw Error('JRA_PARSER_INCOMPLETE');commit(data,generation);status.textContent=`JRA公式 ${data.quality.activeHorseCount}/${data.quality.horseCount}頭｜予想計算完了`;}
      catch(error){if(own!==token||!active||!isActive())return;status.textContent=`JRA公式取得を完了できませんでした｜${error.name==='AbortError'?'JRA_FETCH_TIMEOUT':error.message}｜JSON・CSV／手動入力を使用できます。`;}
      finally{clearTimeout(timeout);if(own===token){button.disabled=false;button.textContent='JRA公式データを取得・予想開始';}}
    }
    button.addEventListener('click',load);document.getElementById('jraDataFile')?.addEventListener('change',cancel);document.getElementById('jraManualFallback')?.addEventListener('toggle',()=>{if(document.getElementById('jraManualFallback').open)cancel();});
    return {load,cancel,setActive(value){active=value;if(!value)cancel();},selectionChanged(){cancel();if(active&&window.CHASS_FEATURES?.ENABLE_JRA_AUTO_FETCH===true)timer=setTimeout(load,400);}};
  }};
})();
