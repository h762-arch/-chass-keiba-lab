import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');

test('v3.6.4 computes ability rank from public ability score', () => {
  assert.match(app, /const byAbility = active/);
  assert.match(app, /abilityRank = new Map\(\)/);
  assert.match(app, /resolvedAbilityRank\(horse, ranks\)/);
});

test('v3.6.4 EV uses current AI win probability times current odds only', () => {
  assert.match(app, /function liveExpectedValue\(horse\)/);
  assert.match(app, /probability \* odds/);
  const start = app.indexOf('function evText(horse)');
  const end = app.indexOf('function metric(', start);
  const block = app.slice(start, end);
  assert.doesNotMatch(block, /horse\.expectedValue/);
});

test('v3.6.4 short comment uses live EV and resolved ability rank', () => {
  assert.match(app, /const abilityRank = resolvedAbilityRank\(horse, ranks\)/);
  assert.match(app, /const liveEv = liveExpectedValue\(horse\)/);
});

