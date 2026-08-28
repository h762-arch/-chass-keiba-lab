(() => {
'use strict';
const VERSION='9.3.2';
function setVersion(){
  document.title=document.title.replace(/Ver\.\d+(?:\.\d+)*/g,`Ver.${VERSION}`);
  document.querySelectorAll('.topbar h1 span,h1 span').forEach(el=>{if(/Ver\./.test(el.textContent||''))el.textContent=`Ver.${VERSION}`});
}
function addNote(){
 const d=document.getElementById('dashboardView'); if(!d||document.getElementById('chass90note'))return;
 const n=document.createElement('div');n.id='chass90note';n.className='card';n.innerHTML='<p class="eyebrow">CHASS 9.3.2 AUTO RESULT SAVE</p><h2>結果取得＋検証自動保存</h2><p class="muted">NAR公式の結果取得ボタン1回で、着順・最終オッズ・実走TIME取得から検証保存・ダッシュボード再集計まで自動実行します。</p>';
 d.prepend(n);
}
function boot(){setVersion();addNote();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
