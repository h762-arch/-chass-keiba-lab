import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeViewerMarketPayload } from '../viewer/viewer-core.js';

test('v3.6.1 exposes public ability score and rank only', () => {
  const market = sanitizeViewerMarketPayload({
    ok: true,
    date: '2026-09-12',
    track: '阪神',
    organization: 'JRA',
    horseColumns: [
      'horseNumber', 'horseName', 'abilityRank', 'score',
      'winProb', 'top3Prob', 'odds', 'popularity',
      'expectedValue', 'evRank', 'abilityPopularityGap',
      'diamond', 'warning',
    ],
    races: [{
      raceNumber: 2,
      raceName: '2歳未勝利',
      horses: [[6, 'テストホース', 2, 86.4, .22, .51, null, null, null, null, null, null, null]],
    }],
  });

  const horse = market.races[0].horses[0];
  assert.equal(horse.abilityRank, 2);
  assert.equal(horse.abilityScore, 86.4);
  assert.equal('distanceScore' in horse, false);
  assert.equal('courseScore' in horse, false);
  assert.equal('modelWeights' in horse, false);
});

test('v3.6.1 mobile UI has left marks, right ability and collapsible secondary marks', () => {
  const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../viewer/viewer.css', import.meta.url), 'utf8');

  assert.match(app, /SECONDARY_MARKS = new Set\(\['○', '▲', '△'\]\)/);
  assert.match(app, /○▲△を見る/);
  assert.match(app, /viewer-ability-badge/);
  assert.match(app, /公開用総合能力指数/);
  assert.match(app, /viewer-short-comment/);
  assert.match(css, /\.viewer-horse-card-top-v36/);
  assert.match(css, /grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/);
});

test('v3.6.1 missing TIME is not ranked', () => {
  const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');

  assert.match(app, /direct != null && direct !== ''/);
  assert.match(app, /if \(!text \|\| text === '—'\) return null/);
  assert.match(app, /return value > 0 \? value : null/);
});
