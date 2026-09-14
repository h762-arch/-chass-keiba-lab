import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const srcUrl=new URL('../src/nar/nar-day-prefetch.mjs',import.meta.url);

test('day prefetch exposes dedicated endpoint',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/\/api\/nar\/history\/prefetch-day/);
  assert.match(src,/handleNarRecentHistoryRequest/);
});

test('day prefetch defaults to races 1 through 12',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/fromRace.*\|\|1/);
  assert.match(src,/toRace.*\|\|12/);
});

test('day prefetch has bounded race and horse concurrency',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/Math\.min\(3/);
  assert.match(src,/Math\.min\(6/);
  assert.match(src,/mapLimit\(raceNumbers,raceConcurrency/);
});

test('day prefetch returns cache warm summary instead of full horse runs',async()=>{
  const src=await readFile(srcUrl,'utf8');
  assert.match(src,/cacheHits/);
  assert.match(src,/cacheMisses/);
  assert.match(src,/successfulRaceCount/);
  assert.match(src,/failedRaceCount/);
  assert.doesNotMatch(src,/runs:payload/);
});
