/* CHASS KEIBA LAB permanent patch loader
   index.html only needs this file once.
   Future versions: replace chass-latest.js only.
*/
(() => {
  'use strict';

  const scripts = [
    '/chass-v7.4-patch.js',
    '/chass-v7.5-patch.js',
    '/chass-v7.6-patch.js',
    '/chass-latest.js'
  ];

  function load(src){
    return new Promise((resolve,reject)=>{
      if(document.querySelector(`script[data-chass-loader="${src}"]`)) return resolve();
      const s=document.createElement('script');
      s.src=src;
      s.async=false;
      s.dataset.chassLoader=src;
      s.onload=resolve;
      s.onerror=()=>reject(new Error(`load failed: ${src}`));
      document.body.appendChild(s);
    });
  }

  (async()=>{
    for(const src of scripts){
      try{ await load(src); }
      catch(e){ console.error('[CHASS loader]',e); }
    }
  })();
})();