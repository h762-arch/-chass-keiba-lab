import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tomorrowJst,classifyTailNoRace} from '../src/nar/nar-prefetch-scheduler.mjs';

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

test('contiguous missing tail is classified as no-race',()=>{
  const input=[
    ...Array.from({length:10},(_,i)=>({race:i+1,ok:true,status:'complete'})),
    {race:11,ok:false,status:502,error:'horse_lineage_refs_not_found'},
    {race:12,ok:false,status:502,error:'horse_lineage_refs_not_found'}
  ];
  const out=classifyTailNoRace(input);
  assert.equal(out[10].skipped,true);
  assert.equal(out[10].status,'no-race');
  assert.equal(out[11].skipped,true);
  assert.equal(out[11].status,'no-race');
  assert.equal(out.filter(r=>!r.ok).length,0);
});

test('a missing race before a later success is not hidden',()=>{
  const input=[
    ...Array.from({length:10},(_,i)=>({race:i+1,ok:true,status:'complete'})),
    {race:11,ok:false,status:502,error:'horse_lineage_refs_not_found'},
    {race:12,ok:true,status:'complete'}
  ];
  const out=classifyTailNoRace(input);
  assert.equal(out[10].ok,false);
  assert.equal(out[10].skipped,undefined);
});

test('a non-missing tail error remains a failure and blocks earlier tail skipping',()=>{
  const input=[
    ...Array.from({length:10},(_,i)=>({race:i+1,ok:true,status:'complete'})),
    {race:11,ok:false,status:502,error:'horse_lineage_refs_not_found'},
    {race:12,ok:false,status:500,error:'upstream_timeout'}
  ];
  const out=classifyTailNoRace(input);
  assert.equal(out[10].ok,false);
  assert.equal(out[11].ok,false);
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
