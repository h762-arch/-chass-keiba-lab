import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {handleReaderSessionRequest,readerSessionValid} from '../src/prediction/reader-session-v1.mjs';
import {cpsiDriveReaderAuthorized,handleCpsiDriveRequest} from '../src/prediction/cpsi-drive-reader-v1.mjs';
import {handleDailyAnalysisRequest} from '../src/prediction/daily-analysis-worker-v1.mjs';
import worker from '../worker-entry.mjs';
const BASE='https://synthetic.example',PATH='/api/chass/v1/reader-session',TOKEN='SYNTHETIC_READER_TOKEN_'+'a'.repeat(32),NOW=Date.now();
const env={CHASS_CPSI_DRIVE_READER_TOKEN:TOKEN};
const req=(method='GET',headers={},base=BASE)=>new Request(base+PATH,{method,headers:{...(method==='GET'?{}:{origin:base}),...headers}});
async function login(){return handleReaderSessionRequest(req('POST',{authorization:'Bearer '+TOKEN}),env,{now:NOW});}
async function cookie(){return (await login()).headers.get('set-cookie').split(';')[0];}
test('explicit remember creates a host-only HttpOnly Secure Strict 30-day session without returning reader secret',async()=>{
 const r=await login(),set=r.headers.get('set-cookie'),body=await r.json();assert.equal(r.status,200);assert.equal(body.connected,true);
 assert.match(set,/^__Host-chass_reader_v1=v1\./);for(const flag of ['Path=/','Max-Age=2592000','Secure','HttpOnly','SameSite=Strict'])assert.ok(set.includes(flag));
 assert.doesNotMatch(set,/Domain=/);assert.ok(!(JSON.stringify(body)+set).includes(TOKEN));assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('vary'),/Cookie/);
});
test('new request/reload restores session and both private read surfaces accept cookie without bearer',async()=>{
 const c=await cookie(),headers={cookie:c};
 assert.equal((await (await handleReaderSessionRequest(req('GET',headers),env,{now:NOW})).json()).connected,true);
 assert.equal(await cpsiDriveReaderAuthorized(new Request(BASE+'/api/cpsi/sources/drive',{headers}),env),true);
 const r=await handleDailyAnalysisRequest(new Request(BASE+'/api/chass/v1/research/daily/setup',{headers}),env);assert.equal(r.status,200);assert.match(r.headers.get('vary'),/Cookie/);
 const s=await handleCpsiDriveRequest(new Request(BASE+'/api/cpsi/sources/drive?organization=NAR&raceId=2026-10-23%7C浦和%7C1',{headers}),{...env,ENABLE_CPSI_DRIVE_READ:'true'});
 assert.equal((await s.json()).code,'DRIVE_CONFIG_INVALID'); // admitted, then registry missing; no Google call
});
test('tampering, expiration, future issuance, host change, sibling origin and key rotation invalidate session',async()=>{
 const c=await cookie(),get=(headers={},base=BASE)=>req('GET',{cookie:c,...headers},base);
 assert.equal(await readerSessionValid(get(),TOKEN,NOW+30*86400000),false);
 assert.equal(await readerSessionValid(get(),TOKEN,NOW-1000),false);
 assert.equal(await readerSessionValid(get({cookie:c.slice(0,-1)+(c.endsWith('0')?'1':'0')}),TOKEN,NOW),false);
 assert.equal(await readerSessionValid(get({},'https://other.example'),TOKEN,NOW),false);
 assert.equal(await readerSessionValid(get({'sec-fetch-site':'same-site'}),TOKEN,NOW),false);
 assert.equal(await readerSessionValid(get(),TOKEN+'b',NOW),false);
 assert.equal(await readerSessionValid(get({cookie:c+'; '+c}),TOKEN,NOW),false);
 assert.equal(await cpsiDriveReaderAuthorized(new Request(BASE+'/api/chass/v1/research/daily',{headers:{cookie:c,authorization:'Bearer wrong'}}),env),false);
});
test('CSRF, GET key/query, missing key and wrong key cannot establish a session',async()=>{
 for(const r of [req('POST',{origin:'https://foreign.example',authorization:'Bearer '+TOKEN}),new Request(BASE+PATH,{method:'POST',headers:{authorization:'Bearer '+TOKEN}}),req('POST',{authorization:'Bearer wrong'}),req('POST'),new Request(BASE+PATH+'?key='+TOKEN)]){
  const out=await handleReaderSessionRequest(r,env);assert.ok([401,403].includes(out.status));assert.equal(out.headers.get('set-cookie'),null);
 }
 assert.equal((await handleReaderSessionRequest(req('GET'),env)).headers.get('set-cookie'),null);
});
test('logout clears current browser cookie, blocks cross-origin logout and does no D1/Google I/O',async()=>{
 const r=await handleReaderSessionRequest(req('DELETE'),env);assert.equal((await r.json()).connected,false);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
 const bad=await handleReaderSessionRequest(req('DELETE',{origin:'https://foreign.example'}),env);assert.equal(bad.status,403);assert.equal(bad.headers.get('set-cookie'),null);
 const routed=await worker.fetch(req('POST',{authorization:'Bearer '+TOKEN}),{...env,DB:new Proxy({},{get(){throw Error('D1 touched');}})},{});assert.equal(routed.status,200);
});
function client(fetchImpl){
 const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',checked:false});return elements.get(id);};
 const window={__CHASS_TEST__:true,CHASS_FEATURES:{}},writes=[];
 vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),vm.createContext({window,document:{getElementById:el},fetch:fetchImpl,AbortController,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,Response,console,setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:()=>null,setItem:(...a)=>writes.push(a)}}));
 return {app:window.CHASS_TEST,el,writes};
}
test('client remembers once, then fresh app instance restores cookie session without key or storage writes; logout removes auth',async()=>{
 let connected=false;const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');if(options.method==='POST'){assert.equal(options.headers.authorization,'Bearer '+TOKEN);connected=true;}if(options.method==='DELETE')connected=false;return Response.json({ok:true,connected});};
 const a=client(fetcher);a.el('cpsiDriveReaderKey').value=TOKEN;assert.equal(await a.app.readerSessionAction('POST'),true);assert.equal(a.el('cpsiDriveReaderKey').value,'');assert.equal(a.app.cpsiReaderHeaders().authorization,undefined);assert.deepEqual(a.writes,[]);
 const b=client(fetcher);assert.equal(await b.app.readerSessionAction(),true);assert.equal(b.app.cpsiReaderHeaders().authorization,undefined);assert.match(b.el('cpsiReaderSessionStatus').textContent,/保持中/);assert.deepEqual(b.writes,[]);
 await b.app.readerSessionAction('DELETE');assert.equal(connected,false);assert.match(b.el('cpsiReaderSessionStatus').textContent,/解除しました/);assert.ok(calls.every(c=>!c.url.includes(TOKEN)));
});
test('failed cookie persistence never claims remember success and does not expose entered key',async()=>{
 const a=client(async()=>Response.json({ok:false},{status:401}));a.el('cpsiDriveReaderKey').value=TOKEN;assert.equal(await a.app.readerSessionAction('POST'),false);assert.match(a.el('cpsiReaderSessionStatus').textContent,/保持できません/);assert.ok(!a.el('cpsiReaderSessionStatus').textContent.includes(TOKEN));assert.deepEqual(a.writes,[]);
});
test('browser rejecting session cookie is reported as failure even if login POST succeeded',async()=>{
 const a=client(async(url,options)=>Response.json({ok:true,connected:options.method==='POST'}));a.el('cpsiDriveReaderKey').value=TOKEN;
 assert.equal(await a.app.readerSessionAction('POST'),false);assert.match(a.el('cpsiReaderSessionStatus').textContent,/保持できません/);
});
