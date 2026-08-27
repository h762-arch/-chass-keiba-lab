/* CHASS KEIBA LAB Ver.7.8
   Mobile decision-first UI patch.
   - Compact horse cards: evidence is moved into "詳細分析を見る".
   - QUICK VIEW restores AI win/place/TIME/overall while staying phone friendly.
   - CHASS FINAL shows FINAL rank explicitly so model rank and raw win-rate rank are not confused.
   - Existing simulation/import/save/market logic remains untouched.
*/
(() => {
  'use strict';
  const VERSION='7.8';
  const $=id=>document.getElementById(id);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function updateVersion(){
    document.title=document.title.replace(/Ver\.\d+(?:\.\d+)?/g,`Ver.${VERSION}`);
    const h=document.querySelector('.topbar h1 span'); if(h) h.textContent=`Ver.${VERSION}`;
  }

  function injectStyles(){
    if($('chass78Styles')) return;
    const s=document.createElement('style'); s.id='chass78Styles';
    s.textContent=`
      .chass78-hidden{display:none!important}
      #predictionView{display:flex;flex-direction:column}
      #chassFinalCard{order:2}.quick-card{order:3}#v76MarketDiscipline{order:4}
      #predictionView>.card:not(.race-overview-card):not(#chassFinalCard):not(.quick-card):not(#v76MarketDiscipline){order:5}
      .horse-row>.fact-summary{display:none!important}
      .horse-all-details .fact-summary{display:grid!important}
      .horse-all-details:not([open]) .horse-all-details-body{display:none}
      .chass78-rank{display:inline-flex;align-items:center;margin-left:7px;padding:3px 8px;border-radius:999px;border:1px solid rgba(92,224,190,.32);font-size:.72rem;opacity:.88;vertical-align:middle}
      .chass78-final-note{margin-top:10px;font-size:.78rem;opacity:.72;line-height:1.5}
      .chass78-quick-list{display:grid;gap:8px}
      .chass78-quick-row{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px 10px;padding:12px;border:1px solid rgba(130,160,205,.18);border-radius:15px;background:rgba(255,255,255,.018)}
      .chass78-quick-no{grid-row:1/3;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:11px;border:1px solid rgba(92,224,190,.42);font-weight:800;color:#61e7bd}
      .chass78-quick-name{min-width:0;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .chass78-quick-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
      .chass78-quick-metrics span{display:block;text-align:center;padding:6px 3px;border-radius:9px;background:rgba(255,255,255,.025);font-size:.67rem;opacity:.72}
      .chass78-quick-metrics strong{display:block;margin-top:2px;font-size:.82rem;opacity:1}
      .chass77-market-summary{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}
      .chass77-market-chip{border:1px solid rgba(125,160,200,.22);border-radius:999px;padding:6px 10px;font-size:.78rem;background:rgba(255,255,255,.03)}
      .chass77-final-extra{margin-top:10px;padding:10px 12px;border:1px solid rgba(92,224,190,.25);border-radius:14px;background:rgba(255,255,255,.02)}
      .chass77-final-extra strong{display:block;margin-bottom:4px}
      .chass77-compact-market .v76-market-note{display:none}.chass77-compact-market .v76-market-row{padding:12px}
      .chass77-compact-market .v76-market-row:not(.v76-diamond):not(.v76-diamond3):not(.v76-warning){display:none}
      @media(max-width:680px){
        .horse-row{padding:14px!important}.horse-compact-summary{gap:6px!important}.horse-compact-summary>div{padding:8px 4px!important}
        .horse-all-details>summary{font-size:1rem;padding:11px 13px}.horse-all-details{margin-top:8px}
        .chass-final-grid{gap:8px}.chass-final-pick{padding:12px!important}
        .chass78-quick-row{padding:10px}.chass78-quick-metrics strong{font-size:.78rem}
      }
    `; document.head.appendChild(s);
  }

  function marketState(){
    const type=String($('oddsType')?.value||'').trim();
    const oddsCount=qsa('.horse-row').filter(r=>num(r.querySelector('.odds')?.value)!==null).length;
    return {type,oddsCount,hasMarket:oddsCount>0};
  }

  function consolidateEvidence(){
    qsa('.horse-row').forEach(row=>{
      const details=row.querySelector(':scope > .horse-all-details');
      const fact=row.querySelector(':scope > .fact-summary');
      const body=details?.querySelector('.horse-all-details-body');
      if(fact&&body) body.insertBefore(fact,body.firstChild);
      if(details) details.open=false;
      ['.horse-input-panel','.ai-panel','.logic-panel'].forEach(sel=>{const d=row.querySelector(sel);if(d)d.open=false;});
    });
  }

  function quickData(){
    const rows=qsa('.horse-row');
    const hs=rows.map(r=>{try{return horseFromRow(r)}catch{return null}}).filter(Boolean);
    return rows.map((r,i)=>{
      const h=hs[i]; if(!h||!String(h['horse-name']||'').trim())return null;
      let score=null; try{score=aiBreakdown(h,hs)?.overall}catch{}
      return {no:String(h['horse-no']||i+1),mark:h.mark||'',name:h['horse-name'],win:num(h.win),place:num(h.place),time:h.time||'',score:num(score)};
    }).filter(Boolean).sort((a,b)=>(b.win??-1)-(a.win??-1));
  }

  function renderQuick78(){
    const el=$('quickCompare'); if(!el)return;
    const rows=quickData();
    if(!rows.length){el.innerHTML='<p class="muted">馬データを入力すると一覧表示します。</p>';return;}
    el.innerHTML=`<div class="chass78-quick-list">${rows.map(x=>`<div class="chass78-quick-row">
      <div class="chass78-quick-no">${esc(x.no)}</div>
      <div class="chass78-quick-name">${esc(x.mark)} ${esc(x.name)}</div>
      <div class="chass78-quick-metrics">
        <span>勝<strong>${x.win===null?'—':x.win.toFixed(1)+'%'}</strong></span>
        <span>複<strong>${x.place===null?'—':x.place.toFixed(1)+'%'}</strong></span>
        <span>TIME<strong>${esc(x.time||'—')}</strong></span>
        <span>総合<strong>${x.score===null?'—':x.score.toFixed(0)}</strong></span>
      </div></div>`).join('')}</div>`;
  }

  function enhanceFinal78(){
    const body=$('chassFinalBody'); if(!body)return;
    const picks=qsa('.chass-final-pick',body);
    picks.forEach((p,i)=>{
      const strong=p.querySelector('strong'); if(!strong)return;
      strong.querySelector('.chass78-rank')?.remove();
      const badge=document.createElement('span');badge.className='chass78-rank';badge.textContent=`FINAL ${i+1}位`;strong.appendChild(badge);
    });
    let note=body.querySelector('.chass78-final-note');
    if(!note){note=document.createElement('div');note.className='chass78-final-note';body.appendChild(note);}
    note.textContent='FINAL順位は勝率だけでなく、総合評価・複勝率・信頼度・市場取得時の期待値を統合した最終順位です。';
  }

  function updateMarketVisibility(){
    const card=$('v76MarketDiscipline'); if(!card)return;
    const st=marketState(); card.hidden=!st.hasMarket; card.classList.add('chass77-compact-market');
    if(!st.hasMarket)return;
    const badge=$('v76MarketBadge'); if(badge)badge.textContent=st.type==='実オッズ'?'実オッズ確認済':st.type==='予想オッズ'?'予想オッズ':'市場データあり';
  }

  function marketFinalNote(){
    const body=$('chassFinalBody');if(!body)return;
    body.querySelector('.chass77-final-extra')?.remove();
    const st=marketState(),e=document.createElement('div');e.className='chass77-final-extra';
    e.innerHTML=!st.hasMarket?'<strong>市場判定</strong><span>実オッズ未取得。期待回収率・穴馬判定は未確定です。</span>':st.type==='実オッズ'?'<strong>市場判定</strong><span>実オッズ反映済み。AIフェアとの乖離を最終判断へ反映しています。</span>':`<strong>市場判定</strong><span>${esc(st.type||'種別不明')}。期待回収率は参考扱いです。</span>`;
    body.appendChild(e);
  }

  function refresh(){updateVersion();consolidateEvidence();renderQuick78();updateMarketVisibility();enhanceFinal78();marketFinalNote();const old=$('marketCard');if(old&&$('v76MarketDiscipline'))old.hidden=true;}
  function hook(name){const fn=window[name];if(typeof fn!=='function'||fn.__chass78)return;const w=function(...a){const o=fn.apply(this,a);setTimeout(refresh,0);return o};w.__chass78=true;window[name]=w;}
  function boot(){injectStyles();updateVersion();['renderAllAiBreakdowns','renderQuickCompare','renderValueRanking','renderFinal','applyOfficialOdds','renderDashboard'].forEach(hook);refresh();let t;const list=$('horseList');if(list)new MutationObserver(()=>{clearTimeout(t);t=setTimeout(refresh,100)}).observe(list,{childList:true,subtree:true});document.addEventListener('change',e=>{if(e.target?.matches?.('.win,.place,.time,.odds,.pop,.mark,.horse-name,.horse-no,#oddsType,#oddsCheckedAt'))setTimeout(refresh,50)});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
