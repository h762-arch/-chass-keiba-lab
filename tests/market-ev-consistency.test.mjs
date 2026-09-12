import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('active market reload does not copy stale EV/value/warning fields', () => {
  assert.doesNotMatch(src, /h\.ev=o\.ev/);
  assert.doesNotMatch(src, /h\.valueMark=o\.valueMark/);
  assert.doesNotMatch(src, /h\.warningMark=o\.warningMark/);
  assert.match(src, /reconcileMarketDerivedValues\(next\.horses,next\.race\)/);
});

test('odds cache invalidates when prediction basis changes', () => {
  assert.match(src, /previousBasisSignature!==basisSignature/);
  assert.match(src, /predictionBasisSignature:basisSignature/);
  assert.match(src, /marketDerivedVersion:'MDV-2'/);
});

test('expected-value semantics remain odds times win-percent', () => {
  const displayEv = (odds, winPct) => odds * winPct / 100;
  assert.equal(Number(displayEv(15.4, 23.4).toFixed(4)), 3.6036);
  assert.equal(Number(displayEv(36.1, 2.8).toFixed(4)), 1.0108);
  assert.equal(Number(displayEv(26.0, 1.7).toFixed(4)), 0.442);
  assert.equal(Number(displayEv(3.5, 1.4).toFixed(4)), 0.049);
});

test('validated historical records are protected from repair', () => {
  assert.match(src, /lockedMarketHistory/);
  assert.match(src, /!lockedMarketHistory&&r\.race\?\.oddsType==='実オッズ'/);
});
