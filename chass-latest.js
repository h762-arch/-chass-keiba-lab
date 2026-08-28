/* CHASS KEIBA LAB Ver.8.9 - State Sync / Auto Validation + Feedback Dashboard */
(() => {
  'use strict';
  const VERSION='8.9.1';
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

/* CHASS KEIBA LAB Ver.8.9 - VALIDATION FEEDBACK LOOP
   Additive patch for Ver.8.7+
   Purpose:
   1) Expand post-race validation beyond win-only accuracy.
   2) Track TOP3 capture, marks, value/risk outcomes, calibration and time error.
   3) Keep existing prediction/result/market flow untouched.
*/
(() => {
  'use strict';

  const VERSION = '8.9.1';
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
    try { const v=JSON.parse(localStorage.getItem('chass_v80_races')||'{}'); if(v&&typeof v==='object'&&!Array.isArray(v)) return Object.values(v); } catch {}
    for (const key of ['chass_keiba_lab','chass_predictions','keiba_predictions','chass_saved_races']) {
      try { const v=JSON.parse(localStorage.getItem(key)||'[]'); if(Array.isArray(v)&&v.length) return v; } catch {}
    }
    return [];
  }

  function resultOrder(r){
    const f=r?.result?.finishOrder;
    if(Array.isArray(f)&&f.length) return f.slice(0,3).map(x=>String(x||'').trim()).filter(Boolean);
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
      <div class="ch88-note">Ver.8.9は「勝った/外れた」だけでなく、TOP3捕捉・印別複勝・穴馬・危険馬・AI確率誤差・予想TIME誤差を同時に保存データから評価します。少数レースでは数値が大きく振れるため、50R・100R以上の累積値を主判断にしてください。</div>`;
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


/* CHASS KEIBA LAB Ver.8.9 - UNIFIED STATE / VALIDATION FOUNDATION
   1) Prediction -> market -> final -> result -> validation stored as one race snapshot.
   2) Model/final snapshots are persisted so dashboard targets do not fall back to 0.
   3) Quick View uses a fixed mobile 2-row layout.
   4) CHASS FINAL explains why each top pick is ranked there.
   5) Validation can compare ALL / latest 50R / latest 100R.
*/
(() => {
  'use strict';
  const VERSION='8.9.1';
  const STATE_KEY='chass_unified_state_v89';
  const $=id=>document.getElementById(id);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const pct=(a,b)=>b?`${(a/b*100).toFixed(1)}%`:'—';

  function setVersion(){
    document.title=document.title.replace(/Ver\.\d+(?:\.\d+)?/gi,`Ver.${VERSION}`);
    qsa('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./i.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
  }
  function raceKey(d={}){return [d.raceDate??$('raceDate')?.value??'',d.track??$('track')?.value??'',d.raceNo??$('raceNo')?.value??''].map(x=>String(x).trim()).join('|')}
  function hNo(h,i=0){return String(h?.['horse-no']??h?.horseNo??h?.no??i+1).trim()}
  function hName(h){return String(h?.['horse-name']??h?.horseName??h?.name??'').trim()}
  function hWin(h){return num(h?.win??h?.winRate??h?.aiWin)}
  function hPlace(h){return num(h?.place??h?.placeRate??h?.aiPlace)}
  function hOdds(h){return num(h?.odds??h?.realOdds??h?.currentOdds)}
  function hPop(h){return num(h?.pop??h?.popularity)}
  function hOverall(h){return num(h?.overall??h?.score??h?.aiOverall)}
  function hTime(h){return String(h?.time??h?.predictedTime??'')}
  function hMark(h){return String(h?.mark??'').trim()}
  function ev(h){const x=num(h?.expectedReturn??h?.ev??h?.expectedValue);if(x!=null&&x>10)return x;const w=hWin(h),o=hOdds(h);return w!=null&&o!=null?w*o:null}
  function realMarket(){return String($('oddsType')?.value||$('oddsTypeDisplay')?.textContent||'').includes('実オッズ')}
  function resultOrder(d={}){return [d.result1??$('result1')?.value,d.result2??$('result2')?.value,d.result3??$('result3')?.value].map(x=>String(x||'').trim()).filter(Boolean)}

  function domHorses(){
    const rs=qsa('.horse-row');
    return rs.map((r,i)=>{
      let h={};try{if(typeof window.horseFromRow==='function')h=window.horseFromRow(r)||{}}catch{}
      let overall=hOverall(h);
      if(overall==null){try{if(typeof window.aiBreakdown==='function'){const all=rs.map(rr=>window.horseFromRow?.(rr)||{});overall=num(window.aiBreakdown(h,all)?.overall)}}catch{}}
      return {
        ...h,
        'horse-no':hNo(h,i),
        'horse-name':hName(h)||String(r.querySelector('.horse-name')?.value||'').trim(),
        mark:hMark(h)||String(r.querySelector('.mark')?.value||'').trim(),
        win:hWin(h)??num(r.querySelector('.win')?.value),
        place:hPlace(h)??num(r.querySelector('.place')?.value),
        time:hTime(h)||String(r.querySelector('.time')?.value||''),
        overall,
        odds:hOdds(h)??num(r.querySelector('.odds')?.value),
        pop:hPop(h)??num(r.querySelector('.pop')?.value)
      };
    }).filter(h=>h['horse-name']||h['horse-no']);
  }
  function form(){try{return typeof window.getForm==='function'?(window.getForm()||{}):{}}catch{return {}}}
  function rank(hs,getter){return [...hs].sort((a,b)=>(getter(b)??-Infinity)-(getter(a)??-Infinity))}
  function snapshotTop(h,label){return h?{label,horseNo:hNo(h),horseName:hName(h),mark:hMark(h),win:hWin(h),place:hPlace(h),overall:hOverall(h),odds:hOdds(h),pop:hPop(h),expectedReturn:ev(h),predictedTime:hTime(h)}:null}

  function buildSnapshot(reason='sync'){
    const d=form(),hs=(Array.isArray(d.horses)&&d.horses.length?d.horses:domHorses()).map((h,i)=>({...h,'horse-no':hNo(h,i)}));
    const byWin=rank(hs,hWin),byOverall=rank(hs,hOverall),byValue=rank(hs,ev);
    const finalMarked=['◎','○','▲'].map(m=>hs.find(h=>hMark(h).includes(m))).filter(Boolean);
    const final=finalMarked.length?finalMarked:byWin.slice(0,3);
    const result=resultOrder(d);
    const snap={
      schemaVersion:'8.9',updatedAt:new Date().toISOString(),reason,
      race:{raceDate:(d.raceDate??$('raceDate')?.value??''),track:(d.track??$('track')?.value??''),raceNo:(d.raceNo??$('raceNo')?.value??''),distance:(d.distance??$('distance')?.value??''),chaos:(d.chaos??$('chaos')?.value??''),pace:(d.pace??$('pace')?.value??''),bias:(d.bias??$('bias')?.value??'')},
      horses:hs,
      market:{isReal:realMarket(),count:hs.filter(h=>hOdds(h)!=null).length,checkedAt:(d.oddsCheckedAt??$('oddsCheckedAt')?.value??''),type:(d.oddsType??$('oddsType')?.value??'')},
      result:{order:result,actualTimes:d.actualTimes||d.actualTimeByHorse||{}},
      modelSnapshot:{
        winModelTop:snapshotTop(byWin[0],'勝率モデル'),
        overallModelTop:snapshotTop(byOverall[0],'総合モデル'),
        valueModelTop:snapshotTop(byValue[0],'期待値モデル'),
        finalModelTop:snapshotTop(final[0],'CHASS FINAL')
      },
      finalSnapshot:{top3:final.slice(0,3).map((h,i)=>snapshotTop(h,['◎','○','▲'][i]||`${i+1}位`)),diamond:hs.filter(h=>hMark(h).includes('💎')).map(h=>snapshotTop(h,'💎')),warning:hs.filter(h=>hMark(h).includes('⚠')).map(h=>snapshotTop(h,'⚠️'))},
      validationSnapshot:{resultCount:result.length,hasActualTimes:Object.keys(d.actualTimes||d.actualTimeByHorse||{}).length>0}
    };
    return snap;
  }

  function saveUnified(reason='sync'){
    const snap=buildSnapshot(reason),key=raceKey(snap.race);if(!key||key==='||')return null;
    try{const db=JSON.parse(localStorage.getItem(STATE_KEY)||'{}');db[key]=snap;localStorage.setItem(STATE_KEY,JSON.stringify(db))}catch{}
    try{
      let all=typeof window.loadAll==='function'?(window.loadAll()||[]):[];if(!Array.isArray(all))all=[];
      let idx=all.findIndex(r=>raceKey(r)===key);const base=idx>=0?all[idx]:form();
      const merged={...base,modelSnapshot:snap.modelSnapshot,finalSnapshot:snap.finalSnapshot,validationSnapshot:snap.validationSnapshot,unifiedSnapshot:snap,oddsType:snap.market.type,oddsCheckedAt:snap.market.checkedAt};
      if(snap.result.order[0])merged.result1=snap.result.order[0];if(snap.result.order[1])merged.result2=snap.result.order[1];if(snap.result.order[2])merged.result3=snap.result.order[2];
      if(Object.keys(snap.result.actualTimes).length)merged.actualTimes=snap.result.actualTimes;
      // Prediction fields remain frozen when a saved race already exists; only market/post-race fields are refreshed.
      if(idx<0){merged.horses=snap.horses;all.unshift(merged)}else{all[idx]=merged}
      if(typeof window.saveAll==='function')window.saveAll(all);
    }catch(e){console.warn('CHASS 8.9 snapshot save',e)}
    return snap;
  }

  function reasonFor(h,hs){
    const w=hWin(h),p=hPlace(h),o=hOdds(h),e=ev(h),ov=hOverall(h),rp=rank(hs,hWin).indexOf(h)+1,rpl=rank(hs,hPlace).indexOf(h)+1;
    const bits=[];
    if(rp===1)bits.push('AI勝率1位');else if(rp<=3)bits.push(`AI勝率${rp}位`);
    if(rpl===1)bits.push('複勝率1位');else if(rpl<=3)bits.push(`複勝率${rpl}位`);
    if(e!=null&&e>=110)bits.push(`市場期待${Math.round(e)}%`);
    if(e!=null&&e<82)bits.push(`市場期待${Math.round(e)}%で割高`);
    if(ov!=null&&ov>=80&&rp>3)bits.push(`総合${Math.round(ov)}だが勝率順位は${rp}位`);
    if(o==null)bits.push('市場未取得');
    return bits.slice(0,3).join('＋')||'能力・展開・市場を統合評価';
  }

  function renderFinalReasons(){
    const card=$('chassFinalCard')||qsa('section.card').find(x=>/CHASS FINAL|最終判断/.test(x.textContent||''));if(!card)return;
    let box=$('chass89FinalReasons');if(!box){box=document.createElement('div');box.id='chass89FinalReasons';box.className='ch89-final-reasons';card.appendChild(box)}
    const hs=domHorses(),tops=['◎','○','▲'].map(m=>hs.find(h=>hMark(h).includes(m))).filter(Boolean);
    box.innerHTML=tops.length?`<div class="ch89-reason-title">選定理由</div>${tops.map(h=>`<div class="ch89-reason"><b>${esc(hMark(h).match(/[◎○▲]/)?.[0]||'')} ${esc(hNo(h))}番 ${esc(hName(h))}</b><span>${esc(reasonFor(h,hs))}</span></div>`).join('')}`:'';
  }

  function renderQuick(){
    const host=$('quickCompare');if(!host)return;const hs=domHorses();if(!hs.length)return;
    const sorted=rank(hs,hWin);
    host.innerHTML=`<div class="ch89-quick-list">${sorted.map(h=>{
      const e=realMarket()?ev(h):null;
      return `<article class="ch89-quick-card"><div class="ch89-qhead"><span class="ch89-no">${esc(hNo(h))}</span><strong>${esc(hMark(h))} ${esc(hName(h))}</strong><em>総合 ${hOverall(h)==null?'—':Math.round(hOverall(h))}</em></div><div class="ch89-qstats"><span><small>AI勝率</small><b>${hWin(h)==null?'—':hWin(h).toFixed(1)+'%'}</b></span><span><small>複勝率</small><b>${hPlace(h)==null?'—':hPlace(h).toFixed(1)+'%'}</b></span><span><small>TIME</small><b>${esc(hTime(h)||'—')}</b></span><span><small>期待</small><b>${e==null?'—':Math.round(e)+'%'}</b></span></div>${realMarket()?`<div class="ch89-market"><span>実 ${hOdds(h)==null?'—':hOdds(h)+'倍'}</span><span>${hPop(h)==null?'人気 —':hPop(h)+'人気'}</span></div>`:''}</article>`;
    }).join('')}</div>`;
  }

  function getSaved(){
    try{if(typeof window.loadAll==='function'){const x=window.loadAll()||[];if(Array.isArray(x)&&x.length)return x}}catch{}
    try{const v=JSON.parse(localStorage.getItem('chass_v80_races')||'{}');if(v&&typeof v==='object'&&!Array.isArray(v))return Object.values(v)}catch{}
    return [];
  }
  function pos(r,h){const order=(Array.isArray(r?.result?.finishOrder)&&r.result.finishOrder.length?r.result.finishOrder:[r.result1,r.result2,r.result3]).map(x=>String(x||'').trim());let i=order.indexOf(hNo(h));if(i<0)i=order.indexOf(hName(h));return i>=0?i+1:null}
  function modelTop(r,k){const s=r.modelSnapshot?.[k]||r.unifiedSnapshot?.modelSnapshot?.[k];if(s?.horseNo)return String(s.horseNo);const hs=r.horses||r.unifiedSnapshot?.horses||[];if(!hs.length)return null;if(k==='winModelTop')return hNo(rank(hs,hWin)[0]);if(k==='overallModelTop')return hNo(rank(hs,hOverall)[0]);if(k==='valueModelTop')return hNo(rank(hs,ev)[0]);const m=hs.find(h=>hMark(h).includes('◎'));return hNo(m||rank(hs,hWin)[0])}
  function modelStats(limit=0){
    let rs=getSaved().filter(r=>(Array.isArray(r?.result?.finishOrder)&&r.result.finishOrder.length>=3)||[r.result1,r.result2,r.result3].some(Boolean));rs=[...rs].sort((a,b)=>String(b.resultUpdatedAt||b.updatedAt||b.raceDate||'').localeCompare(String(a.resultUpdatedAt||a.updatedAt||a.raceDate||'')));if(limit)rs=rs.slice(0,limit);
    const out={races:rs.length,models:{winModelTop:{n:0,w:0,p:0},overallModelTop:{n:0,w:0,p:0},valueModelTop:{n:0,w:0,p:0},finalModelTop:{n:0,w:0,p:0}}};
    for(const r of rs){const hs=r.horses||r.unifiedSnapshot?.horses||[];for(const k of Object.keys(out.models)){const no=modelTop(r,k);if(!no)continue;const h=hs.find(x=>hNo(x)===no);if(!h)continue;const p=pos(r,h),s=out.models[k];s.n++;if(p===1)s.w++;if(p&&p<=3)s.p++}}
    return out;
  }

  function renderValidationWindow(){
    const sec=$('chass88Validation');if(!sec)return;
    let ctl=$('chass89WindowCtl');if(!ctl){ctl=document.createElement('div');ctl.id='chass89WindowCtl';ctl.className='ch89-window';ctl.innerHTML='<b>集計期間</b><button data-n="0" class="active">全期間</button><button data-n="50">最新50R</button><button data-n="100">最新100R</button><div id="chass89ModelWindow"></div>';sec.prepend(ctl);ctl.addEventListener('click',e=>{const b=e.target.closest('button[data-n]');if(!b)return;qsa('button',ctl).forEach(x=>x.classList.toggle('active',x===b));renderModelWindow(Number(b.dataset.n||0))})}
    renderModelWindow(Number(ctl.querySelector('button.active')?.dataset.n||0));
  }
  function renderModelWindow(n){
    const host=$('chass89ModelWindow');if(!host)return;const s=modelStats(n),labels={winModelTop:'勝率',overallModelTop:'総合',valueModelTop:'期待値',finalModelTop:'FINAL'};
    host.innerHTML=`<div class="ch89-window-meta">対象 ${s.races}R</div><div class="ch89-window-grid">${Object.entries(s.models).map(([k,v])=>`<div><b>${labels[k]}</b><span>対象 ${v.n}</span><strong>勝 ${pct(v.w,v.n)} / 複 ${pct(v.p,v.n)}</strong></div>`).join('')}</div>`;
  }

  function syncMarketUI(){
    const hs=domHorses(),n=hs.filter(h=>hOdds(h)!=null).length,total=hs.length;
    qsa('#marketStatus,#quickMarketStatus,#chassFinalStatus,[id*="marketStatus"],[id*="FinalStatus"]').forEach(el=>{
      if(!el)return;const t=el.textContent||'';
      if(n){if(/市場|オッズ|反映|未取得/.test(t))el.textContent=`市場反映済 ${n}/${total}頭`}else if(/市場|オッズ|反映/.test(t))el.textContent='市場未取得';
    });
  }

  function injectStyles(){
    if($('chass89Styles'))return;const s=document.createElement('style');s.id='chass89Styles';s.textContent=`
      .ch89-quick-list{display:grid;gap:10px}.ch89-quick-card{border:1px solid rgba(130,160,205,.22);border-radius:18px;padding:14px;background:rgba(255,255,255,.02)}
      .ch89-qhead{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:10px;align-items:center}.ch89-no{display:grid;place-items:center;width:54px;height:54px;border:1px solid rgba(97,223,184,.55);border-radius:15px;color:#61dfb8;font-size:1.35rem;font-weight:900}.ch89-qhead strong{min-width:0;font-size:1.03rem;overflow-wrap:anywhere}.ch89-qhead em{font-style:normal;font-size:.76rem;color:#9cadc7;border:1px solid rgba(130,160,205,.2);padding:6px 8px;border-radius:999px;white-space:nowrap}
      .ch89-qstats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:11px}.ch89-qstats span{min-width:0;border:1px solid rgba(130,160,205,.17);border-radius:12px;padding:8px 5px;text-align:center}.ch89-qstats small{display:block;color:#9cadc7;font-size:.67rem}.ch89-qstats b{display:block;margin-top:2px;font-size:.91rem;white-space:nowrap}.ch89-market{display:flex;gap:12px;margin-top:8px;color:#9cadc7;font-size:.76rem}
      .ch89-final-reasons{margin-top:12px;border-top:1px solid rgba(130,160,205,.18);padding-top:10px}.ch89-reason-title{font-size:.76rem;color:#61dfb8;font-weight:850;letter-spacing:.08em;margin-bottom:6px}.ch89-reason{display:grid;grid-template-columns:minmax(115px,.8fr) minmax(0,1.5fr);gap:8px;padding:7px 0}.ch89-reason b{font-size:.82rem}.ch89-reason span{font-size:.78rem;color:#9cadc7;line-height:1.45}
      .ch89-window{margin-bottom:16px;padding:11px;border:1px solid rgba(97,223,184,.2);border-radius:15px}.ch89-window>b{display:block;margin-bottom:8px}.ch89-window button{border:1px solid rgba(130,160,205,.22);background:transparent;color:#aab8cd;border-radius:999px;padding:7px 10px;margin-right:5px}.ch89-window button.active{background:#61dfb8;color:#071620;border-color:#61dfb8}.ch89-window-meta{margin:10px 0 7px;color:#9cadc7;font-size:.78rem}.ch89-window-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ch89-window-grid>div{border:1px solid rgba(130,160,205,.16);border-radius:12px;padding:8px}.ch89-window-grid b,.ch89-window-grid span,.ch89-window-grid strong{display:block}.ch89-window-grid span{font-size:.72rem;color:#9cadc7;margin-top:2px}.ch89-window-grid strong{font-size:.78rem;margin-top:3px}
      @media(max-width:520px){.ch89-qhead{grid-template-columns:54px minmax(0,1fr)}.ch89-qhead em{grid-column:2;justify-self:start}.ch89-qstats{grid-template-columns:1fr 1fr}.ch89-reason{grid-template-columns:1fr}.ch89-window-grid{grid-template-columns:1fr 1fr}.tabs{position:relative!important}.chass84-result-anchor{scroll-margin-top:10px}}
    `;document.head.appendChild(s)
  }

  function refresh(reason='ui'){
    setVersion();syncMarketUI();renderQuick();renderFinalReasons();renderValidationWindow();saveUnified(reason);
  }
  function hook(name,reason){const fn=window[name];if(typeof fn!=='function'||fn.__ch89)return;const w=function(...args){const out=fn.apply(this,args);Promise.resolve(out).finally(()=>setTimeout(()=>refresh(reason||name),90));return out};w.__ch89=true;window[name]=w}
  function boot(){
    injectStyles();setVersion();
    ['render','renderDashboard','renderValueRanking','renderAllAiBreakdowns','saveCurrentSilent','autoPersistResult','applyOfficialOdds','applyOfficialResult','fetchOfficialNar'].forEach(n=>hook(n,n));
    document.addEventListener('click',e=>{const t=(e.target?.closest?.('button,label')?.textContent||'').replace(/\s+/g,' ');if(/現在オッズ|結果・最終オッズ|結果を保存・再集計|再集計/.test(t))setTimeout(()=>refresh('action'),700)},true);
    document.addEventListener('change',e=>{if(e.target?.matches?.('.odds,.pop,.win,.place,.mark,.time,.actual-time,#result1,#result2,#result3'))setTimeout(()=>refresh('change'),180)});
    qsa('.tab').forEach(b=>b.addEventListener('click',()=>setTimeout(()=>{setVersion();renderValidationWindow()},120)));
    setTimeout(()=>refresh('boot'),500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();


/* CHASS KEIBA LAB Ver.8.9.1 - MARKET RECOVERY / BASE STORAGE COMPATIBILITY / MOBILE GAP FIX */
(() => {
  'use strict';
  const VERSION='8.9.1';
  const DB_KEY='chass_v80_races';
  const CURRENT_KEY='chass_v80_current';
  const $=id=>document.getElementById(id);
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
  const normDate=s=>String(s||'').replaceAll('/','-');
  const currentRaceId=()=>{
    const d=normDate($('raceDate')?.value||'');
    const t=String($('track')?.value||'').trim();
    const r=String($('raceNo')?.value||'').match(/\d+/)?.[0]||'';
    return d&&t&&r?`${d}|${t}|${r}`:'';
  };
  const loadDb=()=>{try{const v=JSON.parse(localStorage.getItem(DB_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch{return {}}};
  const saveDb=db=>localStorage.setItem(DB_KEY,JSON.stringify(db));
  const raceFromRoot=root=>{
    const r={...(root?.meta||{}),...(root?.race||{})};
    const d=normDate(r.raceDate||r.date||'');
    const t=String(r.track||'').trim();
    const n=String(r.raceNo||'').match(/\d+/)?.[0]||'';
    return d&&t&&n?`${d}|${t}|${n}`:'';
  };
  const actualResult=()=>[1,2,3].map(i=>String($(`result${i}`)?.value||$(`finish${i}`)?.value||'').trim()).filter(Boolean);
  const stateHorseCount=()=>{
    const rid=currentRaceId(); if(!rid)return 0;
    const r=loadDb()[rid]; return Array.isArray(r?.horses)?r.horses.length:0;
  };
  const storedMarketCount=()=>{
    const rid=currentRaceId(); if(!rid)return 0;
    const r=loadDb()[rid]; return (r?.horses||[]).filter(h=>num(h?.odds??h?.realOdds??h?.currentOdds)>0).length;
  };

  function setVersion(){
    document.title=document.title.replace(/Ver\.\d+(?:\.\d+){0,2}/gi,`Ver.${VERSION}`);
    document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./i.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
  }

  function injectFixCss(){
    if($('chass891FixStyles'))return;
    const st=document.createElement('style');st.id='chass891FixStyles';
    st.textContent=`
      @media(max-width:520px){
        .tabs{position:sticky!important;top:78px!important;margin-top:0!important;transform:none!important}
        .wrap{padding-top:14px!important}
      }
      #integrityGrid>div strong{overflow-wrap:anywhere}
    `;
    document.head.appendChild(st);
  }

  function syncResultAliases(){
    for(let i=1;i<=3;i++){
      const src=$(`finish${i}`); if(!src)continue;
      let alias=$(`result${i}`);
      if(!alias){alias=document.createElement('input');alias.type='hidden';alias.id=`result${i}`;document.body.appendChild(alias)}
      alias.value=src.value||'';
    }
  }

  function recomputeMarketOnRace(r){
    if(!r||!Array.isArray(r.horses))return r;
    const market=r.horses.filter(h=>num(h.odds)>0);
    if(!market.length)return r;
    const sorted=[...market].sort((a,b)=>num(a.odds)-num(b.odds));
    const popMap=new Map(sorted.map((h,i)=>[String(h.horseNo??h['horse-no']??''),i+1]));
    r.horses.forEach(h=>{
      const no=String(h.horseNo??h['horse-no']??'');
      const o=num(h.odds),w=num(h.win),p=num(h.place);
      if(o==null)return;
      h.popularity=popMap.get(no)||num(h.popularity)||null;
      h.ev=w!=null?o*w:null;
      h.fair=w>0?100/w:null;
      h.warning='';
      if(String(h.mark||'').includes('💎'))h.mark='';
    });
    [...r.horses].sort((a,b)=>(num(b.win)||0)-(num(a.win)||0)).slice(0,4).forEach((h,i)=>h.mark=['◎','○','▲','△'][i]);
    r.horses.forEach(h=>{
      const pop=num(h.popularity),p=num(h.place),e=num(h.ev);
      if(pop==null||e==null)return;
      if(pop>=10&&p>=20&&e>=125)h.mark='💎💎💎';
      else if(pop>=5&&p>=22&&e>=112)h.mark='💎';
      if(pop>=1&&pop<=3&&e<75)h.warning=e<55?'⚠️⚠️⚠️':e<65?'⚠️⚠️':'⚠️';
    });
    r.race=r.race||{};r.race.oddsType='実オッズ';
    return r;
  }

  function mergePreImport(pre,cur){
    if(!pre||!cur)return cur;
    const oldByNo=new Map((pre.horses||[]).map(h=>[String(h.horseNo??h['horse-no']??''),h]));
    cur.horses=(cur.horses||[]).map(h=>{
      const no=String(h.horseNo??h['horse-no']??''); const old=oldByNo.get(no); if(!old)return h;
      const x={...h};
      for(const k of ['odds','popularity','realOdds','currentOdds']) if((x[k]==null||x[k]==='')&&old[k]!=null)x[k]=old[k];
      return x;
    });
    if(pre.race?.oddsType==='実オッズ' || (pre.horses||[]).some(h=>num(h.odds)>0)){
      cur.race={...(cur.race||{}),oddsType:'実オッズ',oddsUpdatedAt:pre.race?.oddsUpdatedAt||pre.updatedAt||new Date().toISOString()};
    }
    if(!cur.result?.finishOrder?.length && pre.result?.finishOrder?.length)cur.result=pre.result;
    if(pre.validated)cur.validated=true;
    return recomputeMarketOnRace(cur);
  }

  function syncIntegrityAndBadges(){
    const total=stateHorseCount(); const n=storedMarketCount();
    const grid=$('integrityGrid');
    if(grid){[...grid.children].forEach(div=>{if(/市場/.test(div.textContent||'')){const strong=div.querySelector('strong');if(strong)strong.textContent=`${n}/${total}頭`}})}
    const ms=$('marketStatus');if(ms)ms.textContent=n?`市場反映済`:'市場待ち';
    const badge=$('liveOddsBadge');if(badge&&n)badge.textContent=`${n}頭反映`;
    document.querySelectorAll('#quickMarketStatus,#chassFinalStatus,[id*="marketStatus"],[id*="FinalStatus"]').forEach(el=>{
      if(el===ms)return; const t=el.textContent||''; if(/市場|オッズ|反映|未取得/.test(t))el.textContent=n?`市場反映済 ${n}/${total}頭`:'市場未取得';
    });
  }

  async function autoRefreshMarket(){
    if(storedMarketCount()>0){syncIntegrityAndBadges();return true}
    const btn=$('liveOddsSync');
    if(btn&&currentRaceId()){
      btn.click();
      const start=Date.now();
      while(Date.now()-start<8000){await new Promise(r=>setTimeout(r,250));if(storedMarketCount()>0){syncIntegrityAndBadges();return true}}
    }
    return false;
  }

  function installImportPreserver(){
    const inp=$('raceImportFile');if(!inp||inp.__chass891)return;inp.__chass891=true;
    inp.addEventListener('change',async e=>{
      const f=e.target.files?.[0]; if(!f)return;
      let rid='',pre=null;
      try{const text=(await f.text()).replace(/^\uFEFF/,'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');rid=raceFromRoot(JSON.parse(text));if(rid)pre=loadDb()[rid]||null}catch{}
      if(!rid)return;
      const marker=`chass891-reload-${rid}`;
      setTimeout(()=>{
        const db=loadDb(),cur=db[rid]; if(!cur)return;
        if(pre){db[rid]=mergePreImport(pre,cur);saveDb(db);localStorage.setItem(CURRENT_KEY,rid)}
        if(pre && (pre.horses||[]).some(h=>num(h.odds)>0) && sessionStorage.getItem(marker)!=='1'){
          sessionStorage.setItem(marker,'1');location.reload();return;
        }
        setTimeout(autoRefreshMarket,250);
      },900);
    },true);
  }

  function boot(){
    setVersion();injectFixCss();syncResultAliases();installImportPreserver();syncIntegrityAndBadges();
    document.addEventListener('input',e=>{if(/^finish[123]$/.test(e.target?.id||'')){syncResultAliases();setTimeout(setVersion,20)}},true);
    document.addEventListener('change',e=>{if(/^finish[123]$/.test(e.target?.id||'')){syncResultAliases();setTimeout(setVersion,20)}},true);
    document.addEventListener('click',e=>{const t=(e.target?.closest?.('button,label')?.textContent||'').replace(/\s+/g,' ');if(/現在オッズ|結果・最終オッズ|結果を保存|再集計|予想入力|検証ダッシュボード/.test(t))setTimeout(()=>{setVersion();syncResultAliases();syncIntegrityAndBadges()},700)},true);
    setTimeout(()=>{setVersion();syncResultAliases();syncIntegrityAndBadges();if(storedMarketCount()===0)autoRefreshMarket()},900);
    setInterval(()=>{setVersion();syncResultAliases();syncIntegrityAndBadges()},2500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

/* CHASS KEIBA LAB Ver.8.9.2 - QUICK VIEW / MARKET DETAIL SYNC / VALIDATION DEFINITIONS / ACTUAL TIME */
(() => {
  'use strict';
  const VERSION='8.9.2';
  const DB_KEY='chass_v80_races';
  const $=id=>document.getElementById(id);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const pct=(a,b)=>b?((a/b)*100).toFixed(1)+'%':'—';
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const normDate=s=>String(s||'').replaceAll('/','-');

  function setVersion(){
    document.title=document.title.replace(/Ver\.\d+(?:\.\d+){0,2}/gi,`Ver.${VERSION}`);
    qsa('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./i.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
  }
  function rid(){
    const d=normDate($('raceDate')?.value||'');
    const t=String($('track')?.value||'').trim();
    const r=String($('raceNo')?.value||'').match(/\d+/)?.[0]||'';
    return d&&t&&r?`${d}|${t}|${r}`:'';
  }
  function loadDb(){try{const v=JSON.parse(localStorage.getItem(DB_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch{return {}}}
  function saveDb(v){localStorage.setItem(DB_KEY,JSON.stringify(v))}
  function savedRace(){const k=rid();return k?loadDb()[k]||null:null}
  function hNo(h){return String(h?.horseNo??h?.['horse-no']??h?.no??'').trim()}
  function hName(h){return String(h?.horseName??h?.['horse-name']??h?.name??'').trim()}
  function hMark(h){return String(h?.mark??'').trim()}
  function hWin(h){return num(h?.win??h?.winRate??h?.aiWin)}
  function hPlace(h){return num(h?.place??h?.placeRate??h?.aiPlace)}
  function hOverall(h){return num(h?.overall??h?.score??h?.aiOverall)}
  function hOdds(h){return num(h?.odds??h?.realOdds??h?.currentOdds)}
  function hPop(h){return num(h?.popularity??h?.pop)}
  function hTime(h){return String(h?.predictedTime??h?.time??'')}
  function hEv(h){const x=num(h?.ev??h?.expectedReturn??h?.expectedValue);if(x!=null&&x>10)return x;const w=hWin(h),o=hOdds(h);return w!=null&&o!=null?w*o:null}
  function horses(r=savedRace()){return Array.isArray(r?.horses)?r.horses:[]}
  function resultOrder(r){const a=r?.result?.finishOrder;return (Array.isArray(a)&&a.length?a:[r?.result1,r?.result2,r?.result3]).slice(0,3).map(x=>String(x||'').trim()).filter(Boolean)}
  function pos(r,h){const o=resultOrder(r),no=hNo(h),name=hName(h);let i=no?o.indexOf(no):-1;if(i<0&&name)i=o.indexOf(name);return i>=0?i+1:null}
  function actualTime(r,h){const m=r?.actualTimes||r?.result?.actualTimes||r?.actualTimeByHorse||{};return m?.[hNo(h)]??h?.actualTime??''}
  function timeSec(v){if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;const s=String(v).trim();if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);const m=s.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);return m?Number(m[1])*60+Number(m[2]):null}

  function injectCss(){
    if($('chass892Styles'))return;
    const s=document.createElement('style');s.id='chass892Styles';s.textContent=`
      #chass88Validation{display:none!important}
      #chass892Validation{margin:18px 0;padding:16px;border:1px solid rgba(97,223,184,.24);border-radius:20px;background:rgba(15,29,49,.62)}
      .c892-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.c892-head small{display:block;color:#61dfb8;font-weight:850;letter-spacing:.14em}.c892-head h3{margin:3px 0 0;font-size:1.35rem}.c892-note{color:#9cadc7;font-size:.76rem;line-height:1.5}
      .c892-window{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.c892-window button{border:1px solid rgba(130,160,205,.25);background:transparent;color:#aebbd0;border-radius:999px;padding:8px 11px;font-weight:750}.c892-window button.active{background:#61dfb8;color:#071620;border-color:#61dfb8}
      .c892-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.c892-card{border:1px solid rgba(130,160,205,.20);border-radius:15px;padding:12px;min-width:0}.c892-card span,.c892-card small,.c892-card strong{display:block}.c892-card span{color:#9cadc7;font-size:.78rem}.c892-card strong{font-size:1.35rem;margin:5px 0}.c892-card small{color:#8fa1bb;font-size:.71rem;line-height:1.4}.c892-wide{grid-column:1/-1}
      .c892-title{margin:18px 0 8px;font-size:1rem;font-weight:850}.c892-table{display:grid;gap:7px}.c892-row{display:grid;grid-template-columns:minmax(84px,1.2fr) repeat(3,minmax(0,.8fr));gap:7px;align-items:center;border-top:1px solid rgba(130,160,205,.16);padding:9px 4px;font-size:.78rem}.c892-row span{color:#a9b7cc}
      .c892-quick{display:grid;gap:10px}.c892-qcard{border:1px solid rgba(130,160,205,.22);border-radius:18px;padding:14px;background:rgba(255,255,255,.02)}.c892-qhead{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:10px;align-items:center}.c892-no{display:grid;place-items:center;width:54px;height:54px;border:1px solid rgba(97,223,184,.58);border-radius:15px;color:#61dfb8;font-size:1.35rem;font-weight:900}.c892-qname{font-size:1.05rem;font-weight:850;min-width:0;overflow-wrap:anywhere}.c892-score{font-size:.75rem;color:#9cadc7;border:1px solid rgba(130,160,205,.20);border-radius:999px;padding:6px 8px;white-space:nowrap}.c892-qstats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:10px}.c892-qstats>div{border:1px solid rgba(130,160,205,.16);border-radius:12px;padding:8px 5px;text-align:center;min-width:0}.c892-qstats small{display:block;color:#8fa1bb;font-size:.66rem}.c892-qstats b{display:block;margin-top:2px;font-size:.9rem;white-space:nowrap}.c892-market{display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;color:#9cadc7;font-size:.76rem}
      @media(max-width:520px){.c892-qhead{grid-template-columns:54px minmax(0,1fr)}.c892-score{grid-column:2;justify-self:start}.c892-qstats{grid-template-columns:repeat(2,minmax(0,1fr))}.c892-row{grid-template-columns:1fr 1fr}.c892-row b{grid-column:1/-1}.c892-grid{grid-template-columns:1fr 1fr}}
    `;document.head.appendChild(s);
  }

  function renderQuick(){
    const host=$('quickList')||$('quickCompare');if(!host)return;
    const hs=horses();if(!hs.length)return;
    const sorted=[...hs].sort((a,b)=>(hWin(b)??-1)-(hWin(a)??-1));
    host.innerHTML=`<div class="c892-quick">${sorted.map(h=>`<article class="c892-qcard"><div class="c892-qhead"><span class="c892-no">${esc(hNo(h))}</span><div class="c892-qname">${esc(hMark(h))} ${esc(hName(h))}</div><span class="c892-score">総合 ${hOverall(h)==null?'—':Math.round(hOverall(h))}</span></div><div class="c892-qstats"><div><small>AI勝率</small><b>${hWin(h)==null?'—':hWin(h).toFixed(1)+'%'}</b></div><div><small>複勝率</small><b>${hPlace(h)==null?'—':hPlace(h).toFixed(1)+'%'}</b></div><div><small>TIME</small><b>${esc(hTime(h)||'—')}</b></div><div><small>期待</small><b>${hEv(h)==null?'—':Math.round(hEv(h))+'%'}</b></div></div><div class="c892-market"><span>実オッズ ${hOdds(h)==null?'—':hOdds(h)+'倍'}</span><span>${hPop(h)==null?'人気 —':hPop(h)+'人気'}</span></div></article>`).join('')}</div>`;
  }

  function syncHorseDetails(){
    const map=new Map(horses().map(h=>[hNo(h),h]));
    qsa('.horse-row').forEach(row=>{
      const no=String(row.querySelector('.horse-no')?.textContent||row.querySelector('.horse-no')?.value||'').trim();const h=map.get(no);if(!h)return;
      const sub=row.querySelector('.horse-sub');if(sub){const old=String(sub.textContent||'').split('｜').map(x=>x.trim()).filter(Boolean);const style=old.find(x=>!/(人気|倍)$/.test(x)&&x!=='不明')||'';sub.textContent=[style,hPop(h)!=null?`${hPop(h)}人気`:'人気—',hOdds(h)!=null?`${hOdds(h)}倍`:'オッズ—'].filter(Boolean).join('｜')}
      const name=row.querySelector('.horse-mark-name');if(name)name.textContent=`${hMark(h)} ${hName(h)}`.trim();
    });
  }

  function allRaces(limit){let rs=Object.values(loadDb()).filter(r=>resultOrder(r).length>=3);rs.sort((a,b)=>String(b.result?.at||b.updatedAt||'').localeCompare(String(a.result?.at||a.updatedAt||'')));return limit?rs.slice(0,limit):rs}
  function modelTop(r,key){const hs=Array.isArray(r?.horses)?r.horses:[];const snap=r?.modelSnapshot?.[key]||r?.unifiedSnapshot?.modelSnapshot?.[key];if(snap?.horseNo)return String(snap.horseNo);if(!hs.length)return null;if(key==='win')return hNo([...hs].sort((a,b)=>(hWin(b)??-1)-(hWin(a)??-1))[0]);if(key==='overall')return hNo([...hs].sort((a,b)=>(hOverall(b)??-1)-(hOverall(a)??-1))[0]);if(key==='value')return hNo([...hs].sort((a,b)=>(hEv(b)??-1)-(hEv(a)??-1))[0]);return hNo(hs.find(h=>hMark(h).includes('◎'))||[...hs].sort((a,b)=>(hWin(b)??-1)-(hWin(a)??-1))[0])}
  function calc(limit=0){
    const rs=allRaces(limit),s={races:rs.length,atLeast1:0,all3:0,captured:0,marks:{},diamond:{n:0,p:0,pop:[],odds:[]},warn:{n:0,out:0},winAE:[],plAE:[],winBrier:[],plBrier:[],time:[],models:{win:{n:0,w:0,p:0},overall:{n:0,w:0,p:0},value:{n:0,w:0,p:0},final:{n:0,w:0,p:0}}};['◎','○','▲','△','☆'].forEach(k=>s.marks[k]={n:0,w:0,p:0});
    for(const r of rs){const hs=Array.isArray(r.horses)?r.horses:[],actual=new Set(resultOrder(r));const preds=hs.filter(h=>/[◎○▲]/.test(hMark(h))).slice(0,3).map(h=>hNo(h));const hits=preds.filter(x=>actual.has(String(x))).length;s.captured+=hits;if(hits>=1)s.atLeast1++;if(preds.length===3&&hits===3)s.all3++;
      for(const h of hs){const p=pos(r,h),m=hMark(h),wp=hWin(h),pp=hPlace(h);for(const k of Object.keys(s.marks))if(m.includes(k)){const z=s.marks[k];z.n++;if(p===1)z.w++;if(p&&p<=3)z.p++}
        const pop=hPop(h),ev=hEv(h),diamond=m.includes('💎')||(pop!=null&&ev!=null&&pop>=5&&(pp??0)>=20&&ev>=112);if(diamond){s.diamond.n++;if(p&&p<=3)s.diamond.p++;if(pop!=null)s.diamond.pop.push(pop);if(hOdds(h)!=null)s.diamond.odds.push(hOdds(h))}
        const warning=m.includes('⚠')||(pop!=null&&pop<=3&&ev!=null&&ev<82);if(warning){s.warn.n++;if(!p||p>3)s.warn.out++}
        if(wp!=null){const y=p===1?1:0,q=clamp(wp)/100;s.winAE.push(Math.abs(y*100-wp));s.winBrier.push((q-y)**2)}if(pp!=null){const y=p&&p<=3?1:0,q=clamp(pp)/100;s.plAE.push(Math.abs(y*100-pp));s.plBrier.push((q-y)**2)}const pt=timeSec(hTime(h)),at=timeSec(actualTime(r,h));if(pt!=null&&at!=null)s.time.push(Math.abs(at-pt));
      }
      for(const k of Object.keys(s.models)){const no=modelTop(r,k);if(!no)continue;const h=hs.find(x=>hNo(x)===no);if(!h)continue;const p=pos(r,h),z=s.models[k];z.n++;if(p===1)z.w++;if(p&&p<=3)z.p++}
    }return s;
  }
  let currentLimit=0;
  function ensureValidation(){
    const dash=$('dashboardView');if(!dash)return null;let sec=$('chass892Validation');if(sec)return sec;const host=qsa('section.card',dash).find(x=>/予想検証ダッシュボード/.test(x.textContent||''))||dash;sec=document.createElement('div');sec.id='chass892Validation';const races=$('dashRaces');if(races&&races.parentNode===host)host.insertBefore(sec,races);else host.appendChild(sec);return sec;
  }
  function renderValidation(){
    const sec=ensureValidation();if(!sec)return;const s=calc(currentLimit),modelNames={win:'勝率',overall:'総合',value:'期待値',final:'FINAL'};const avgCaptured=s.races?s.captured/s.races:null;
    sec.innerHTML=`<div class="c892-head"><div><small>VALIDATION 8.9.2</small><h3>検証精度・フィードバック</h3></div><span class="c892-note">定義を分離して誤解を防止</span></div><div class="c892-window"><button data-l="0" class="${currentLimit===0?'active':''}">全期間</button><button data-l="50" class="${currentLimit===50?'active':''}">最新50R</button><button data-l="100" class="${currentLimit===100?'active':''}">最新100R</button></div><div class="c892-note">対象 ${s.races}R。◎○▲について「1頭以上捕捉」「3頭完全捕捉」「平均捕捉頭数」を別々に表示します。</div><div class="c892-grid" style="margin-top:10px"><div class="c892-card"><span>◎○▲ 1頭以上捕捉率</span><strong>${pct(s.atLeast1,s.races)}</strong><small>${s.races}R中 ${s.atLeast1}R</small></div><div class="c892-card"><span>◎○▲ 3頭完全捕捉率</span><strong>${pct(s.all3,s.races)}</strong><small>着順不問で3頭すべて3着内</small></div><div class="c892-card"><span>平均捕捉頭数</span><strong>${avgCaptured==null?'—':avgCaptured.toFixed(2)+'頭'}</strong><small>1Rあたり最大3頭</small></div><div class="c892-card"><span>💎 穴馬 複勝率</span><strong>${pct(s.diamond.p,s.diamond.n)}</strong><small>${s.diamond.n}頭中 ${s.diamond.p}頭</small></div><div class="c892-card"><span>💎 平均人気 / 単勝</span><strong>${avg(s.diamond.pop)==null?'—':avg(s.diamond.pop).toFixed(1)+'人気'}</strong><small>${avg(s.diamond.odds)==null?'実オッズ不足':'平均 '+avg(s.diamond.odds).toFixed(1)+'倍'}</small></div><div class="c892-card"><span>⚠️ 人気馬 圏外率</span><strong>${pct(s.warn.out,s.warn.n)}</strong><small>${s.warn.n}頭中 ${s.warn.out}頭</small></div><div class="c892-card"><span>AI勝率 MAE / Brier</span><strong>${avg(s.winAE)==null?'—':avg(s.winAE).toFixed(1)+'pt'}</strong><small>Brier ${avg(s.winBrier)==null?'—':avg(s.winBrier).toFixed(3)}（小さいほど良）</small></div><div class="c892-card"><span>AI複勝率 MAE / Brier</span><strong>${avg(s.plAE)==null?'—':avg(s.plAE).toFixed(1)+'pt'}</strong><small>Brier ${avg(s.plBrier)==null?'—':avg(s.plBrier).toFixed(3)}（小さいほど良）</small></div><div class="c892-card c892-wide"><span>予想TIME 平均絶対誤差</span><strong>${avg(s.time)==null?'—':avg(s.time).toFixed(2)+'秒'}</strong><small>実走TIMEを取得・保存できた馬のみ</small></div></div><div class="c892-title">モデル別成績</div><div class="c892-table">${Object.entries(s.models).map(([k,v])=>`<div class="c892-row"><b>${modelNames[k]}</b><span>対象 ${v.n}</span><span>勝 ${pct(v.w,v.n)}</span><span>複 ${pct(v.p,v.n)}</span></div>`).join('')}</div><div class="c892-title">印別成績</div><div class="c892-table">${Object.entries(s.marks).map(([k,v])=>`<div class="c892-row"><b>${k}</b><span>対象 ${v.n}</span><span>勝 ${pct(v.w,v.n)}</span><span>複 ${pct(v.p,v.n)}</span></div>`).join('')}</div>`;
    qsa('.c892-window button',sec).forEach(b=>b.addEventListener('click',()=>{currentLimit=Number(b.dataset.l||0);renderValidation()}));
  }

  function captureNar(data){
    if(!data||typeof data!=='object')return;const k=rid();if(!k)return;const db=loadDb(),r=db[k];if(!r)return;
    const times=data.actualTimes||data.result?.actualTimes||{};if(times&&Object.keys(times).length){r.actualTimes={...(r.actualTimes||{}),...times};r.result={...(r.result||{}),actualTimes:{...(r.result?.actualTimes||{}),...times}}}
    if(Array.isArray(data.odds)&&data.odds.length){const map=new Map(data.odds.map(x=>[String(x.horseNo??x.no??''),num(x.winOdds??x.odds)]));r.horses=(r.horses||[]).map(h=>{const o=map.get(hNo(h));return o!=null?{...h,odds:o,realOdds:o}:h})}
    db[k]=r;saveDb(db);
  }
  function wrapFetch(){
    if(window.fetch.__chass892)return;const native=window.fetch.bind(window);const wrapped=async(...args)=>{const res=await native(...args);try{const url=String(args[0]?.url||args[0]||'');if(/\/api\/nar\/(sync|odds)/.test(url)){res.clone().json().then(d=>{captureNar(d);setTimeout(refresh,80)}).catch(()=>{})}}catch{}return res};wrapped.__chass892=true;wrapped.__native=native;window.fetch=wrapped;
  }
  async function recoverActualTimes(){
    const r=savedRace();if(!r||resultOrder(r).length<3)return;const existing=r.actualTimes||r.result?.actualTimes||{};if(Object.keys(existing).length)return;const code={'帯広':3,'門別':36,'盛岡':10,'水沢':11,'浦和':18,'船橋':19,'大井':20,'川崎':21,'笠松':22,'金沢':23,'名古屋':24,'園田':27,'姫路':28,'高知':31,'佐賀':32}[String($('track')?.value||'')];const date=$('raceDate')?.value,race=String($('raceNo')?.value||'').match(/\d+/)?.[0];if(!code||!date||!race)return;try{await fetch(`/api/nar/sync?code=${code}&date=${encodeURIComponent(date)}&race=${encodeURIComponent(race)}`,{cache:'no-store',headers:{accept:'application/json'}})}catch{}
  }
  function refresh(){setVersion();renderQuick();syncHorseDetails();renderValidation()}
  function boot(){injectCss();setVersion();wrapFetch();refresh();const mo=new MutationObserver(()=>{clearTimeout(mo.__t);mo.__t=setTimeout(refresh,80)});['quickList','quickCompare','horseList','dashboardView'].forEach(id=>{const el=$(id);if(el)mo.observe(el,{childList:true,subtree:true})});document.addEventListener('click',e=>{const t=(e.target?.closest?.('button,label')?.textContent||'').replace(/\s+/g,' ');if(/現在オッズ|結果・最終オッズ|結果を保存|再集計|予想入力|検証ダッシュボード/.test(t))setTimeout(refresh,750)},true);setTimeout(recoverActualTimes,1200);setInterval(()=>{setVersion();syncHorseDetails()},3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

/* CHASS KEIBA LAB Ver.8.9.3 - VALIDATION CORRECTNESS / DASHBOARD CONSOLIDATION */
(() => {
  'use strict';
  const VERSION='8.9.3', DB_KEY='chass_v80_races';
  const $=id=>document.getElementById(id);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
  const pct=(a,b)=>b?((a/b)*100).toFixed(1)+'%':'—';
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const hNo=h=>String(h?.horseNo??h?.['horse-no']??h?.no??'').trim();
  const hName=h=>String(h?.horseName??h?.['horse-name']??h?.name??'').trim();
  const hMark=h=>String(h?.mark??'').trim();
  const hWin=h=>num(h?.win??h?.winRate??h?.aiWin);
  const hPlace=h=>num(h?.place??h?.placeRate??h?.aiPlace);
  const hOverall=h=>num(h?.overall??h?.score??h?.aiOverall);
  const hOdds=h=>num(h?.odds??h?.realOdds??h?.currentOdds);
  const hPop=h=>num(h?.popularity??h?.pop);
  const hTime=h=>String(h?.predictedTime??h?.time??'');
  const hEv=h=>{const x=num(h?.ev??h?.expectedReturn??h?.expectedValue);if(x!=null&&x>10)return x;const w=hWin(h),o=hOdds(h);return w!=null&&o!=null?w*o:null};
  const timeSec=v=>{if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;const s=String(v).trim();if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);const m=s.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);return m?Number(m[1])*60+Number(m[2]):null};
  function setVersion(){document.title=document.title.replace(/Ver\.\d+(?:\.\d+){0,2}/gi,`Ver.${VERSION}`);qsa('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./i.test(el.textContent||''))el.textContent=`Ver.${VERSION}`})}
  function loadDb(){try{const v=JSON.parse(localStorage.getItem(DB_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch{return {}}}
  function resultOrder(r){
    const candidates=[r?.result?.finishOrder,r?.result?.order,r?.finishOrder,[r?.result1,r?.result2,r?.result3],[r?.finish1,r?.finish2,r?.finish3]];
    for(const c of candidates){if(Array.isArray(c)){const a=c.slice(0,3).map(x=>String(x||'').trim()).filter(Boolean);if(a.length>=3)return a}}
    return [];
  }
  function horses(r){return Array.isArray(r?.horses)?r.horses:[]}
  function pos(r,h){const o=resultOrder(r),no=hNo(h),name=hName(h);let i=no?o.indexOf(no):-1;if(i<0&&name)i=o.indexOf(name);return i>=0?i+1:null}
  function actualTime(r,h){const m=r?.actualTimes||r?.result?.actualTimes||r?.actualTimeByHorse||{};return m?.[hNo(h)]??h?.actualTime??''}
  function normalizeSnapshotHorse(x){if(!x)return null;return {horseNo:String(x.horseNo??x['horse-no']??x.no??'').trim(),horseName:String(x.horseName??x['horse-name']??x.name??'').trim(),mark:String(x.mark??x.label??'').trim()}}
  function finalTop3(r){
    const fs=r?.finalSnapshot?.top3||r?.unifiedSnapshot?.finalSnapshot?.top3;
    if(Array.isArray(fs)&&fs.length){const a=fs.map(normalizeSnapshotHorse).filter(x=>x?.horseNo||x?.horseName).slice(0,3);if(a.length)return a}
    const hs=horses(r);
    const byExplicit=['◎','○','▲'].map(m=>hs.find(h=>hMark(h).includes(m))).filter(Boolean).map(normalizeSnapshotHorse);
    if(byExplicit.length)return byExplicit.slice(0,3);
    return [...hs].sort((a,b)=>(hWin(b)??-1)-(hWin(a)??-1)).slice(0,3).map(normalizeSnapshotHorse);
  }
  function modelTop(r,key){
    const ms=r?.modelSnapshot||r?.unifiedSnapshot?.modelSnapshot||{};
    const keyMap={win:'winModelTop',overall:'overallModelTop',value:'valueModelTop',final:'finalModelTop'};
    const snap=ms[keyMap[key]]||ms[key];
    if(snap?.horseNo||snap?.horseName)return normalizeSnapshotHorse(snap);
    if(key==='final')return finalTop3(r)[0]||null;
    const hs=horses(r);if(!hs.length)return null;
    const getter=key==='win'?hWin:key==='overall'?hOverall:hEv;
    return normalizeSnapshotHorse([...hs].sort((a,b)=>(getter(b)??-1)-(getter(a)??-1))[0]);
  }
  function findHorse(r,ref){if(!ref)return null;return horses(r).find(h=>(ref.horseNo&&hNo(h)===ref.horseNo)||(ref.horseName&&hName(h)===ref.horseName))||null}
  function calc(limit=0){
    let rs=Object.values(loadDb()).filter(r=>resultOrder(r).length>=3);
    rs.sort((a,b)=>String(b?.result?.at||b?.resultUpdatedAt||b?.updatedAt||'').localeCompare(String(a?.result?.at||a?.resultUpdatedAt||a?.updatedAt||'')));
    if(limit)rs=rs.slice(0,limit);
    const s={races:rs.length,atLeast1:0,all3:0,captured:0,marks:{},diamond:{n:0,p:0,pop:[],odds:[]},warn:{n:0,out:0},winAE:[],plAE:[],winBrier:[],plBrier:[],time:[],models:{win:{n:0,w:0,p:0,pos:[]},overall:{n:0,w:0,p:0,pos:[]},value:{n:0,w:0,p:0,pos:[]},final:{n:0,w:0,p:0,pos:[]}}};
    ['◎','○','▲','△','☆'].forEach(k=>s.marks[k]={n:0,w:0,p:0,pos:[]});
    for(const r of rs){
      const hs=horses(r),actual=new Set(resultOrder(r));
      const preds=finalTop3(r);const hits=preds.filter(x=>actual.has(x.horseNo)||actual.has(x.horseName)).length;
      s.captured+=hits;if(hits>=1)s.atLeast1++;if(preds.length===3&&hits===3)s.all3++;
      for(const h of hs){
        const p=pos(r,h),m=hMark(h),wp=hWin(h),pp=hPlace(h);
        for(const k of Object.keys(s.marks))if(m.includes(k)){const z=s.marks[k];z.n++;if(p===1)z.w++;if(p&&p<=3)z.p++;if(p)z.pos.push(p)}
        const pop=hPop(h),ev=hEv(h),diamond=m.includes('💎')||(pop!=null&&ev!=null&&pop>=5&&(pp??0)>=20&&ev>=112);if(diamond){s.diamond.n++;if(p&&p<=3)s.diamond.p++;if(pop!=null)s.diamond.pop.push(pop);if(hOdds(h)!=null)s.diamond.odds.push(hOdds(h))}
        const warning=m.includes('⚠')||(pop!=null&&pop<=3&&ev!=null&&ev<82);if(warning){s.warn.n++;if(!p||p>3)s.warn.out++}
        if(wp!=null){const y=p===1?1:0,q=Math.max(0,Math.min(100,wp))/100;s.winAE.push(Math.abs(y*100-wp));s.winBrier.push((q-y)**2)}
        if(pp!=null){const y=p&&p<=3?1:0,q=Math.max(0,Math.min(100,pp))/100;s.plAE.push(Math.abs(y*100-pp));s.plBrier.push((q-y)**2)}
        const pt=timeSec(hTime(h)),at=timeSec(actualTime(r,h));if(pt!=null&&at!=null)s.time.push(Math.abs(at-pt));
      }
      for(const k of Object.keys(s.models)){const ref=modelTop(r,k),h=findHorse(r,ref);if(!h)continue;const p=pos(r,h),z=s.models[k];z.n++;if(p===1)z.w++;if(p&&p<=3)z.p++;if(p)z.pos.push(p)}
    }
    return s;
  }
  let currentLimit=0;
  function injectCss(){if($('chass893Styles'))return;const st=document.createElement('style');st.id='chass893Styles';st.textContent=`
    #chass892Validation{display:none!important}
    #chass893Validation{margin:18px 0;padding:16px;border:1px solid rgba(97,223,184,.30);border-radius:20px;background:rgba(15,29,49,.68)}
    .c893-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.c893-head small{display:block;color:#61dfb8;font-weight:850;letter-spacing:.14em}.c893-head h3{font-size:1.34rem;margin:4px 0}.c893-note{font-size:.75rem;color:#9cadc7;line-height:1.5}.c893-window{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.c893-window button{border:1px solid rgba(130,160,205,.25);background:transparent;color:#aebbd0;border-radius:999px;padding:8px 11px;font-weight:750}.c893-window button.active{background:#61dfb8;color:#071620;border-color:#61dfb8}
    .c893-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}.c893-card{border:1px solid rgba(130,160,205,.20);border-radius:15px;padding:12px;min-width:0}.c893-card span,.c893-card small,.c893-card strong{display:block}.c893-card span{color:#9cadc7;font-size:.78rem}.c893-card strong{font-size:1.34rem;margin:5px 0}.c893-card small{color:#8fa1bb;font-size:.71rem;line-height:1.4}.c893-wide{grid-column:1/-1}.c893-title{margin:18px 0 8px;font-size:1rem;font-weight:850}.c893-table{display:grid}.c893-row{display:grid;grid-template-columns:minmax(90px,1.3fr) repeat(4,minmax(0,.85fr));gap:7px;border-top:1px solid rgba(130,160,205,.16);padding:10px 4px;align-items:center;font-size:.76rem}.c893-row span{color:#a9b7cc}.c893-ok{color:#61dfb8!important}
    @media(max-width:520px){.c893-grid{grid-template-columns:1fr 1fr}.c893-row{grid-template-columns:1fr 1fr}.c893-row b{grid-column:1/-1}}
  `;document.head.appendChild(st)}
  function ensure(){const dash=$('dashboardView');if(!dash)return null;let sec=$('chass893Validation');if(sec)return sec;sec=document.createElement('section');sec.id='chass893Validation';sec.className='card';const legacy=qsa('section.card',dash).find(x=>/予想検証ダッシュボード/.test(x.textContent||''));if(legacy)legacy.insertAdjacentElement('afterend',sec);else dash.prepend(sec);return sec}
  function render(){const sec=ensure();if(!sec)return;const s=calc(currentLimit),ac=s.races?s.captured/s.races:null;const names={win:'勝率',overall:'総合',value:'期待値',final:'FINAL'};
    sec.innerHTML=`<div class="c893-head"><div><small>VALIDATION 8.9.3</small><h3>検証精度・モデル比較</h3></div><span class="c893-note">予想時点スナップショットを優先</span></div><div class="c893-window"><button data-l="0" class="${currentLimit===0?'active':''}">全期間</button><button data-l="50" class="${currentLimit===50?'active':''}">最新50R</button><button data-l="100" class="${currentLimit===100?'active':''}">最新100R</button></div><div class="c893-note">◎○▲の捕捉は、結果保存後に変化した現在の印ではなく「予想時点の finalSnapshot.top3」を優先して判定します。</div><div class="c893-grid"><div class="c893-card"><span>◎○▲ 1頭以上捕捉率</span><strong>${pct(s.atLeast1,s.races)}</strong><small>${s.races}R中 ${s.atLeast1}R</small></div><div class="c893-card"><span>◎○▲ 3頭完全捕捉率</span><strong>${pct(s.all3,s.races)}</strong><small>着順不問で3頭全て3着内</small></div><div class="c893-card"><span>平均捕捉頭数</span><strong>${ac==null?'—':ac.toFixed(2)+'頭'}</strong><small>1Rあたり最大3頭</small></div><div class="c893-card"><span>💎 穴馬 複勝率</span><strong>${pct(s.diamond.p,s.diamond.n)}</strong><small>${s.diamond.n}頭中 ${s.diamond.p}頭</small></div><div class="c893-card"><span>💎 平均人気 / 単勝</span><strong>${avg(s.diamond.pop)==null?'—':avg(s.diamond.pop).toFixed(1)+'人気'}</strong><small>${avg(s.diamond.odds)==null?'実オッズ不足':'平均 '+avg(s.diamond.odds).toFixed(1)+'倍'}</small></div><div class="c893-card"><span>⚠️ 人気馬 圏外率</span><strong>${pct(s.warn.out,s.warn.n)}</strong><small>${s.warn.n}頭中 ${s.warn.out}頭</small></div><div class="c893-card"><span>AI勝率 MAE / Brier</span><strong>${avg(s.winAE)==null?'—':avg(s.winAE).toFixed(1)+'pt'}</strong><small>Brier ${avg(s.winBrier)==null?'—':avg(s.winBrier).toFixed(3)}</small></div><div class="c893-card"><span>AI複勝率 MAE / Brier</span><strong>${avg(s.plAE)==null?'—':avg(s.plAE).toFixed(1)+'pt'}</strong><small>Brier ${avg(s.plBrier)==null?'—':avg(s.plBrier).toFixed(3)}</small></div><div class="c893-card c893-wide"><span>予想TIME 平均絶対誤差</span><strong>${avg(s.time)==null?'—':avg(s.time).toFixed(2)+'秒'}</strong><small>${s.time.length?`${s.time.length}頭分で集計`:'NAR実走TIMEが保存された馬から自動集計'}</small></div></div><div class="c893-title">モデル別成績</div><div class="c893-table">${Object.entries(s.models).map(([k,v])=>`<div class="c893-row"><b>${names[k]}</b><span>対象 ${v.n}</span><span>勝 ${pct(v.w,v.n)}</span><span>複 ${pct(v.p,v.n)}</span><span>平均着 ${avg(v.pos)==null?'—':avg(v.pos).toFixed(2)}</span></div>`).join('')}</div><div class="c893-title">印別成績</div><div class="c893-table">${Object.entries(s.marks).map(([k,v])=>`<div class="c893-row"><b>${esc(k)}</b><span>対象 ${v.n}</span><span>勝 ${pct(v.w,v.n)}</span><span>複 ${pct(v.p,v.n)}</span><span>平均着 ${avg(v.pos)==null?'—':avg(v.pos).toFixed(2)}</span></div>`).join('')}</div>`;
    qsa('.c893-window button',sec).forEach(b=>b.onclick=()=>{currentLimit=Number(b.dataset.l||0);render()});
  }
  function boot(){injectCss();setVersion();render();document.addEventListener('click',e=>{const t=(e.target?.closest?.('button,label')?.textContent||'').replace(/\s+/g,' ');if(/結果|再集計|検証ダッシュボード/.test(t))setTimeout(()=>{setVersion();render()},700)},true);setInterval(()=>{setVersion()},3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
