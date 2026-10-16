import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {versionedSaveFixture} from './fixtures/nar/phase1409-versioned-save-fixtures.mjs';
import {preflightNarCandidateCard as preflight} from '../src/research/nar-candidate-card-preflight.mjs';
import {runNarCandidateCardCli} from '../scripts/preflight-nar-candidate-card.mjs';
const date='2026-10-16',now=Date.parse('2026-10-15T22:00:00.000Z');
function page(url){const u=new URL(url);u.searchParams.set('k_babaCode','22');return versionedSaveFixture(u.toString()).replaceAll('金沢','川崎').replaceAll('k_babaCode=22','k_babaCode=21');}
const html=value=>new Response(value,{headers:{'content-type':'text/html; charset=utf-8'}});
const options=()=>({date,code:'21',race:1,wallNow:()=>now,fetchImpl:async url=>html(page(url))});
test('two fixed raw-slash GETs pass existing meeting/header/card parser gates with no optional network',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('GLOBAL_FETCH_FORBIDDEN');});const calls=[];
 const r=await preflight({...options(),fetchImpl:async(url,init)=>{calls.push({url,init});return html(page(url));}});
 assert.equal(r.status,'CANDIDATE_CARD_OBSERVED');assert.equal(r.requestCount,2);assert.equal(calls.length,2);
 assert.deepEqual(calls.map(c=>c.url),['https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=21&k_raceDate=2026/10/16','https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=21&k_raceDate=2026/10/16&k_raceNo=1']);
 for(const {init} of calls){assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.signal.aborted,true);}
 assert.equal(r.meeting.selectedRaceLinkMatched,true);assert.equal(r.card.horseCount,2);assert.equal(r.card.activeFiniteAbilityCount,2);
 assert.equal(r.card.optionalNetworkReads,'NOT_PERFORMED');assert.equal(r.card.parserBasis,'EXISTING_BUILD_NAR_RACE_PAYLOAD_STABLE');
});
test('normal string horse numbers from the existing parser remain valid and unique',async()=>{
 const r=await preflight(options());assert.equal(r.status,'CANDIDATE_CARD_OBSERVED');assert.equal(r.card.activeHorseCount,2);assert.equal(r.card.activeTimePresentCount,2);
});
test('candidate inspection does not certify collection, snapshot freshness, source correction or activation',async()=>{
 const r=await preflight(options());assert.equal(r.collectionStatus,'NOT_EVALUATED');assert.equal(r.mirrorFreshness,'NOT_EVALUATED');
 assert.equal(r.productionSourceChanged,false);assert.equal(r.snapshotCreated,false);assert.equal(r.acquisitionCertified,false);
 assert.equal(r.savedDataVerification,'NOT_PERFORMED');assert.equal(r.production404Cause,'NOT_ESTABLISHED');
 assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.formalKpiEligible,false);
});
test('historical and future dates are rejected before GET rather than renewing a stale mirror',async()=>{
 for(const d of ['2026-10-15','2026-10-17']){let calls=0;const r=await preflight({...options(),date:d,fetchImpl:async()=>{calls++;}});
  assert.deepEqual(r.reasonCodes,['CURRENT_JST_DATE_REQUIRED']);assert.equal(calls,0);
 }
});
test('invalid date, code, race, fetcher and timeouts fail before network',async()=>{
 for(const patch of [{date:'2026-02-30'},{code:21},{code:'021'},{code:'PRIVATE_SECRET'},{race:0},{race:21},{race:'1'},{fetchImpl:null},{wallNow:null},{perRequestTimeoutMs:0},{perRequestTimeoutMs:5001}]){
  let calls=0;const r=await preflight({...options(),fetchImpl:async()=>{calls++;},...patch});assert.equal(r.status,'HOLD');assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('wrong meeting date or venue cannot trigger a card request',async()=>{
 for(const alter of [s=>s.replace('2026年10月16日','2026年10月15日'),s=>s.replaceAll('川崎','名古屋')]){
  let calls=0;const r=await preflight({...options(),fetchImpl:async url=>{calls++;return html(alter(page(url)));}});
  assert.equal(r.status,'HOLD');assert.equal(calls,1);assert.equal(r.card,null);
 }
});
test('race must be in the observed meeting before card GET',async()=>{
 let calls=0;const r=await preflight({...options(),race:2,fetchImpl:async url=>{calls++;return html(page(url));}});
 assert.deepEqual(r.reasonCodes,['RACE_NOT_IN_MEETING']);assert.equal(calls,1);
});
test('selected race link must match date, code, route and origin with unique identity parameters',async()=>{
 for(const alter of [s=>s.replaceAll('k_babaCode=21','k_babaCode=23'),s=>s.replaceAll('k_raceDate=2026/10/16','k_raceDate=2026/10/15'),s=>s.replace('/KeibaWeb/TodayRaceInfo/DebaTableSmall','https://example.invalid/PRIVATE_SECRET'),s=>s.replace('k_babaCode=21','k_babaCode=21&amp;k_babaCode=22')]){
  let calls=0;const r=await preflight({...options(),fetchImpl:async url=>{calls++;return html(alter(page(url)));}});
  assert.deepEqual(r.reasonCodes,['RACE_LINK_IDENTITY_INVALID']);assert.equal(calls,1);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('wrong card date, venue and race header hold before interpreting a candidate',async()=>{
 for(const alter of [s=>s.replace('2026年10月16日','2026年10月15日'),s=>s.replace('川崎','名古屋'),s=>s.replace('第1競走','第2競走')]){
  const r=await preflight({...options(),fetchImpl:async url=>html(url.includes('DebaTableSmall')?alter(page(url)):page(url))});
  assert.deepEqual(r.reasonCodes,['CARD_IDENTITY_INVALID']);assert.equal(r.requestCount,2);assert.equal(r.card,null);
 }
});
test('post time is enforced at parse completion, including exact boundary',async()=>{
 const atPost=Date.parse('2026-10-16T06:00:00.000Z');
 const r=await preflight({...options(),wallNow:()=>atPost});assert.deepEqual(r.reasonCodes,['POST_TIME_REACHED']);assert.equal(r.card.postTime,'15:00');
 let n=0;const crossed=await preflight({...options(),wallNow:()=>++n<6?atPost-1:atPost});
 assert.deepEqual(crossed.reasonCodes,['POST_TIME_REACHED']);assert.equal(crossed.requestCount,2);
});
test('JST date rollover after meeting read prevents a card GET',async()=>{
 let n=0,calls=0;const end=Date.parse('2026-10-16T15:00:00.000Z');
 const r=await preflight({...options(),wallNow:()=>++n<3?end-1:end,fetchImpl:async url=>{calls++;return html(page(url));}});
 assert.deepEqual(r.reasonCodes,['REQUEST_DATE_CHANGED']);assert.equal(calls,1);
});
test('missing valid post time, distance or surface stays HOLD',async()=>{
 for(const alter of [s=>s.replace('15:00発走','発走時刻未定'),s=>s.replace('ダート1400m','ダート700m'),s=>s.replace('ダート1400m','条件不明')]){
  const r=await preflight({...options(),fetchImpl:async url=>html(url.includes('DebaTableSmall')?alter(page(url)):page(url))});
  assert.equal(r.status,'HOLD');assert.equal(r.card,null);
 }
});
test('missing retained ability inputs cannot become a candidate ready for the existing collector',async()=>{
 const body='<h4>2026年10月16日 川崎 第1競走 15:00発走</h4><h2>ダート1400m</h2><table>'+['ハルノカゼ','アキノツキ'].map((name,i)=>`<tr class="dbitem"><td>${i+1}</td><td><font class="bamei"><b>${name}</b></font></td><td>検証調教師（川崎）</td><td>56.0 検証騎手</td><td>過去走不明</td></tr>`).join('')+'</table>';
 const r=await preflight({...options(),fetchImpl:async url=>html(url.includes('DebaTableSmall')?body:page(url))});
 assert.equal(r.status,'HOLD');assert.deepEqual(r.reasonCodes,['ABILITY_INSUFFICIENT']);
 assert.ok(r.card.activeFiniteAbilityCount<2);
});
test('HTTP error or redirect stops the chain without retry or foreign request',async()=>{
 for(const status of [302,404,429,500]){
  let calls=0;const r=await preflight({...options(),fetchImpl:async()=>{calls++;return new Response('PRIVATE_SECRET',{status,headers:{location:'https://example.invalid/PRIVATE_SECRET'}});}});
  assert.deepEqual(r.reasonCodes,['SOURCE_HTTP']);assert.equal(calls,1);assert.equal(r.requests[0].httpStatus,status);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('HTTP200 unsupported content type does not count as captured HTML',async()=>{
 const r=await preflight({...options(),fetchImpl:async()=>new Response('PRIVATE_SECRET',{headers:{'content-type':'application/json'}})});
 assert.deepEqual(r.reasonCodes,['SOURCE_CONTENT_TYPE']);assert.equal(r.requestCount,1);assert.equal(r.requests[0].status,'FAILED');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('HTTP reader keeps original UTF8 and response byte bounds',async()=>{
 for(const make of [()=>html(new Uint8Array([255])),()=>html(' '.repeat(1000001))]){
  const r=await preflight({...options(),fetchImpl:async()=>make()});assert.equal(r.status,'HOLD');assert.ok(['SOURCE_DECODE','SOURCE_SIZE'].includes(r.reasonCodes[0]));assert.equal(r.requestCount,1);
 }
});
test('hanging fetch and body have a bounded deadline and never advance to a card',async()=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}}),{headers:{'content-type':'text/html'}})]){
  const r=await preflight({...options(),perRequestTimeoutMs:5,fetchImpl});assert.deepEqual(r.reasonCodes,['SOURCE_DEADLINE']);assert.equal(r.requestCount,1);assert.equal(r.card,null);
 }
});
test('decoded HTML hashes explicitly differ from original BOM-prefixed received bytes',async()=>{
 const calls=[],r=await preflight({...options(),fetchImpl:async url=>{const text=page(url);calls.push(text);return html(new Uint8Array([239,187,191,...new TextEncoder().encode(text)]));}});
 assert.equal(r.status,'CANDIDATE_CARD_OBSERVED');const q=r.requests[0];assert.equal(q.fingerprintBasis,'DECODED_HTML_UTF8_REENCODED');
 assert.equal(q.decodedHtmlSha256,createHash('sha256').update(calls[0]).digest('hex'));assert.equal(q.decodedUtf8Bytes,Buffer.byteLength(calls[0]));
 assert.notEqual(q.decodedHtmlSha256,createHash('sha256').update(new Uint8Array([239,187,191,...new TextEncoder().encode(calls[0])])).digest('hex'));
});
test('raw HTML, horse names, arbitrary URLs and exception text are not emitted',async()=>{
 const r=await preflight({...options(),fetchImpl:async url=>html(page(url)+'<script>PRIVATE_SECRET</script>')});
 assert.equal(r.status,'CANDIDATE_CARD_OBSERVED');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);assert.equal(JSON.stringify(r).includes('合成22試験'),false);
 const error=await preflight({...options(),fetchImpl:async()=>{throw Error('PRIVATE_SECRET');}});assert.equal(error.status,'HOLD');assert.equal(JSON.stringify(error).includes('PRIVATE_SECRET'),false);
});
test('invalid and backward clocks fail closed before further network requests',async()=>{
 assert.deepEqual((await preflight({...options(),wallNow:()=>NaN})).reasonCodes,['PREFLIGHT_CLOCK_INVALID']);
 const times=[now,now,now-1];let calls=0;const r=await preflight({...options(),wallNow:()=>times.shift(),fetchImpl:async url=>{calls++;return html(page(url));}});
 assert.deepEqual(r.reasonCodes,['PREFLIGHT_CLOCK_INVALID']);assert.equal(calls,1);assert.equal(r.requests[0].status,'FAILED');
});
test('explicit CLI identity overrides injected options, and URL/token/DB/save/time overrides are rejected',async()=>{
 const args=['--date',date,'--code','21','--race','1'];const r=await runNarCandidateCardCli(args,{...options(),date:'2026-10-15',code:'22',race:2});assert.equal(r.status,'CANDIDATE_CARD_OBSERVED');
 for(const extra of [['--url','https://example.invalid/'],['--token','PRIVATE_SECRET'],['--db','PRIVATE_SECRET'],['--save'],['--now','0'],['--timeout','1'],['--historical']]){
  let calls=0;const x=await runNarCandidateCardCli([...args,...extra],{...options(),fetchImpl:async()=>{calls++;}});assert.equal(x.status,'HOLD');assert.equal(calls,0);
 }
});
test('CLI date and race syntax cannot be silently normalized into another request',async()=>{
 for(const args of [['--date','2026-02-30','--code','21','--race','1'],['--date',date,'--code','021','--race','1'],['--date',date,'--code','21','--race','01'],['--date',date,'--code','21','--race','21']]){
  assert.deepEqual((await runNarCandidateCardCli(args,options())).reasonCodes,['CLI_ARGUMENTS_INVALID']);
 }
});
test('late fetch after deadline is cancelled without mutating returned audit or starting a card request',async()=>{
 let resolve,cancelled=0,calls=0;
 const result=await preflight({...options(),perRequestTimeoutMs:5,fetchImpl:()=>{calls++;return new Promise(r=>{resolve=r;});}});
 const before=JSON.stringify(result);resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'text/html'}}));
 await new Promise(r=>setTimeout(r,0));assert.equal(cancelled,1);assert.equal(calls,1);assert.equal(JSON.stringify(result),before);
});
test('JST date change between meeting and card requests stops before the second GET',async()=>{
 let n=0,calls=0;const next=Date.parse('2026-10-16T15:00:00.000Z');
 const r=await preflight({...options(),wallNow:()=>++n<4?next-1:next,fetchImpl:async url=>{calls++;return html(page(url));}});
 assert.deepEqual(r.reasonCodes,['REQUEST_DATE_CHANGED']);assert.equal(calls,1);assert.equal(r.requestCount,1);
});
