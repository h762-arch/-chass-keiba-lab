import test from 'node:test';
import assert from 'node:assert/strict';
import { readJraOfficialRaceCache } from '../jra-official-cache.mjs';

function envFor(row) {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return { first: async () => row };
          }
        };
      }
    }
  };
}

const baseBody = {
  ok: true,
  organization: 'JRA',
  source: 'JRA_OFFICIAL',
  dataConfidence: 'high',
  race: {
    date: '2026-09-13', racecourse: '中山', raceNo: 1, raceName: 'テスト',
    postTime: '10:00', surface: '芝', distance: 1600, direction: '右',
    courseType: '外回り', raceClass: '3歳未勝利', trackCondition: '良', weather: '晴'
  },
  horses: [
    {
      horseNo: 1, frameNo: 1, horseName: 'テストホースA', sexAge: '牡3',
      weightCarried: 57, jockey: '騎手A', trainer: '調教師A',
      bodyWeight: 480, bodyWeightChange: 2, runningStatus: 'active',
      odds: null, popularity: null,
      pastRuns: [{ date: '2026-08-01', racecourse: '新潟', distance: 1600, time: '1:34.0' }]
    },
    {
      horseNo: 2, frameNo: 2, horseName: 'テストホースB', sexAge: '牝3',
      weightCarried: 55, jockey: '騎手B', trainer: '調教師B',
      bodyWeight: 450, bodyWeightChange: -2, runningStatus: 'active',
      odds: null, popularity: null,
      pastRuns: [{ date: '2026-08-02', racecourse: '新潟', distance: 1600, time: '1:34.5' }]
    }
  ],
  quality: {
    raceParsed: true, horseCount: 2, activeHorseCount: 2,
    horseNameRate: 1, weightRate: 1, jockeyRate: 1, pastRunRate: 1
  }
};

function row(expiresAt) {
  return {
    payload_json: JSON.stringify(baseBody),
    source_url: 'https://www.jra.go.jp/',
    fetched_at: '2026-09-13T03:15:00.000Z',
    expires_at: expiresAt,
    parser_version: 'jra-official-card-v1',
    content_hash: 'abc123'
  };
}

test('fresh JRA D1 race cache remains current official data', async () => {
  const result = await readJraOfficialRaceCache(
    envFor(row('2026-09-13T09:15:00.000Z')),
    { date: '2026-09-13', track: '中山', race: 1, nowMs: Date.parse('2026-09-13T06:00:00.000Z') }
  );
  assert.equal(result.body.source, 'JRA_OFFICIAL');
  assert.equal(result.body.dataConfidence, 'high');
  assert.equal(result.body.bridgeCache.freshness, 'current');
  assert.equal(result.body.bridgeCache.expired, false);
  assert.equal(result.body.horses[0].jockey, '騎手A');
  assert.equal(result.body.horses[0].bodyWeight, 480);
});

test('expired JRA D1 race cache becomes SAVED_OFFICIAL_BASE', async () => {
  const result = await readJraOfficialRaceCache(
    envFor(row('2026-09-13T09:15:00.000Z')),
    { date: '2026-09-13', track: '中山', race: 1, nowMs: Date.parse('2026-09-13T12:00:00.000Z') }
  );

  assert.equal(result.body.source, 'JRA_SAVED_OFFICIAL_BASE');
  assert.equal(result.body.dataConfidence, 'medium');
  assert.equal(result.body.liveFieldsVerified, false);
  assert.equal(result.body.bridgeCache.freshness, 'saved');
  assert.equal(result.body.bridgeCache.expired, true);
  assert.equal(result.body.race.distance, 1600);
  assert.equal(result.body.race.racecourse, '中山');
  assert.equal(result.body.race.trackCondition, '不明');
  assert.equal(result.body.race.weather, '');
  assert.equal(result.body.horses[0].horseName, 'テストホースA');
  assert.equal(result.body.horses[0].weightCarried, 57);
  assert.equal(result.body.horses[0].pastRuns.length, 1);
  assert.equal(result.body.horses[0].jockey, '');
  assert.equal(result.body.horses[0].bodyWeight, null);
  assert.equal(result.body.horses[0].bodyWeightChange, null);
  assert.equal(result.body.horses[0].liveStatusConfidence, 'unconfirmed');
  assert.ok(result.body.savedOfficialBase.unconfirmedLiveFields.includes('horses.runningStatus'));
  assert.ok(result.body.savedOfficialBase.unconfirmedLiveFields.includes('horses.jockey'));
  assert.ok(result.body.savedOfficialBase.unconfirmedLiveFields.includes('horses.bodyWeight'));
});

test('missing D1 row still returns null so Drive fallback can run', async () => {
  const result = await readJraOfficialRaceCache(
    envFor(null),
    { date: '2026-09-13', track: '中山', race: 1, nowMs: Date.now() }
  );
  assert.equal(result, null);
});
