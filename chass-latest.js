(() => {
'use strict';
const VERSION='9.2';
function setVersion(){
  document.title=document.title.replace(/Ver\.\d+(?:\.\d+)*/g,`Ver.${VERSION}`);
  document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
}
function addNote(){
 const d=document.getElementById('dashboardView'); if(!d||document.getElementById('chass90note'))return;
 const n=document.createElement('div');n.id='chass90note';n.className='card';n.innerHTML='<p class="eyebrow">CHASS 9.2 FAILURE ANALYSIS</p><h2>失敗原因分析エンジン</h2><p class="muted">レースごとの外れ方を、人気・市場過大評価、穴馬/期待値過大評価、AI勝率過大評価、勝ち馬能力過小評価、穴馬取りこぼし、TIME誤差、展開・馬場検証候補へ自動分類します。</p>';
 d.prepend(n);
}
function boot(){setVersion();addNote();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
