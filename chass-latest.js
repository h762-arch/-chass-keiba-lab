(() => {
'use strict';
const VERSION='9.1';
function setVersion(){
  document.title=document.title.replace(/Ver\.\d+(?:\.\d+)*/g,`Ver.${VERSION}`);
  document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
}
function addNote(){
 const d=document.getElementById('dashboardView'); if(!d||document.getElementById('chass90note'))return;
 const n=document.createElement('div');n.id='chass90note';n.className='card';n.innerHTML='<p class="eyebrow">CHASS 9.1 VALIDATION ENGINE</p><h2>検証・自己改善エンジン</h2><p class="muted">◎○▲捕捉、💎・⚠️、期待値帯、人気帯、距離別、AI確率較正、NAR実走TIME誤差を蓄積し、モデル改善に使える検証基盤へ拡張しました。</p>';
 d.prepend(n);
}
function boot(){setVersion();addNote();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
