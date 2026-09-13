import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const clientSource=fs.readFileSync(new URL('../jra-odds-client.js',import.meta.url),'utf8');
const oddsFetchSource=fs.readFileSync(new URL('../jra-odds-fetch.mjs',import.meta.url),'utf8');
const selection={date:'2026-09-05',track:'中山',race:5};
function harness(fetchImpl,applyImpl){
 class E{constructor(){this.disabled=false;this.textContent=''}}
 const elements={liveOddsSync:new E(),liveOddsStatus:new E()};let active=true,generation=1,applied=[];
 const context={window:{addEventListener(){}},document:{getElementById:id=>elements[id]},fetch:fetchImpl,AbortController,URLSearchParams,setTimeout,clearTimeout};
 vm.runInNewContext(clientSource,context,{filename:'jra-odds-client.js'});
 const api=context.window.CHASS_JRA_ODDS_CLIENT.create({isActive:()=>active,getSelection:()=>selection,getGeneration:()=>generation,apply:data=>{applied.push(data);return applyImpl?applyImpl(data):undefined}});api.setActive(true);
 return {api,elements,applied,stale(){generation++},off(){active=false;api.setActive(false)}};
}
const primaryPayload={ok:true,date:selection.date,track:selection.track,race:selection.race,odds:[{horseNo:1,odds:3.2,popularity:1}],quality:{oddsHorseCount:1,activeHorseCount:1},oddsSnapshotType:'live',acquiredAt:'2026-09-05T03:00:00.000Z'};
function overlayPayload({status='saved',time='2026-09-05T03:15:00.000Z',race=5}={}){return {ok:true,viewerMarketOverlay:[{raceNumber:race,horses:[{horseNumber:1,horseName:'馬1',odds:3.4,popularity:1,oddsStatus:status,oddsFetchedAt:time},{horseNumber:2,horseName:'馬2',odds:5.6,popularity:2,oddsStatus:status,oddsFetchedAt:time}]}]}}
test('primary current odds remain first and no fallback request is made',async()=>{const calls=[],h=harness(async url=>{calls.push(String(url));return Response.json(primaryPayload)});await h.api.load();assert.equal(calls.length,1);assert.match(calls[0],/^\/api\/jra\/odds\?/);assert.equal(h.applied.length,1);assert.equal(h.applied[0].oddsSnapshotType,'live');assert.match(h.elements.liveOddsStatus.textContent,/1\/1頭反映/);assert.match(h.elements.liveOddsStatus.textContent,/現在オッズ/)});
test('strict cache miss falls back to exact-race saved overlay with timestamp',async()=>{const calls=[],h=harness(async url=>{calls.push(String(url));if(String(url).startsWith('/api/jra/odds?'))return Response.json({ok:false,error:'JRA_ODDS_CACHE_MISS'},{status:503});return Response.json(overlayPayload())});await h.api.load();assert.equal(calls.length,2);assert.match(calls[1],/viewerMarket=1/);assert.equal(h.applied.length,1);assert.equal(h.applied[0].race,5);assert.equal(h.applied[0].oddsSnapshotType,'saved');assert.equal(h.applied[0].acquiredAt,'2026-09-05T03:15:00.000Z');assert.match(h.elements.liveOddsStatus.textContent,/保存オッズ/);assert.match(h.elements.liveOddsStatus.textContent,/取得/);assert.match(h.elements.liveOddsStatus.textContent,/現在値ではありません/)});
test('saved overlay without acquisition time is not applied',async()=>{const h=harness(async url=>String(url).startsWith('/api/jra/odds?')?Response.json({ok:false,error:'JRA_ODDS_CACHE_MISS'},{status:503}):Response.json(overlayPayload({time:''})));await h.api.load();assert.equal(h.applied.length,0);assert.match(h.elements.liveOddsStatus.textContent,/取得時刻付き保存値/)});
test('wrong-race overlay is never applied',async()=>{const h=harness(async url=>String(url).startsWith('/api/jra/odds?')?Response.json({ok:false,error:'JRA_ODDS_CACHE_MISS'},{status:503}):Response.json(overlayPayload({race:6})));await h.api.load();assert.equal(h.applied.length,0);assert.match(h.elements.liveOddsStatus.textContent,/未取得/)});
test('final persisted overlay stays final',async()=>{const h=harness(async url=>String(url).startsWith('/api/jra/odds?')?Response.json({ok:false,error:'JRA_ODDS_CACHE_MISS'},{status:503}):Response.json(overlayPayload({status:'final'})));await h.api.load();assert.equal(h.applied.length,1);assert.equal(h.applied[0].oddsSnapshotType,'final');assert.match(h.elements.liveOddsStatus.textContent,/最終オッズ/)});
test('client accepts legacy apply callbacks that return zero',async()=>{let count=0;class E{constructor(){this.disabled=false;this.textContent=''}}const elements={liveOddsSync:new E(),liveOddsStatus:new E()},context={window:{addEventListener(){}},document:{getElementById:id=>elements[id]},fetch:async()=>Response.json(primaryPayload),AbortController,URLSearchParams,setTimeout,clearTimeout};vm.runInNewContext(clientSource,context);const api=context.window.CHASS_JRA_ODDS_CLIENT.create({isActive:()=>true,getSelection:()=>selection,getGeneration:()=>1,apply:()=>count++});api.setActive(true);await api.load();assert.equal(count,1);assert.match(elements.liveOddsStatus.textContent,/1\/1頭反映/)});
test('explicit boolean false from app identity guard is rejected',async()=>{const h=harness(async()=>Response.json(primaryPayload),()=>false);await h.api.load();assert.equal(h.applied.length,1);assert.match(h.elements.liveOddsStatus.textContent,/一致しない/)});
test('strict current odds service remains separate from viewer persisted fallback',()=>{assert.match(oddsFetchSource,/readJraOfficialOddsCache/);assert.doesNotMatch(oddsFetchSource,/readJraOfficialOddsCacheForViewer/);assert.match(clientSource,/\/api\/chass\/v1\/public\/day-ai\?/);assert.match(clientSource,/viewerMarket/)});

test('disabled flag message keeps the existing ENABLE_JRA_ODDS_FETCH guidance',async()=>{
 const h=harness(async url=>{
  if(String(url).startsWith('/api/jra/odds?')){
   return Response.json({ok:false,error:'JRA_ODDS_FETCH_DISABLED'},{status:503});
  }
  return Response.json({ok:true,viewerMarketOverlay:[]});
 });
 await h.api.load();
 assert.equal(h.applied.length,0);
 assert.match(h.elements.liveOddsStatus.textContent,/ENABLE_JRA_ODDS_FETCH/);
});
