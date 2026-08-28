(() => {
'use strict';
const VERSION='9.4';
function setVersion(){
  document.title=document.title.replace(/Ver\.\d+(?:\.\d+)*/g,`Ver.${VERSION}`);
  document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
}
function addNote(){
 const d=document.getElementById('dashboardView'); if(!d||document.getElementById('chass90note'))return;
 const n=document.createElement('div');n.id='chass90note';n.className='card';n.innerHTML='<p class="eyebrow">CHASS 9.4 AUTO QUALITY</p><h2>NAR自動生成・品質改善</h2><p class="muted">出馬表とオッズ表を照合して馬名誤認・距離誤認・全馬同点化を抑制。市場しかない場合は市場暫定評価と明示し、根拠のない予想TIMEは生成しません。結果取得＋自動保存も継続します。</p>';
 d.prepend(n);
}
function boot(){setVersion();addNote();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
