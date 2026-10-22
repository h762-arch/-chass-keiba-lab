import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolveChrome} from '../scripts/browser-runtime.mjs';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {tmpdir} from 'node:os';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
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
async function browserDom(chrome,url,width=390){
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
  child.stdio[4].on('error',fail);
  child.on('error',fail);
  child.on('exit',(code,signal)=>fail(new Error(`CHASS_BROWSER_SMOKE_CHROME_EXIT:${code}:${signal}:${stderr.slice(-1000)}`)));
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    // Full-suite CI starts Chrome alongside hundreds of Node test workers.
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CHASS_BROWSER_SMOKE_CDP_TIMEOUT:${method}`))},25000);
    pending.set(id,{resolve,reject,timer});
    child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error)fail(error)});
  });
  child.stdio[3].on('error',fail);
  try{
    const {targetId}=await call('Target.createTarget',{url});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true},sessionId);
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

test('390px real browser analyzes NAR, saves, restores and exports without touching forecasts',{timeout:60000},async()=>{
 const port=await freePort(),name=`wave-ui-smoke-${process.pid}.html`,fixturePath=path.join(ROOT,name),index=await readFile(path.join(ROOT,'index.html'),'utf8');
 const probe=`<script>
 window.__CHASS_TEST__=true;
 const finish=(ok,text)=>{document.documentElement.setAttribute('data-chass-browser-smoke',ok?'pass':'fail');document.documentElement.setAttribute('data-detail',text)};
 let started=false;const timer=setInterval(async()=>{
 if(started||!document.getElementById('waveAnalyze')?.onclick)return;started=true;clearInterval(timer);
 try{
 const now=Date.now(),date=new Date(now+9*3600000).toISOString().slice(0,10),at=new Date(now-10000).toISOString(),freeze=new Date(now-5000).toISOString(),post=new Date(now+3600000).toISOString(),id=date+'|浦和|1';
 const meta={organizer:'NAR',raceId:id,runId:'BROWSER_RUN',inputSnapshotId:'INPUT',kind:'EARLY',isPreResult:true,capturedAt:at,authorityRef:'INDEX'};
 const root={race:{raceDate:date,track:'浦和',raceNo:1,raceType:'NAR',surface:'ダート',waveEligibility:'NAR_FLAT',metricInputFreeze:{runId:'BROWSER_RUN',inputSnapshotId:'INPUT',indexSnapshotId:'INDEX',marketSnapshotId:'MARKET',freezeAt:freeze,postAt:post},originalEarlyMarket:{...meta,snapshotId:'MARKET',authorityRef:'MARKET_AUTH',sourceRef:'browser-fixture',sourceClass:'PREDICTED_ODDS',horses:[1,2,3].map(n=>({horseNo:n,popularity:n,odds:n+1}))},waveEvidence:{...meta,snapshotId:'EV',indexSnapshotId:'INDEX',marketSnapshotId:'MARKET',indexAuthorityRef:'INDEX',favoriteHighestIndexRank:1,multiClusterCount:0,clusterAuthorityRef:'CL',marketGapCount:0,marketGapAuthorityRef:'MG'}},horses:[1,2,3].map(n=>({horseNo:n,horseName:'馬'+n,canonicalHorseKey:'NAR:'+n,canonicalIndex:{...meta,sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:'INDEX',peak:80-n,baseline5:60-n,current:null,prev:50-n,distance:40-n,course:30-n},win:33,valueMark:'💎',abilityMark:'◎'}))};
 // Real auto UI event -> mocked network transport -> real IndexedDB readback and CPSI core.
 window.CHASS_TEST.installCpsiAutoControls();
 const source=window.CHASS_CPSI_SOURCE_RECOVERY;
 const sourceArtifact=await source.createSourceArtifact(root,{sourceRef:'synthetic-browser-auto'});
 const realFetch=window.fetch;let autoCalls=0;
 window.fetch=async(url,options)=>{
  if(String(url).startsWith('/api/cpsi/sources/drive?')){
   autoCalls++;if(options.headers.authorization!=='Bearer SYNTHETIC_CPSI_READER_TOKEN_0123456789')throw Error('auto auth');
   return Response.json({ok:true,status:'DRIVE_SOURCE_READY',organization:'NAR',raceId:id,format:source.BUNDLE_FORMAT,transportAuthenticated:true,sourceOriginAuthenticated:false,sources:[sourceArtifact]});
  }return realFetch(url,options);
 };
 for(const [key,value] of Object.entries({raceMode:'NAR',autoRaceDate:date,autoTrack:'浦和',autoRaceNo:'1',cpsiDriveReaderKey:'SYNTHETIC_CPSI_READER_TOKEN_0123456789'})){const el=document.getElementById(key);if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value))el.add(new Option(value,value));el.value=value;}
 document.getElementById('cpsiDriveReaderKey').dispatchEvent(new Event('change'));
 const autoUntil=Date.now()+6000;
 while(!document.getElementById('cpsiDriveStatus').textContent.includes('端末読戻完了')&&Date.now()<autoUntil)await new Promise(r=>setTimeout(r,30));
 if(autoCalls!==1||!window.CHASS_TEST.getCpsiFirstPreview()?.result?.cpsi)throw Error('auto CPSI:'+document.getElementById('cpsiDriveStatus').textContent);
 if(document.getElementById('cpsiDriveReaderKey').value)throw Error('credential remained in form');
 document.getElementById('cpsiAutoRead').checked=false;
 document.getElementById('cpsiAutoRead').dispatchEvent(new Event('change'));
 window.fetch=realFetch;
 window.CHASS_TEST.previewCpsiFirst(root);
 root.predictionSnapshot={createdAt:freeze,race:structuredClone(root.race),horses:structuredClone(root.horses)};
 window.CHASS_TEST.setState(root);
 const before=JSON.stringify(window.CHASS_TEST.getState());
 // Exercise the real app source getter, with an already saved prediction.
 if(!window.CHASS_WAVE_INPUT())throw Error('saved prediction incorrectly blocks read-only Wave input');
 document.getElementById('waveAnalyze').click();
 const until=Date.now()+8000;while(!document.getElementById('waveAnalysisStatus').dataset.artifactKey&&Date.now()<until)await new Promise(r=>setTimeout(r,30));
 const key=document.getElementById('waveAnalysisStatus').dataset.artifactKey;
 if(!key)throw Error('no saved readback:'+document.getElementById('waveAnalysisStatus').textContent);
 if(!document.getElementById('waveAnalysisOutput').textContent.includes('/ 100'))throw Error('score not displayed');
 if(document.getElementById('waveAnalysisOutput').querySelector('h3').textContent.includes('%'))throw Error('misleading probability');
 window.CHASS_WAVE_RESET();const select=document.getElementById('waveAnalysisSaved');select.value=key;await select.onchange({target:select});
 if(!document.getElementById('waveAnalysisStatus').textContent.includes('再検証済み'))throw Error('restore not verified');
 let downloaded=false;HTMLAnchorElement.prototype.click=function(){if(this.download.startsWith('CHASS_WAVE_'))downloaded=true};document.getElementById('waveAnalysisExport').click();if(!downloaded)throw Error('export missing');
 if(before!==JSON.stringify(window.CHASS_TEST.getState()))throw Error('forecast mutated');
 // Daily UI is a read-only consumer of the authenticated server response.
 window.CHASS_TEST.installDailyAnalysisUi();let dayCalls=0;
 window.fetch=async(url,options)=>{
  if(String(url).startsWith('/api/chass/v1/research/daily?')){
   dayCalls++;if(!options.headers.authorization.startsWith('Bearer '))throw Error('daily auth missing');
   return Response.json({ok:true,date,status:'PARTIAL',rows:[{raceId:id,result:{cpsi:window.CHASS_TEST.calculateCpsiFirst(root).result,favorite:{status:'HOLD',reason:'FAVORITE_SCENARIO_EVIDENCE_MISSING'},longshots:{rows:[{horseNo:6,popularity:6,cpsi:null,reason:'SCENARIO_MISSING'}]},wave:JSON.parse(localStorage.getItem(key)).body.result}}]});
  }return realFetch(url,options);
 };
 await document.getElementById('dailyAnalysisRefresh').onclick();
 const day=document.getElementById('dailyAnalysisOutput').textContent;
 if(dayCalls!==1||!day.includes('CPSI')||!day.includes('1番人気')||!day.includes('6番人気以下')||!day.includes('波乱度')||!day.includes('6番｜人気 6'))throw Error('daily render missing');
 if(before!==JSON.stringify(window.CHASS_TEST.getState()))throw Error('daily view mutated EARLY');
 window.fetch=realFetch;
 finish(true,'NAR_ANALYZE_SAVE_RESTORE_EXPORT_FORECAST_UNCHANGED');
 }catch(e){finish(false,e.stack||e.message)}
 },50);
 </script>`;
 await writeFile(fixturePath,index.replace('<head>','<head>'+probe));
 const server=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 try{await waitFor(`http://127.0.0.1:${port}/`);const dom=await browserDom(resolveChrome().executable,`http://127.0.0.1:${port}/${name}`);assert.match(dom,/data-chass-browser-smoke="pass"/,dom.slice(0,1800));}
 finally{server.kill('SIGTERM');await unlink(fixturePath).catch(()=>{});}
});
