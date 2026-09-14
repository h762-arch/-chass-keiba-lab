import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tomorrowJst} from '../src/nar/nar-prefetch-scheduler.mjs';

const schedulerUrl=new URL('../src/nar/nar-prefetch-scheduler.mjs',import.meta.url);
const workerUrl=new URL('../worker-entry.mjs',import.meta.url);
const wranglerUrl=new URL('../wrangler.jsonc',import.meta.url);

test('tomorrowJst resolves next Japanese calendar date',()=>{
  assert.equal(tomorrowJst(new Date('2026-09-14T08:59:59Z')),'2026-09-15');
  assert.equal(tomorrowJst(new Date('2026-12-31T10:00:00Z')),'2027-01-01');
});

test('scheduler fans out by track then one race per child invocation',async()=>{
  const src=await readFile(schedulerUrl,'utf8');
  assert.match(src,/TRACKS=\[/);
  assert.match(src,/for\(let race=1;race<=12;race\+\+\)/);
  assert.match(src,/fromRace.*String\(race\)/);
  assert.match(src,/toRace.*String\(race\)/);
  assert.match(src,/Promise\.all\(calls\)/);
});

test('worker handles 18:00 JST and 18:30 retry cron without breaking base schedule',async()=>{
  const src=await readFile(workerUrl,'utf8');
  assert.match(src,/controller\?\.cron==='0 9 \* \* \*'/);
  assert.match(src,/controller\?\.cron==='30 9 \* \* \*'/);
  assert.match(src,/baseWorker\.scheduled/);
});

test('wrangler preserves JRA five-minute cron and adds NAR evening crons',async()=>{
  const raw=await readFile(wranglerUrl,'utf8');
  const cfg=JSON.parse(raw);
  assert.ok(cfg.triggers.crons.includes('*/5 * * * *'));
  assert.ok(cfg.triggers.crons.includes('0 9 * * *'));
  assert.ok(cfg.triggers.crons.includes('30 9 * * *'));
  assert.equal(cfg.vars.ENABLE_NAR_PREFETCH,'true');
});

test('manual auto-prefetch endpoint exists for production verification',async()=>{
  const src=await readFile(workerUrl,'utf8');
  assert.match(src,/\/api\/nar\/history\/prefetch-auto/);
});
