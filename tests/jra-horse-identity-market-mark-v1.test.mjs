import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const normalizer = fs.readFileSync(new URL('../jra-normalizer.js', import.meta.url), 'utf8');
const viewer = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');
const raceFetch = fs.readFileSync(new URL('../jra-race-fetch.mjs', import.meta.url), 'utf8');
const oddsFetch = fs.readFileSync(new URL('../jra-odds-fetch.mjs', import.meta.url), 'utf8');

test('official JRA parsers retain horseNo as the identity key', () => {
  assert.match(raceFetch, /horses\.push\(\{horseNo:no/);
  assert.match(oddsFetch, /odds\.push\(\{horseNo,odds:winOdds,popularity\}\)/);
});

test('JRA normalizer never invents horseNo from array index', () => {
  assert.match(normalizer, /function requiredJraHorseNo/);
  assert.match(normalizer, /JRA_HORSE_NO_REQUIRED/);
  assert.doesNotMatch(normalizer, /horseNo:numberOrNull\(horse\.horseNo\?\?horse\.horse_no\)\?\?index\+1/);
});

test('generic transform fails closed for missing JRA horseNo', () => {
  assert.match(app, /function canonicalInputHorseNo\(h,i,race=\{\}\)/);
  assert.match(app, /JRA_HORSE_NO_REQUIRED/);
  assert.match(app, /horseNo:canonicalInputHorseNo\(h,i,r\)/);
});

test('JRA odds are blocked when horse identity sets disagree', () => {
  assert.match(app, /function assertJraMarketIdentity\(items=\[\]\)/);
  assert.match(app, /JRA_HORSE_IDENTITY_MISMATCH/);
  assert.match(app, /assertJraMarketIdentity\(items\)/);
});

test('JRA ability marks use displayed overall ability ordering', () => {
  assert.match(app, /function abilityMarks\(horses,race=\{\}\)/);
  assert.match(app, /const overall=value\(b\.overall\)-value\(a\.overall\)/);
  assert.match(app, /\['◎','○','▲','△'\]/);
});

test('viewer prefers resolved race-detail identity and rebuilds mark order', () => {
  assert.match(viewer, /horseNo: full\.horseNo \?\? horse\.horseNo/);
  assert.match(viewer, /function normalizeAbilityMarkOrder\(race\)/);
  assert.match(viewer, /Number\(b\.abilityScore\) - Number\(a\.abilityScore\)/);
  assert.match(viewer, /const marks = \['◎', '○', '▲', '△'\]/);
});
