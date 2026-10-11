import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {captureJraPdfOfficialCard as capture} from '../src/research/jra-pdf-official-card-capture-v1.mjs';
const html=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const table=objects=>{const h=Object.keys(objects[0]);return [h,...objects.map(o=>h.map(k=>o[k]))];};
function fixture(){const card=parseJraRaceCard(html),r=card.race;return {sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=fixture',clock:()=>`${r.date}T00:00:00Z`,
 pdfInput:{sourceRaceId:'r',canonicalRaceId:'c',sourceSpreadsheetId:'pdf',
 manifestTable:table([{Race_ID:'r','開催日':r.date,'競馬場':r.racecourse,'レース番号':r.raceNo,'芝ダ障':r.surface,'距離':r.distance,'出走頭数':3}]),
 runnerTable:table(card.horses.map(h=>({Race_ID:'r','開催日':r.date,'競馬場':r.racecourse,R:r.raceNo,'馬番':h.horseNo,'馬名':h.horseName,Horse_Key:`TEMP|${h.horseName}`,'取消状態':'UNKNOWN',KnownHistoryRuns:0,UnknownHistorySlots:5}))),
 historyTable:table(card.horses.flatMap(h=>[1,2,3,4,5].map(n=>({Race_ID:'r',Horse_Key:`TEMP|${h.horseName}`,'馬番':h.horseNo,'馬名':h.horseName,Run_No:n,'過去走日付':'UNKNOWN','競馬場':'UNKNOWN','芝ダ':'UNKNOWN','距離':'UNKNOWN','着順':'UNKNOWN','走破TIME':'UNKNOWN',Raw_PDF:'UNKNOWN'}))))},
 fetchImpl:async()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})};}
test('bounded capture records bytes, request options and separate missing-slot evidence',async()=>{const f=fixture();let options;f.fetchImpl=async(url,o)=>{assert.equal(url,f.sourceUrl);options=o;return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});};const out=await capture(f);assert.equal(options.redirect,'manual');assert.equal(options.method,'GET');assert.ok(options.signal);assert.equal(out.capture.byteLength,Buffer.byteLength(html));assert.match(out.capture.rawSha256,/^[a-f0-9]{64}$/);assert.equal(out.evidence.resolutionInput.pdfInput.missingHistoryDeclarations.length,15);assert.equal(out.evidence.resolutionInput.pdfInput.statuses.length,3);assert.equal(out.formalKpiEligible,false);});
test('body completion after post time cannot prove pre-off status',async()=>{const f=fixture(),r=parseJraRaceCard(html).race;f.timeoutMs=10000;const out=await capture({...f,clock:()=>`${r.date}T${r.postTime}:00+09:00`});assert.equal(out.evidence.source.preOffDeclared,false);assert.equal(out.evidence.resolutionInput.pdfInput.statuses.length,0);
 // Crossing the boundary inside an otherwise short capture.
 const off=Date.parse(`${r.date}T${r.postTime}:00+09:00`),short=[off-1,off,off];const crossed=await capture({...f,clock:()=>new Date(short.shift()).toISOString()});assert.equal(crossed.evidence.resolutionInput.pdfInput.statuses.length,0);});
test('HTTP errors and redirect responses reject without retry',async()=>{for(const status of [302,404,500]){let calls=0;await assert.rejects(capture({...fixture(),fetchImpl:async()=>{calls++;return new Response('',{status});}}),/HTTP_REJECTED/);assert.equal(calls,1);}});
test('foreign and changed response URLs reject',async()=>{for(const url of ['https://evil.example/JRADB/accessD.html','https://www.jra.go.jp/JRADB/accessD.html?CNAME=other'])await assert.rejects(capture({...fixture(),fetchImpl:async()=>({ok:true,status:200,url,headers:new Headers()})}),/URL_INVALID|URL_CONFLICT/);});
test('content length and streamed bytes obey the size cap',async()=>{await assert.rejects(capture({...fixture(),maxBytes:10}),/SIZE_LIMIT/);await assert.rejects(capture({...fixture(),fetchImpl:async()=>new Response(html,{headers:{'content-length':'1000001'}})}),/SIZE_LIMIT/);});
test('fetch deadline works even if the injected fetch ignores abort',async()=>{
 await assert.rejects(capture({...fixture(),timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),/DEADLINE/);
 let release,cancelled=false;
 await assert.rejects(capture({...fixture(),timeoutMs:10,fetchImpl:()=>new Promise(resolve=>{release=resolve;})}),/DEADLINE/);
 release(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/html; charset=utf-8'}}));
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cancelled,true);
});
test('a stalled body also expires and is cancelled',async()=>{let cancelled=false;await assert.rejects(capture({...fixture(),timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/html; charset=utf-8'}})}),/DEADLINE/);assert.equal(cancelled,true);});
test('unknown encoding, conflicting charset and invalid byte sequences reject',async()=>{for(const [body,type] of [['x','text/html; charset=unknown'],['<meta charset="shift_jis">','text/html; charset=utf-8'],[new Uint8Array([255]),'text/html; charset=utf-8']])await assert.rejects(capture({...fixture(),fetchImpl:async()=>new Response(body,{headers:{'content-type':type}})}),/ENCODING_INVALID|DECODE_INVALID/);});
test('reversed process clocks and invalid safety limits reject',async()=>{const f=fixture(),times=['2026-09-05T00:00:01Z','2026-09-05T00:00:00Z','2026-09-05T00:00:00Z'];await assert.rejects(capture({...f,clock:()=>times.shift()}),/CLOCK_INVALID/);for(const timeoutMs of [0,10001])await assert.rejects(capture({...f,timeoutMs}),/LIMIT_INVALID/);});
