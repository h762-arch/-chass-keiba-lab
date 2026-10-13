import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wrangler=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const storeSource=readFileSync(new URL('../src/prediction/nar-shared-history-store.mjs',import.meta.url),'utf8');

test('Phase139 enables shared history without widening the bounded NAR trial',()=>{
 const v=wrangler.vars;
 assert.equal(v.ENABLE_NAR_SHARED_HISTORY,'true');
 assert.equal(v.NAR_PRECOMPUTE_TRACK_CODES,'21');
 assert.equal(v.NAR_PRECOMPUTE_MAX_JOBS,'3');
 assert.equal(v.NAR_PRECOMPUTE_BUDGET_MS,'20000');
 assert.equal(v.NAR_PRECOMPUTE_RUN_MODE,'daily');
 assert.equal(v.NAR_PRECOMPUTE_DAILY_FROM,'2026-10-14');
 assert.equal(v.NAR_PRECOMPUTE_DAILY_UNTIL,'2026-10-20');
 assert.equal(v.NAR_PRECOMPUTE_DAILY_START_JST,'07:00');
 assert.equal(v.NAR_PRECOMPUTE_DAILY_STOP_JST,'14:55');
 assert.equal(v.JRA_PRECOMPUTE_MAX_JOBS,'1');
 assert.ok(wrangler.triggers.crons.includes('*/5 * * * *'));
});

test('shared history audit preserves count fields and records successful materialization time',()=>{
 for(const field of [
  'insertedObservationCount',
  'existingObservationCount',
  'unresolvedObservationCount',
  'availableEpisodeCount',
  'heldEpisodeCount',
  'elapsedMs'
 ])assert.match(storeSource,new RegExp(`${field}:`));
 assert.match(storeSource,/elapsedMs:Math\.max\(0,Math\.round\(performance\.now\(\)-startedAt\)\)/);
});
