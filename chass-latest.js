/* CHASS KEIBA LAB Ver.7.9
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

/* CHASS KEIBA LAB Ver.7.9
   RESULT RESTORE / INDEPENDENT POST-RACE VALIDATION
   - レース後検証を「運用」折りたたみから独立
   - NAR公式 結果・最終オッズ取得ボタンを常時表示
   - 同一Worker /api/nar/sync を優先して利用
   - 公式取得後: 着順・実走タイム・最終オッズを反映し、自動保存/再集計
*/
(() => {
  'use strict';
  const VERSION='7.9';
  const $79=id=>document.getElementById(id);
  const q79=(s,r=document)=>r.querySelector(s);
  const qa79=(s,r=document)=>[...r.querySelectorAll(s)];

  const TRACK_CODES79={
    '船橋':'19','笠松':'22','園田':'27','姫路':'28','門別':'36'
  };

  function updateVersion79(){
    document.title=document.title.replace(/Ver\.\d+(?:\.\d+)?/g,`Ver.${VERSION}`);
    const span=q79('.topbar h1 span');
    if(span)span.textContent=`Ver.${VERSION}`;
  }

  function injectStyles79(){
    if($79('chass79Styles'))return;
    const st=document.createElement('style');
    st.id='chass79Styles';
    st.textContent=`
      #chassIndependentResult{order:6!important;margin-top:16px}
      #chassIndependentResult .official-result-box{display:grid;gap:10px;margin:12px 0 18px;padding:14px;border:1px solid rgba(92,224,190,.28);border-radius:16px;background:rgba(92,224,190,.045)}
      #chassIndependentResult #fetchOfficialResult{width:100%;min-height:56px;font-weight:900}
      #chassIndependentResult #officialResultStatus{line-height:1.5}
      #chassIndependentResult .nar-api-settings{display:none!important}
      #chassIndependentResult .result-grid79{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      #chassIndependentResult .result-grid79 label{min-width:0}
      #chassIndependentResult .result-grid79 input{font-size:1.15rem;font-weight:800}
      #chassIndependentResult .result-auto79{margin-top:12px}
      #chassIndependentResult .result-source79{font-size:.78rem;opacity:.72;margin-top:8px;line-height:1.45}
      #chassIndependentResult.official-ok79{border-color:rgba(92,224,190,.52)}
      #chassIndependentResult.official-warn79{border-color:rgba(255,190,70,.42)}
      @media(max-width:680px){
        #chassIndependentResult .result-grid79{grid-template-columns:1fr}
        #chassIndependentResult{padding:16px!important}
      }
    `;
    document.head.appendChild(st);
  }

  function findResultSection79(){
    const r1=$79('result1');
    if(!r1)return null;
    return r1.closest('section.card') || r1.closest('.card') || r1.parentElement;
  }

  function setStatus79(text,kind=''){
    const el=$79('officialResultStatus');
    const sec=$79('chassIndependentResult');
    if(el)el.textContent=text;
    if(sec){
      sec.classList.remove('official-ok79','official-warn79');
      if(kind==='ok')sec.classList.add('official-ok79');
      if(kind==='warn')sec.classList.add('official-warn79');
    }
    try{ if(typeof setOfficialStatus==='function') setOfficialStatus(text,kind); }catch{}
  }

  function ensureOfficialControls79(sec){
    if(!sec)return;
    let box=q79('.official-result-box',sec);
    if(!box){
      box=document.createElement('div');
      box.className='official-result-box';
      const head=q79('.section-head',sec);
      if(head)head.insertAdjacentElement('afterend',box); else sec.prepend(box);
    }
    let btn=$79('fetchOfficialResult');
    if(!btn){
      btn=document.createElement('button');
      btn.id='fetchOfficialResult';
      btn.type='button';
      btn.className='primary';
      btn.textContent='NAR公式から結果・最終オッズを取得';
      box.appendChild(btn);
    }else if(btn.parentElement!==box){box.appendChild(btn);}
    let status=$79('officialResultStatus');
    if(!status){
      status=document.createElement('span');
      status.id='officialResultStatus';
      status.className='muted';
      status.textContent='NAR公式：取得待ち';
      box.appendChild(status);
    }else if(status.parentElement!==box){box.appendChild(status);}

    btn.onclick=()=>fetchOfficial79(false);
  }

  function makeIndependent79(){
    const sec=findResultSection79();
    if(!sec)return null;
    sec.id='chassIndependentResult';
    sec.hidden=false;
    const ops=sec.closest('details.ops-panel');
    const prediction=$79('predictionView');
    if(ops && prediction){
      // 「運用」details の外へ物理的に移動し、閉じ状態の影響を受けなくする。
      prediction.appendChild(sec);
    }
    // 既存の3列を識別し、独立カード内だけレスポンシブ化。
    const r1=$79('result1');
    const grid=r1?.closest('.grid.three') || r1?.closest('.grid');
    if(grid)grid.classList.add('result-grid79');
    const auto=$79('resultAutoReview'); if(auto)auto.classList.add('result-auto79');
    ensureOfficialControls79(sec);
    return sec;
  }

  function narCode79(){
    const track=String($79('track')?.value||'').trim();
    try{
      if(typeof narTrackCode==='function'){
        const c=String(narTrackCode()||'').trim();
        if(c)return c;
      }
    }catch{}
    return TRACK_CODES79[track]||'';
  }

  function params79(){
    return new URLSearchParams({
      code:narCode79(),
      date:String($79('raceDate')?.value||''),
      race:String($79('raceNo')?.value||'')
    });
  }

  function applyOdds79(data){
    if(!Array.isArray(data?.odds)||!data.odds.length)return 0;
    const byNo=new Map(data.odds.map(x=>[String(x.horseNo),x]));
    let n=0;
    qa79('.horse-row').forEach(row=>{
      const no=String(q79('.horse-no',row)?.value||'').trim();
      const x=byNo.get(no); if(!x)return;
      const odds=q79('.odds',row),pop=q79('.pop',row);
      if(x.winOdds!=null&&odds){odds.value=x.winOdds;n++;}
      if(x.popularity!=null&&pop)pop.value=x.popularity;
    });
    if(n){
      try{ if(typeof setAutoOddsMeta==='function')setAutoOddsMeta('実オッズ',data.checkedAt||'最終'); }catch{}
      try{ if(typeof derivePopularityFromOdds==='function')derivePopularityFromOdds(); }catch{}
      try{ if(typeof renderValueRanking==='function')renderValueRanking(); }catch{}
      try{ if(typeof renderAllAiBreakdowns==='function')renderAllAiBreakdowns(); }catch{}
    }
    return n;
  }

  function applyResult79(data){
    const order=Array.isArray(data?.finishOrder)?data.finishOrder:[];
    if(order.length>=3){
      if($79('result1'))$79('result1').value=order[0];
      if($79('result2'))$79('result2').value=order[1];
      if($79('result3'))$79('result3').value=order[2];
    }
    const times=data?.actualTimes||{};
    qa79('.horse-row').forEach(row=>{
      const no=String(q79('.horse-no',row)?.value||'').trim();
      const t=times[no]; const el=q79('.actual-time',row);
      if(t&&el)el.value=t;
    });
    try{ if(order.length&&typeof autoPersistResult==='function')autoPersistResult(); }catch{}
    try{ if(typeof refreshResultAutoReview==='function')refreshResultAutoReview(); }catch{}
    return order.length;
  }

  async function fetchOfficial79(silent=false){
    const code=narCode79(),date=String($79('raceDate')?.value||''),race=String($79('raceNo')?.value||'');
    if(!code||!date||!race){
      if(!silent)setStatus79('NAR取得には競馬場・日付・レース番号が必要です。','warn');
      return false;
    }
    try{
      setStatus79('NAR公式から結果・最終オッズを確認中…');
      // Ver.7.4以降と同じ same-origin API。手動Worker URL設定は不要。
      const res=await fetch('/api/nar/sync?'+params79().toString(),{headers:{accept:'application/json'},cache:'no-store'});
      if(!res.ok)throw new Error(res.status===404?'NAR取得APIが見つかりません':'HTTP '+res.status);
      const data=await res.json();
      if(data?.error)throw new Error(data.error);
      const oddsN=applyOdds79(data);
      const resultN=applyResult79(data);
      if(!oddsN&&!resultN){
        setStatus79(data?.pending?'NAR公式：結果確定待ちです。':'NAR公式ページは取得できましたが、反映できる結果・オッズがありません。','warn');
        return false;
      }
      try{ if(typeof saveCurrentSilent==='function')saveCurrentSilent(); }catch{}
      try{ if(typeof renderArchive==='function')renderArchive(); }catch{}
      try{ if(typeof renderDashboard==='function')renderDashboard(); }catch{}
      const bits=[];
      if(oddsN)bits.push(`最終オッズ ${oddsN}頭`);
      if(resultN)bits.push(`着順 ${data.finishOrder.slice(0,3).join('-')}`);
      setStatus79(`NAR公式反映：${bits.join(' / ')}`,'ok');
      return true;
    }catch(e){
      setStatus79(`公式取得失敗：${String(e?.message||e)}`,'warn');
      return false;
    }
  }

  function bindManualResult79(){
    ['result1','result2','result3','review'].forEach(id=>{
      const el=$79(id); if(!el||el.dataset.chass79Bound)return;
      el.dataset.chass79Bound='1';
      const fn=()=>{
        try{ if(typeof autoPersistResult==='function')autoPersistResult(); }catch{}
        try{ if(typeof refreshResultAutoReview==='function')refreshResultAutoReview(); }catch{}
      };
      el.addEventListener('input',fn); el.addEventListener('change',fn);
    });
  }

  function boot79(){
    updateVersion79();injectStyles79();makeIndependent79();bindManualResult79();
    // 既存アプリにfetchOfficialNarがあれば、今後の他機能からも同じ取得ロジックを利用。
    try{ window.fetchOfficialNar=async({silent=false}={})=>fetchOfficial79(silent); }catch{}
    // 保存済みレースを開いた後など、DOM再構成にも追従。
    let timer;
    new MutationObserver(()=>{
      clearTimeout(timer);timer=setTimeout(()=>{makeIndependent79();bindManualResult79();updateVersion79();},120);
    }).observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot79);else boot79();
})();
