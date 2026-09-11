import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEWER_ROLE,
  buildViewerDayUrl,
  buildViewerRaceUrl,
  buildViewerRacesUrl,
  isViewerSafeEndpoint,
  sanitizeViewerDayPayload,
  sanitizeViewerRacePayload,
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

test('viewer builds only public read-only endpoints', () => {
  const context = { date: '2026-09-12', organization: 'JRA', track: '中山' };
  const day = buildViewerDayUrl(context);
  const race = buildViewerRaceUrl({ ...context, race: 11 });
  const races = buildViewerRacesUrl(context);

  for (const url of [day, race, races]) {
    assert.equal(isViewerSafeEndpoint(url), true);
    assert.match(url, /^\/api\/chass\/v1\/public\//);
  }

  assert.match(day, /\/day\?/);
  assert.match(day, /format=compact/);
  assert.match(race, /\/race\?/);
  assert.match(race, /race=11/);
  assert.match(races, /\/races\?/);
  assert.equal(isViewerSafeEndpoint('/api/db/meetings'), false);
  assert.equal(isViewerSafeEndpoint('/api/chass/context'), false);
});

test('viewer sanitizer accepts compact aliases and full public details', () => {
  const compact = sanitizeViewerDayPayload({
    ok: true,
    date: '2026-09-12',
    track: '中山',
    organization: 'JRA',
    races: [{
      raceNumber: 11,
      raceName: 'テスト競走',
      horses: [{
        horseNumber: 7,
        horseName: 'テストホース',
        mark: '◎',
        winProb: 0.21,
        top3Prob: 0.48,
        predictedTime: '1:33.4',
        predictedTimeSec: 93.4,
      }],
    }],
  });

  assert.equal(compact.races[0].raceNo, 11);
  assert.equal(compact.races[0].horses[0].horseNo, 7);
  assert.equal(compact.races[0].horses[0].aiWinRate, 0.21);
  assert.equal(compact.races[0].horses[0].predictedTimeText, '1:33.4');

  const full = sanitizeViewerRacePayload({
    ok: true,
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
      danger: { mark: '⚠️', reason: '人気先行' },
      runnerStatus: 'active',
      rawIndices: { secret: true },
    }],
  });

  assert.equal(full.horses[0].odds, 6.2);
  assert.equal(full.horses[0].expectedValue, 1.30);
  assert.equal(full.horses[0].longshotMark, '💎');
  assert.equal(full.horses[0].dangerMark, '⚠️');
  assert.equal('rawIndices' in full.horses[0], false);
  assert.equal('internalModelWeights' in full, false);
});

test('viewer sanitizer rejects non-public-shaped payloads and invalid selectors', () => {
  assert.throws(() => sanitizeViewerDayPayload({ ok: false }), /viewer_invalid_payload/);
  assert.throws(() => sanitizeViewerRacePayload({ ok: true }), /viewer_invalid_race_payload/);
  assert.throws(() => buildViewerDayUrl({ date: '2026-02-30', organization: 'JRA', track: '東京' }), /viewer_invalid_date/);
  assert.throws(() => buildViewerDayUrl({ date: '2026-09-12', organization: 'JRA', track: '大井' }), /viewer_invalid_track/);
  assert.throws(() => buildViewerRaceUrl({ date: '2026-09-12', organization: 'JRA', track: '中山', race: 0 }), /viewer_invalid_race/);
});
