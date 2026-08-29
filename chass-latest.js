(() => {
'use strict';
const VERSION='9.5';
const originalFetch=window.fetch.bind(window);

function setVersion(){
  document.title=document.title.replace(/Ver\.\d+(?:\.\d+)*/g,`Ver.${VERSION}`);
  document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{
    if(/Ver\./.test(el.textContent||'')) el.textContent=`Ver.${VERSION}`;
  });
}

function abilityProxy(data){
  if(!data || !Array.isArray(data.horses)) return data;
  const hasRealMarket=Array.isArray(data.odds) && data.odds.length>=2;
  const abilityReady=data.horses.filter(h=>Number.isFinite(Number(h.abilityPriorOdds))).length>=2;
  if(!hasRealMarket || !abilityReady) return data;

  // app.js 9.4 の市場事前分布部分だけを「能力事前分布」に差し替える。
  // top-level data.odds は実オッズのまま保持されるため、
  // 後段の期待値・人気・穴馬判定には本物の市場が使われる。
  data.horses=data.horses.map(h=>{
    const a=Number(h.abilityPriorOdds);
    if(!Number.isFinite(a) || a<=0) return h;
    return {
      ...h,
      odds:a,
      dataMode:'NAR自動・能力先行',
      reason:h.reason||'NAR公式過去走から市場非依存で能力評価。'
    };
  });
  data.quality={...(data.quality||{}),abilityProxyApplied:true,marketSeparated:true};
  return data;
}

window.fetch=async function(input,init){
  const response=await originalFetch(input,init);
  try{
    const url=typeof input==='string'?input:(input?.url||'');
    if(url.includes('/api/nar/race') && response.ok){
      const data=abilityProxy(await response.clone().json());
      return new Response(JSON.stringify(data),{
        status:response.status,
        statusText:response.statusText,
        headers:new Headers(response.headers)
      });
    }
  }catch(e){
    console.warn('[CHASS 9.5] ability bridge skipped',e);
  }
  return response;
};

function addNote(){
 const d=document.getElementById('dashboardView');
 if(!d||document.getElementById('chass95note'))return;
 const n=document.createElement('div');
 n.id='chass95note';
 n.className='card';
 n.innerHTML='<p class="eyebrow">CHASS 9.5 ABILITY-FIRST</p><h2>能力評価 → 市場評価を分離</h2><p class="muted">NAR公式の過去走から近走・同距離時計・距離/コース適性・位置取り傾向を能力側へ追加。単勝オッズは能力計算後に期待値・💎穴馬・⚠️危険人気馬の判定へ使用します。解析可能な過去走が不足する馬は信頼度を下げます。</p>';
 d.prepend(n);
}

function boot(){setVersion();addNote();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();