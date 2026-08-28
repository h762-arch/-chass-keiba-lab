(() => {
'use strict';
const VERSION='9.3';
function setVersion(){
  document.title=document.title.replace(/Ver\.\d+(?:\.\d+)*/g,`Ver.${VERSION}`);
  document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
}
function addNote(){
 const d=document.getElementById('dashboardView'); if(!d||document.getElementById('chass90note'))return;
 const n=document.createElement('div');n.id='chass90note';n.className='card';n.innerHTML='<p class="eyebrow">CHASS 9.3 AUTO RACE DATA</p><h2>公式データ自動生成</h2><p class="muted">日付・競馬場・レース番号を選ぶだけで、NAR公式出馬表と取得可能なオッズから内部レースデータを自動生成します。手動JSON取込も引き続き利用できます。</p>';
 d.prepend(n);
}
function boot(){setVersion();addNote();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
