import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEWER_ROLE,
  buildViewerDayUrl,
  isViewerSafeEndpoint,
  sanitizeViewerDayPayload,
} from '../viewer/viewer-core.js';

test('VIEWER role is read-only and cannot access internal capabilities', () => {
  assert.equal(VIEWER_ROLE.name, 'VIEWER');
  assert.equal(VIEWER_ROLE.permissions.readPublicPredictions, true);
  assert.equal(VIEWER_ROLE.permissions.writePredictions, false);
  assert.equal(VIEWER_ROLE.permissions.readResearchData, false);
  assert.equal(VIEWER_ROLE.permissions.readInternalIndices, false);
  assert.equal(VIEWER_ROLE.permissions.readModelWeights, false);
  assert.equal(VIEWER_ROLE.permissions.readValidationDb, false);
  assert.equal(VIEWER_ROLE.permissions.changeSettings, false);
});

test('viewer builds only the public read-only day endpoint', () => {
  const url = buildViewerDayUrl({
    date: '2026-09-12',
    organization: 'JRA',
    track: '中山',
  });
  assert.equal(isViewerSafeEndpoint(url), true);
  assert.match(url, /^\/api\/chass\/v1\/public\/day\?/);
  assert.match(url, /organization=JRA/);
  assert.match(url, /track=%E4%B8%AD%E5%B1%B1/);
  assert.match(url, /format=compact/);
  assert.equal(isViewerSafeEndpoint('/api/db/meetings'), false);
  assert.equal(isViewerSafeEndpoint('/api/chass/context'), false);
});

test('viewer sanitizer whitelists public display fields and drops internal data', () => {
  const result = sanitizeViewerDayPayload({
    ok: true,
    date: '2026-09-12',
    track: '中山',
    organization: 'JRA',
    generatedAt: '2026-09-12T01:00:00.000Z',
    secret: 'must-not-leak',
    races: [{
      race: {
        organization: 'JRA',
        raceId: '2026-09-12|中山|11',
        date: '2026-09-12',
        track: '中山',
        raceNo: 11,
        raceName: 'テスト競走',
        surface: '芝',
        distance: 1600,
        going: '良',
        startTime: '15:45',
        fieldSize: 1,
        internalRaceToken: 'hidden',
      },
      internalModelWeights: { ability: 28 },
      horses: [{
        horseNo: 7,
        horseName: 'テストホース',
        mark: '◎',
        probability: { win: 0.21, top3: 0.48 },
        predictedTime: { standard: 93.4, text: '1:33.4' },
        market: { odds: 6.2, popularity: 4, expectedValue: 1.30 },
        longshot: { mark: '💎', reason: '展開向く', hiddenScore: 999 },
        danger: null,
        runnerStatus: 'active',
        rawIndices: { secret: true },
      }],
    }],
  });

  assert.equal(result.races[0].horses[0].horseName, 'テストホース');
  assert.equal(result.races[0].horses[0].expectedValue, 1.30);
  assert.equal('rawIndices' in result.races[0].horses[0], false);
  assert.equal('internalModelWeights' in result.races[0], false);
  assert.equal('secret' in result, false);
});

test('viewer sanitizer rejects non-public-shaped payloads', () => {
  assert.throws(() => sanitizeViewerDayPayload({ ok: false }), /viewer_invalid_payload/);
  assert.throws(() => buildViewerDayUrl({ date: '2026-02-30', organization: 'JRA', track: '東京' }), /viewer_invalid_date/);
  assert.throws(() => buildViewerDayUrl({ date: '2026-09-12', organization: 'JRA', track: '大井' }), /viewer_invalid_track/);
});
