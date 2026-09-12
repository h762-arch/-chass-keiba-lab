import test from 'node:test';
import assert from 'node:assert/strict';
import { createJraResultService } from '../jra-result-fetch.mjs';

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
  finishOrder: [2, 8, 9],
  actualTimes: { 2: '1:10.8', 8: '1:11.0', 9: '1:11.2' },
  results: [
    { position: 1, horseNo: 2, horseName: 'A', time: '1:10.8', actualTime: '1:10.8' },
    { position: 2, horseNo: 8, horseName: 'B', time: '1:11.0', actualTime: '1:11.0' },
    { position: 3, horseNo: 9, horseName: 'C', time: '1:11.2', actualTime: '1:11.2' }
  ],
  resultMeta: { weather: '晴', trackCondition: '良' },
  quality: { resultRows: 3, finishOrderCount: 3, complete: true },
  source: 'JRA_OFFICIAL',
  parserVersion: 'test'
};

test('JRA result service returns fresh D1 result without outbound fetch', async () => {
  const service = createJraResultService({
    fetchImpl: async () => { throw new Error('outbound fetch must not run'); },
    now: () => Date.parse('2026-09-12T07:00:00Z')
  });

  const response = await service(
    new Request('https://local.invalid/api/jra/result?date=2026-09-12&track=%E4%B8%AD%E5%B1%B1&race=1'),
    {
      DB: fakeDb({
        payload_json: JSON.stringify(cachedBody),
        source_url: 'https://www.jra.go.jp/',
        fetched_at: '2026-09-12T06:59:00Z',
        expires_at: '2027-09-12T06:59:00Z',
        parser_version: 'test',
        content_hash: 'abc'
      }),
      ENABLE_JRA_RESULT_FETCH: 'true',
      ENABLE_JRA_RESULT_DIRECT_FETCH: 'false'
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-CHASS-JRA-Result-Cache'), 'D1-HIT');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.finishOrder, [2, 8, 9]);
  assert.equal(body.bridgeCache.provider, 'github_actions_d1');
  assert.equal(body.bridgeCache.kind, 'result');
});

test('JRA result service fails closed on D1 miss when direct fetch is disabled', async () => {
  const service = createJraResultService({
    fetchImpl: async () => { throw new Error('outbound fetch must not run'); },
    now: () => Date.parse('2026-09-12T07:00:00Z')
  });

  const response = await service(
    new Request('https://local.invalid/api/jra/result?date=2026-09-12&track=%E4%B8%AD%E5%B1%B1&race=1'),
    {
      DB: fakeDb(null),
      ENABLE_JRA_RESULT_FETCH: 'true',
      ENABLE_JRA_RESULT_DIRECT_FETCH: 'false'
    }
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-CHASS-JRA-Result-Cache'), 'D1-MISS');
  assert.equal((await response.json()).error, 'JRA_RESULT_CACHE_MISS');
});

test('JRA result service preserves direct-fetch behavior when no DB is bound', async () => {
  let calls = 0;
  const service = createJraResultService({
    fetchImpl: async () => { calls += 1; throw new Error('offline'); }
  });

  const response = await service(
    new Request('https://local.invalid/api/jra/result?date=2026-09-12&track=%E4%B8%AD%E5%B1%B1&race=1'),
    { ENABLE_JRA_RESULT_FETCH: 'true' }
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'JRA_OFFICIAL_UNAVAILABLE');
  assert.equal(calls, 1);
});
