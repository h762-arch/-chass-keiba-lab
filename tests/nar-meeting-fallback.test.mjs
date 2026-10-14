import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchNarPrecomputeMeeting} from '../src/prediction/nar-ability-precompute.mjs';

const raceList=(track,date,numbers)=>`<!doctype html><html><body><h1>${date.slice(0,4)}年${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日 ${track}競馬 当日メニュー</h1>${numbers.map(n=>`<a href="/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=21&amp;k_raceDate=${date.replaceAll('-','/')}&amp;k_raceNo=${n}">${n}R</a>`).join('')}</body></html>`;

test('NAR precompute meeting discovery keeps the canonical RaceList as primary',async()=>{
 const calls=[];
 const value=await fetchNarPrecomputeMeeting({code:'21',date:'2026-10-14',timeoutMs:5000,fetchImpl:async url=>{
  calls.push(String(url));
  return new Response(raceList('川崎','2026-10-14',[1,2,3]),{status:200});
 }});
 assert.equal(value.status,'meeting');
 assert.equal(value.sourceRoute,'RaceList');
 assert.equal(value.attemptCount,1);
 assert.deepEqual(value.raceNumbers,[1,2,3]);
 assert.equal(calls.length,1);
});

test('NAR precompute meeting discovery falls back only to the official IPAT RaceList',async()=>{
 const calls=[];
 const value=await fetchNarPrecomputeMeeting({code:'21',date:'2026-10-14',timeoutMs:5000,fetchImpl:async url=>{
  calls.push(String(url));
  if(calls.length===1)return new Response('',{status:302,headers:{location:'https://www.keiba.go.jp/'}});
  return new Response(raceList('川崎','2026-10-14',[1,2]),{status:200});
 }});
 assert.equal(value.status,'meeting');
 assert.equal(value.sourceRoute,'RaceList_ipat');
 assert.equal(value.attemptCount,2);
 assert.match(calls[1],/\/KeibaWeb_IPAT\/TodayRaceInfo\/RaceList_ipat\?/);
});

test('NAR precompute meeting discovery fails closed when both official routes fail',async()=>{
 await assert.rejects(fetchNarPrecomputeMeeting({code:'21',date:'2026-10-14',timeoutMs:5000,fetchImpl:async()=>new Response('',{status:503})}),/MEETING_SOURCE_UNAVAILABLE/);
});
