import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import worker,{fetchNarMeeting} from '../worker.js';
import wrapper from '../worker-entry.mjs';
import {fetchNarPrecomputeMeeting} from '../src/prediction/nar-ability-precompute.mjs';
import {handleNarDayPrefetchRequest} from '../src/nar/nar-day-prefetch.mjs';
import {handleNarPrefetchSchedulerRequest} from '../src/nar/nar-prefetch-scheduler.mjs';
import {getNarRaceHistory} from '../src/nar/nar-recent-history.mjs';
const pairs=[['22','金沢'],['23','笠松']],version='NAR_VENUE_ROUTING_22_23_V1';
const html=(track,code)=>`<h1>2026年10月13日 ${track}競馬 当日メニュー</h1><a href="/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=${code}&k_raceDate=2026/10/13&k_raceNo=1">1R</a>`;
test('Phase140.7 all eight runtime/UI tables agree on official 22/23 pairing',async()=>{
 for(const [path,name,inverse] of [['worker.js','TRACK_NAMES'],['server.mjs','TRACK_NAMES'],['app.js','NAR_TRACKS',true],['worker-entry.mjs','NAR_TRACK_CODES',true],['src/nar/nar-day-prefetch.mjs','NAR_TRACK_CODES',true],['src/nar/nar-recent-history.mjs','TRACK_NAMES'],['src/prediction/nar-ability-precompute.mjs','TRACKS']]){
  const src=await readFile(new URL('../'+path,import.meta.url),'utf8'),literal=src.match(new RegExp('const '+name+'=(\\{[\\s\\S]*?\\});'))?.[1];assert.ok(literal,path);const table=vm.runInNewContext('('+literal+')');for(const [code,track] of pairs)assert.equal(String(inverse?table[track]:table[code]),inverse?code:track,path);
 }
 const src=await readFile(new URL('../src/nar/nar-prefetch-scheduler.mjs',import.meta.url),'utf8'),table=vm.runInNewContext('('+src.match(/const TRACKS=(\[[\s\S]*?\]);/)[1]+')');for(const [code,track] of pairs)assert.equal(table.find(x=>x.code===code).track,track);
});
test('Phase140.7 worker discovery and precompute request correct code and validate matching venue',async()=>{
 for(const [code,track] of pairs){const urls=[],a=await fetchNarMeeting({code,date:'2026-10-13',fetcher:async url=>{urls.push(new URL(url));return html(track,code);}});assert.equal(a.track,track);assert.equal(a.status,'meeting');assert.equal(a.venueRoutingVersion,version);assert.equal(urls[0].searchParams.get('k_babaCode'),code);
 const b=await fetchNarPrecomputeMeeting({code,date:'2026-10-13',fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get('k_babaCode'),code);return new Response(html(track,code));}});assert.equal(b.track,track);assert.equal(b.status,'meeting');}
});
test('Phase140.7 mobile fallback validates corrected track against official code',async()=>{
 for(const [code,track] of pairs){let calls=0;const out=await fetchNarPrecomputeMeeting({code,date:'2026-10-13',fetchImpl:async url=>{calls++;if(calls<3)return new Response('',{status:404});return new Response(`<h1>${track}競馬 2026年10月13日</h1><a href="/KeibaWebSP/TodayRaceInfo/S_DebaTable?k_babaCode=${code}&k_raceDate=2026/10/13&k_raceNo=1">1R</a>`);}});assert.equal(out.track,track);assert.equal(out.sourceRoute,'RaceList_mobile');assert.equal(calls,3);}
});
test('Phase140.7 prefetch plans send corrected code without performing requests',async()=>{
 for(const [code,track] of pairs){const r=await handleNarDayPrefetchRequest(new Request('https://app.test/api/nar/history/prefetch-day?date=2026-10-13&chunkSize=2&track='+encodeURIComponent(track)),{}),d=await r.json();assert.equal(d.code,code);assert.equal(d.chunkCount,6);for(const item of d.chunks)assert.equal(new URL(item.url).searchParams.get('code'),code);}
});
test('Phase140.7 scheduler fanout uses corrected venue codes and unchanged track count',async()=>{
 const old=globalThis.fetch,seen=[];try{globalThis.fetch=async url=>{const u=new URL(url);seen.push(u);return Response.json({ok:true,active:false,status:'no-meeting',track:u.searchParams.get('track')});};const r=await handleNarPrefetchSchedulerRequest(new Request('https://app.test/api/nar/history/prefetch-auto?date=2026-10-13'),{PUBLIC_BASE_URL:'https://app.test'});const d=await r.json();assert.equal(d.checkedTrackCount,15);for(const [code,track] of pairs)assert.equal(seen.find(u=>u.searchParams.get('track')===track).searchParams.get('code'),code);}finally{globalThis.fetch=old;}
});
test('Phase140.7 legacy meeting cache is bypassed rather than relabeled as verified',async()=>{
 const old=globalThis.fetch;let calls=0;const db={prepare(sql){return {bind(){return this;},async first(){return {date:'2026-10-13',track:'金沢',status:'meeting',race_numbers_json:'[9]',checked_at:'2026-10-13T00:00:00Z',source:'old'};},async run(){throw Error('test cache is read only');}};}};
 try{globalThis.fetch=async()=>{calls++;return new Response(html('金沢','22'));};const r=await worker.fetch(new Request('https://app.test/api/nar/meeting?code=22&date=2026-10-13'),{DB:db}),d=await r.json();assert.equal(d.cacheHit,false);assert.equal(d.track,'金沢');assert.equal(d.venueRoutingVersion,version);assert.deepEqual(d.raceNumbers,[1]);assert.equal(calls,1);}finally{globalThis.fetch=old;}
});
test('Phase140.7 recent-history summary uses the correct target track for 22/23',async()=>{
 for(const [code,track] of pairs){const seen=[],ref='<a href="/KeibaWeb/DataRoom/HorseMarkInfo?k_lineageLoginCode=30007403486">試験</a>',cells=['2026/09/01',track,'1','試験','C1','1400','晴','良','','12','1','1','2','1','1:30.0','0','38','480','騎手','56','調教師'];
 const out=await getNarRaceHistory({code,date:'2026-10-13',race:1,fetcher:async url=>{const u=new URL(url);seen.push(u);return new Response(u.pathname.includes('HorseMarkInfo')?'<h4>試験</h4><tr>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>':ref+' ダート1400ｍ');}});assert.equal(out.targetTrack,track);for(const u of seen.filter(u=>u.searchParams.has('k_babaCode')))assert.equal(u.searchParams.get('k_babaCode'),code);assert.equal(out.horses[0].summary.sameTrackRuns,1);}
});
test('Phase140.7 fresh meeting cache persists its routing marker and reuses it without a second fetch',async()=>{
 const original=globalThis.fetch;let row=null,calls=0,writes=0;const db={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return row;},async run(){writes++;row={date:args[0],track:args[1],status:args[2],race_numbers_json:args[3],checked_at:args[4],source:args[5]};}};}};
 try{globalThis.fetch=async()=>{calls++;return new Response(html('笠松','23'));};const req=()=>new Request('https://app.test/api/nar/meeting?code=23&date=2026-10-13');const first=await(await worker.fetch(req(),{DB:db})).json();assert.equal(first.cacheHit,false);assert.equal(JSON.parse(row.race_numbers_json).venueRoutingVersion,version);const second=await(await worker.fetch(req(),{DB:db})).json();assert.equal(second.cacheHit,true);assert.equal(second.track,'笠松');assert.equal(second.venueRoutingVersion,version);assert.equal(calls,1);assert.equal(writes,1);}finally{globalThis.fetch=original;}
});
test('Phase140.7 explicit contradictory venue/code requests fail before fetching',async()=>{
 const original=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
 for(const [code,track] of pairs){const wrong=code==='22'?'23':'22',q='?date=2026-10-13&track='+encodeURIComponent(track)+'&code='+wrong;
 const a=await handleNarDayPrefetchRequest(new Request('https://app.test/api/nar/history/prefetch-day'+q),{});assert.equal(a.status,400);
 const b=await handleNarPrefetchSchedulerRequest(new Request('https://app.test/api/nar/history/prefetch-auto'+q+'&mode=track'),{});assert.equal(b.status,400);
 const c=await wrapper.fetch(new Request('https://app.test/api/chass/v1/public/race-context'+q+'&race=1'),{},{});assert.equal(c.status,400);
 }
 assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
