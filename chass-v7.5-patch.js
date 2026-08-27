// CHASS KEIBA LAB Ver.7.5 patch
// 目的:
// 1) CHASS FINAL（最終判断）を最上部に追加
// 2) 期待値・穴馬・人気馬リスクを見やすく統合
// 3) AI勝率 / 総合評価 / 期待値モデルを分離して保存・検証
// 4) ダッシュボードで回収率・平均人気・モデル比較を追加
// 5) 既存 Ver.7.4 を壊さず後読みで拡張

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const qsa = (s, root=document) => [...root.querySelectorAll(s)];
  const num = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const clamp = (v, lo=0, hi=100) => Math.max(lo, Math.min(hi, v));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));

  // ----------------------------
  // 0. Version / style
  // ----------------------------
  function setVersion75(){
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/i, 'Ver.7.5');
    const h1 = document.querySelector('.topbar h1');
    if(h1){
      const span = h1.querySelector('span');
      if(span) span.textContent = 'Ver.7.5';
    }
  }

  function injectStyles(){
    if($('chass75Styles')) return;
    const st = document.createElement('style');
    st.id = 'chass75Styles';
    st.textContent = `
      .chass-final-card{border:1px solid rgba(90,229,188,.42);background:linear-gradient(180deg,rgba(16,34,55,.98),rgba(12,27,46,.98));}
      .chass-final-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
      .chass-final-title{font-size:1.55rem;font-weight:800;letter-spacing:.01em}
      .chass-final-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
      .chass-final-pick{border:1px solid rgba(130,160,205,.22);border-radius:16px;padding:14px;background:rgba(255,255,255,.025)}
      .chass-final-pick strong{display:block;font-size:1.05rem;margin-bottom:6px}
      .chass-final-pick small{display:block;opacity:.78;line-height:1.55}
      .chass-final-flags{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
      .chass-final-flag{border-radius:14px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(130,160,205,.18);line-height:1.5}
      .chass-final-flag.diamond{border-color:rgba(92,224,207,.45)}
      .chass-final-flag.warning{border-color:rgba(255,194,88,.45)}
      .chass-final-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .model-tag{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:.78rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
      .chass75-value{font-weight:800}
      .chass75-value.good{color:#61e7bd}
      .chass75-value.hot{color:#7bf0d0}
      .chass75-value.bad{color:#ffc66d}
      .dash-extra-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .dash-extra-card{border:1px solid rgba(130,160,205,.18);border-radius:16px;padding:14px;background:rgba(255,255,255,.025)}
      .dash-extra-card strong{font-size:1.35rem;display:block;margin:5px 0}
      .model-compare-table td,.model-compare-table th{white-space:nowrap}
      @media(max-width:700px){
        .chass-final-grid{grid-template-columns:1fr}
        .chass-final-flags{grid-template-columns:1fr}
        .dash-extra-grid{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(st);
  }

  // ----------------------------
  // 1. Utility: horse snapshot
  // ----------------------------
  function horseRows(){
    return qsa('.horse-row').filter(r => r.querySelector('.horse-name')?.value.trim());
  }

  function currentHorseData(){
    const rows = horseRows();
    const hs = rows.map((r, i) => {
      let h = null;
      try{
        h = typeof horseFromRow === 'function' ? horseFromRow(r) : null;
      }catch{}
      if(!h){
        h = {
          'horse-no': r.querySelector('.horse-no')?.value || String(i+1),
          mark: r.querySelector('.mark')?.value || '',
          'horse-name': r.querySelector('.horse-name')?.value.trim() || '',
          win: r.querySelector('.win')?.value || '',
          place: r.querySelector('.place')?.value || '',
          ev: r.querySelector('.ev')?.value || '',
          odds: r.querySelector('.odds')?.value || '',
          pop: r.querySelector('.pop')?.value || '',
          time: r.querySelector('.time')?.value || ''
        };
      }
      let overall = 50, confidence = 0;
      try{
        if(typeof aiBreakdown === 'function'){
          overall = aiBreakdown(h, rows.map(rr => typeof horseFromRow==='function'?horseFromRow(rr):h))?.overall ?? overall;
        }
      }catch{}
      try{
        if(typeof derivedConfidence === 'function') confidence = derivedConfidence(h);
      }catch{}
      const win = num(h.win), place = num(h.place), odds = num(h.odds), pop = num(h.pop), ev = num(h.ev);
      const fair = win && win > 0 ? 100 / win : null;
      const expected = odds && win !== null ? odds * win : ev;
      return {
        row:r, no:String(h['horse-no']||i+1), name:h['horse-name']||'',
        mark:h.mark||'', win, place, odds, pop, ev: expected,
        fair, time:h.time||'', overall:Number(overall)||50, confidence:Number(confidence)||0
      };
    });
    return hs;
  }

  function abilityRank(hs){
    return [...hs].sort((a,b)=>(b.win??-1)-(a.win??-1));
  }
  function overallRank(hs){
    return [...hs].sort((a,b)=>(b.overall??-1)-(a.overall??-1));
  }
  function valueRank(hs){
    return [...hs].filter(x=>x.ev!==null).sort((a,b)=>(b.ev??-1)-(a.ev??-1));
  }

  function finalScore(x, hs){
    const aRank = abilityRank(hs).findIndex(h=>h===x);
    const oRank = overallRank(hs).findIndex(h=>h===x);
    const vRank = valueRank(hs).findIndex(h=>h===x);
    const n = Math.max(1, hs.length);
    const rankScore = (r, w) => r < 0 ? 0 : ((n-r)/n)*w;
    // 勝率・総合評価・複勝率・期待値・信頼度を分離して統合
    let s = 0;
    s += rankScore(aRank, 34);
    s += rankScore(oRank, 25);
    s += (x.place ?? 0) * 0.16;
    s += (x.confidence ?? 0) * 0.10;
    if(x.ev !== null) s += clamp((x.ev-70)/80*15, -5, 15);
    return s;
  }

  function pickFinal(hs){
    return [...hs].sort((a,b)=>finalScore(b,hs)-finalScore(a,hs));
  }

  function holeCandidates(hs){
    return hs.filter(x=>{
      if(x.ev===null) return false;
      if(x.pop!==null && x.pop>=8 && (x.place??0)>=18 && x.ev>=125) return true;
      if(x.pop!==null && x.pop>=4 && (x.place??0)>=20 && x.ev>=112) return true;
      return false;
    }).sort((a,b)=>(b.ev??0)-(a.ev??0));
  }

  function warningCandidates(hs){
    return hs.filter(x=>{
      if(x.ev===null || x.pop===null || x.pop>3) return false;
      return x.ev < 82;
    }).sort((a,b)=>(a.ev??999)-(b.ev??999));
  }

  // ----------------------------
  // 2. CHASS FINAL
  // ----------------------------
  function ensureFinalCard(){
    let card = $('chassFinalCard');
    if(card) return card;
    const raceCard = document.querySelector('.race-overview-card');
    if(!raceCard) return null;
    card = document.createElement('section');
    card.id = 'chassFinalCard';
    card.className = 'card chass-final-card';
    card.innerHTML = `
      <div class="chass-final-head">
        <div><p class="eyebrow">CHASS FINAL</p><div class="chass-final-title">最終判断</div></div>
        <span class="badge" id="chassFinalStatus">分析待ち</span>
      </div>
      <div id="chassFinalBody"><p class="muted">予想データを読み込むと自動表示します。</p></div>
    `;
    raceCard.insertAdjacentElement('afterend', card);
    return card;
  }

  function renderFinal(){
    const card = ensureFinalCard();
    if(!card) return;
    const body = $('chassFinalBody');
    const status = $('chassFinalStatus');
    const hs = currentHorseData();
    if(!hs.length){
      body.innerHTML = '<p class="muted">予想データを読み込むと自動表示します。</p>';
      if(status) status.textContent = '分析待ち';
      return;
    }

    const picks = pickFinal(hs).slice(0,3);
    const marks = ['◎','○','▲'];
    const diamonds = holeCandidates(hs);
    const warnings = warningCandidates(hs);
    const chaos = num($('chaos')?.value);
    const pace = $('pace')?.value?.trim() || '未設定';

    const cards = picks.map((x,i)=>{
      const ev = x.ev===null ? '市場待ち' : `${x.ev.toFixed(0)}%`;
      const fair = x.fair ? `${x.fair.toFixed(1)}倍` : '—';
      return `<div class="chass-final-pick">
        <strong>${marks[i]} ${esc(x.no)}番 ${esc(x.name)}</strong>
        <small>勝 ${x.win===null?'—':x.win.toFixed(1)+'%'} ｜ 複 ${x.place===null?'—':x.place.toFixed(1)+'%'}<br>
        総合 ${x.overall.toFixed(0)}/100 ｜ 期待 ${ev} ｜ AIフェア ${fair}</small>
      </div>`;
    }).join('');

    const d = diamonds[0];
    const w = warnings[0];
    const diamondText = d
      ? `${(d.pop??99)>=10 && (d.ev??0)>=135 ? '💎💎💎 激推し大穴' : '💎 穴馬'}：${esc(d.no)}番 ${esc(d.name)} ｜ 期待 ${d.ev.toFixed(0)}%${d.pop?` ｜ ${d.pop}人気`:''}`
      : '💎 穴馬：現時点で強い市場乖離なし';
    const warnText = w
      ? `⚠️ 人気馬注意：${esc(w.no)}番 ${esc(w.name)} ｜ 期待 ${w.ev.toFixed(0)}%${w.pop?` ｜ ${w.pop}人気`:''}`
      : '⚠️ 人気馬リスク：強い該当なし';

    body.innerHTML = `
      <div class="chass-final-grid">${cards}</div>
      <div class="chass-final-flags">
        <div class="chass-final-flag diamond">${diamondText}</div>
        <div class="chass-final-flag warning">${warnText}</div>
      </div>
      <div class="chass-final-meta">
        <span class="model-tag">波乱度 ${chaos===null?'—':chaos+'%'}</span>
        <span class="model-tag">展開 ${esc(pace)}</span>
        <span class="model-tag">勝率モデル・総合モデル・期待値モデルを分離</span>
      </div>
    `;
    if(status) status.textContent = hs.some(x=>x.odds) ? '市場反映済' : 'AI評価';
  }

  // ----------------------------
  // 3. 自動印を「最終判断」に合わせる
  // ----------------------------
  function assignFinalMarks(){
    const hs = currentHorseData();
    if(!hs.length) return;
    const picks = pickFinal(hs);
    hs.forEach(x=>{
      const sel = x.row.querySelector('.mark');
      if(sel) sel.value = '';
    });
    ['◎','○','▲'].forEach((m,i)=>{
      const x = picks[i];
      if(x?.row?.querySelector('.mark')) x.row.querySelector('.mark').value = m;
    });
  }

  // ----------------------------
  // 4. 保存時にモデル別順位を記録
  // ----------------------------
  function modelSnapshot(){
    const hs = currentHorseData();
    const top = arr => arr[0] ? {horseNo:arr[0].no,horseName:arr[0].name} : null;
    return {
      savedAt:new Date().toISOString(),
      winModelTop:top(abilityRank(hs)),
      overallModelTop:top(overallRank(hs)),
      valueModelTop:top(valueRank(hs)),
      finalModelTop:top(pickFinal(hs))
    };
  }

  if(typeof getForm === 'function'){
    const oldGetForm = getForm;
    window.getForm = function(){
      const d = oldGetForm();
      d.modelSnapshot = modelSnapshot();
      return d;
    };
  }

  // ----------------------------
  // 5. Dashboard extras
  // ----------------------------
  function raceResults(r){
    return [r.result1,r.result2,r.result3].map(x=>String(x||'').trim()).filter(Boolean);
  }
  function pos(r,h){
    const rs = raceResults(r);
    const no = String(h['horse-no']||'').trim();
    const i = rs.indexOf(no);
    return i>=0 ? i+1 : null;
  }

  function ensureDashboardExtras(){
    const dash = $('dashboardView');
    if(!dash || $('dashValueValidation')) return;

    const sec = document.createElement('section');
    sec.id = 'dashValueValidation';
    sec.className = 'card dash-data-section';
    sec.innerHTML = `
      <div class="section-head"><div><p class="eyebrow">VALUE VALIDATION</p><h2>穴馬・危険馬・回収率</h2></div></div>
      <div id="dashValueValidationBody" class="dash-extra-grid"></div>
    `;
    dash.appendChild(sec);

    const sec2 = document.createElement('section');
    sec2.id = 'dashModelCompare';
    sec2.className = 'card dash-data-section';
    sec2.innerHTML = `
      <div class="section-head"><div><p class="eyebrow">MODEL COMPARISON</p><h2>モデル別トップ評価の成績</h2></div></div>
      <div class="table-wrap"><table class="model-compare-table">
        <thead><tr><th>モデル</th><th>対象</th><th>1着</th><th>3着内</th><th>勝率</th><th>複勝率</th></tr></thead>
        <tbody id="dashModelCompareBody"></tbody>
      </table></div>
    `;
    dash.appendChild(sec2);
  }

  function calcValueStats(all){
    let dN=0,dPlace=0,dWin=0,dPop=0,dPopN=0,dReturn=0;
    let wN=0,wOut=0;
    all.filter(r=>raceResults(r).length).forEach(r=>{
      (r.horses||[]).forEach(h=>{
        const pop=num(h.pop), ev=num(h.ev), odds=num(h.odds), place=num(h.place);
        const p=pos(r,h);
        const isD = (String(h.mark||'').includes('💎')) ||
          (pop!==null && ev!==null && ((pop>=8 && place>=18 && ev>=125)||(pop>=4 && place>=20 && ev>=112)));
        if(isD){
          dN++;
          if(p===1)dWin++;
          if(p&&p<=3)dPlace++;
          if(pop!==null){dPop+=pop;dPopN++;}
          if(p===1 && odds!==null)dReturn += odds*100;
        }
        const isW = String(h.mark||'').includes('⚠️') || (pop!==null&&pop<=3&&ev!==null&&ev<82);
        if(isW){
          wN++;
          if(!p || p>3)wOut++;
        }
      });
    });
    return {
      dN,dWin,dPlace,avgPop:dPopN?dPop/dPopN:null,
      winReturn:dN?dReturn/dN:null,
      wN,wOut
    };
  }

  function modelStats(all, key){
    let n=0,win=0,place=0;
    all.filter(r=>raceResults(r).length).forEach(r=>{
      const snap=r.modelSnapshot?.[key];
      if(!snap?.horseNo)return;
      const h=(r.horses||[]).find(x=>String(x['horse-no'])===String(snap.horseNo));
      if(!h)return;
      n++;
      const p=pos(r,h);
      if(p===1)win++;
      if(p&&p<=3)place++;
    });
    return {n,win,place};
  }

  function pct(a,b){ return b ? (a/b*100).toFixed(1)+'%' : '—'; }

  function renderDashboardExtras(){
    ensureDashboardExtras();
    let all=[];
    try{ all = typeof loadAll === 'function' ? loadAll() : []; }catch{}
    const v=calcValueStats(all);
    const body=$('dashValueValidationBody');
    if(body){
      body.innerHTML = `
        <div class="dash-extra-card"><span>💎 穴馬 指名数</span><strong>${v.dN}頭</strong><small>勝 ${pct(v.dWin,v.dN)} / 複 ${pct(v.dPlace,v.dN)}</small></div>
        <div class="dash-extra-card"><span>💎 平均人気</span><strong>${v.avgPop===null?'—':v.avgPop.toFixed(1)+'人気'}</strong><small>保存データ内の人気</small></div>
        <div class="dash-extra-card"><span>💎 単勝回収率</span><strong>${v.winReturn===null?'—':v.winReturn.toFixed(1)+'%'}</strong><small>単勝オッズ保存済み馬のみ概算</small></div>
        <div class="dash-extra-card"><span>⚠️ 人気馬 圏外率</span><strong>${pct(v.wOut,v.wN)}</strong><small>${v.wN}頭中 ${v.wOut}頭</small></div>
      `;
    }

    const models=[
      ['winModelTop','勝率モデル'],
      ['overallModelTop','総合評価モデル'],
      ['valueModelTop','期待値モデル'],
      ['finalModelTop','CHASS FINAL']
    ];
    const tb=$('dashModelCompareBody');
    if(tb){
      tb.innerHTML=models.map(([k,label])=>{
        const s=modelStats(all,k);
        return `<tr><td><strong>${label}</strong></td><td>${s.n}</td><td>${s.win}</td><td>${s.place}</td><td>${pct(s.win,s.n)}</td><td>${pct(s.place,s.n)}</td></tr>`;
      }).join('');
    }
  }

  // ----------------------------
  // 6. Existing function hooks
  // ----------------------------
  function hook(name, after){
    const fn = window[name];
    if(typeof fn !== 'function') return;
    if(fn.__chass75Hooked) return;
    const wrapped = function(...args){
      const out = fn.apply(this,args);
      try{ after(...args); }catch(e){ console.warn('Ver.7.5 hook',name,e); }
      return out;
    };
    wrapped.__chass75Hooked = true;
    window[name] = wrapped;
  }

  function hookAsync(name, after){
    const fn = window[name];
    if(typeof fn !== 'function') return;
    if(fn.__chass75Hooked) return;
    const wrapped = async function(...args){
      const out = await fn.apply(this,args);
      try{ await after(...args); }catch(e){ console.warn('Ver.7.5 hook',name,e); }
      return out;
    };
    wrapped.__chass75Hooked = true;
    window[name] = wrapped;
  }

  function installHooks(){
    hook('renderAllAiBreakdowns',()=>renderFinal());
    hook('renderValueRanking',()=>renderFinal());
    hook('renderDashboard',()=>renderDashboardExtras());
    hook('saveCurrentSilent',()=>renderDashboardExtras());
    hook('saveCurrent',()=>renderDashboardExtras());

    const oldSim = window.runSimulation;
    if(typeof oldSim==='function' && !oldSim.__chass75Hooked){
      const wrapped=function(...args){
        const ok=oldSim.apply(this,args);
        if(ok){
          try{ assignFinalMarks(); }catch{}
          try{ if(typeof renderValueRanking==='function') renderValueRanking(); }catch{}
          try{ renderFinal(); }catch{}
        }
        return ok;
      };
      wrapped.__chass75Hooked=true;
      window.runSimulation=wrapped;
      const btn=$('runSimulation');
      if(btn) btn.onclick=window.runSimulation;
    }

    const oldApplyOdds = window.applyOfficialOdds;
    if(typeof oldApplyOdds==='function' && !oldApplyOdds.__chass75Hooked){
      const wrapped=function(...args){
        const n=oldApplyOdds.apply(this,args);
        try{
          if(typeof renderValueRanking==='function') renderValueRanking();
          assignFinalMarks();
          renderFinal();
        }catch{}
        return n;
      };
      wrapped.__chass75Hooked=true;
      window.applyOfficialOdds=wrapped;
    }

    hookAsync('fetchOfficialNar',async()=> {
      try{
        if(typeof renderValueRanking==='function') renderValueRanking();
        assignFinalMarks();
        renderFinal();
        renderDashboardExtras();
      }catch{}
    });
  }

  // ----------------------------
  // 7. Mutation observer for imported data
  // ----------------------------
  let t=null;
  function scheduleRefresh(){
    clearTimeout(t);
    t=setTimeout(()=>{
      try{ renderFinal(); }catch{}
      try{ renderDashboardExtras(); }catch{}
    },120);
  }

  function init(){
    setVersion75();
    injectStyles();
    ensureFinalCard();
    installHooks();
    renderFinal();
    ensureDashboardExtras();
    renderDashboardExtras();

    document.addEventListener('input', e=>{
      if(e.target?.matches?.('.win,.place,.odds,.pop,.mark,.horse-name,.horse-no,#chaos,#pace')) scheduleRefresh();
    });
    document.addEventListener('change', e=>{
      if(e.target?.matches?.('.win,.place,.odds,.pop,.mark,.horse-name,.horse-no,#chaos,#pace')) scheduleRefresh();
    });

    const root=$('horseList');
    if(root){
      new MutationObserver(scheduleRefresh).observe(root,{childList:true,subtree:true});
    }

    // タブ切替後にモデル比較を再描画
    qsa('.tab').forEach(btn=>btn.addEventListener('click',()=>setTimeout(renderDashboardExtras,60)));
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init);
  }else{
    init();
  }
})();
