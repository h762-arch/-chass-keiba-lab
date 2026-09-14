import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const srcUrl=new URL('../src/nar/nar-day-prefetch.mjs',import.meta.url);

test('v2 keeps the existing day prefetch endpoint',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/\/api\/nar\/history\/prefetch-day/);
  assert.match(src,/nar-day-prefetch-v2/);
});

test('v2 hard-limits each worker invocation to two races',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/Math\.min\(requestedTo,fromRace\+1\)/);
  assert.match(src,/at most 2 races per Worker invocation/);
});

test('v2 browser runner performs separate fetches for chunks',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/executionMode:'browser-separated-worker-invocations'/);
  assert.match(src,/await fetch\(chunk\.url/);
  assert.match(src,/run.*===.*'1'/);
});

test('v2 plan exposes runnerUrl and chunk URLs',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/executionMode:'chunk-plan'/);
  assert.match(src,/runnerUrl:buildRunnerUrl/);
  assert.match(src,/chunks,/);
});

test('v2 chunk processing reuses existing recent-history cache logic',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/handleNarRecentHistoryRequest/);
  assert.match(src,/cacheHits/);
  assert.match(src,/cacheMisses/);
});
