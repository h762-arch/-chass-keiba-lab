import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
test('phone viewport displays research ability score/rank/TIME with no formal probability cards',async t=>{
 const root=new URL('..',import.meta.url).pathname,html=await readFile(root+'viewer/index.html','utf8');
 const data={ok:true,date:'2026-10-13',track:'川崎',organization:'NAR',viewerMode:'nar-precomputed-ability-research',marketEvaluation:'disabled',races:[{organization:'NAR',date:'2026-10-13',track:'川崎',raceNo:7,raceName:'試験',postTime:'18:00',distance:900,surface:'ダート',horses:[{horseNo:1,horseName:'テスト',ability:{score:87.5},abilityRank:1,probability:{win:null,top3:null},predictedTime:{text:'0:55.1'},runnerStatus:'active'}]}]};
 const probe=`<script>window.fetch=async()=>Response.json(${JSON.stringify(data)});const timer=setInterval(()=>{const body=document.querySelector('.viewer-nar-ability');if(!body)return;clearInterval(timer);const txt=body.textContent;document.documentElement.dataset.narAbility=txt.includes('能力 87.5')&&txt.includes('順位 1位')&&txt.includes('TIME 0:55.1')&&getComputedStyle(body).display!=='none'&&document.querySelector('.viewer-global-legend-shell').hidden?'pass':'fail';},25);</script>`;
 const page=html.replace('<head>','<head>'+probe);
 const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/viewer/index.html'){res.setHeader('content-type','text/html');res.end(page);return;}const f=resolve(root,'.'+path);if(!f.startsWith(resolve(root)+'/'))throw Error();res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(f));}catch{res.statusCode=404;res.end('missing');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 let chrome;for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){try{chrome=execFileSync('which',[name],{encoding:'utf8'}).trim();break;}catch{}}assert.ok(chrome,'Chrome required');
 const child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=412,810','--force-device-scale-factor=1','--virtual-time-budget=4000','--dump-dom',`http://127.0.0.1:${server.address().port}/viewer/index.html?organization=NAR&date=2026-10-13&track=${encodeURIComponent('川崎')}`]);let out='',err='';child.stdout.on('data',v=>{out+=v;});child.stderr.on('data',v=>{err+=v;});const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});assert.equal(code,0,err);assert.match(out,/data-nar-ability="pass"/,out.slice(-2500));
});
