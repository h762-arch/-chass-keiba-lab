import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJraPrecomputeSourceLoader,projectJraPrecomputeSource} from '../src/prediction/jra-precompute-source-loader.mjs';
import {fetchDirectCard,parseJraRaceCard} from '../jra-race-fetch.mjs';
import {raceJobKey} from '../src/prediction/background-precompute.mjs';
import {createPrecomputedIdentity} from '../src/prediction/precomputed-snapshot.mjs';
import {createPrecomputeSourceBoundary} from '../src/prediction/precompute-source-boundary.mjs';

const timestamp='2026-09-23T00:00:00.000Z';
const job=Object.freeze({organization:'JRA',date:'2026-09-05',track:'中山',raceNo:5,
  raceId:raceJobKey({organization:'JRA',date:'2026-09-05',track:'中山',raceNo:5})});
const token='pw01dde0106202604010520260905/16';
const listing=`<html><body><a href="/JRADB/accessD.html?CNAME=${token}">5R</a></body></html>`;
const html=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const abortError=()=>new DOMException('Aborted','AbortError');

function service({card=html,list=listing,clock=()=>timestamp,onFetch}={}){
  const seen=[];
  const fetchImpl=async (url,options)=>{
    seen.push({url,options});
    if(onFetch)return onFetch(url,options,seen.length);
    return new Response(seen.length===1?list:card);
  };
  return {loader:createJraPrecomputeSourceLoader({fetchImpl,now:clock}),seen};
}

test('isolated JRA load returns exactly the SOURCE contract without market or fetch metadata',async()=>{
  const {loader,seen}=service();
  const controller=new AbortController();
  const source=await loader(job,{signal:controller.signal});
  assert.deepEqual(Object.keys(source),['organization','raceId','race','horses','quality','source','parserVersion','dataConfidence','acquiredAt']);
  assert.equal(source.organization,'JRA');
  assert.equal(source.raceId,raceJobKey(job));
  assert.equal(source.race.racecourse,'中山');
  assert.equal(source.acquiredAt,timestamp);
  assert.equal(source.source,'JRA_OFFICIAL');
  assert.equal(source.horses.length,3);
  for(const horse of source.horses){
    assert.equal(Object.hasOwn(horse,'odds'),false);
    assert.equal(Object.hasOwn(horse,'popularity'),false);
  }
  for(const key of ['MARKET','FINAL','RESULT','sourceUrl','navigation'])assert.equal(Object.hasOwn(source,key),false);
  assert.equal(seen.length,2);
  assert.equal(seen[0].options.signal,controller.signal);
  assert.equal(seen[1].options.signal,controller.signal);
  assert.equal(seen[0].options.method,'POST');
  assert.equal(seen[1].options.method,'GET');
  assert.equal(Object.isFrozen(job),true);
});

test('projection removes even non-null odds and popularity without mutating parsed horses',()=>{
  const parsed=parseJraRaceCard(html,{date:job.date,track:job.track,race:job.raceNo});
  const horse=Object.freeze({...parsed.horses[0],odds:2.1,popularity:1});
  const input=Object.freeze({...parsed,horses:Object.freeze([horse])});
  const source=projectJraPrecomputeSource(input,{raceId:job.raceId,acquiredAt:timestamp});
  assert.equal(Object.hasOwn(source.horses[0],'odds'),false);
  assert.equal(Object.hasOwn(source.horses[0],'popularity'),false);
  assert.equal(horse.odds,2.1);
  assert.equal(horse.popularity,1);
  assert.equal(source.horses[0].horseName,horse.horseName);
});

test('rejects non-JRA or invalid date, track, race number and identity before fetch',async()=>{
  const {loader,seen}=service();
  for(const malformed of [{...job,organization:'NAR'}, {...job,date:'2026-09-99'},
    {...job,track:'不明'}, {...job,raceNo:0},{...job,raceNo:13},{...job,raceNo:'5'},
    {...job,raceId:'mismatched'}]){
    await assert.rejects(loader(malformed,{signal:new AbortController().signal}));
  }
  assert.equal(seen.length,0);
});

test('pre-aborted and missing signals reject without fetching',async()=>{
  const {loader,seen}=service();
  const controller=new AbortController();controller.abort();
  await assert.rejects(loader(job,{signal:controller.signal}),error=>error.name==='AbortError');
  await assert.rejects(loader(job),/invalid_jra_precompute_source_signal/);
  assert.equal(seen.length,0);
});

test('navigation abort prevents card fetch even when a fake fetch ignores signal',async()=>{
  const controller=new AbortController();let resolve;
  const waiting=new Promise(done=>{resolve=done;});
  const {loader,seen}=service({onFetch:()=>waiting});
  const pending=loader(job,{signal:controller.signal});
  controller.abort();resolve(new Response(listing));
  await assert.rejects(pending,error=>error.name==='AbortError');
  assert.equal(seen.length,1);
});

test('abort during card fetch or body read never returns a SOURCE',async()=>{
  for(const duringBody of [false,true]){
    const controller=new AbortController();let release;
    const waiting=new Promise(done=>{release=done;});
    const {loader,seen}=service({onFetch:(_url,options,call)=>{
      if(call===1)return new Response(listing);
      if(!duringBody)return waiting;
      const body=new ReadableStream({start(stream){
        options.signal.addEventListener('abort',()=>stream.error(abortError()),{once:true});
      }});
      return new Response(body);
    }});
    const pending=loader(job,{signal:controller.signal});
    while(seen.length<2)await Promise.resolve();
    controller.abort();
    if(!duringBody)release(new Response(html));
    await assert.rejects(pending,error=>error.name==='AbortError');
    assert.equal(seen.length,2);
  }
});

test('post-navigation and post-card abort checkpoints fail closed',async()=>{
  for(const stop of [1,2]){
    const controller=new AbortController();
    const {loader,seen}=service({onFetch:(_url,_options,call)=>{
      if(call===stop)controller.abort();
      return new Response(call===1?listing:html);
    }});
    await assert.rejects(loader(job,{signal:controller.signal}),error=>error.name==='AbortError');
    assert.equal(seen.length,stop);
  }
});

test('abort after parse, before return, rejects without a SOURCE',async()=>{
  const controller=new AbortController();
  const {loader}=service({clock:()=>{controller.abort();return timestamp;}});
  await assert.rejects(loader(job,{signal:controller.signal}),error=>error.name==='AbortError');
});

test('parser rejects mismatched date, track and race or incomplete HTML',async()=>{
  for(const card of [html.replace('2026年9月5日','2026年9月6日'),
    html.replace('4回中山1日','4回阪神1日').replaceAll('メイクデビュー中山','メイクデビュー阪神'),
    html.replace('race_num_5.png','race_num_6.png').replace('5レース','6レース'),
    html.replace('</html>','')]){
    const {loader}=service({card});
    await assert.rejects(loader(job,{signal:new AbortController().signal}));
  }
});

test('ISO acquisition clock is validated and is excluded from semantic source identity',async()=>{
  const first=await service({clock:()=>new Date('2026-09-23T09:00:00+09:00')}).loader(job,{signal:new AbortController().signal});
  const second=await service({clock:()=> '2026-09-23T00:01:00Z'}).loader(job,{signal:new AbortController().signal});
  assert.equal(first.acquiredAt,timestamp);
  assert.equal(second.acquiredAt,'2026-09-23T00:01:00.000Z');
  const a=await createPrecomputedIdentity({organization:'JRA',source:first});
  const b=await createPrecomputedIdentity({organization:'JRA',source:second});
  assert.equal(a.sourceHash,b.sourceHash);
  assert.equal(a.inputHash,b.inputHash);
  for(const invalid of [null,'bad',NaN,Infinity]){
    const {loader}=service({clock:()=>invalid});
    await assert.rejects(loader(job,{signal:new AbortController().signal}),/invalid_jra_precompute_source_clock/);
  }
});

test('exported direct card fetch preserves Shift-JIS decoding and HTTP error semantics',async()=>{
  const bytes=new Uint8Array([60,104,116,109,108,62,0x92,0x86,0x8e,0x52,60,47,104,116,109,108,62]);
  const decoded=await fetchDirectCard(async()=>new Response(bytes,{headers:{'content-type':'text/html; charset=Shift_JIS'}}),'https://www.jra.go.jp/test',new AbortController().signal);
  assert.equal(decoded,'<html>中山</html>');
  await assert.rejects(fetchDirectCard(async()=>new Response('',{status:403}),'https://www.jra.go.jp/test',new AbortController().signal),/JRA_HTTP_ERROR/);
});

test('Boundary timeout ignores late loader completion, without joining public Race Service',async()=>{
  const controllerTimer={callback:null};let release;
  const waiting=new Promise(done=>{release=done;});
  const {loader,seen}=service({onFetch:()=>waiting});
  const boundary=createPrecomputeSourceBoundary({loadSource:loader,timeoutMs:10,
    setTimer:callback=>{controllerTimer.callback=callback;return 1;},clearTimer:()=>{}});
  const pending=boundary(job);
  controllerTimer.callback();
  await assert.rejects(pending,error=>error.code==='precompute_source_timeout');
  release(new Response(listing));
  await new Promise(done=>setImmediate(done));
  assert.equal(seen.length,1);
});

test('loader has no internal cache, pending map, timer, AbortController or Worker wiring',async()=>{
  const source=await readFile(new URL('../src/prediction/jra-precompute-source-loader.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/createJraRaceService|handleJraRaceRequest|readJraOfficialRaceCache|new AbortController|setTimeout|Promise\.race|\.prepare\s*\(/);
  for(const path of ['../worker.js','../worker-entry.mjs']){
    const worker=await readFile(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(worker,/jra-precompute-source-loader/);
  }
});
