(() => {
  'use strict';

  const ERROR_LABELS={
    JRA_RACE_NOT_FOUND:'JRA公式のレース導線を解決できませんでした',
    JRA_HTTP_ERROR:'JRA公式への通信が正常完了しませんでした',
    JRA_OFFICIAL_UNAVAILABLE:'JRA公式へ接続できませんでした',
    JRA_FETCH_TIMEOUT:'JRA公式データ取得がタイムアウトしました',
    JRA_PARSER_STRUCTURE_CHANGED:'JRA公式ページ構造を安全に解析できませんでした',
    JRA_PARSER_INCOMPLETE:'JRA公式データが予想に必要な品質を満たしませんでした',
    JRA_RACE_MISMATCH:'選択レースと取得レースが一致しませんでした'
  };

  window.CHASS_JRA_RACE_CLIENT={
    create({isActive,getSelection,getGeneration,commit}){
      const button=document.getElementById('jraOfficialLoad');
      const status=document.getElementById('jraStatus');
      let active=false,token=0,timer,controller;

      const resetButton=()=>{
        if(button){
          button.disabled=false;
          button.textContent='JRA公式データを取得・予想開始';
        }
      };

      const cancel=()=>{
        token++;
        clearTimeout(timer);
        controller?.abort();
        resetButton();
      };

      async function load(){
        cancel();
        if(!active||!isActive())return;

        const own=token;
        const generation=getGeneration();
        const selection=getSelection();
        controller=new AbortController();

        button.disabled=true;
        button.textContent='JRA公式データを取得中…';
        status.textContent='JRA公式出馬表を確認しています…';

        // Server-side navigation may require JRA's official form flow before the exact card.
        // Give it a little more room than the previous single-page fetch while remaining bounded.
        const timeout=setTimeout(()=>controller.abort(),18000);

        try{
          const q=new URLSearchParams({
            date:selection.date,
            track:selection.track,
            race:String(selection.race)
          });
          const response=await fetch('/api/jra/race?'+q,{signal:controller.signal});
          const data=await response.json();

          if(own!==token||!active||!isActive()||generation!==getGeneration())return;
          if(!response.ok||!data.ok)throw Error(data.error||'JRA_OFFICIAL_UNAVAILABLE');

          if(
            data.dataConfidence!=='high'||
            !data.quality?.raceParsed||
            data.quality.horseCount<2||
            data.quality.horseNameRate!==1||
            data.quality.weightRate!==1||
            data.quality.jockeyRate!==1
          )throw Error('JRA_PARSER_INCOMPLETE');

          commit(data,generation);

          const nav=data.navigation?.pagesVisited
            ? `｜公式導線 ${data.navigation.pagesVisited}ページ確認`
            : '';
          status.textContent=`JRA公式 ${data.quality.activeHorseCount}/${data.quality.horseCount}頭｜予想計算完了${nav}`;
        }catch(error){
          if(own!==token||!active||!isActive())return;
          const code=error.name==='AbortError'?'JRA_FETCH_TIMEOUT':error.message;
          const label=ERROR_LABELS[code]||code;
          status.textContent=`${label}｜${code}｜JSON・CSV／手動入力を使用できます。`;
        }finally{
          clearTimeout(timeout);
          if(own===token)resetButton();
        }
      }

      button.addEventListener('click',load);
      document.getElementById('jraDataFile')?.addEventListener('change',cancel);
      document.getElementById('jraManualFallback')?.addEventListener('toggle',()=>{
        if(document.getElementById('jraManualFallback').open)cancel();
      });

      return {
        load,
        cancel,
        setActive(value){
          active=value;
          if(!value)cancel();
        },
        selectionChanged(){
          cancel();
          if(active&&window.CHASS_FEATURES?.ENABLE_JRA_AUTO_FETCH===true)timer=setTimeout(load,400);
        }
      };
    }
  };
})();
