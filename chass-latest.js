/* CHASS KEIBA LAB Ver.8.8 - State Sync / Auto Validation + Feedback Dashboard */
(() => {
  'use strict';
  const VERSION='8.8';
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
       'result1','result2','result3','review','resultUpdatedAt','actualTimes','actualTimeByHorse',
       'modelSnapshot','finalSnapshot','validationSnapshot'].forEach(k=>{
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

/* CHASS KEIBA LAB Ver.8.8 - VALIDATION FEEDBACK LOOP
   Additive patch for Ver.8.7+
   Purpose:
   1) Expand post-race validation beyond win-only accuracy.
   2) Track TOP3 capture, marks, value/risk outcomes, calibration and time error.
   3) Keep existing prediction/result/market flow untouched.
*/
(() => {
  'use strict';

  const VERSION = '8.8';
  const $ = id => document.getElementById(id);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const pct = (a,b,d=1) => b ? `${(a/b*100).toFixed(d)}%` : '—';

  function setVersion(){
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/gi, `Ver.${VERSION}`);
    qsa('.topbar h1 span, h1 span').forEach(el => {
      if (/Ver\./i.test(el.textContent || '')) el.textContent = `Ver.${VERSION}`;
    });
  }

  function injectStyles(){
    if ($('chass88ValidationStyles')) return;
    const st=document.createElement('style');
    st.id='chass88ValidationStyles';
    st.textContent=`
      .ch88-section{margin-top:18px;padding-top:18px;border-top:1px solid rgba(130,160,205,.20)}
      .ch88-title{font-size:1.15rem;font-weight:850;margin:0 0 12px}
      .ch88-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .ch88-card{border:1px solid rgba(130,160,205,.22);border-radius:16px;background:rgba(255,255,255,.02);padding:13px}
      .ch88-card span{display:block;color:#9cadc7;font-size:.78rem;margin-bottom:4px}
      .ch88-card strong{font-size:1.28rem;color:#f4f7ff}
      .ch88-card small{display:block;color:#9cadc7;margin-top:5px;line-height:1.45}
      .ch88-wide{grid-column:1/-1}
      .ch88-table{display:grid;gap:8px;margin-top:10px}
      .ch88-row{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(4,minmax(58px,.6fr));gap:8px;align-items:center;border:1px solid rgba(130,160,205,.18);border-radius:13px;padding:10px 11px}
      .ch88-row b{font-size:.9rem}.ch88-row span{text-align:right;font-size:.82rem;color:#c4cede}
      .ch88-note{margin-top:10px;padding:10px 12px;border-radius:13px;border:1px solid rgba(97,223,184,.20);background:rgba(97,223,184,.04);color:#a9b9cf;font-size:.8rem;line-height:1.55}
      @media(max-width:520px){.ch88-grid{grid-template-columns:1fr 1fr}.ch88-row{grid-template-columns:1fr 1fr}.ch88-row b{grid-column:1/-1}.ch88-row span{text-align:left}.ch88-wide{grid-column:1/-1}}
    `;
    document.head.appendChild(st);
  }

  function getAll(){
    try { if (typeof window.loadAll === 'function') return window.loadAll() || []; } catch {}
    for (const key of ['chass_keiba_lab','chass_predictions','keiba_predictions','chass_saved_races']) {
      try { const v=JSON.parse(localStorage.getItem(key)||'[]'); if(Array.isArray(v)&&v.length) return v; } catch {}
    }
    return [];
  }

  function resultOrder(r){
    return [r.result1,r.result2,r.result3].map(x=>String(x||'').trim()).filter(Boolean);
  }

  function horseNo(h){ return String(h?.['horse-no'] ?? h?.horseNo ?? h?.no ?? '').trim(); }
  function horseName(h){ return String(h?.['horse-name'] ?? h?.horseName ?? h?.name ?? '').trim(); }
  function mark(h){ return String(h?.mark ?? '').trim(); }
  function winP(h){ return num(h?.win ?? h?.winRate ?? h?.aiWin); }
  function placeP(h){ return num(h?.place ?? h?.placeRate ?? h?.aiPlace); }
  function odds(h){ return num(h?.odds ?? h?.realOdds ?? h?.currentOdds); }
  function pop(h){ return num(h?.pop ?? h?.popularity); }
  function predictedTime(h){ return h?.time ?? h?.predictedTime ?? ''; }
  function actualTime(r,h){
    const no=horseNo(h);
    const m=r.actualTimes || r.actualTimeByHorse || {};
    return m?.[no] ?? h?.actualTime ?? '';
  }

  function timeSec(v){
    if(v==null||v==='') return null;
    if(typeof v==='number') return Number.isFinite(v)?v:null;
    const s=String(v).trim();
    if(/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
    const m=s.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/); if(!m)return null;
    return Number(m[1])*60+Number(m[2]);
  }

  function position(r,h){
    const order=resultOrder(r), no=horseNo(h), name=horseName(h);
    let i=no?order.indexOf(no):-1;
    if(i<0 && name) i=order.indexOf(name);
    return i>=0?i+1:null;
  }

  function rankBy(hs, getter){
    return [...hs].filter(Boolean).sort((a,b)=>(getter(b)??-Infinity)-(getter(a)??-Infinity));
  }

  function overall(h){ return num(h?.overall ?? h?.score ?? h?.aiOverall); }
  function expectedReturn(h){
    const explicit=num(h?.expectedReturn ?? h?.ev ?? h?.expectedValue);
    if(explicit!=null && explicit>10) return explicit;
    const w=winP(h), o=odds(h); return (w!=null&&o!=null)?w*o:null;
  }

  function modelTop(r, key){
    const snap=r.modelSnapshot?.[key];
    if(snap?.horseNo) return String(snap.horseNo);
    const hs=r.horses||[];
    if(!hs.length)return null;
    if(key==='winModelTop') return horseNo(rankBy(hs,winP)[0]);
    if(key==='overallModelTop') return horseNo(rankBy(hs,overall)[0]);
    if(key==='valueModelTop') return horseNo(rankBy(hs,expectedReturn)[0]);
    if(key==='finalModelTop'){
      const marked=hs.find(h=>mark(h).includes('◎'));
      return horseNo(marked || rankBy(hs,winP)[0]);
    }
    return null;
  }

  function isDiamond(h){
    const m=mark(h); if(m.includes('💎')) return true;
    const p=pop(h), ev=expectedReturn(h), pl=placeP(h);
    return ev!=null && ((p!=null&&p>=8&&(pl??0)>=18&&ev>=125)||(p!=null&&p>=4&&(pl??0)>=20&&ev>=112));
  }
  function isWarning(h){
    const m=mark(h); if(m.includes('⚠')) return true;
    const p=pop(h), ev=expectedReturn(h); return p!=null&&p<=3&&ev!=null&&ev<82;
  }

  function stats(){
    const races=getAll().filter(r=>resultOrder(r).length>=1);
    const out={races:races.length,horses:0,top3Capture:0,mark:{},diamond:{n:0,win:0,place:0,popSum:0,popN:0,oddsSum:0,oddsN:0},warning:{n:0,out:0},calWinAE:[],calPlaceAE:[],timeErr:[],models:{}};
    const markKeys=['◎','○','▲','△','☆']; markKeys.forEach(k=>out.mark[k]={n:0,win:0,place:0});
    ['winModelTop','overallModelTop','valueModelTop','finalModelTop'].forEach(k=>out.models[k]={n:0,win:0,place:0});

    for(const r of races){
      const hs=r.horses||[]; out.horses+=hs.length;
      const order=resultOrder(r);
      const top3Marks=hs.filter(h=>/[◎○▲]/.test(mark(h))).map(h=>horseNo(h));
      if(order.slice(0,3).some(no=>top3Marks.includes(String(no)))) out.top3Capture++;

      for(const h of hs){
        const p=position(r,h); const m=mark(h);
        for(const k of markKeys){ if(m.includes(k)){ const s=out.mark[k]; s.n++; if(p===1)s.win++; if(p&&p<=3)s.place++; } }
        if(isDiamond(h)){ const d=out.diamond; d.n++; if(p===1)d.win++; if(p&&p<=3)d.place++; const pp=pop(h),oo=odds(h); if(pp!=null){d.popSum+=pp;d.popN++;} if(oo!=null){d.oddsSum+=oo;d.oddsN++;} }
        if(isWarning(h)){ out.warning.n++; if(!p||p>3)out.warning.out++; }

        const wp=winP(h), pp=placeP(h);
        if(wp!=null) out.calWinAE.push(Math.abs((p===1?100:0)-wp));
        if(pp!=null) out.calPlaceAE.push(Math.abs((p&&p<=3?100:0)-pp));
        const pt=timeSec(predictedTime(h)), at=timeSec(actualTime(r,h)); if(pt!=null&&at!=null) out.timeErr.push(Math.abs(at-pt));
      }

      for(const k of Object.keys(out.models)){
        const no=modelTop(r,k); if(!no)continue;
        const h=hs.find(x=>horseNo(x)===String(no)); if(!h)continue;
        const p=position(r,h), s=out.models[k]; s.n++; if(p===1)s.win++; if(p&&p<=3)s.place++;
      }
    }
    return out;
  }

  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;

  function findDashboardCard(){
    const dash=$('dashboardView'); if(!dash)return null;
    return qsa('section.card',dash).find(s=>/予想検証ダッシュボード/.test(s.textContent||'')) || qsa('section.card',dash)[0] || dash;
  }

  function ensureSection(){
    const host=findDashboardCard(); if(!host)return null;
    let sec=$('chass88Validation'); if(sec)return sec;
    sec=document.createElement('div'); sec.id='chass88Validation'; sec.className='ch88-section'; host.appendChild(sec); return sec;
  }

  function render(){
    setVersion(); const sec=ensureSection(); if(!sec)return;
    const s=stats();
    const avgPop=s.diamond.popN?s.diamond.popSum/s.diamond.popN:null;
    const avgOdds=s.diamond.oddsN?s.diamond.oddsSum/s.diamond.oddsN:null;
    const winMAE=avg(s.calWinAE), placeMAE=avg(s.calPlaceAE), tm=avg(s.timeErr);
    const labels={winModelTop:'勝率モデル',overallModelTop:'総合モデル',valueModelTop:'期待値モデル',finalModelTop:'CHASS FINAL'};

    sec.innerHTML=`
      <div class="ch88-title">検証精度・フィードバック</div>
      <div class="ch88-grid">
        <div class="ch88-card"><span>◎○▲ TOP3捕捉率</span><strong>${pct(s.top3Capture,s.races)}</strong><small>${s.races}R中 ${s.top3Capture}Rで1頭以上3着内</small></div>
        <div class="ch88-card"><span>💎 穴馬 複勝率</span><strong>${pct(s.diamond.place,s.diamond.n)}</strong><small>${s.diamond.n}頭中 ${s.diamond.place}頭</small></div>
        <div class="ch88-card"><span>💎 平均人気 / 平均単勝</span><strong>${avgPop==null?'—':avgPop.toFixed(1)+'人気'}</strong><small>${avgOdds==null?'実オッズ不足':`平均 ${avgOdds.toFixed(1)}倍`}</small></div>
        <div class="ch88-card"><span>⚠️ 人気馬 圏外率</span><strong>${pct(s.warning.out,s.warning.n)}</strong><small>${s.warning.n}頭中 ${s.warning.out}頭</small></div>
        <div class="ch88-card"><span>AI勝率 平均絶対誤差</span><strong>${winMAE==null?'—':winMAE.toFixed(1)+'pt'}</strong><small>0/100結果との差。蓄積で較正確認</small></div>
        <div class="ch88-card"><span>AI複勝率 平均絶対誤差</span><strong>${placeMAE==null?'—':placeMAE.toFixed(1)+'pt'}</strong><small>3着内0/100結果との差</small></div>
        <div class="ch88-card ch88-wide"><span>予想TIME 平均絶対誤差</span><strong>${tm==null?'—':tm.toFixed(2)+'秒'}</strong><small>実走TIME保存済みデータのみ集計</small></div>
      </div>
      <div class="ch88-title" style="margin-top:18px">印別成績</div>
      <div class="ch88-table">${Object.entries(s.mark).map(([k,v])=>`<div class="ch88-row"><b>${k}</b><span>対象 ${v.n}</span><span>勝 ${pct(v.win,v.n)}</span><span>複 ${pct(v.place,v.n)}</span><span>3着内 ${v.place}</span></div>`).join('')}</div>
      <div class="ch88-title" style="margin-top:18px">モデル別成績</div>
      <div class="ch88-table">${Object.entries(s.models).map(([k,v])=>`<div class="ch88-row"><b>${esc(labels[k])}</b><span>対象 ${v.n}</span><span>勝 ${pct(v.win,v.n)}</span><span>複 ${pct(v.place,v.n)}</span><span>3着内 ${v.place}</span></div>`).join('')}</div>
      <div class="ch88-note">Ver.8.8は「勝った/外れた」だけでなく、TOP3捕捉・印別複勝・穴馬・危険馬・AI確率誤差・予想TIME誤差を同時に保存データから評価します。少数レースでは数値が大きく振れるため、50R・100R以上の累積値を主判断にしてください。</div>`;
  }

  function hook(name){
    const fn=window[name]; if(typeof fn!=='function'||fn.__ch88)return;
    const wrapped=function(...args){ const out=fn.apply(this,args); Promise.resolve(out).finally(()=>setTimeout(render,40)); return out; };
    wrapped.__ch88=true; window[name]=wrapped;
  }

  function boot(){
    injectStyles(); setVersion();
    ['renderDashboard','saveCurrent','saveCurrentSilent','autoPersistResult','applyOfficialResult'].forEach(hook);
    qsa('.tab').forEach(b=>b.addEventListener('click',()=>setTimeout(render,80)));
    $('recalcDash')?.addEventListener('click',()=>setTimeout(render,50));
    document.addEventListener('change',e=>{if(e.target?.matches?.('#result1,#result2,#result3,.actual-time,.mark,.win,.place,.odds,.pop'))setTimeout(render,80);});
    setTimeout(render,120);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

