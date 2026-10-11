import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {readJraOfficialRaceCache} from '../jra-official-cache.mjs';

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

// Use wall-clock polling: virtual time can expire before IndexedDB boot completes.
async function browserDom(chrome,url){
  const profile=await mkdtemp(path.join(tmpdir(),'chass-smoke-'));
  const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--remote-debugging-pipe',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
  const pending=new Map();let nextId=0,buffer='',stderr='';
  child.stderr.on('data',chunk=>stderr+=String(chunk));
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data',chunk=>{
    buffer+=String(chunk);let end;
    while((end=buffer.indexOf('\0'))>=0){
      const frame=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!frame)continue;
      const message=JSON.parse(frame),request=pending.get(message.id);if(!request)continue;
      pending.delete(message.id);clearTimeout(request.timer);
      if(message.error)request.reject(new Error(JSON.stringify(message.error)));else request.resolve(message.result);
    }
  });
  const fail=error=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error)}pending.clear()};
  child.on('error',fail);
  child.on('exit',(code,signal)=>fail(new Error(`CHASS_BROWSER_SMOKE_CHROME_EXIT:${code}:${signal}:${stderr.slice(-1000)}`)));
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CHASS_BROWSER_SMOKE_CDP_TIMEOUT:${method}`))},8000);
    pending.set(id,{resolve,reject,timer});
    child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error)fail(error)});
  });
  child.stdio[3].on('error',fail);
  try{
    const {targetId}=await call('Target.createTarget',{url});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    const started=Date.now();let dom='';
    while(Date.now()-started<12000){
      const result=await call('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true},sessionId);
      dom=result.result?.value||'';
      if(/data-chass-browser-smoke="(?:pass|fail)"/.test(dom))return dom;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error(`CHASS_BROWSER_SMOKE_RENDER_TIMEOUT:${dom.slice(-1000)}`);
  }finally{
    const closed=new Promise(resolve=>child.once('close',resolve));
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await closed}
    await rm(profile,{recursive:true,force:true});
  }
}

test('real Chromium boots shared JRA Ability Core browser chain',{timeout:30000},async t=>{
  const chrome=chromePath();
  const port=await freePort();
  const smokeName=`chass-browser-smoke-${process.pid}-${Date.now()}.html`;
  const smokePath=path.join(ROOT,smokeName);
  const index=await readFile(path.join(ROOT,'index.html'),'utf8');
  const fixture=await readFile(path.join(ROOT,'tests/fixtures/jra/jra-race-card-fixture.html'),'utf8');
  const parsed=parseJraRaceCard(fixture,{date:'2026-09-05',track:'中山',race:5});
  const row={payload_json:JSON.stringify({ok:true,organization:'JRA',...parsed}),expires_at:'2026-09-04T00:00:00Z'};
  const {body}=await readJraOfficialRaceCache({DB:{prepare:()=>({bind:()=>({first:async()=>row})})}},{nowMs:Date.parse('2026-09-05T00:00:00Z')});
  const probe=`
<script>
(()=>{
 const errors=[];
 let finished=false,loading=false;
 const finish=(ok,detail)=>{if(finished)return;finished=true;document.documentElement.setAttribute('data-chass-browser-smoke',ok?'pass':'fail');document.documentElement.setAttribute('data-chass-browser-smoke-errors',String(errors.length));document.documentElement.setAttribute('data-chass-browser-smoke-detail',String(detail||''));};
 addEventListener('error',event=>errors.push(String(event.error?.stack||event.message||'error')));
 addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.stack||event.reason||'unhandledrejection')));
 window.CHASS_FEATURES={ENABLE_JRA_MEETING_DISCOVERY:false,ENABLE_JRA_AUTO_FETCH:false};
  const originalFetch=window.fetch.bind(window),card=${JSON.stringify(body)};
 window.fetch=(input,options)=>{
  const pathname=new URL(String(input),location.href).pathname;
  if(pathname==='/api/jra/race')return Promise.resolve(Response.json(card));
  if(pathname==='/api/jra/odds')return Promise.resolve(Response.json({ok:false,error:'JRA_ODDS_CACHE_MISS'},{status:503}));
  if(pathname.startsWith('/api/'))return Promise.resolve(Response.json({ok:false,error:'SMOKE_OFFLINE'},{status:503}));
  return originalFetch(input,options);
 };
 const started=Date.now();
 const timer=setInterval(()=>{
  try{
   const mode=document.getElementById('raceMode'),jraPanel=document.getElementById('jraInputPanel');
   const css=[...document.styleSheets].some(sheet=>String(sheet.href||'').endsWith('/styles.css'));
   const ready=!!window.CHASS_JRA_ABILITY_CORE&&!!window.CHASS_JRA_MODEL&&!!window.CHASS_JRA_ADAPTER&&!!mode&&!!jraPanel&&typeof mode.onchange==='function'&&css&&!document.getElementById('autoRaceLoad').disabled;
   if(ready&&!loading){
    loading=true;
    document.getElementById('jraDate').value=card.race.date;
    document.getElementById('jraCourse').value=card.race.racecourse;
    document.getElementById('jraRaceNo').value=String(card.race.raceNo);
    mode.value='JRA';mode.onchange({target:mode});
    document.getElementById('jraOfficialLoad').click();
   }
   if(loading){
    const status=document.getElementById('jraStatus'),rows=document.querySelectorAll('#quickList .quick-row');
    if(status.textContent.includes('予想計算完了')){
     const statusVisible=!status.closest('details:not([open])');
     const names=card.horses.every(h=>document.getElementById('quickList').textContent.includes(h.horseName));
     clearInterval(timer);finish(errors.length===0&&!jraPanel.hidden&&statusVisible&&rows.length===card.horses.length&&names,errors[0]||'saved_card_render');return;
    }
   }
   if(Date.now()-started>6000){clearInterval(timer);finish(false,errors[0]||document.getElementById('jraStatus')?.textContent||'bootstrap_timeout');}
  }catch(error){errors.push(String(error?.stack||error));clearInterval(timer);finish(false,errors[0]);}
 },50);
})();
</script>
`;
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
  const dom=await browserDom(chrome,`http://127.0.0.1:${port}/${smokeName}`);

  assert.match(dom,/data-chass-browser-smoke="pass"/,`browser bootstrap failed\n${dom.slice(-4000)}\nserver stdout:${stdout.join('')}\nserver stderr:${stderr.join('')}`);
  assert.match(dom,/data-chass-browser-smoke-errors="0"/);
});
