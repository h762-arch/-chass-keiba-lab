/*
 * CHASS KEIBA LAB Ver.8.2 unified latest patch
 * Target: Ver.8.1 style app (app.js + one persistent chass-latest.js include)
 *
 * Main changes
 * 1) Ability / confidence / market value are separated.
 * 2) Real odds are never inferred from horse number or popularity placeholders.
 * 3) Expected return is shown only when oddsType === '実オッズ'.
 * 4) Three TIME scenarios (fit / standard / adverse) are shown as estimates.
 * 5) LIVE MARKET shows update time and odds movement from saved snapshots.
 * 6) Data Integrity is compact when normal and expands only on warnings.
 * 7) CHASS FINAL and Quick View are rebuilt for mobile readability.
 * 8) Existing result validation / dashboard functions are preserved.
 */
(() => {
  'use strict';

  const VERSION = '8.2';
  const MARKET_KEY = 'chass_market_snapshots_v82';
  const PATCH_STYLE_ID = 'chass82Styles';
  const PATCH_CARD_ID = 'chass82FinalCard';
  const MARKET_CARD_ID = 'chass82LiveMarket';
  const INTEGRITY_ID = 'chass82IntegrityBar';
  const $ = id => document.getElementById(id);
  const qsa = (sel, root=document) => [...root.querySelectorAll(sel)];
  const num = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const clamp = (v, lo=0, hi=100) => Math.max(lo, Math.min(hi, v));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));

  function parseTime(s){
    if(s == null || s === '') return null;
    const t = String(s).trim();
    if(/^\d+(?:\.\d+)?$/.test(t)) return parseFloat(t);
    const m = t.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);
    if(!m) return null;
    return parseInt(m[1],10) * 60 + parseFloat(m[2]);
  }
  function formatRaceTime(sec){
    if(!Number.isFinite(sec)) return '—';
    const m = Math.floor(sec/60), s = sec-m*60;
    return m ? `${m}:${s.toFixed(1).padStart(4,'0')}` : `${s.toFixed(1)}秒`;
  }

  function setVersion(){
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/gi, `Ver.${VERSION}`);
    qsa('.topbar h1 span, h1 span').forEach(el => {
      if(/Ver\./i.test(el.textContent || '')) el.textContent = `Ver.${VERSION}`;
    });
  }

  function injectStyles(){
    if($(PATCH_STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = PATCH_STYLE_ID;
    st.textContent = `
      .ch82-card{border:1px solid rgba(89,226,188,.42);background:linear-gradient(180deg,rgba(15,34,55,.98),rgba(11,27,46,.98));}
      .ch82-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}
      .ch82-title{font-size:1.6rem;font-weight:900;line-height:1.15}
      .ch82-picks{display:grid;gap:10px}
      .ch82-pick{border:1px solid rgba(137,163,206,.24);border-radius:17px;padding:14px;background:rgba(255,255,255,.02)}
      .ch82-pick-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
      .ch82-pick-top strong{font-size:1.1rem}
      .ch82-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
      .ch82-grid>div{border-radius:12px;background:rgba(255,255,255,.035);padding:8px 6px;text-align:center}
      .ch82-grid span{display:block;font-size:.68rem;opacity:.7;margin-bottom:3px}
      .ch82-grid strong{display:block;font-size:.95rem}
      .ch82-sub{font-size:.82rem;opacity:.82;line-height:1.5;margin-top:8px}
      .ch82-flags{display:grid;gap:9px;margin-top:12px}
      .ch82-flag{border-radius:14px;padding:12px 14px;border:1px solid rgba(137,163,206,.24);line-height:1.5}
      .ch82-flag.diamond{border-color:rgba(83,226,194,.62)}
      .ch82-flag.warning{border-color:rgba(255,190,68,.62)}
      .ch82-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}
      .ch82-pill{border-radius:999px;border:1px solid rgba(255,255,255,.12);padding:5px 9px;font-size:.77rem;background:rgba(255,255,255,.04)}
      .ch82-market-list{display:grid;gap:10px;margin-top:12px}
      .ch82-market-row{border:1px solid rgba(137,163,206,.24);border-radius:16px;padding:12px}
      .ch82-market-row.hot{border-color:rgba(83,226,194,.62)}
      .ch82-market-row.warn{border-color:rgba(255,190,68,.62)}
      .ch82-market-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      .ch82-market-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
      .ch82-market-stats>div{background:rgba(255,255,255,.035);border-radius:11px;padding:8px 5px;text-align:center}
      .ch82-market-stats span{display:block;font-size:.66rem;opacity:.7}
      .ch82-market-stats strong{font-size:.9rem}
      .ch82-integrity{border:1px solid rgba(137,163,206,.22);border-radius:14px;padding:10px 12px;margin:10px 0;display:flex;align-items:center;gap:9px;justify-content:space-between;background:rgba(255,255,255,.02)}
      .ch82-integrity.ok{border-color:rgba(83,226,194,.38)}
      .ch82-integrity.warn{border-color:rgba(255,190,68,.55)}
      .ch82-integrity strong{font-size:.88rem}
      .ch82-integrity small{display:block;opacity:.75;margin-top:2px}
      .ch82-quick-list{display:grid;gap:9px}
      .ch82-quick-row{display:grid;grid-template-columns:auto 1fr;gap:10px;border:1px solid rgba(137,163,206,.22);border-radius:15px;padding:11px}
      .ch82-no{min-width:44px;height:44px;border-radius:12px;border:1px solid rgba(83,226,194,.52);display:grid;place-items:center;font-weight:900}
      .ch82-quick-main strong{font-size:1rem}
      .ch82-quick-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:7px}
      .ch82-quick-stats>span{font-size:.76rem;opacity:.82}
      .ch82-estimate-note{font-size:.72rem;opacity:.68}
      @media(max-width:680px){
        .ch82-grid,.ch82-market-stats,.ch82-quick-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
    `;
    document.head.appendChild(st);
  }

  function marketKind(){
    const t = String($('oddsType')?.value || '').trim();
    return t === '実オッズ' ? 'real' : t === '予想オッズ' ? 'predicted' : t === '種別不明' ? 'unknown' : 'none';
  }
  function isRealMarket(){ return marketKind() === 'real'; }

  function raceKey(){
    return `${String($('raceDate')?.value||'')}|${String($('track')?.value||'')}|${String($('raceNo')?.value||'')}`;
  }
  function loadSnaps(){
    try { return JSON.parse(localStorage.getItem(MARKET_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSnaps(v){ localStorage.setItem(MARKET_KEY, JSON.stringify(v)); }

  function fallbackHorse(row, i){
    return {
      'horse-no': row.querySelector('.horse-no')?.value || String(i+1),
      mark: row.querySelector('.mark')?.value || '',
      'horse-name': row.querySelector('.horse-name')?.value?.trim() || '',
      win: row.querySelector('.win')?.value || '',
      place: row.querySelector('.place')?.value || '',
      time: row.querySelector('.time')?.value || '',
      pop: row.querySelector('.pop')?.value || '',
      odds: row.querySelector('.odds')?.value || '',
      variance: row.querySelector('.variance')?.value || '',
      'position-fail': row.querySelector('.position-fail')?.value || '',
      'data-confidence': row.querySelector('.data-confidence')?.value || ''
    };
  }

  function horses(){
    const rows = qsa('.horse-row');
    const allForBreakdown = rows.map((r,i)=>{
      try { return typeof window.horseFromRow === 'function' ? window.horseFromRow(r) : fallbackHorse(r,i); }
      catch { return fallbackHorse(r,i); }
    });
    return rows.map((row,i)=>{
      let h = allForBreakdown[i];
      if(!String(h['horse-name']||'').trim()) return null;
      const win = num(h.win), place = num(h.place), odds = num(h.odds), pop = num(h.pop);
      let ability = null, confidence = num(h['data-confidence']);
      try {
        if(typeof window.aiBreakdown === 'function') ability = num(window.aiBreakdown(h, allForBreakdown)?.overall);
      } catch {}
      if(ability === null) ability = num(row.querySelector('.quick-score')?.textContent);
      if(confidence === null){
        try { if(typeof window.derivedConfidence === 'function') confidence = num(window.derivedConfidence(h)); } catch {}
      }
      if(confidence === null) confidence = 50;
      const fair = win && win > 0 ? 100 / win : null;
      const realOdds = isRealMarket() && odds && odds > 0 ? odds : null;
      const ev = realOdds && win !== null ? win * realOdds : null;
      return {
        row, raw:h, no:String(h['horse-no'] || i+1), name:String(h['horse-name']||'').trim(), mark:String(h.mark||''),
        win, place, odds:realOdds, pop:isRealMarket()?pop:null, fair, ev,
        ability:clamp(ability ?? 50), confidence:clamp(confidence), time:String(h.time||''),
        variance:num(h.variance), positionFail:num(h['position-fail'])
      };
    }).filter(Boolean);
  }

  function captureMarket(source='ui'){
    if(!isRealMarket()) return;
    const hs = horses().filter(h=>h.odds);
    if(!hs.length) return;
    const key = raceKey();
    if(!key || key === '||') return;
    const db = loadSnaps(); db[key] ||= [];
    const checkedAt = String($('oddsCheckedAt')?.value || '');
    const sig = JSON.stringify(hs.map(h=>[h.no,h.odds,h.pop]));
    const last = db[key][db[key].length-1];
    if(last?.sig === sig && last?.checkedAt === checkedAt) return;
    db[key].push({at:new Date().toISOString(),source,checkedAt,sig,horses:hs.map(h=>({no:h.no,name:h.name,odds:h.odds,pop:h.pop}))});
    if(db[key].length > 60) db[key] = db[key].slice(-60);
    saveSnaps(db);
  }
  function marketMovement(no, current){
    if(!current) return null;
    const list = loadSnaps()[raceKey()] || [];
    if(list.length < 2) return null;
    const prev = [...list].reverse().slice(1).find(s => (s.horses||[]).some(h=>String(h.no)===String(no) && num(h.odds)));
    const p = prev?.horses?.find(h=>String(h.no)===String(no));
    if(!p || !num(p.odds)) return null;
    const diff = current - num(p.odds);
    return Math.abs(diff) < 0.05 ? {symbol:'→',diff:0} : diff < 0 ? {symbol:'↓',diff} : {symbol:'↑',diff};
  }

  function timeScenarios(h){
    const base = parseTime(h.time);
    if(base === null) return null;
    const variancePct = Math.max(.4, h.variance ?? 2.0);
    const failPct = Math.max(0, h.positionFail ?? 12);
    // Estimated scenarios; keep standard time unchanged.
    const fitGain = clamp(variancePct * 0.26, 0.25, 1.20);
    const adverseLoss = clamp(variancePct * 0.42 + failPct * 0.012, 0.40, 2.20);
    return {fit:base-fitGain, standard:base, adverse:base+adverseLoss};
  }

  function finalScore(h, hs){
    const n = Math.max(1, hs.length);
    const winRank = [...hs].sort((a,b)=>(b.win??-1)-(a.win??-1)).indexOf(h);
    const abilityRank = [...hs].sort((a,b)=>b.ability-a.ability).indexOf(h);
    const placeRank = [...hs].sort((a,b)=>(b.place??-1)-(a.place??-1)).indexOf(h);
    const rankPts = (r,w)=>r<0?0:((n-r)/n)*w;
    let s = rankPts(winRank,32) + rankPts(abilityRank,25) + rankPts(placeRank,18);
    s += h.confidence * .12;
    if(h.ev !== null) s += clamp((h.ev-90)/4, -8, 18);
    return s;
  }

  function ensureFinal(){
    let card = $(PATCH_CARD_ID);
    if(card) return card;
    // Remove/disable older dynamic final card to prevent duplicate FINAL sections.
    const old = $('chassFinalCard');
    if(old) old.hidden = true;
    card = document.createElement('section');
    card.id = PATCH_CARD_ID;
    card.className = 'card ch82-card';
    card.innerHTML = `<div class="ch82-head"><div><p class="eyebrow">CHASS FINAL</p><div class="ch82-title">最終判断</div></div><span id="ch82FinalStatus" class="badge">分析待ち</span></div><div id="ch82FinalBody"></div>`;
    const race = document.querySelector('.race-overview-card') || qsa('section.card').find(x=>/RACE/.test(x.textContent||''));
    if(race) race.insertAdjacentElement('afterend', card);
    else $('predictionView')?.prepend(card);
    return card;
  }

  function renderFinal(){
    const card = ensureFinal(); if(!card) return;
    const hs = horses(); const body = $('ch82FinalBody'), status = $('ch82FinalStatus');
    if(!hs.length){ body.innerHTML='<p class="muted">予想データを読み込むと自動表示します。</p>'; if(status)status.textContent='分析待ち'; return; }
    const picks = [...hs].sort((a,b)=>finalScore(b,hs)-finalScore(a,hs)).slice(0,3);
    const marks=['◎','○','▲'];
    const diamonds = hs.filter(h=>h.ev!==null && h.pop!==null && ((h.pop>=8 && (h.place??0)>=18 && h.ev>=125)||(h.pop>=4 && (h.place??0)>=22 && h.ev>=112))).sort((a,b)=>b.ev-a.ev);
    const warnings = hs.filter(h=>h.ev!==null && h.pop!==null && h.pop<=3 && h.ev<82).sort((a,b)=>a.ev-b.ev);
    const phtml = picks.map((h,i)=>{
      const ts=timeScenarios(h);
      return `<article class="ch82-pick"><div class="ch82-pick-top"><strong>${marks[i]} ${esc(h.no)}番 ${esc(h.name)}</strong></div><div class="ch82-grid"><div><span>AI勝率</span><strong>${h.win===null?'—':h.win.toFixed(1)+'%'}</strong></div><div><span>複勝率</span><strong>${h.place===null?'—':h.place.toFixed(1)+'%'}</strong></div><div><span>能力</span><strong>${h.ability.toFixed(0)}/100</strong></div><div><span>信頼度</span><strong>${h.confidence.toFixed(0)}%</strong></div></div><div class="ch82-sub">TIME ${ts?`${formatRaceTime(ts.standard)}（ハマり ${formatRaceTime(ts.fit)} / 不利 ${formatRaceTime(ts.adverse)}）`:'—'}<br>${h.ev===null?`市場期待値：算出待ち ｜ AIフェア ${h.fair?h.fair.toFixed(1)+'倍':'—'}`:`実 ${h.odds.toFixed(1)}倍 ｜ 期待回収率 ${h.ev.toFixed(0)}% ｜ AIフェア ${h.fair?.toFixed(1)||'—'}倍`}</div></article>`;
    }).join('');
    body.innerHTML = `<div class="ch82-picks">${phtml}</div><div class="ch82-flags"><div class="ch82-flag diamond">${diamonds[0]?`💎 穴馬：${esc(diamonds[0].no)}番 ${esc(diamonds[0].name)} ｜ 期待 ${diamonds[0].ev.toFixed(0)}% ｜ ${diamonds[0].pop}人気`:'💎 穴馬：実オッズ取得後に判定'}</div><div class="ch82-flag warning">${warnings[0]?`⚠️ 人気馬注意：${esc(warnings[0].no)}番 ${esc(warnings[0].name)} ｜ 期待 ${warnings[0].ev.toFixed(0)}% ｜ ${warnings[0].pop}人気`:'⚠️ 人気馬リスク：実オッズ取得後に判定'}</div></div><div class="ch82-meta"><span class="ch82-pill">能力・信頼度・市場期待値を分離</span><span class="ch82-pill">波乱度 ${esc($('chaos')?.value||'—')}%</span><span class="ch82-pill">展開 ${esc($('pace')?.value||'—')}</span></div>`;
    if(status) status.textContent = isRealMarket() ? '市場反映済' : '市場待ち';
  }

  function findLiveMarketAnchor(){
    const buttons = qsa('button');
    const b = buttons.find(x=>/現在オッズを取得/.test(x.textContent||''));
    return b?.closest('section,.card') || null;
  }
  function ensureLiveMarket(){
    let card = $(MARKET_CARD_ID); if(card) return card;
    const old = findLiveMarketAnchor();
    if(old) old.hidden = true;
    card = document.createElement('section'); card.id=MARKET_CARD_ID; card.className='card';
    card.innerHTML=`<div class="section-head"><div><p class="eyebrow">LIVE MARKET</p><h2>現在オッズ</h2></div><span id="ch82MarketBadge" class="badge">未取得</span></div><button id="ch82FetchOdds" class="primary big" type="button">NAR公式から現在オッズを取得</button><div id="ch82MarketNote" class="muted" style="margin-top:10px">実オッズ取得後に期待回収率を再計算します。</div><div id="ch82MarketRows" class="ch82-market-list"></div>`;
    const race = document.querySelector('.race-overview-card');
    const final = $(PATCH_CARD_ID);
    if(final) final.insertAdjacentElement('afterend', card); else if(race) race.insertAdjacentElement('afterend', card); else $('predictionView')?.prepend(card);
    $('ch82FetchOdds')?.addEventListener('click', async()=>{
      const fn = window.fetchCurrentNarOdds || window.fetchOfficialNar;
      if(typeof fn !== 'function'){ $('ch82MarketNote').textContent='現在オッズ取得関数を確認できません。'; return; }
      $('ch82MarketNote').textContent='NAR公式の現在オッズを確認中…';
      try { await fn({silent:false, oddsOnly:true}); } catch { try{ await fn({silent:false}); }catch{} }
      setTimeout(()=>{ captureMarket('manual'); renderAll(); },120);
    });
    return card;
  }

  function renderLiveMarket(){
    ensureLiveMarket();
    const hs=horses(), badge=$('ch82MarketBadge'), rows=$('ch82MarketRows'), note=$('ch82MarketNote');
    if(!hs.length){ if(rows)rows.innerHTML=''; return; }
    if(!isRealMarket()){
      if(badge)badge.textContent='未取得';
      if(note)note.textContent='実オッズ未取得。人気・期待回収率・💎/⚠️判定は保留します。';
      if(rows)rows.innerHTML='';
      return;
    }
    captureMarket('render');
    const checked=String($('oddsCheckedAt')?.value||'');
    if(badge)badge.textContent=checked?`更新 ${checked}`:'実オッズ';
    if(note)note.textContent='実オッズ取得済み。AIフェアとの差から期待回収率を計算しています。';
    if(rows) rows.innerHTML=[...hs].filter(h=>h.odds).sort((a,b)=>a.odds-b.odds).map(h=>{
      const mv=marketMovement(h.no,h.odds); const cls=h.ev!==null&&h.ev>=110?'hot':(h.ev!==null&&h.ev<82&&h.pop!==null&&h.pop<=3?'warn':'');
      return `<article class="ch82-market-row ${cls}"><div class="ch82-market-top"><strong>${esc(h.no)}番 ${esc(h.name)}</strong><span>${h.pop?`${h.pop}人気`:''}</span><span>${mv?`${mv.symbol} ${Math.abs(mv.diff).toFixed(1)}倍`:''}</span></div><div class="ch82-market-stats"><div><span>実オッズ</span><strong>${h.odds.toFixed(1)}倍</strong></div><div><span>AIフェア</span><strong>${h.fair?h.fair.toFixed(1)+'倍':'—'}</strong></div><div><span>AI勝率</span><strong>${h.win===null?'—':h.win.toFixed(1)+'%'}</strong></div><div><span>期待回収率</span><strong>${h.ev===null?'—':h.ev.toFixed(0)+'%'}</strong></div></div></article>`;
    }).join('');
  }

  function ensureIntegrityCompact(){
    let bar=$(INTEGRITY_ID); if(bar) return bar;
    const integrityCard = qsa('section.card').find(x=>/データ整合性/.test(x.textContent||''));
    if(!integrityCard) return null;
    bar=document.createElement('div'); bar.id=INTEGRITY_ID; bar.className='ch82-integrity';
    integrityCard.insertAdjacentElement('beforebegin',bar);
    integrityCard.dataset.ch82Original='1';
    return bar;
  }
  function renderIntegrity(){
    const bar=ensureIntegrityCompact(); if(!bar)return;
    const hs=horses();
    const missing=[];
    hs.forEach(h=>{
      if(h.win===null) missing.push(`${h.no}番勝率`);
      if(h.place===null) missing.push(`${h.no}番複勝率`);
      if(parseTime(h.time)===null) missing.push(`${h.no}番TIME`);
    });
    const ok=hs.length>=2 && !missing.length;
    bar.className=`ch82-integrity ${ok?'ok':'warn'}`;
    bar.innerHTML=`<div><strong>${ok?'✓ データ正常':`⚠️ データ確認 ${missing.length}件`}</strong><small>${hs.length}頭 ｜ AI確率 ${hs.filter(h=>h.win!==null&&h.place!==null).length}/${hs.length} ｜ TIME ${hs.filter(h=>parseTime(h.time)!==null).length}/${hs.length} ｜ 市場 ${isRealMarket()?'取得済':'未取得'}</small></div><button type="button" class="ghost" id="ch82IntegrityToggle">${ok?'詳細':'確認'}</button>`;
    const integrityCard=qsa('section.card').find(x=>/データ整合性/.test(x.textContent||''));
    if(integrityCard){ integrityCard.hidden=true; $('ch82IntegrityToggle')?.addEventListener('click',()=>{ integrityCard.hidden=!integrityCard.hidden; }); }
  }

  function renderQuick(){
    const quick = $('quickCompare'); if(!quick) return;
    const hs=horses(); if(!hs.length) return;
    quick.innerHTML=`<div class="ch82-quick-list">${[...hs].sort((a,b)=>(b.win??-1)-(a.win??-1)).map(h=>{
      const ts=timeScenarios(h);
      return `<article class="ch82-quick-row"><div class="ch82-no">${esc(h.no)}</div><div class="ch82-quick-main"><strong>${esc(h.mark?`${h.mark} `:'')}${esc(h.name)}</strong><div class="ch82-quick-stats"><span>勝 ${h.win===null?'—':h.win.toFixed(1)+'%'}</span><span>複 ${h.place===null?'—':h.place.toFixed(1)+'%'}</span><span>能力 ${h.ability.toFixed(0)}</span><span>信頼 ${h.confidence.toFixed(0)}%</span></div><div class="ch82-estimate-note">TIME ${ts?`${formatRaceTime(ts.standard)} / ハマり ${formatRaceTime(ts.fit)} / 不利 ${formatRaceTime(ts.adverse)}`:'—'} ｜ ${h.ev===null?'市場期待値 保留':`期待 ${h.ev.toFixed(0)}%`}</div></div></article>`;
    }).join('')}</div>`;
    const market=$('quickMarketStatus');
    if(market) market.textContent = isRealMarket()?`市場データ：実オッズ取得済${$('oddsCheckedAt')?.value?' ｜ '+$('oddsCheckedAt').value:''}`:'市場データ：未取得 ｜ AI能力のみ表示';
  }

  function neutralizeFakeMarketDisplays(){
    if(isRealMarket()) return;
    // Do not erase source values; only prevent UI from calling them real market data.
    qsa('.horse-row').forEach(row=>{
      const name=row.querySelector('.horse-name')?.value?.trim(); if(!name)return;
      const labels=qsa('.fact-summary, .value-result',row);
      labels.forEach(el=>{
        if(/当日オッズ|実オッズ|期待回収率/.test(el.textContent||'')){
          el.querySelectorAll('span').forEach(s=>{ if(/当日オッズ|実オッズ|期待回収率/.test(s.textContent||'')) s.textContent='市場未取得'; });
        }
      });
    });
  }

  function renderAll(){
    if(window.__ch82Rendering) return;
    window.__ch82Rendering=true;
    try{
      setVersion();
      renderFinal();
      renderLiveMarket();
      renderIntegrity();
      renderQuick();
      neutralizeFakeMarketDisplays();
    } finally { window.__ch82Rendering=false; }
  }

  function hook(name, after){
    const fn=window[name]; if(typeof fn!=='function' || fn.__ch82Hooked) return;
    const wrapped=function(...args){
      const out=fn.apply(this,args);
      Promise.resolve(out).finally(()=>setTimeout(()=>{ try{ after?.(...args); renderAll(); }catch{} },30));
      return out;
    };
    wrapped.__ch82Hooked=true; window[name]=wrapped;
  }

  function installHooks(){
    ['renderAllAiBreakdowns','renderValueRanking','runSimulation','saveCurrentSilent','saveCurrent','renderDashboard','fillForm','importRaceRows'].forEach(n=>hook(n));
    hook('applyOfficialOdds', (data)=>captureMarket(/最終/.test(String(data?.checkedAt||''))?'official-final':'official'));
    hook('fetchOfficialNar', ()=>captureMarket('official-sync'));
  }

  function boot(){
    injectStyles(); setVersion(); installHooks(); ensureFinal(); ensureLiveMarket(); renderAll();
    let timer=null;
    const schedule=()=>{ clearTimeout(timer); timer=setTimeout(renderAll,90); };
    document.addEventListener('input',e=>{
      if(e.target?.matches?.('.horse-row input,.horse-row select,#oddsType,#oddsCheckedAt,#chaos,#pace,#raceDate,#track,#raceNo')) schedule();
    });
    document.addEventListener('change',e=>{
      if(e.target?.matches?.('.horse-row input,.horse-row select,#oddsType,#oddsCheckedAt,#chaos,#pace,#raceDate,#track,#raceNo')){
        if(isRealMarket()) captureMarket('change'); schedule();
      }
    });
    const root=$('horseList');
    if(root) new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
