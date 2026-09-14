import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  tomorrowJst,
  extractRaceNosFromRaceListHtml,
  classifyTailNoRace,
  aggregateTracks
} from '../src/nar/nar-prefetch-scheduler.mjs';

const schedulerUrl=new URL('../src/nar/nar-prefetch-scheduler.mjs',import.meta.url);
const workerUrl=new URL('../worker-entry.mjs',import.meta.url);
const wranglerUrl=new URL('../wrangler.jsonc',import.meta.url);

test('tomorrowJst resolves next Japanese calendar date',()=>{
  assert.equal(tomorrowJst(new Date('2026-09-14T08:59:59Z')),'2026-09-15');
  assert.equal(tomorrowJst(new Date('2026-12-31T10:00:00Z')),'2027-01-01');
});

test('RaceList parser discovers exact race numbers and dedupes links',()=>{
  const html=`
    <a href="/KeibaWebSP/TodayRaceInfo/S_DebaTable?k_babaCode=20&amp;k_raceDate=2026/09/15&amp;k_raceNo=1">1R</a>
    <a href="/x?k_raceNo=2">2R</a>
    <a href="/x?k_raceNo=2">2R duplicate</a>
    <a href="/x?k_raceNo=11">11R</a>
    <a href="/x?k_raceNo=12">12R</a>`;
  assert.deepEqual(extractRaceNosFromRaceListHtml(html),[1,2,11,12]);
});

test('RaceList parser returns empty list for no-meeting page',()=>{
  assert.deepEqual(extractRaceNosFromRaceListHtml('<html><body>本日の開催はありません</body></html>'),[]);
});

test('scheduler uses official NAR RaceList for meeting discovery',async()=>{
  const src=await readFile(schedulerUrl,'utf8');
  assert.match(src,/S_RaceList/);
  assert.match(src,/extractRaceNosFromRaceListHtml/);
  assert.match(src,/discoverySource:'nar-race-list'/);
});

test('scheduler fans out track children through prefetch-auto path',async()=>{
  const src=await readFile(schedulerUrl,'utf8');
  assert.match(src,/new URL\(origin\+AUTO_PATH\)/);
  assert.match(src,/searchParams\.set\('mode','track'\)/);
  assert.match(src,/Promise\.all\(requests\)/);
});

test('track-child routing failure is not mistaken for no meeting',()=>{
  const input=[
    {track:'大井',code:'20',active:false,ok:false,status:404,error:'prefetch_track_failed'},
    {track:'川崎',code:'21',active:false,ok:true,status:'no-meeting',failedRaceCount:0}
  ];
  const out=aggregateTracks(input);
  assert.equal(out.active.length,0);
  assert.equal(out.failed.length,1);
  assert.equal(out.failed[0].track,'大井');
});

test('contiguous missing tail is classified as no-race',()=>{
  const input=[
    ...Array.from({length:10},(_,i)=>({race:i+1,ok:true,status:'complete'})),
    {race:11,ok:false,status:502,error:'horse_lineage_refs_not_found'},
    {race:12,ok:false,status:502,error:'horse_lineage_refs_not_found'}
  ];
  const out=classifyTailNoRace(input);
  assert.equal(out[10].skipped,true);
  assert.equal(out[11].skipped,true);
  assert.equal(out.filter(r=>!r.ok).length,0);
});

test('worker handles 18:00 JST and 18:30 retry cron without breaking base schedule',async()=>{
  const src=await readFile(workerUrl,'utf8');
  assert.match(src,/controller\?\.cron==='0 9 \* \* \*'/);
  assert.match(src,/controller\?\.cron==='30 9 \* \* \*'/);
  assert.match(src,/baseWorker\.scheduled/);
});

test('wrangler keeps public self-fetch and all crons',async()=>{
  const raw=await readFile(wranglerUrl,'utf8');
  const cfg=JSON.parse(raw);
  assert.ok(cfg.triggers.crons.includes('*/5 * * * *'));
  assert.ok(cfg.triggers.crons.includes('0 9 * * *'));
  assert.ok(cfg.triggers.crons.includes('30 9 * * *'));
  assert.equal(cfg.vars.ENABLE_NAR_PREFETCH,'true');
  assert.ok(cfg.compatibility_flags.includes('global_fetch_strictly_public'));
});
