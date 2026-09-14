import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('worker entry exposes combined NAR chat context endpoint',async()=>{
  const src=await readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8');
  assert.match(src,/\/api\/chass\/v1\/public\/race-context/);
  assert.match(src,/Promise\.all\(/);
  assert.match(src,/\/api\/chass\/v1\/public\/race/);
  assert.match(src,/\/api\/nar\/history\/race/);
  assert.match(src,/chass-race-context-v1/);
});

test('combined context keeps existing history routes intact',async()=>{
  const src=await readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8');
  assert.match(src,/\/api\/nar\/history\/horse/);
  assert.match(src,/handleNarRecentHistoryRequest/);
});

test('chat context projects up to 10 compact history runs',async()=>{
  const src=await readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8');
  assert.match(src,/Math\.min\(10,Math\.max\(1/);
  assert.match(src,/slice\(0,runsLimit\)\.map\(compactRun\)/);
  assert.match(src,/recentFormShape|summary/);
});
