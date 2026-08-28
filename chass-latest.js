/* CHASS KEIBA LAB Ver.8.2 UI Update */
(() => {
  'use strict';
  const VERSION='8.3';
  const $=id=>document.getElementById(id);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const n=v=>{const x=parseFloat(v);return Number.isFinite(x)?x:null;};
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function updateVersion(){
    document.title=document.title.replace(/Ver\.\d+(?:\.\d+)?/gi,`Ver.${VERSION}`);
    qsa('.topbar h1 span, h1 span').forEach(el=>{if(/Ver\./i.test(el.textContent||''))el.textContent=`Ver.${VERSION}`;});
  }

  function injectStyles(){
    if($('chass82Styles'))return;
    const s=document.createElement('style');s.id='chass82Styles';s.textContent=`
      :root{--c82-mint:#61dfb8;--c82-card:#111e33;--c82-line:#2b4164;--c82-muted:#9cadc7;--c82-text:#f3f7ff}
      body{overflow-x:hidden}.tabs{position:sticky!important;top:0;z-index:50;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
      .chass82-actions{margin:18px 0 22px;display:grid;grid-template-columns:1.35fr .65fr;gap:10px}
      .chass82-import-label,.chass82-action{min-height:58px;border-radius:17px;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:800;font-size:1rem;border:1px solid var(--c82-line);box-sizing:border-box}
      .chass82-import-label{background:var(--c82-mint);color:#071620;border-color:transparent}.chass82-action{background:#12213a;color:var(--c82-text)}
      .chass82-subactions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:10px}.chass82-status{grid-column:1/-1;padding:10px 13px;border-radius:13px;background:#101d31;border:1px solid rgba(120,150,190,.18);color:var(--c82-muted);font-size:.86rem;line-height:1.45}
      .race-inline-import{display:none!important}.quick-card .table-wrap{overflow:visible!important}.quick-mobile-list{display:grid!important;gap:12px!important}
      .quick-mobile-row{display:block!important;width:100%!important;box-sizing:border-box!important;padding:15px!important;border-radius:18px!important;border:1px solid var(--c82-line)!important;background:var(--c82-card)!important;overflow:hidden!important}
      .quick-mobile-head{display:grid!important;grid-template-columns:58px minmax(0,1fr)!important;grid-template-areas:'no name' 'no meta'!important;align-items:center!important;column-gap:14px!important;row-gap:3px!important;min-width:0!important}
      .quick-mobile-head .horse-number-badge{grid-area:no!important;width:54px!important;height:54px!important;display:flex!important;align-items:center!important;justify-content:center!important;border-radius:14px!important;font-size:1.3rem!important;border:1px solid rgba(97,223,184,.55)!important;color:var(--c82-mint)!important;background:rgba(97,223,184,.06)!important}
      .quick-name{grid-area:name!important;min-width:0!important;white-space:normal!important;overflow-wrap:anywhere!important;font-size:1.08rem!important;line-height:1.3!important}.quick-mark{grid-area:meta!important;font-size:.9rem!important;color:var(--c82-muted)!important}
      .quick-mobile-stats{margin-top:13px!important;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important}.quick-mobile-stats>div{min-width:0!important;padding:9px 5px!important;text-align:center!important;border-radius:12px!important;background:rgba(255,255,255,.025)!important}.quick-mobile-stats span{display:block!important;font-size:.68rem!important;color:var(--c82-muted)!important}.quick-mobile-stats strong{display:block!important;margin-top:3px!important;font-size:.92rem!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .compact-horse-top{display:grid!important;grid-template-columns:82px 70px minmax(0,1fr)!important;gap:8px!important}.compact-horse-top .remove{display:none!important}.horse-name{min-width:0!important;width:100%!important}.horse-compact-summary{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important}.horse-compact-summary strong{white-space:nowrap!important;font-size:.93rem!important}
      #chassFinalCard,.chass-final-card{border-color:rgba(97,223,184,.52)!important;background:linear-gradient(180deg,#0f2536,#0e1c31)!important}.chass82-result-anchor{margin-top:22px}
      #chass82ResultJump{position:fixed;right:16px;bottom:22px;z-index:80;width:52px;height:52px;border-radius:50%;border:1px solid rgba(97,223,184,.5);background:#10243a;color:var(--c82-mint);font-size:1.25rem;box-shadow:0 10px 30px rgba(0,0,0,.32)}
      @media(max-width:680px){.wrap{padding-left:14px!important;padding-right:14px!important}.card{border-radius:20px!important}.chass82-actions{grid-template-columns:1fr}.chass82-subactions{grid-template-columns:1fr 1fr}}
      @media(max-width:430px){.quick-mobile-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}.compact-horse-top{grid-template-columns:72px 64px minmax(0,1fr)!important}.horse-compact-summary{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
    `;document.head.appendChild(s);
  }

  function ensureActionPanel(){
    if($('chass82Actions'))return;
    const prediction=$('predictionView');if(!prediction)return;
    const race=document.querySelector('.race-overview-card');
    const panel=document.createElement('section');panel.id='chass82Actions';panel.className='chass82-actions';
    panel.innerHTML=`<label class="chass82-import-label" for="raceImportFile">📄 予想データファイルを選択</label><button id="chass82OddsBtn" class="chass82-action" type="button">現在オッズ</button><div class="chass82-subactions"><button id="chass82ResultBtn" class="chass82-action" type="button">レース結果</button><button id="chass82DashBtn" class="chass82-action" type="button">検証を見る</button></div><div id="chass82ActionStatus" class="chass82-status">JSON / CSVを選択すると自動分析します。</div>`;
    if(race)race.insertAdjacentElement('beforebegin',panel);else prediction.prepend(panel);
    $('chass82OddsBtn')?.addEventListener('click',async()=>{const st=$('chass82ActionStatus');if(st)st.textContent='NAR公式の現在オッズを確認中…';try{if(typeof fetchOfficialNar==='function'){await fetchOfficialNar({silent:false});if(st)st.textContent='市場データを更新しました。';}else{$('fetchCurrentOdds')?.click();}}catch(e){if(st)st.textContent='現在オッズ取得に失敗しました：'+String(e?.message||e);}});
    $('chass82ResultBtn')?.addEventListener('click',()=>{const el=findResultSection();if(el)el.scrollIntoView({behavior:'smooth',block:'start'});else $('fetchOfficialResult')?.click();});
    $('chass82DashBtn')?.addEventListener('click',()=>{const btn=qsa('.tab').find(x=>x.dataset.view==='dashboardView');if(btn)btn.click();else if(typeof showView==='function')showView('dashboardView');});
    $('raceImportFile')?.addEventListener('change',()=>{const f=$('raceImportFile').files?.[0],st=$('chass82ActionStatus');if(f&&st)st.textContent=`${f.name} を読み込み中…`;setTimeout(syncImportStatus,300);setTimeout(syncImportStatus,1200);});
  }
  function syncImportStatus(){const st=$('chass82ActionStatus'),src=$('importStatus');if(st&&src&&src.textContent.trim())st.textContent=src.textContent.trim();}

  function currentRows(){
    const rows=qsa('.horse-row');
    return rows.map((r,i)=>{let h=null;try{h=typeof horseFromRow==='function'?horseFromRow(r):null;}catch{}const name=(h?.['horse-name']??r.querySelector('.horse-name')?.value??'').trim();if(!name)return null;const no=String(h?.['horse-no']??r.querySelector('.horse-no')?.value??i+1),mark=String(h?.mark??r.querySelector('.mark')?.value??''),win=n(h?.win??r.querySelector('.win')?.value),place=n(h?.place??r.querySelector('.place')?.value),time=String(h?.time??r.querySelector('.time')?.value??''),odds=n(h?.odds??r.querySelector('.odds')?.value),pop=n(h?.pop??r.querySelector('.pop')?.value);let overall=null;try{if(typeof aiBreakdown==='function'){const hs=rows.map(rr=>typeof horseFromRow==='function'?horseFromRow(rr):{});overall=n(aiBreakdown(h,hs)?.overall);}}catch{}return{no,name,mark,win,place,time,overall,odds,pop};}).filter(Boolean);
  }
  function renderQuick82(){
    const el=$('quickCompare');if(!el)return;const hs=currentRows();if(!hs.length)return;const marketReal=String($('oddsType')?.value||'')==='実オッズ';
    const sorted=[...hs].sort((a,b)=>(b.win??-1)-(a.win??-1));
    el.innerHTML=`<div class="quick-mobile-list">${sorted.map(h=>{const fair=h.win&&h.win>0?100/h.win:null,ev=marketReal&&h.odds&&h.win!=null?h.win*h.odds:null,market=marketReal&&h.odds?`${h.odds.toFixed(1)}倍${h.pop?` / ${h.pop}人気`:''}`:'実オッズ —';return `<article class="quick-mobile-row"><div class="quick-mobile-head"><strong class="horse-number-badge">${esc(h.no)}</strong><strong class="quick-name">${esc((h.mark?h.mark+' ':'')+h.name)}</strong><span class="quick-mark">${market}${ev!==null?` ｜ 期待 ${ev.toFixed(0)}%`:fair?` ｜ AIフェア ${fair.toFixed(1)}倍`:''}</span></div><div class="quick-mobile-stats"><div><span>勝</span><strong>${h.win==null?'—':h.win.toFixed(1)+'%'}</strong></div><div><span>複</span><strong>${h.place==null?'—':h.place.toFixed(1)+'%'}</strong></div><div><span>TIME</span><strong>${esc(h.time||'—')}</strong></div><div><span>総合</span><strong>${h.overall==null?'—':Math.round(h.overall)}</strong></div></div></article>`;}).join('')}</div>`;
  }

  function findResultSection(){const btn=$('fetchOfficialResult');return btn?.closest('section.card')||qsa('section.card').find(s=>/レース後検証/.test(s.textContent||''))||null;}
  function makeResultIndependent(){const sec=findResultSection();if(!sec)return;sec.classList.add('chass82-result-anchor');const details=sec.closest('details.ops-panel, details');if(details&&details.parentNode)details.insertAdjacentElement('afterend',sec);if(!$('chass82ResultJump')){const b=document.createElement('button');b.id='chass82ResultJump';b.type='button';b.title='レース後検証';b.textContent='✓';b.addEventListener('click',()=>sec.scrollIntoView({behavior:'smooth',block:'start'}));document.body.appendChild(b);}}

  function refresh(){updateVersion();syncImportStatus();renderQuick82();makeResultIndependent();}
  function hookFunction(name,after){const fn=window[name];if(typeof fn!=='function'||fn.__chass82)return;const w=function(...args){const out=fn.apply(this,args);Promise.resolve(out).finally(()=>setTimeout(after,20));return out;};w.__chass82=true;window[name]=w;}
  function installHooks(){['renderQuickCompare','renderAllAiBreakdowns','renderValueRanking','applyOfficialOdds','applyOfficialResult','renderDashboard'].forEach(name=>hookFunction(name,refresh));}

  function boot(){injectStyles();updateVersion();ensureActionPanel();makeResultIndependent();installHooks();refresh();document.addEventListener('input',e=>{if(e.target?.matches?.('.win,.place,.odds,.pop,.time,.horse-name,.horse-no,.mark,#oddsType')){clearTimeout(window.__ch82Input);window.__ch82Input=setTimeout(renderQuick82,80);}});document.addEventListener('change',e=>{if(e.target?.matches?.('.win,.place,.odds,.pop,.time,.horse-name,.horse-no,.mark,#oddsType'))setTimeout(renderQuick82,60);});const obs=new MutationObserver(()=>{clearTimeout(window.__ch82Mut);window.__ch82Mut=setTimeout(()=>{ensureActionPanel();makeResultIndependent();renderQuick82();syncImportStatus();},120);});obs.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
