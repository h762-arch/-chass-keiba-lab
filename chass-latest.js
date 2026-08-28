/* CHASS KEIBA LAB Ver.8.7 - State Sync / Auto Validation */
(() => {
  'use strict';
  const VERSION='8.7';
  const $=id=>document.getElementById(id);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};

  function setVersion(){
    document.title=document.title.replace(/Ver\.\d+(?:\.\d+)?/g,`Ver.${VERSION}`);
    document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{
      if(/Ver\./.test(el.textContent||'')) el.textContent=`Ver.${VERSION}`;
    });
  }
  function raceKey(d){
    return [String(d?.raceDate||$('raceDate')?.value||'').trim(),
            String(d?.track||$('track')?.value||'').trim(),
            String(d?.raceNo||$('raceNo')?.value||'').trim()].join('|');
  }
  function getFormSafe(){try{return typeof window.getForm==='function'?window.getForm():null}catch{return null}}
  function horseNo(h){return String(h?.['horse-no']??h?.horseNo??h?.no??'').trim()}
  function rows(){return qsa('.horse-row')}
  function marketCount(){return rows().filter(r=>{const o=num(r.querySelector('.odds')?.value);return o&&o>0}).length}
  function resultValues(){return [1,2,3].map(i=>String($(`result${i}`)?.value||'').trim()).filter(Boolean)}
  function hasResults(){return resultValues().length>=3}

  function setRealOddsMeta(){
    try{if(typeof window.setAutoOddsMeta==='function')window.setAutoOddsMeta('実オッズ',$('oddsCheckedAt')?.value||'NAR公式')}catch{}
    if($('oddsType')) $('oddsType').value='実オッズ';
    if($('oddsTypeDisplay')) $('oddsTypeDisplay').textContent='実オッズ';
  }

  function mergeHorse(oldH,curH){
    if(!oldH)return {...curH};
    const x={...oldH};
    ['odds','pop','ev','actual-time','actualTime'].forEach(k=>{
      if(curH?.[k]!==undefined&&curH[k]!==null&&curH[k]!=='')x[k]=curH[k];
    });
    if(curH?.mark)x.mark=curH.mark;
    return x;
  }

  function upsertCurrentRace(reason='sync'){
    const cur=getFormSafe(); if(!cur)return false;
    const key=raceKey(cur); if(!key||key==='||')return false;
    let all=[]; try{all=typeof window.loadAll==='function'?window.loadAll():[]}catch{}
    if(!Array.isArray(all))all=[];
    const idx=all.findIndex(r=>raceKey(r)===key), now=new Date().toISOString();

    if(idx<0){
      all.push({...cur,savedAt:cur.savedAt||now,updatedAt:now,syncReason:reason});
    }else{
      const old=all[idx], merged={...old};
      ['oddsType','oddsCheckedAt','marketSnapshots','marketFirst','marketFinal',
       'result1','result2','result3','review','resultUpdatedAt'].forEach(k=>{
        if(cur[k]!==undefined&&cur[k]!==null&&cur[k]!=='')merged[k]=cur[k];
      });
      const oldHs=Array.isArray(old.horses)?old.horses:[];
      const curHs=Array.isArray(cur.horses)?cur.horses:[];
      const map=new Map(oldHs.map(h=>[horseNo(h),h]));
      merged.horses=curHs.map(h=>mergeHorse(map.get(horseNo(h)),h));
      const curNos=new Set(merged.horses.map(horseNo));
      oldHs.forEach(h=>{if(!curNos.has(horseNo(h)))merged.horses.push(h)});
      merged.updatedAt=now; merged.syncReason=reason;
      if(hasResults())merged.resultUpdatedAt=now;
      all[idx]=merged;
    }
    try{
      if(typeof window.saveAll==='function')window.saveAll(all);
      if(typeof window.renderArchive==='function')window.renderArchive();
      if(typeof window.renderDashboard==='function')window.renderDashboard();
      return true;
    }catch(e){console.warn('Ver.8.7 save failed',e);return false}
  }

  function refreshPanels(){
    ['renderValueRanking','renderAllAiBreakdowns','renderQuickCompare','renderQuickView','renderFinal'].forEach(n=>{
      try{if(typeof window[n]==='function')window[n]()}catch{}
    });
  }

  function finalCard(){
    return $('chassFinalCard')||qsa('section.card').find(x=>/CHASS FINAL|最終判断/.test(x.textContent||''))||null;
  }
  function setFinalBadge(){
    const n=marketCount(), card=finalCard(); if(!card)return;
    const badge=card.querySelector('.badge,[id*="FinalStatus"],[id*="finalStatus"]');
    if(badge)badge.textContent=n?`市場反映済 ${n}頭`:'オッズ未取得';
  }

  function ensureSyncBar(){
    let bar=$('chass87SyncBar'); if(bar)return bar;
    const host=qsa('section.card').find(x=>/予想フロー/.test(x.textContent||''))||document.querySelector('.race-overview-card');
    if(!host)return null;
    bar=document.createElement('div'); bar.id='chass87SyncBar'; bar.className='chass87-syncbar'; host.appendChild(bar); return bar;
  }

  function syncSummary(){
    const bar=ensureSyncBar(); if(!bar)return;
    const hs=rows().filter(r=>r.querySelector('.horse-name')?.value?.trim()||r.querySelector('.horse-no')?.value).length;
    const odds=marketCount(), res=resultValues();
    let saved=false;
    try{const cur=getFormSafe(),all=typeof window.loadAll==='function'?window.loadAll():[];saved=Array.isArray(all)&&all.some(r=>raceKey(r)===raceKey(cur))}catch{}
    bar.innerHTML=`<span class="${hs?'ok':''}">📄 ${hs}頭</span><span class="${odds?'ok':''}">📡 市場 ${odds}/${hs}</span><span class="${res.length>=3?'ok':''}">🏁 ${res.length>=3?res.slice(0,3).join('-'):'結果待ち'}</span><span class="${saved?'ok':''}">📊 ${saved?'保存済':'未保存'}</span>`;
  }

  function injectStyles(){
    if($('chass87Styles'))return;
    const s=document.createElement('style'); s.id='chass87Styles';
    s.textContent=`.chass87-syncbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding:10px 12px;border:1px solid rgba(132,157,199,.22);border-radius:14px;background:rgba(255,255,255,.02)}.chass87-syncbar span{display:inline-flex;justify-content:center;padding:6px 9px;border-radius:999px;border:1px solid rgba(132,157,199,.18);font-size:.78rem;opacity:.72}.chass87-syncbar span.ok{opacity:1;border-color:rgba(96,226,187,.38);color:#76e9c5}@media(max-width:680px){.chass87-syncbar{display:grid;grid-template-columns:1fr 1fr}}`;
    document.head.appendChild(s);
  }

  async function afterMarket(reason='market'){
    if(!marketCount())return false;
    setRealOddsMeta(); refreshPanels(); setFinalBadge(); upsertCurrentRace(reason); syncSummary(); return true;
  }
  async function afterResult(reason='result'){
    if(!hasResults())return false;
    if(marketCount())setRealOddsMeta();
    refreshPanels(); setFinalBadge(); upsertCurrentRace(reason);
    try{if(typeof window.renderDashboard==='function')window.renderDashboard()}catch{}
    syncSummary(); return true;
  }

  function waitFor(pred,timeout=9000,interval=150){
    return new Promise(resolve=>{const start=Date.now();(function tick(){try{if(pred())return resolve(true)}catch{}if(Date.now()-start>=timeout)return resolve(false);setTimeout(tick,interval)})()})
  }

  function bindButtons(){
    document.addEventListener('click',async e=>{
      const btn=e.target?.closest?.('button,label'); if(!btn)return;
      const text=(btn.textContent||'').replace(/\s+/g,' ').trim();
      if(/現在オッズを取得/.test(text)){await waitFor(()=>marketCount()>0);await afterMarket('nar-current-odds')}
      if(/結果・最終オッズを取得/.test(text)){await waitFor(()=>hasResults()||marketCount()>0);if(hasResults())await afterResult('nar-result-final');else await afterMarket('nar-final-odds')}
      if(/結果を保存・再集計/.test(text))setTimeout(()=>afterResult('manual-result-save'),80);
    },true);
  }

  function hook(name,after){
    const fn=window[name]; if(typeof fn!=='function'||fn.__chass87)return;
    const w=function(...args){const out=fn.apply(this,args);if(out&&typeof out.then==='function')return out.then(async v=>{try{await after(v,...args)}catch{}return v});try{after(out,...args)}catch{}return out};
    w.__chass87=true; window[name]=w;
  }
  function installHooks(){
    hook('applyOfficialOdds',()=>setTimeout(()=>afterMarket('applyOfficialOdds'),50));
    hook('fetchOfficialNar',()=>setTimeout(()=>hasResults()?afterResult('fetchOfficialNar'):afterMarket('fetchOfficialNar-market'),100));
    hook('autoPersistResult',()=>setTimeout(()=>afterResult('autoPersistResult'),100));
    hook('renderDashboard',()=>setTimeout(syncSummary,30));
  }

  function init(){
    setVersion(); injectStyles(); installHooks(); bindButtons();
    document.addEventListener('input',e=>{if(e.target?.matches?.('.odds,.pop,#result1,#result2,#result3'))setTimeout(()=>hasResults()?afterResult('input-result'):afterMarket('input-market'),350)});
    setTimeout(()=>{if(hasResults())afterResult('boot-result-recovery');else if(marketCount())afterMarket('boot-market-recovery');else syncSummary();setFinalBadge()},400);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();