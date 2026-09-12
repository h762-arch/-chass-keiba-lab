import test from 'node:test';
import assert from 'node:assert/strict';
import { createJraRaceService } from '../jra-race-fetch.mjs';

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

test('fresh D1 cache is returned without outbound fetch', async () => {
  const body = {
    ok: true,
    organization: 'JRA',
    race: { date: '2026-09-12', racecourse: '中山', raceNo: 1 },
    horses: [{ horseNo: 1, horseName: 'A' }, { horseNo: 2, horseName: 'B' }],
    quality: { raceParsed: true, horseCount: 2 },
    dataConfidence: 'high',
    source: 'JRA_OFFICIAL'
  };

  const service = createJraRaceService({
    fetchImpl: async () => { throw new Error('outbound fetch must not run'); },
    now: () => Date.parse('2026-09-12T00:00:00Z')
  });

  const response = await service(
    new Request('https://local.invalid/api/jra/race?date=2026-09-12&track=%E4%B8%AD%E5%B1%B1&race=1'),
    {
      DB: fakeDb({
        payload_json: JSON.stringify(body),
        source_url: 'https://www.jra.go.jp/',
        fetched_at: '2026-09-11T23:55:00Z',
        expires_at: '2026-09-12T06:00:00Z',
        parser_version: 'test',
        content_hash: 'abc'
      }),
      ENABLE_JRA_DIRECT_FETCH: 'false'
    }
  );

  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.ok, true);
  assert.equal(json.bridgeCache.provider, 'github_actions_d1');
});

test('cache miss fails closed when direct fetch is disabled', async () => {
  const service = createJraRaceService({
    fetchImpl: async () => { throw new Error('outbound fetch must not run'); },
    now: () => Date.parse('2026-09-12T00:00:00Z')
  });

  const response = await service(
    new Request('https://local.invalid/api/jra/race?date=2026-09-12&track=%E4%B8%AD%E5%B1%B1&race=1'),
    { DB: fakeDb(null), ENABLE_JRA_DIRECT_FETCH: 'false' }
  );

  assert.equal(response.status, 503);
  const json = await response.json();
  assert.equal(json.error, 'JRA_CACHE_MISS');
});
