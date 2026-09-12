import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');

test('v3.6.5 market/detail merge is identity-first', () => {
  assert.match(app, /function horseIdentityKey\(value\)/);
  assert.match(app, /function resolveHorseIdentity\(baseHorse, candidates, used = new Set\(\)\)/);
  assert.match(app, /If a name exists but does not agree, do not fall back to horse number/);
  assert.doesNotMatch(app, /new Map\(marketRace\.horses\.map\(\(horse\) => \[Number\(horse\.horseNo\), horse\]\)\)/);
});

test('v3.6.5 safely updates official horse number/name after identity match', () => {
  assert.match(app, /horseNo: market\.horseNo \?\? horse\.horseNo/);
  assert.match(app, /horseName: market\.horseName \|\| horse\.horseName/);
});

test('v3.6.5 unmatched identity never receives another horse market values', () => {
  assert.match(app, /if \(!market\) \{/);
  assert.match(app, /odds: null/);
  assert.match(app, /popularity: null/);
  assert.match(app, /expectedValue: null/);
});

test('v3.6.5 suppresses duplicate main marks in Viewer', () => {
  assert.match(app, /function normalizeDuplicateMainMarks\(race\)/);
  assert.match(app, /horse\.mark === '◎'/);
  assert.match(app, /if \(horse !== keep\) horse\.mark = null/);
});

test('v3.6.5 supports a unique small spelling discrepancy without broad fuzzy matching', () => {
  assert.match(app, /horseNameDistance/);
  assert.match(app, /item\.distance <= 2/);
  assert.match(app, /fuzzy\[0\]\.distance < fuzzy\[1\]\.distance/);
});

