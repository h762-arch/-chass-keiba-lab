import test from 'node:test';
import assert from 'node:assert/strict';
import {createNarAbilityPrecomputeRunner,fetchNarPrecomputeMeeting,parseNarMobileRaceList} from '../src/prediction/nar-ability-precompute.mjs';
import {normalizeNarPrecomputeRunAudit} from '../src/prediction/nar-precompute-run-audit.mjs';

const env={
 ENABLE_NAR_ABILITY_PRECOMPUTE:'true',
 NAR_PRECOMPUTE_TRACK_CODES:'21',
 NAR_PRECOMPUTE_MAX_JOBS:'3',
 NAR_PRECOMPUTE_BUDGET_MS:'20000',
 NAR_PRECOMPUTE_RUN_MODE:'daily',
 NAR_PRECOMPUTE_DAILY_FROM:'2026-10-14',
 NAR_PRECOMPUTE_DAILY_UNTIL:'2026-10-20',
 NAR_PRECOMPUTE_DAILY_START_JST:'07:00',
 NAR_PRECOMPUTE_DAILY_STOP_JST:'14:55',
 DB:{prepare(){return {async all(){return {results:[]};}};}}
};

test('meeting source failure retains route and bounded HTTP status only',async()=>{
 let calls=0;
 await assert.rejects(fetchNarPrecomputeMeeting({code:'21',date:'2026-10-14',timeoutMs:5000,fetchImpl:async()=>new Response('',{status:++calls===1?302:503})}),error=>{
  assert.equal(error.message,'MEETING_SOURCE_UNAVAILABLE');
  assert.deepEqual(error.meetingAudit,[{route:'RaceList',reason:'SOURCE_HTTP',httpStatus:302},{route:'RaceList_ipat',reason:'SOURCE_HTTP',httpStatus:503},{route:'RaceList_mobile',reason:'SOURCE_HTTP',httpStatus:503}]);
  return true;
 });
});

test('invalid UTF-8 is classified without exposing response bytes',async()=>{
 await assert.rejects(fetchNarPrecomputeMeeting({code:'21',date:'2026-10-14',timeoutMs:5000,fetchImpl:async()=>new Response(new Uint8Array([0xff]),{status:200})}),error=>{
  assert.deepEqual(error.meetingAudit,[{route:'RaceList',reason:'SOURCE_DECODE'},{route:'RaceList_ipat',reason:'SOURCE_DECODE'},{route:'RaceList_mobile',reason:'SOURCE_DECODE'}]);
  return true;
 });
});

test('official mobile RaceList is the third bounded fallback with exact identity links',async()=>{
 const mobile=`<!doctype html><html><body><h1>川崎競馬 2026年10月14日（水）</h1>${[1,2,12].map(n=>`<a href="/KeibaWebSP/TodayRaceInfo/S_DebaTable?k_babaCode=21&amp;k_raceDate=2026/10/14&amp;k_raceNo=${n}">${n}R</a>`).join('')}</body></html>`;
 assert.deepEqual(parseNarMobileRaceList(mobile,{code:'21',track:'川崎',date:'2026-10-14'}).raceNumbers,[1,2,12]);
 const calls=[];
 const value=await fetchNarPrecomputeMeeting({code:'21',date:'2026-10-14',timeoutMs:5000,fetchImpl:async url=>{
  calls.push(String(url));
  if(calls.length<3)return new Response('',{status:404});
  return new Response(mobile,{status:200});
 }});
 assert.equal(value.status,'meeting');
 assert.equal(value.sourceRoute,'RaceList_mobile');
 assert.equal(value.attemptCount,3);
 assert.equal(calls.length,3);
 assert.match(calls[2],/^https:\/\/sp\.keiba\.go\.jp\/KeibaWebSP\/TodayRaceInfo\/S_RaceList\?/);
});

test('meeting source attempts survive runner result as bounded safe fields',async()=>{
 const error=new Error('MEETING_SOURCE_UNAVAILABLE');
 error.meetingAudit=[
  {route:'RaceList',reason:'SOURCE_HTTP',httpStatus:302,url:'https://secret.invalid/',body:'private'},
  {route:'RaceList_ipat',reason:'SOURCE_DEADLINE',httpStatus:599,statusText:'private'},
  {route:'RaceList_mobile',reason:'SOURCE_HTTP',httpStatus:404,body:'private'},
  {route:'UnknownRoute',reason:'SOURCE_HTTP',httpStatus:418}
 ];
 const at=Date.parse('2026-10-14T03:45:00.000Z');
 const runner=createNarAbilityPrecomputeRunner(env,{wallNow:()=>at,scheduledTime:at,meeting:async()=>{throw error;},card:async()=>{throw Error('CARD_MUST_NOT_RUN');}});
 const result=await runner();
 assert.equal(result.status,'COMPLETED');
 assert.equal(result.attempted,0);
 assert.equal(result.saved,0);
 assert.deepEqual(result.events,[{track:'川崎',reason:'MEETING_SOURCE_UNAVAILABLE',meetingAttempts:[{route:'RaceList',reason:'SOURCE_HTTP',httpStatus:302},{route:'RaceList_ipat',reason:'SOURCE_DEADLINE'},{route:'RaceList_mobile',reason:'SOURCE_HTTP',httpStatus:404}]}]);
});

test('public run audit independently strips unknown meeting attempt fields',()=>{
 const audit=normalizeNarPrecomputeRunAudit({scheduledAt:'2026-10-14T03:45:14.000Z',result:{status:'COMPLETED',events:[{track:'川崎',reason:'MEETING_SOURCE_UNAVAILABLE',meetingAttempts:[{route:'RaceList',reason:'SOURCE_HTTP',httpStatus:403,url:'secret'},{route:'RaceList_ipat',reason:'MEETING_UNCONFIRMED',html:'secret'},{route:'RaceList_mobile',reason:'SOURCE_HTTP',httpStatus:404,body:'secret'},{route:'foreign',reason:'SOURCE_HTTP',httpStatus:418}]}]}});
 assert.deepEqual(audit.events,[{track:'川崎',reason:'MEETING_SOURCE_UNAVAILABLE',meetingAttempts:[{route:'RaceList',reason:'SOURCE_HTTP',httpStatus:403},{route:'RaceList_ipat',reason:'MEETING_UNCONFIRMED'},{route:'RaceList_mobile',reason:'SOURCE_HTTP',httpStatus:404}]}]);
 assert.equal(JSON.stringify(audit).includes('secret'),false);
});
