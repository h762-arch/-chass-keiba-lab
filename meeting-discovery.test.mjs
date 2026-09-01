import test from 'node:test';
import assert from 'node:assert/strict';
import {collectorRequestMetrics,meetingCacheKey,parseNarRaceList} from '../meeting-discovery.mjs';
import {fetchNarMeeting} from '../worker.js';

const raceList=(track,date,numbers)=>`<!doctype html><html><head><title>${track}</title></head><body><h1>${date.slice(0,4)}年${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日 ${track}競馬 当日メニュー</h1>${numbers.map(n=>`<a href="/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=20&amp;k_raceDate=${date.replaceAll('-','/')}&amp;k_raceNo=${n}">${n}R</a>`).join('')}</body></html>`;

test('a 12-race meeting is discovered from one RaceList response',()=>{const parsed=parseNarRaceList(raceList('大井','2026-08-31',Array.from({length:12},(_,i)=>i+1)),{track:'大井',date:'2026-08-31'});assert.equal(parsed.status,'meeting');assert.deepEqual(parsed.raceNumbers,Array.from({length:12},(_,i)=>i+1))});
test('an 11-race meeting does not invent race 12',()=>{const parsed=parseNarRaceList(raceList('高知','2026-08-01',Array.from({length:11},(_,i)=>i+1)),{track:'高知',date:'2026-08-01'});assert.equal(parsed.status,'meeting');assert.equal(parsed.raceNumbers.at(-1),11);assert.equal(parsed.raceNumbers.includes(12),false)});
test('same-date redirect to another active venue is an explicit non-meeting',()=>{const parsed=parseNarRaceList(raceList('船橋','2026-08-31',[1,2,3]),{track:'大井',date:'2026-08-31'});assert.equal(parsed.status,'non_meeting');assert.equal(parsed.activeTrack,'船橋');assert.deepEqual(parsed.raceNumbers,[])});
test('ambiguous, wrong-date and empty pages are unknown, never non-meetings',()=>{for(const html of ['<html>maintenance</html>',raceList('大井','2026-08-30',[1,2]),''])assert.equal(parseNarRaceList(html,{track:'大井',date:'2026-08-31'}).status,'meeting_unknown')});
test('worker discovery uses the official RaceList route and returns source metrics',async()=>{let called='';const payload=await fetchNarMeeting({code:20,date:'2026-08-31',fetcher:async url=>{called=url;return raceList('大井','2026-08-31',[1,2,3])}});assert.match(called,/\/TodayRaceInfo\/RaceList\?/);assert.match(called,/k_babaCode=20/);assert.equal(payload.status,'meeting');assert.equal(payload.raceNumbers.length,3);assert.equal(payload.source,'NAR公式 RaceList')});
test('cache key normalizes date and track',()=>assert.equal(meetingCacheKey('2026/08/31','大井競馬'),'2026-08-31_大井'));
test('request KPI compares legacy full scan with meeting-aware requests',()=>{const metrics=collectorRequestMetrics({dateCount:30,trackCount:1,meetingRequests:30,raceRequests:72,resultRequests:72,discoveredRaceCount:72});assert.equal(metrics.legacyCandidateCount,360);assert.equal(metrics.actualRequests,174);assert.equal(metrics.reductionRate,59.7)});
