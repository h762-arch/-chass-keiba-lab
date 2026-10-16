import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {versionedSaveFixture} from './fixtures/nar/phase1409-versioned-save-fixtures.mjs';
import {inspectNarDirectCard as inspect} from '../src/research/nar-direct-card-inspection.mjs';
import {runNarDirectCardCli} from '../scripts/inspect-nar-direct-card.mjs';
const date='2026-10-16',now=Date.parse('2026-10-15T22:00:00.000Z');
const page=url=>{const u=new URL(url);u.searchParams.set('k_babaCode','22');return versionedSaveFixture(u.toString()).replaceAll('金沢','川崎');};
const response=value=>new Response(value,{headers:{'content-type':'text/html; charset=utf-8'}});
const options=()=>({date,code:'21',race:1,wallNow:()=>now,fetchImpl:async url=>response(page(url))});

test('one direct fixed GET parses a card without making or synthesizing a meeting request',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('GLOBAL_FETCH_FORBIDDEN');});const calls=[];
 const r=await inspect({...options(),fetchImpl:async(url,init)=>{calls.push({url,init});return response(page(url));}});
 assert.equal(r.status,'DIRECT_CARD_PARSE_OBSERVED');assert.equal(r.requestCount,1);assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=21&k_raceDate=2026/10/16&k_raceNo=1');
 assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.redirect,'manual');assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.headers,undefined);
 assert.equal(r.meetingVerified,false);assert.equal(r.meetingToCardStatus,'NOT_PERFORMED');assert.equal(r.card.horseCount,2);assert.equal(r.card.activeFiniteAbilityCount,2);
 assert.equal(r.card.optionalNetworkReads,'NOT_PERFORMED');assert.equal(r.card.parserBasis,'EXISTING_BUILD_NAR_RACE_PAYLOAD_STABLE');
});
test('card observation never certifies collection, meeting, fresh mirror, Worker replay or activation',async()=>{
 for(const fetchImpl of [options().fetchImpl,async()=>new Response('',{status:404})]){
  const r=await inspect({...options(),fetchImpl});assert.equal(r.acquisitionCertified,false);assert.equal(r.currentStatusEligible,false);
  assert.equal(r.meetingVerified,false);assert.equal(r.meetingToCardStatus,'NOT_PERFORMED');assert.equal(r.collectionStatus,'NOT_EVALUATED');assert.equal(r.mirrorFreshness,'NOT_EVALUATED');
  assert.equal(r.productionSourceChanged,false);assert.equal(r.snapshotCreated,false);assert.equal(r.savedDataVerification,'NOT_PERFORMED');
  assert.equal(r.production404Cause,'NOT_ESTABLISHED');assert.equal(r.executionBasis,'STANDALONE_FETCH_NOT_WORKER_REPLAY');
  assert.equal(r.formalKpiEligible,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');
 }
});
test('old and future dates are rejected before requesting the card',async()=>{
 for(const d of ['2026-10-15','2026-10-17']){let calls=0;const r=await inspect({...options(),date:d,fetchImpl:async()=>{calls++;}});
  assert.deepEqual(r.reasonCodes,['CURRENT_JST_DATE_REQUIRED']);assert.equal(calls,0);
 }
});
test('invalid identities and unsafe options fail before GET and do not echo inputs',async()=>{
 for(const patch of [{date:'2026-02-30'},{code:21},{code:'021'},{code:'PRIVATE_SECRET'},{race:'1'},{race:0},{race:21},{fetchImpl:null},{wallNow:null},{timeoutMs:0},{timeoutMs:5001}]){
  let calls=0;const r=await inspect({...options(),fetchImpl:async()=>{calls++;},...patch});assert.equal(r.status,'HOLD');assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('JST date rollover before the request makes zero GETs',async()=>{
 let n=0,calls=0;const end=Date.parse('2026-10-16T15:00:00.000Z');
 const r=await inspect({...options(),wallNow:()=>++n===1?end-1:end,fetchImpl:async()=>{calls++;}});
 assert.deepEqual(r.reasonCodes,['REQUEST_DATE_CHANGED']);assert.equal(calls,0);
});
test('wrong date, venue or race in the fetched header cannot be promoted by requested identity',async()=>{
 for(const alter of [s=>s.replace('2026年10月16日','2026年10月15日'),s=>s.replace('川崎','名古屋'),s=>s.replace('第1競走','第2競走')]){
  const r=await inspect({...options(),fetchImpl:async url=>response(alter(page(url)))});
  assert.deepEqual(r.reasonCodes,['CARD_IDENTITY_INVALID']);assert.equal(r.requests[0].status,'CAPTURED');assert.equal(r.card,null);
 }
});
test('a menu-shaped HTTP200 response is not a card',async()=>{
 const r=await inspect({...options(),fetchImpl:async()=>response('<h1>2026年10月16日 川崎競馬 当日メニュー</h1><a>1R</a>')});
 assert.deepEqual(r.reasonCodes,['CARD_IDENTITY_INVALID']);assert.equal(r.card,null);
});
test('missing post time, unsupported distance or surface stays HOLD',async()=>{
 for(const alter of [s=>s.replace('15:00発走','発走時刻未定'),s=>s.replace('ダート1400m','ダート700m'),s=>s.replace('ダート1400m','条件不明')]){
  const r=await inspect({...options(),fetchImpl:async url=>response(alter(page(url)))});assert.equal(r.status,'HOLD');assert.equal(r.card,null);
 }
});
test('one runner cannot satisfy the existing collector field gate',async()=>{
 const r=await inspect({...options(),fetchImpl:async url=>response(page(url).replace(/<tr class="dbitem">[\s\S]*?<\/tr>/,''))});
 assert.equal(r.status,'HOLD');assert.equal(r.card,null);
});
test('missing ability inputs preserve partial counts and do not fabricate scores',async()=>{
 const body='<h4>2026年10月16日 川崎 第1競走 15:00発走</h4><h2>ダート1400m</h2><table>'+['ハルノカゼ','アキノツキ'].map((name,i)=>`<tr class="dbitem"><td>${i+1}</td><td><font class="bamei"><b>${name}</b></font></td><td>検証調教師（川崎）</td><td>56.0 検証騎手</td><td>過去走不明</td></tr>`).join('')+'</table>';
 const r=await inspect({...options(),fetchImpl:async()=>response(body)});assert.deepEqual(r.reasonCodes,['ABILITY_INSUFFICIENT']);assert.ok(r.card.activeFiniteAbilityCount<2);assert.equal(r.acquisitionCertified,false);
});
test('normal string runner numbers from the actual parser pass the field gate',async()=>{
 const r=await inspect(options());assert.equal(r.status,'DIRECT_CARD_PARSE_OBSERVED');assert.equal(r.card.activeHorseCount,2);assert.equal(r.card.activeTimePresentCount,2);
});
test('post time is enforced at completion, not only when the GET starts',async()=>{
 const post=Date.parse('2026-10-16T06:00:00.000Z');let n=0;
 const r=await inspect({...options(),wallNow:()=>++n<4?post-1:post});assert.deepEqual(r.reasonCodes,['POST_TIME_REACHED']);assert.equal(r.card.postTime,'15:00');
 const before=await inspect({...options(),wallNow:()=>post-1});assert.equal(before.status,'DIRECT_CARD_PARSE_OBSERVED');
});
test('JST date rollover after response or after parsing cannot yield an observation',async()=>{
 const next=Date.parse('2026-10-16T15:00:00.000Z');
 for(const boundary of [3,4]){let n=0;const r=await inspect({...options(),wallNow:()=>++n<boundary?next-1:next});assert.deepEqual(r.reasonCodes,['REQUEST_DATE_CHANGED']);assert.equal(r.requestCount,1);assert.equal(r.card,null);}
});
test('non-finite and backward clocks fail closed without manufacturing capture times',async()=>{
 assert.deepEqual((await inspect({...options(),wallNow:()=>NaN})).reasonCodes,['INSPECTION_CLOCK_INVALID']);
 const times=[now,now,now-1];const r=await inspect({...options(),wallNow:()=>times.shift()});assert.deepEqual(r.reasonCodes,['INSPECTION_CLOCK_INVALID']);assert.equal(r.requests[0].status,'FAILED');assert.equal(r.requests[0].finishedAt,undefined);
});
test('redirect and HTTP failures get no retry, meeting request or alternate source',async()=>{
 for(const status of [302,404,429,500]){let calls=0;const r=await inspect({...options(),fetchImpl:async()=>{calls++;return new Response('PRIVATE_SECRET',{status,headers:{location:'https://example.invalid/PRIVATE_SECRET'}});}});
  assert.deepEqual(r.reasonCodes,['SOURCE_HTTP']);assert.equal(r.requests[0].httpStatus,status);assert.equal(calls,1);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('unsupported content type is not captured HTML',async()=>{
 const r=await inspect({...options(),fetchImpl:async()=>new Response('PRIVATE_SECRET',{headers:{'content-type':'application/json'}})});
 assert.deepEqual(r.reasonCodes,['SOURCE_CONTENT_TYPE']);assert.equal(r.requests[0].status,'FAILED');assert.equal(r.requests[0].decodedHtmlSha256,undefined);
});
test('the existing reader enforces UTF8 and the one-megabyte byte bound',async()=>{
 for(const [body,reason] of [[new Uint8Array([255]),'SOURCE_DECODE'],[' '.repeat(1000001),'SOURCE_SIZE']]){
  const r=await inspect({...options(),fetchImpl:async()=>response(body)});assert.deepEqual(r.reasonCodes,[reason]);assert.equal(r.card,null);
 }
});
test('hanging connection or body stops at the bounded deadline',async()=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}}))]){
  const r=await inspect({...options(),timeoutMs:5,fetchImpl});assert.deepEqual(r.reasonCodes,['SOURCE_DEADLINE']);assert.equal(r.requestCount,1);
 }
});
test('late fetch is cancelled and cannot mutate the returned evidence',async()=>{
 let resolve,cancelled=0,calls=0;const r=await inspect({...options(),timeoutMs:5,fetchImpl:()=>{calls++;return new Promise(done=>{resolve=done;});}});
 const before=JSON.stringify(r);resolve(response(new ReadableStream({cancel(){cancelled++;}})));await new Promise(done=>setTimeout(done,0));
 assert.equal(cancelled,1);assert.equal(calls,1);assert.equal(JSON.stringify(r),before);
});
test('decoded-BOM fingerprint is explicit and never described as received-byte identity',async()=>{
 const text=page('https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=21&k_raceDate=2026/10/16&k_raceNo=1');
 const bytes=new Uint8Array([239,187,191,...new TextEncoder().encode(text)]);
 const r=await inspect({...options(),fetchImpl:async()=>response(bytes)});assert.equal(r.status,'DIRECT_CARD_PARSE_OBSERVED');
 assert.equal(r.requests[0].fingerprintBasis,'DECODED_HTML_UTF8_REENCODED');assert.equal(r.requests[0].decodedUtf8Bytes,Buffer.byteLength(text));
 assert.equal(r.requests[0].decodedHtmlSha256,createHash('sha256').update(text).digest('hex'));assert.notEqual(r.requests[0].decodedHtmlSha256,createHash('sha256').update(bytes).digest('hex'));
});
test('no raw HTML, horse names, calculated scores or arbitrary exception text is emitted',async()=>{
 const r=await inspect({...options(),fetchImpl:async url=>response(page(url)+'<script>PRIVATE_SECRET</script>')});assert.equal(r.status,'DIRECT_CARD_PARSE_OBSERVED');
 const s=JSON.stringify(r);for(const forbidden of ['PRIVATE_SECRET','合成22試験','abilityScore','predictedTime'])assert.equal(s.includes(forbidden),false);
 const error=await inspect({...options(),fetchImpl:async()=>{throw Error('PRIVATE_SECRET');}});assert.deepEqual(error.reasonCodes,['CARD_READ_UNAVAILABLE']);assert.equal(JSON.stringify(error).includes('PRIVATE_SECRET'),false);
});
test('CLI explicit identity wins and extra URL, token, DB, save, clock or timeout flags fail',async()=>{
 const args=['--date',date,'--code','21','--race','1'];assert.equal((await runNarDirectCardCli(args,{...options(),date:'2026-10-15',code:'22',race:2})).status,'DIRECT_CARD_PARSE_OBSERVED');
 for(const extra of [['--url','https://example.invalid'],['--token','PRIVATE_SECRET'],['--db','PRIVATE_SECRET'],['--save'],['--now','0'],['--timeout','1'],['--historical']]){
  let calls=0;const r=await runNarDirectCardCli([...args,...extra],{...options(),fetchImpl:async()=>{calls++;}});assert.deepEqual(r.reasonCodes,['CLI_ARGUMENTS_INVALID']);assert.equal(calls,0);
 }
});
test('CLI rejects noncanonical identity syntax and executable exits nonzero for HOLD',async()=>{
 for(const args of [['--date','2026-02-30','--code','21','--race','1'],['--date',date,'--code','021','--race','1'],['--date',date,'--code','21','--race','01']])assert.deepEqual((await runNarDirectCardCli(args,options())).reasonCodes,['CLI_ARGUMENTS_INVALID']);
 const child=spawnSync(process.execPath,['scripts/inspect-nar-direct-card.mjs'],{encoding:'utf8'});assert.equal(child.status,1);assert.deepEqual(JSON.parse(child.stdout).reasonCodes,['CLI_ARGUMENTS_INVALID']);
});
