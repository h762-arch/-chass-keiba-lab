/* CHASS KEIBA LAB Ver.8.5 - VERIFIED LIVE MARKET / FLOW / MOBILE UI */
(() => {
  'use strict';

  const VERSION = '8.5';
  const $ = id => document.getElementById(id);
  const LIVE_KEY_PREFIX = 'chass_live_verified_v85:';
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function setVersion(){
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/gi, `Ver.${VERSION}`);
    qsa('.topbar h1 span, h1 span').forEach(el => {
      if (/Ver\./i.test(el.textContent || '')) el.textContent = `Ver.${VERSION}`;
    });
  }

  function injectStyles(){
    if ($('chass84Styles')) return;
    const st = document.createElement('style');
    st.id = 'chass84Styles';
    st.textContent = `
      :root{--c84-mint:#61dfb8;--c84-card:#111e33;--c84-line:#2b4164;--c84-muted:#9cadc7;--c84-text:#f4f7ff;--c84-warn:#ffc96b}
      body{overflow-x:hidden}.tabs{position:sticky!important;top:0;z-index:50;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
      .race-inline-import{display:none!important}
      .chass84-flow{margin:18px 0 22px;padding:15px;border:1px solid rgba(97,223,184,.30);border-radius:20px;background:rgba(17,30,51,.66)}
      .chass84-flow-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.chass84-flow-title strong{font-size:.98rem}.chass84-flow-title span{font-size:.76rem;color:var(--c84-muted)}
      .chass84-flow-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .chass84-flow-btn,.chass84-import{min-height:62px;border-radius:15px;border:1px solid var(--c84-line);background:#12213a;color:var(--c84-text);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-align:center;font-weight:800;padding:8px;box-sizing:border-box;cursor:pointer}
      .chass84-import{background:var(--c84-mint);color:#071620;border-color:transparent}.chass84-step{font-size:.72rem;opacity:.70;font-weight:700}.chass84-flow-btn strong,.chass84-import strong{font-size:.88rem}.chass84-flow-status{margin-top:10px;padding:10px 12px;border-radius:12px;background:#0f1c30;border:1px solid rgba(130,160,205,.15);font-size:.82rem;color:var(--c84-muted);line-height:1.45}
      .chass84-flow-status.ok{color:#a9f1d9;border-color:rgba(97,223,184,.35)}.chass84-flow-status.warn{color:#ffd998;border-color:rgba(255,201,107,.35)}
      .quick-card .table-wrap{overflow:visible!important}.quick-mobile-list{display:grid!important;gap:11px!important}
      .quick-mobile-row{display:block!important;width:100%!important;box-sizing:border-box!important;padding:14px!important;border-radius:18px!important;border:1px solid var(--c84-line)!important;background:var(--c84-card)!important;overflow:hidden!important}
      .quick-mobile-head{display:grid!important;grid-template-columns:56px minmax(0,1fr) auto!important;grid-template-areas:'no name score' 'no market market'!important;align-items:center!important;column-gap:12px!important;row-gap:4px!important;min-width:0!important}
      .quick-mobile-head .horse-number-badge{grid-area:no!important;width:52px!important;height:52px!important;display:flex!important;align-items:center!important;justify-content:center!important;border-radius:14px!important;font-size:1.25rem!important;border:1px solid rgba(97,223,184,.55)!important;color:var(--c84-mint)!important;background:rgba(97,223,184,.06)!important}
      .quick-name{grid-area:name!important;min-width:0!important;white-space:normal!important;overflow-wrap:anywhere!important;font-size:1.03rem!important;line-height:1.28!important}.quick-score-pill{grid-area:score;padding:6px 9px;border:1px solid var(--c84-line);border-radius:999px;color:var(--c84-text);font-size:.76rem;white-space:nowrap}.quick-marketline{grid-area:market;min-width:0;color:var(--c84-muted);font-size:.78rem;line-height:1.35;white-space:normal!important;overflow-wrap:anywhere!important}
      .quick-mobile-stats{margin-top:12px!important;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important}.quick-mobile-stats>div{min-width:0!important;padding:8px 4px!important;text-align:center!important;border-radius:11px!important;background:rgba(255,255,255,.025)!important}.quick-mobile-stats span{display:block!important;font-size:.65rem!important;color:var(--c84-muted)!important}.quick-mobile-stats strong{display:block!important;margin-top:3px!important;font-size:.88rem!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .quick-mobile-row.value{border-color:rgba(97,223,184,.60)!important}.quick-mobile-row.risk{border-color:rgba(255,201,107,.55)!important}
      .compact-horse-top{display:grid!important;grid-template-columns:82px 70px minmax(0,1fr)!important;gap:8px!important}.compact-horse-top .remove{display:none!important}.horse-name{min-width:0!important;width:100%!important}.horse-compact-summary{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important}.horse-compact-summary strong{white-space:nowrap!important;font-size:.93rem!important}
      #chassFinalCard,.chass-final-card{border-color:rgba(97,223,184,.52)!important;background:linear-gradient(180deg,#0f2536,#0e1c31)!important}
      .chass84-model-note{margin-top:10px;padding:9px 11px;border-radius:12px;background:rgba(97,223,184,.05);border:1px solid rgba(97,223,184,.18);color:var(--c84-muted);font-size:.78rem;line-height:1.45}
      .chass84-result-anchor{margin-top:22px}.chass84-result-anchor details{display:block!important}
      #chass84ResultJump{position:fixed;right:16px;bottom:22px;z-index:80;width:50px;height:50px;border-radius:50%;border:1px solid rgba(97,223,184,.5);background:#10243a;color:var(--c84-mint);font-size:1.15rem;box-shadow:0 10px 30px rgba(0,0,0,.32)}
      @media(max-width:760px){.chass84-flow-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:680px){.wrap{padding-left:14px!important;padding-right:14px!important}.card{border-radius:20px!important}}
      @media(max-width:430px){.quick-mobile-head{grid-template-columns:54px minmax(0,1fr) auto!important}.quick-mobile-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}.compact-horse-top{grid-template-columns:72px 64px minmax(0,1fr)!important}.horse-compact-summary{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
    `;
    document.head.appendChild(st);
  }

  function setFlowStatus(text, kind=''){
    const el = $('chass84FlowStatus'); if (!el) return;
    el.textContent = text;
    el.className = 'chass84-flow-status' + (kind ? ' ' + kind : '');
  }

  function findResultSection(){
    const btn = $('fetchOfficialResult') || $('narSync');
    return btn?.closest('section.card') || qsa('section.card').find(s => /レース後検証/.test(s.textContent || '')) || null;
  }

  function ensureFlow(){
    if ($('chass84Flow')) return;
    const prediction = $('predictionView'); if (!prediction) return;
    const race = document.querySelector('.race-overview-card');
    const sec = document.createElement('section');
    sec.id = 'chass84Flow'; sec.className = 'chass84-flow';
    sec.innerHTML = `
      <div class="chass84-flow-title"><strong>予想フロー</strong><span>読込 → 市場 → 結果 → 検証</span></div>
      <div class="chass84-flow-grid">
        <label class="chass84-import" for="raceImportFile"><span class="chass84-step">STEP 1</span><strong>📄 データ読込</strong></label>
        <button id="chass84OddsBtn" class="chass84-flow-btn" type="button"><span class="chass84-step">STEP 2</span><strong>📡 現在オッズ</strong></button>
        <button id="chass84ResultBtn" class="chass84-flow-btn" type="button"><span class="chass84-step">STEP 3</span><strong>🏁 レース結果</strong></button>
        <button id="chass84DashBtn" class="chass84-flow-btn" type="button"><span class="chass84-step">STEP 4</span><strong>📊 検証</strong></button>
      </div>
      <div id="chass84FlowStatus" class="chass84-flow-status">JSON / CSVを選択すると自動分析します。</div>`;
    if (race) race.insertAdjacentElement('beforebegin', sec); else prediction.prepend(sec);

    $('chass84OddsBtn')?.addEventListener('click', () => syncCurrentOdds84(false));
    $('chass84ResultBtn')?.addEventListener('click', () => {
      const result = findResultSection();
      const fetchBtn = $('fetchOfficialResult') || $('narSync');
      if (fetchBtn) fetchBtn.click();
      if (result) setTimeout(()=>result.scrollIntoView({behavior:'smooth', block:'start'}),80);
    });
    $('chass84DashBtn')?.addEventListener('click', () => {
      const btn = qsa('.tab').find(x => x.dataset.view === 'dashboardView');
      if (btn) btn.click(); else if (typeof window.showView === 'function') window.showView('dashboardView');
    });
    $('raceImportFile')?.addEventListener('change', () => {
      const f = $('raceImportFile')?.files?.[0]; if (f) setFlowStatus(`${f.name} を読み込み中…`);
      setTimeout(syncImportStatus, 350); setTimeout(syncImportStatus, 1300);
    });
  }

  function syncImportStatus(){
    const src = $('importStatus');
    if (src?.textContent?.trim()) setFlowStatus(src.textContent.trim(), /✓|完了|正常/.test(src.textContent) ? 'ok' : '');
  }

  function getRaceInfo(){
    const track = String($('track')?.value || window.state?.race?.track || '').trim();
    const date = String($('raceDate')?.value || window.state?.race?.raceDate || '').trim();
    const race = String($('raceNo')?.value || window.state?.race?.raceNo || '').trim();
    return {track,date,race};
  }
  function narCode(track){
    const map = {'帯広':3,'門別':36,'盛岡':10,'水沢':11,'浦和':18,'船橋':19,'大井':20,'川崎':21,'金沢':23,'笠松':22,'名古屋':24,'園田':27,'姫路':28,'高知':31,'佐賀':32};
    try { if (typeof window.narTrackCode === 'function') return window.narTrackCode(track); } catch {}
    return map[track] || null;
  }

  function raceKey85(){
    const {track,date,race}=getRaceInfo();
    return `${date}|${track}|${race}`;
  }
  function liveKey85(){ return LIVE_KEY_PREFIX + raceKey85(); }
  function markLiveVerified85(meta={}){
    try{
      sessionStorage.setItem(liveKey85(), JSON.stringify({
        verified:true,
        at:meta.acquiredAt || new Date().toISOString(),
        count:meta.count || 0,
        source:meta.source || 'NAR'
      }));
    }catch{}
  }
  function getLiveVerified85(){
    try{
      const v=JSON.parse(sessionStorage.getItem(liveKey85())||'null');
      return v?.verified ? v : null;
    }catch{return null;}
  }
  function clearLiveVerified85(){ try{ sessionStorage.removeItem(liveKey85()); }catch{} }

  function applyOddsToLegacyRows(items, acquiredAt){
    const valid = (items || []).map(x => ({no:String(x.horseNo ?? x.no ?? ''), odds:num(x.odds)})).filter(x => x.no && x.odds != null);
    if (!valid.length) return 0;
    const pop = [...valid].sort((a,b) => a.odds-b.odds); const popMap = new Map(pop.map((x,i)=>[x.no,i+1]));
    const oddsMap = new Map(valid.map(x => [x.no,x.odds]));
    let count = 0;
    qsa('.horse-row').forEach((row,i) => {
      let no = String(row.querySelector('.horse-no')?.value || i+1);
      try { const h = typeof window.horseFromRow === 'function' ? window.horseFromRow(row) : null; if (h?.['horse-no']) no=String(h['horse-no']); } catch {}
      const o = oddsMap.get(no); if (o == null) return;
      const oe = row.querySelector('.odds'); if (oe) oe.value = String(o);
      const pe = row.querySelector('.pop'); if (pe) pe.value = String(popMap.get(no) || '');
      count++;
    });
    const t = $('oddsType'); if (t) t.value='実オッズ';
    const d = $('oddsTypeDisplay'); if (d) d.textContent='実オッズ';
    const at = $('oddsCheckedAt'); if (at) at.value = acquiredAt || new Date().toISOString();
    try { if (typeof window.renderValueRanking === 'function') window.renderValueRanking(); } catch {}
    try { if (typeof window.renderAllAiBreakdowns === 'function') window.renderAllAiBreakdowns(); } catch {}
    try { if (typeof window.saveCurrentSilent === 'function') window.saveCurrentSilent(); } catch {}
    return count;
  }

  async function syncCurrentOdds84(silent=false){
    setFlowStatus('NAR公式の現在オッズを確認中…');
    try {
      if (typeof window.syncLiveOdds === 'function') {
        const out = await window.syncLiveOdds(silent);
        const hs=currentRows(), count=hs.filter(h=>h.odds!=null).length;
        if(!count) throw new Error('現在オッズを確認できません');
        markLiveVerified85({count,source:'NAR-live'});
        setTimeout(() => { renderQuick84(); syncMarketStatus84(); }, 30);
        setFlowStatus(`現在オッズ ${count}頭を確認。人気・期待値・最終判断を再計算しました。`,'ok');
        return out ?? true;
      }
      if ($('liveOddsSync')) {
        $('liveOddsSync').click();
        setFlowStatus('現在オッズ取得を実行しました。反映を確認中…');
        setTimeout(() => { const count=currentRows().filter(h=>h.odds!=null).length; if(count){markLiveVerified85({count,source:'NAR-live-button'});} renderQuick84(); syncMarketStatus84(); setFlowStatus(count?`現在オッズ ${count}頭を確認しました。`:'現在オッズの反映待ちです。',count?'ok':'warn'); }, 700);
        return true;
      }
      const {track,date,race} = getRaceInfo(), code = narCode(track);
      if (!code || !date || !race) throw new Error('競馬場・日付・Rを確認してください');
      const res = await fetch(`/api/nar/odds?code=${encodeURIComponent(code)}&date=${encodeURIComponent(date)}&race=${encodeURIComponent(race)}`, {cache:'no-store', headers:{accept:'application/json'}});
      const data = await res.json(); if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      let count = 0;
      if (typeof window.applyMarketOdds === 'function') count = window.applyMarketOdds(data.odds || [], data.acquiredAt) || 0;
      else if (typeof window.applyOfficialOdds === 'function') count = window.applyOfficialOdds({...data, odds:data.odds || [], oddsType:'実オッズ', checkedAt:data.acquiredAt}) || 0;
      if (!count) count = applyOddsToLegacyRows(data.odds || [], data.acquiredAt);
      if (!count) throw new Error('現在オッズを確認できません（発売前・未掲載の可能性）');
      markLiveVerified85({count,acquiredAt:data.acquiredAt,source:'NAR-api'});
      renderQuick84(); syncMarketStatus84();
      setFlowStatus(`NAR公式 現在オッズ ${count}頭反映。人気・期待値・最終判断を更新しました。`,'ok');
      return true;
    } catch(e) {
      setFlowStatus(`現在オッズ取得失敗：${String(e?.message || e)}`,'warn');
      return false;
    }
  }
  window.chassSyncCurrentOdds = syncCurrentOdds84;

  function currentRows(){
    const domRows=qsa('.horse-row');
    const domMap=new Map();
    domRows.forEach((r,i)=>{
      let h=null; try{ h=typeof window.horseFromRow==='function'?window.horseFromRow(r):null; }catch{}
      const no=String(h?.['horse-no'] ?? r.querySelector('.horse-no')?.value ?? i+1);
      domMap.set(no,{
        no,
        name:String(h?.['horse-name'] ?? r.querySelector('.horse-name')?.value ?? '').trim(),
        mark:String(h?.mark ?? r.querySelector('.mark')?.value ?? ''),
        win:num(h?.win ?? r.querySelector('.win')?.value),
        place:num(h?.place ?? r.querySelector('.place')?.value),
        time:String(h?.time ?? r.querySelector('.time')?.value ?? ''),
        odds:num(h?.odds ?? r.querySelector('.odds')?.value),
        pop:num(h?.pop ?? r.querySelector('.pop')?.value),
        overall:null
      });
    });
    if (window.state?.horses?.length) {
      return window.state.horses.map((h,i)=>{
        const no=String(h.horseNo ?? h['horse-no'] ?? i+1), d=domMap.get(no)||{};
        return {
          no,
          name:String(h.horseName ?? h['horse-name'] ?? d.name ?? ''),
          mark:String(h.mark ?? d.mark ?? ''),
          win:num(h.win ?? d.win), place:num(h.place ?? d.place),
          time:String(h.predictedTime ?? h.time ?? d.time ?? ''),
          overall:num(h.overall ?? d.overall),
          // DOM values win here because live odds are often written into legacy rows first.
          odds:d.odds ?? num(h.odds), pop:d.pop ?? num(h.popularity ?? h.pop)
        };
      }).filter(h=>h.name);
    }
    return [...domMap.values()].filter(h=>h.name).map(h=>{
      if(h.overall==null){
        try{
          const row=domRows.find((r,i)=>String(r.querySelector('.horse-no')?.value||i+1)===h.no);
          if(row && typeof window.aiBreakdown==='function'){
            const x=typeof window.horseFromRow==='function'?window.horseFromRow(row):null;
            const hs=domRows.map(rr=>typeof window.horseFromRow==='function'?window.horseFromRow(rr):{});
            h.overall=num(window.aiBreakdown(x,hs)?.overall);
          }
        }catch{}
      }
      return h;
    });
  }

  function marketIsReal(){
    // Ver.8.5: only a successful NAR live fetch is treated as "current real odds".
    // Imported odds may still be used by the legacy model, but are not labelled as LIVE.
    return !!getLiveVerified85();
  }

  function renderQuick84(){
    const el=$('quickCompare'); if(!el)return;
    const hs=currentRows(); if(!hs.length)return;
    const real=marketIsReal();
    const sorted=[...hs].sort((a,b)=>(b.win??-1)-(a.win??-1));
    el.innerHTML=`<div class="quick-mobile-list">${sorted.map(h=>{
      const fair=h.win&&h.win>0?100/h.win:null, ev=real&&h.odds&&h.win!=null?h.win*h.odds:null;
      const value=ev!=null && ev>=110 && (h.pop??99)>=4, risk=ev!=null && ev<82 && (h.pop??99)<=3;
      const mkt=real&&h.odds?`実 ${h.odds.toFixed(1)}倍${h.pop?` / ${h.pop}人気`:''}`:'実オッズ —';
      const marketLine=`${mkt}${ev!=null?` ｜ 期待 ${ev.toFixed(0)}%`:fair?` ｜ AIフェア ${fair.toFixed(1)}倍`:''}`;
      return `<article class="quick-mobile-row ${value?'value':risk?'risk':''}"><div class="quick-mobile-head"><strong class="horse-number-badge">${esc(h.no)}</strong><strong class="quick-name">${esc((h.mark?h.mark+' ':'')+h.name)}</strong><span class="quick-score-pill">総合 ${h.overall==null?'—':Math.round(h.overall)}</span><span class="quick-marketline">${esc(marketLine)}</span></div><div class="quick-mobile-stats"><div><span>AI勝率</span><strong>${h.win==null?'—':h.win.toFixed(1)+'%'}</strong></div><div><span>複勝率</span><strong>${h.place==null?'—':h.place.toFixed(1)+'%'}</strong></div><div><span>TIME</span><strong>${esc(h.time||'—')}</strong></div><div><span>期待値</span><strong>${ev==null?'—':ev.toFixed(0)+'%'}</strong></div></div></article>`;
    }).join('')}</div>`;
  }

  function syncMarketStatus84(){
    const live=getLiveVerified85(), real=!!live, hs=currentRows(), priced=hs.filter(h=>h.odds!=null).length;
    const badge=$('marketStatus');
    if (badge) badge.textContent=real?`実オッズ ${priced}頭`:'未取得';
    const quick=$('quickMarketStatus');
    if (quick) quick.textContent=real?`市場データ：NAR現在オッズ ${priced}頭反映済`:'市場データ：現在オッズ未取得';
    // Do not overwrite CHASS FINAL as market-reflected unless LIVE verification succeeded.
    const finalStatus=$('chassFinalStatus');
    if(finalStatus) finalStatus.textContent=real?'現在市場反映済':'AI評価';
    const liveBadge=qsa('.card').find(x=>/現在オッズ/.test(x.querySelector('h2')?.textContent||''))?.querySelector('.badge');
    if(liveBadge) liveBadge.textContent=real?`取得済 ${priced}頭`:'未取得';
  }

  function annotateFinal(){
    const card=$('chassFinalCard') || document.querySelector('.chass-final-card'); if(!card)return;
    if (!$('chass84ModelNote')) {
      const note=document.createElement('div'); note.id='chass84ModelNote'; note.className='chass84-model-note';
      note.textContent='印は「総合点の順位」ではなく、AI勝率・複勝率・展開適性・市場期待値・信頼度を分離して統合した最終判断です。総合点が高くても◎とは限りません。';
      card.appendChild(note);
    }
  }

  function makeResultIndependent(){
    const sec=findResultSection(); if(!sec)return;
    sec.classList.add('chass84-result-anchor');
    const details=sec.closest('details.ops-panel, details');
    if(details && details.parentNode && !details.contains(sec)) return;
    if(details && details.parentNode && details !== sec){
      details.insertAdjacentElement('afterend', sec);
      if (!details.querySelector('section.card')) details.hidden=true;
    }
    if(!$('chass84ResultJump')){
      const b=document.createElement('button'); b.id='chass84ResultJump'; b.type='button'; b.title='レース後検証'; b.textContent='✓';
      b.addEventListener('click',()=>sec.scrollIntoView({behavior:'smooth',block:'start'})); document.body.appendChild(b);
    }
  }

  function removeOldActionPanels(){
    ['chass82Actions','chass83Actions'].forEach(id=>$(id)?.remove());
  }

  function annotateDashboardEmpty85(){
    const dash=$('dashboardView'); if(!dash)return;
    const text=dash.textContent||'';
    if(!/検証済み\s*0R|検証済みレース[\s\S]*0R/.test(text))return;
    if($('chass85DashEmptyNote'))return;
    const sec=dash.querySelector('section.card'); if(!sec)return;
    const p=document.createElement('p'); p.id='chass85DashEmptyNote'; p.className='muted';
    p.style.cssText='margin-top:10px;padding:10px 12px;border:1px solid rgba(130,160,205,.18);border-radius:12px;line-height:1.5';
    p.textContent='まだ「結果を保存・再集計」した完了レースがありません。予想データを読み込んだだけでは検証件数には加算しません。';
    sec.appendChild(p);
  }

  function resetLiveOnRaceChange85(){
    let last=raceKey85();
    const check=()=>{const now=raceKey85();if(now!==last){last=now;syncMarketStatus84();renderQuick84();}};
    ['track','raceDate','raceNo'].forEach(id=>$(id)?.addEventListener('change',check));
  }

  function refresh(){ setVersion(); removeOldActionPanels(); ensureFlow(); syncImportStatus(); renderQuick84(); syncMarketStatus84(); annotateFinal(); makeResultIndependent(); annotateDashboardEmpty85(); }

  function hook(name, after){
    const fn=window[name]; if(typeof fn!=='function'||fn.__chass84)return;
    const wrapped=function(...args){ const out=fn.apply(this,args); Promise.resolve(out).finally(()=>setTimeout(after,30)); return out; };
    wrapped.__chass84=true; window[name]=wrapped;
  }
  function installHooks(){
    ['render','renderQuickCompare','renderAllAiBreakdowns','renderValueRanking','applyOfficialOdds','applyMarketOdds','applyOfficialResult','renderDashboard','saveCurrentSilent'].forEach(name=>hook(name,refresh));
  }

  function boot(){
    injectStyles(); setVersion(); removeOldActionPanels(); ensureFlow(); makeResultIndependent(); annotateFinal(); installHooks(); resetLiveOnRaceChange85(); refresh();
    document.addEventListener('input',e=>{if(e.target?.matches?.('.win,.place,.odds,.pop,.time,.horse-name,.horse-no,.mark,#oddsType')){clearTimeout(window.__ch84Input);window.__ch84Input=setTimeout(()=>{renderQuick84();syncMarketStatus84();},80);}});
    document.addEventListener('change',e=>{if(e.target?.matches?.('.win,.place,.odds,.pop,.time,.horse-name,.horse-no,.mark,#oddsType'))setTimeout(()=>{renderQuick84();syncMarketStatus84();},60);});
    const obs=new MutationObserver(()=>{clearTimeout(window.__ch84Mut);window.__ch84Mut=setTimeout(()=>{removeOldActionPanels();ensureFlow();makeResultIndependent();annotateFinal();renderQuick84();syncMarketStatus84();syncImportStatus();},150);});
    obs.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
