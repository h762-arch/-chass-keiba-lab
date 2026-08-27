/* CHASS KEIBA LAB Ver.7.7
   UI consolidation + future-proof loader architecture companion.
   Goals:
   1) CHASS FINAL becomes the primary decision block.
   2) MARKET CHECK is hidden until market data exists, and compact when shown.
   3) Horse details stay collapsed by default on mobile.
   4) Duplicate information is reduced.
   5) Version label is updated to Ver.7.7.
*/
(() => {
  'use strict';

  const VERSION = '7.7';
  const $ = id => document.getElementById(id);
  const qsa = (s, root=document) => [...root.querySelectorAll(s)];
  const num = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));

  function updateVersion(){
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/g, `Ver.${VERSION}`);
    const h = document.querySelector('.topbar h1 span');
    if(h) h.textContent = `Ver.${VERSION}`;
  }

  function injectStyles(){
    if($('chass77Styles')) return;
    const s = document.createElement('style');
    s.id = 'chass77Styles';
    s.textContent = `
      .chass77-hidden{display:none!important}
      .chass77-collapsed-note{font-size:.82rem;opacity:.7;margin-top:8px}
      #chassFinalCard{order:2}
      .quick-card{order:3}
      #v76MarketDiscipline{order:4}
      #predictionView>.card:not(.race-overview-card):not(#chassFinalCard):not(.quick-card):not(#v76MarketDiscipline){order:5}
      #predictionView{display:flex;flex-direction:column}
      .chass77-market-summary{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}
      .chass77-market-chip{border:1px solid rgba(125,160,200,.22);border-radius:999px;padding:6px 10px;font-size:.78rem;background:rgba(255,255,255,.03)}
      .chass77-final-extra{margin-top:10px;padding:10px 12px;border:1px solid rgba(92,224,190,.25);border-radius:14px;background:rgba(255,255,255,.02)}
      .chass77-final-extra strong{display:block;margin-bottom:4px}
      .chass77-compact-market .v76-market-note{display:none}
      .chass77-compact-market .v76-market-row{padding:12px}
      .chass77-compact-market .v76-market-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
      .chass77-compact-market .v76-market-row:not(.v76-diamond):not(.v76-diamond3):not(.v76-warning){display:none}
      .horse-all-details:not([open]) .horse-all-details-body{display:none}
      @media(max-width:680px){
        .horse-all-details>summary{font-size:1rem;padding:12px 14px}
        .horse-all-details{margin-top:8px}
        .quick-mobile-list{gap:10px}
        .chass-final-grid{gap:8px}
      }
    `;
    document.head.appendChild(s);
  }

  function marketState(){
    const type = String($('oddsType')?.value || '').trim();
    const rows = qsa('.horse-row');
    const oddsCount = rows.filter(r => num(r.querySelector('.odds')?.value) !== null).length;
    return {type, oddsCount, hasMarket: oddsCount > 0};
  }

  function collapseHorseDetails(){
    qsa('.horse-row').forEach(row => {
      const all = row.querySelector('.horse-all-details');
      if(all) all.open = false;
      const p1 = row.querySelector('.horse-input-panel');
      if(p1) p1.open = false;
      const p2 = row.querySelector('.ai-panel');
      if(p2) p2.open = false;
      const p3 = row.querySelector('.logic-panel');
      if(p3) p3.open = false;
    });
  }

  function compactQuickView(){
    const quick = $('quickCompare');
    if(!quick) return;
    qsa('.quick-mobile-row', quick).forEach(card => {
      const judge = card.querySelector('.quick-judgement-row');
      if(judge && /実オッズ —/.test(judge.textContent || '')){
        judge.classList.add('chass77-hidden');
      }
    });
  }

  function updateMarketVisibility(){
    const card = $('v76MarketDiscipline');
    if(!card) return;
    const st = marketState();
    // Hide the full market block when there is no market information.
    card.hidden = !st.hasMarket;
    card.classList.add('chass77-compact-market');

    if(st.hasMarket){
      const badge = $('v76MarketBadge');
      if(badge){
        if(st.type === '実オッズ') badge.textContent = '実オッズ確認済';
        else if(st.type === '予想オッズ') badge.textContent = '予想オッズ';
        else badge.textContent = '市場データあり';
      }

      let top = card.querySelector('.chass77-market-summary');
      if(!top){
        top = document.createElement('div');
        top.className = 'chass77-market-summary';
        const rows = card.querySelector('#v76MarketRows');
        if(rows) rows.insertAdjacentElement('beforebegin', top);
      }
      top.innerHTML = `
        <span class="chass77-market-chip">${esc(st.type || '種別不明')}</span>
        <span class="chass77-market-chip">${st.oddsCount}頭取得</span>
        <span class="chass77-market-chip">乖離候補のみ表示</span>
      `;
    }
  }

  function enhanceFinal(){
    const body = $('chassFinalBody');
    if(!body) return;
    const st = marketState();

    const old = body.querySelector('.chass77-final-extra');
    if(old) old.remove();

    const extra = document.createElement('div');
    extra.className = 'chass77-final-extra';
    if(!st.hasMarket){
      extra.innerHTML = '<strong>市場判定</strong><span>実オッズ未取得のため、期待回収率・穴馬判定は確定していません。</span>';
    }else if(st.type === '実オッズ'){
      extra.innerHTML = '<strong>市場判定</strong><span>実オッズ反映済み。AIフェアとの乖離を最終判断へ反映しています。</span>';
    }else{
      extra.innerHTML = `<strong>市場判定</strong><span>${esc(st.type || '種別不明')}。期待回収率は参考扱いです。</span>`;
    }
    body.appendChild(extra);
  }

  function hideLegacyDuplicateMarket(){
    // Old market card can duplicate Ver.7.6 MARKET CHECK.
    const old = $('marketCard');
    if(!old) return;
    const newer = $('v76MarketDiscipline');
    if(newer) old.hidden = true;
  }

  function refresh77(){
    updateVersion();
    compactQuickView();
    updateMarketVisibility();
    enhanceFinal();
    hideLegacyDuplicateMarket();
  }

  function hook(name, after){
    const fn = window[name];
    if(typeof fn !== 'function' || fn.__chass77Hooked) return;
    const wrapped = function(...args){
      const out = fn.apply(this,args);
      try{ after(...args); }catch(e){ console.warn('Ver.7.7 hook', name, e); }
      return out;
    };
    wrapped.__chass77Hooked = true;
    window[name] = wrapped;
  }

  function installHooks(){
    ['renderAllAiBreakdowns','renderQuickCompare','renderValueRanking','renderFinal','applyOfficialOdds','renderDashboard']
      .forEach(n => hook(n, () => setTimeout(refresh77, 0)));
  }

  function boot(){
    injectStyles();
    updateVersion();
    installHooks();
    collapseHorseDetails();
    refresh77();

    const list = $('horseList');
    if(list){
      let timer = null;
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          collapseHorseDetails();
          refresh77();
        }, 100);
      }).observe(list,{childList:true,subtree:true});
    }

    document.addEventListener('input', e => {
      if(e.target?.matches?.('.odds,.pop,.win,.place,#oddsType,#oddsCheckedAt')){
        setTimeout(refresh77, 60);
      }
    });
    document.addEventListener('change', e => {
      if(e.target?.matches?.('.odds,.pop,.win,.place,#oddsType,#oddsCheckedAt')){
        setTimeout(refresh77, 60);
      }
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();