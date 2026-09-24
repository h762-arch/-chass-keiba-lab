import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ROOT=fileURLToPath(new URL('..',import.meta.url));

function chromePath(){
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    try{return execFileSync('which',[name],{encoding:'utf8'}).trim()}catch{}
  }
  throw new Error('CHASS_BROWSER_SMOKE_CHROME_NOT_FOUND');
}

async function freePort(){
  return await new Promise((resolve,reject)=>{
    const server=createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      const port=typeof address==='object'&&address?address.port:null;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}

async function waitFor(url,timeoutMs=8000){
  const started=Date.now();
  let last=null;
  while(Date.now()-started<timeoutMs){
    try{const response=await fetch(url);if(response.ok)return;}catch(error){last=error}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`CHASS_BROWSER_SMOKE_SERVER_TIMEOUT:${last?.message||'unreachable'}`);
}

test('real Chromium boots shared JRA Ability Core browser chain',{timeout:30000},async t=>{
  const chrome=chromePath();
  const port=await freePort();
  const smokeName=`chass-browser-smoke-${process.pid}-${Date.now()}.html`;
  const smokePath=path.join(ROOT,smokeName);
  const index=await readFile(path.join(ROOT,'index.html'),'utf8');
  const probe=`\n<script>\n(()=>{\n const errors=[];\n let finished=false;\n const finish=(ok,detail)=>{if(finished)return;finished=true;document.documentElement.setAttribute('data-chass-browser-smoke',ok?'pass':'fail');document.documentElement.setAttribute('data-chass-browser-smoke-errors',String(errors.length));document.documentElement.setAttribute('data-chass-browser-smoke-detail',String(detail||''));};\n addEventListener('error',event=>errors.push(String(event.error?.stack||event.message||'error')));\n addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.stack||event.reason||'unhandledrejection')));\n const started=Date.now();\n const timer=setInterval(()=>{\n  try{\n   const mode=document.getElementById('raceMode');\n   const jraPanel=document.getElementById('jraInputPanel');\n   const css=[...document.styleSheets].some(sheet=>String(sheet.href||'').endsWith('/styles.css'));\n   const ready=!!window.CHASS_JRA_ABILITY_CORE&&!!window.CHASS_JRA_MODEL&&!!window.CHASS_JRA_ADAPTER&&!!mode&&!!jraPanel&&typeof mode.onchange==='function'&&css;\n   if(ready){clearInterval(timer);mode.value='JRA';mode.onchange({target:mode});const jraVisible=jraPanel.hidden===false;setTimeout(()=>finish(errors.length===0&&jraVisible,errors[0]||(jraVisible?'ready':'jra_panel_hidden')),400);return;}\n   if(Date.now()-started>5000){clearInterval(timer);finish(false,errors[0]||'bootstrap_timeout');}\n  }catch(error){errors.push(String(error?.stack||error));clearInterval(timer);finish(false,errors[0]);}\n },50);\n})();\n</script>\n`;
  assert.match(index,/<\/body>/i);
  await writeFile(smokePath,index.replace(/<\/body>/i,`${probe}</body>`),'utf8');

  const stdout=[];
  const stderr=[];
  const server=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>stdout.push(String(chunk)));
  server.stderr.on('data',chunk=>stderr.push(String(chunk)));
  t.after(async()=>{
    if(!server.killed)server.kill('SIGTERM');
    await unlink(smokePath).catch(()=>{});
  });

  await waitFor(`http://127.0.0.1:${port}/api/health`);
  const dom=execFileSync(chrome,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--run-all-compositor-stages-before-draw','--virtual-time-budget=8000','--dump-dom',
    `http://127.0.0.1:${port}/${smokeName}`
  ],{encoding:'utf8',timeout:20000,maxBuffer:20*1024*1024});

  assert.match(dom,/data-chass-browser-smoke="pass"/,`browser bootstrap failed\n${dom.slice(-4000)}\nserver stdout:${stdout.join('')}\nserver stderr:${stderr.join('')}`);
  assert.match(dom,/data-chass-browser-smoke-errors="0"/);
});
