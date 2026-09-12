import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../viewer/viewer-core.js', import.meta.url), 'utf8');
const oddsFetch = fs.readFileSync(new URL('../jra-odds-fetch.mjs', import.meta.url), 'utf8');

test('viewer persisted market contract matches v1.8.6+', () => {
  assert.match(worker, /async function publicViewerMarketOverlay\(day,races,env\)/);
  assert.match(worker, /readJraOfficialOddsCacheForViewer/);
  assert.match(worker, /payload\.viewerMarketOverlay=await publicViewerMarketOverlay\(day,races,env\)/);
  assert.match(core, /const overlayDisplayable = \['available', 'final', 'saved'\]\.includes/);
  assert.match(core, /fallbackToSaved/);
});

test('strict current odds reader remains separate from viewer persisted fallback', () => {
  assert.match(oddsFetch, /readJraOfficialOddsCache/);
  assert.doesNotMatch(oddsFetch, /readJraOfficialOddsCacheForViewer/);
});
