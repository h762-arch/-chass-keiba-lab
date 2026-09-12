import test from 'node:test';
import assert from 'node:assert/strict';
import { createJraOddsService } from '../jra-odds-fetch.mjs';

function fakeDb(row) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return row;
            }
          };
        }
      };
    }
  };
}

const cachedBody = {
  ok: true,
  organization: 'JRA',
  date: '2026-09-12',
  track: '中山',
  race: 1,
  odds: [
    { horseNo: 1, odds: 4.5, popularity: 2 },
    { horseNo: 2, odds: 3.1, popularity: 1 }
  ],
  quality: {
    activeHorseCount: 2,
    oddsHorseCount: 2,
    oddsCoverage: 1,
    complete: true
  },
  oddsSnapshotType: 'live',
  source: 'JRA_OFFICIAL',
  marketDataSource: 'JRA_OFFICIAL_WIN_ODDS',
  parserVersion: 'test'
};

test('JRA odds service returns fresh D1 odds without outbound fetch', async () => {
  const service = createJraOddsService({
    fetchImpl: async () => {
      throw new Error('outbound fetch must not run');
    },
    now: () => Date.parse('2026-09-12T04:00:00Z')
  });

  const response = await service(
    new Request('https://local.invalid/api/jra/odds?date=2026-09-12&track=%E4%B8%AD%E5%B1%B1&race=1'),
    {
      DB: fakeDb({
        payload_json: JSON.stringify(cachedBody),
        source_url: 'https://www.jra.go.jp/',
        fetched_at: '2026-09-12T03:59:00Z',
        expires_at: '2026-09-12T04:20:00Z',
        parser_version: 'test',
        content_hash: 'abc'
      }),
      ENABLE_JRA_ODDS_FETCH: 'true',
      ENABLE_JRA_ODDS_DIRECT_FETCH: 'false'
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-CHASS-JRA-Odds-Cache'), 'D1-HIT');

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.bridgeCache.provider, 'github_actions_d1');
  assert.equal(body.bridgeCache.kind, 'odds');
  assert.equal(body.quality.oddsHorseCount, 2);
});

test('JRA odds service fails closed on D1 miss when direct fetch is disabled', async () => {
  const service = createJraOddsService({
    fetchImpl: async () => {
      throw new Error('outbound fetch must not run');
    },
    now: () => Date.parse('2026-09-12T04:00:00Z')
  });

  const response = await service(
    new Request('https://local.invalid/api/jra/odds?date=2026-09-12&track=%E4%B8%AD%E5%B1%B1&race=1'),
    {
      DB: fakeDb(null),
      ENABLE_JRA_ODDS_FETCH: 'true',
      ENABLE_JRA_ODDS_DIRECT_FETCH: 'false'
    }
  );

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'JRA_ODDS_CACHE_MISS');
});
