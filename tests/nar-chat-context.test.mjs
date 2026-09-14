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

test('chat context adds recent10 time theory without changing ability probability fields',async()=>{
  const src=await readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8');
  assert.match(src,/nar-time-theory\.mjs/);
  assert.match(src,/buildNarTimeTheory/);
  assert.match(src,/rankNarTimeTheoryHorses/);
  assert.match(src,/summarizeNarTimeTheoryRace/);
  assert.match(src,/timeTheoryVersion:NAR_TIME_THEORY_VERSION/);
  assert.match(src,/winProb:a\.winProb/);
  assert.match(src,/top3Prob:a\.top3Prob/);
});

test('time theory is explicitly research-only until post-race calibration',async()=>{
  const theory=await readFile(new URL('../src/nar/nar-time-theory.mjs',import.meta.url),'utf8');
  assert.match(theory,/researchOnly:true/);
  assert.match(theory,/affectsProbability:false/);
  assert.match(theory,/time_theory_upside/);
  assert.match(theory,/time_theory_risk/);
});


test('race context can continue history-only when ability race is not yet saved',async()=>{
  const src=await readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8');
  assert.match(src,/classifyAbilityAvailability/);
  assert.match(src,/history_only/);
  assert.match(src,/abilityAvailable:abilityPolicy\.available/);
  assert.match(src,/abilityFallbackReason:abilityPolicy\.reason/);
  assert.match(src,/abilityPolicy\.available&&Array\.isArray\(abilityPayload\?\.horses\)/);
});
