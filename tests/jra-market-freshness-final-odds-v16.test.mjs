import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../viewer/viewer-core.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');

test('stable public tabular horseColumns contract is unchanged', () => {
  assert.match(
    worker,
    /const horseColumns=\['horseNumber','horseName','abilityRank','score','winProb','top3Prob','odds','popularity','expectedValue','evRank','abilityPopularityGap','diamond','warning'\]/,
  );
  assert.doesNotMatch(
    worker,
    /const horseColumns=\[[^\]]*'oddsStatus'[^\]]*\]/,
  );
});

test('viewer opts into a separate market overlay', () => {
  assert.match(core, /viewerMarket: '1'/);
  assert.match(worker, /function publicViewerMarketOverlay\(day,races\)/);
  assert.match(worker, /u\.searchParams\.get\('viewerMarket'\)==='1'/);
  assert.match(worker, /payload\.viewerMarketOverlay=publicViewerMarketOverlay\(day,races\)/);
});

test('normal day-ai saved-snapshot semantics remain present', () => {
  assert.match(worker, /marketEvaluationMode:'saved-snapshot-only'/);
  assert.match(worker, /expectedValue:'winProb × savedOdds'/);
  assert.match(worker, /const pop=popularity\.map\.get\(h\.no\)\?\?null,odds=publicPositiveNumber\(h\.odds\)/);
});

test('viewer overlay is fail-closed for stale market data', () => {
  assert.match(worker, /savedUsable=savedStatus==='available'/);
  assert.match(
    worker,
    /odds:finalUsable\?finalOdds:\(savedUsable\?publicPositiveNumber\(h\?\.odds\):null\)/,
  );
  assert.match(core, /overlayUsable = overlayStatus === 'available' \|\| overlayStatus === 'final'/);
});

test('viewer horse identity contract is preserved', () => {
  assert.match(app, /horseNo: market\.horseNo \?\? horse\.horseNo/);
  assert.match(app, /horseName: market\.horseName \|\| horse\.horseName/);
  assert.match(app, /const market = resolveHorseIdentity\(horse, marketRace\.horses, used\)/);
  assert.match(core, /return overlayName === normalizedName/);
});

test('viewer can distinguish stale and final market states', () => {
  assert.match(app, /市場データ 古い/);
  assert.match(app, /確定市場 反映済み/);
  assert.match(app, /marketStatus: market\.marketStatus \?\? null/);
});
