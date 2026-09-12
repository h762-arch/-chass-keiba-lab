import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('JRA race selection isolation patch is installed', () => {
  assert.match(app, /CHASS-JRA-RACE-STATE-ISOLATION-v1\.9/);
  assert.match(app, /function ensureJraRaceSelectionState/);
  assert.match(app, /function jraPayloadMatchesActive/);
});

test('JRA odds are fail-closed across race identity mismatch', () => {
  const m=app.match(/function commitJraOdds\(data,generation\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'commitJraOdds not found');
  assert.match(m[0], /jraPayloadMatchesActive\(data\)/);
  assert.match(m[0], /layerMatchesActive\(state,state\.predictionSnapshot,'prediction'\)/);
});

test('JRA results are fail-closed across race identity mismatch', () => {
  const m=app.match(/function commitJraResult\(data,generation\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'commitJraResult not found');
  assert.match(m[0], /jraPayloadMatchesActive\(data\)/);
  assert.match(m[0], /layerMatchesActive\(state,state\.predictionSnapshot,'prediction'\)/);
});

test('JRA selector clears stale race state before client refresh', () => {
  assert.match(app, /onSelection:\(\)=>\{ensureJraRaceSelectionState\(\{renderNow:true\}\);/);
  assert.match(app, /for\(const id of \['jraDate','jraCourse','jraRaceNo'\]\)/);
});
