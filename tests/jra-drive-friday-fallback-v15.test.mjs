import test from 'node:test';
import assert from 'node:assert/strict';

import {
  JRA_DRIVE_PAST_RUN_LIMIT,
  createDriveJraFallback,
  mergeOfficialJraWithDriveRows,
  parseDrivePastRuns,
} from '../jra-drive-prediction-input.mjs';

const makeRuns = count => Array.from({ length: count }, (_, i) => ({
  date: `2026-0${Math.max(1, 8 - Math.floor(i / 3))}-${String(20 - (i % 10)).padStart(2, '0')}`,
  racecourse: i % 2 ? '中山' : '東京',
  raceName: `過去レース${i + 1}`,
  raceClass: '1勝',
  finish: (i % 6) + 1,
  fieldSize: 16,
  jockey: 'テスト騎手',
  weightCarried: 56,
  distance: 1600,
  surface: '芝',
  time: `1:3${i % 10}.${i % 10}`,
  trackCondition: '良',
  bodyWeight: 480 + i,
  cornerPositions: [4 + (i % 3), 4 + (i % 3)],
  last3F: 33.5 + i * 0.1,
}));

const baseRows = [
  {
    '開催日': '2026-09-13',
    '主催': 'JRA',
    '競馬場': '阪神',
    'R': 7,
    'レース名': '3歳以上1勝クラス',
    '芝/ダ': '芝',
    '距離m': 1600,
    '馬番': 1,
    '馬名': 'テストホースA',
    '性齢': '牡4',
    '斤量': 58,
    '騎手': '川田将雅',
    '最高指数': 95,
    '5走平均': 88,
    '距離指数': 94,
    'コース指数': 92,
    '前走指数': 90,
    '2走前指数': 88,
    '3走前指数': 86,
    '指数近接パターン': '距離=コース',
    '予想オッズ': 99.9,
    '人気': 12,
    '過去10走JSON': JSON.stringify(makeRuns(12)),
    '登録日時': '2026-09-11 22:00 JST',
  },
  {
    '開催日': '2026-09-13',
    '主催': 'JRA',
    '競馬場': '阪神',
    'R': 7,
    'レース名': '3歳以上1勝クラス',
    '芝/ダ': '芝',
    '距離m': 1600,
    '馬番': 2,
    '馬名': 'テストホースB',
    '性齢': '牡4',
    '斤量': 58,
    '騎手': '坂井瑠星',
    '最高指数': 80,
    '5走平均': 77,
    '距離指数': 78,
    'コース指数': 76,
    '前走指数': 77,
    '2走前指数': 75,
    '3走前指数': 72,
    '指数近接パターン': '',
    '予想オッズ': 1.2,
    '人気': 1,
    '過去10走JSON': JSON.stringify(makeRuns(7)),
    '登録日時': '2026-09-11 22:00 JST',
  },
];

test('Drive past-runs are capped at 10', () => {
  const runs = parseDrivePastRuns(baseRows[0]);
  assert.equal(JRA_DRIVE_PAST_RUN_LIMIT, 10);
  assert.equal(runs.length, 10);
});

test('Drive fallback restores a complete JRA race without using forecast market', () => {
  const fallback = createDriveJraFallback(
    { date: '2026-09-13', track: '阪神', race: 7 },
    baseRows,
    'JRA_CACHE_MISS',
  );

  assert.equal(fallback.ok, true);
  assert.equal(fallback.source, 'JRA_DRIVE_FRIDAY_BASE');
  assert.equal(fallback.dataConfidence, 'high');
  assert.equal(fallback.quality.horseCount, 2);
  assert.equal(fallback.horses[0].pastRuns.length, 10);
  assert.equal(fallback.horses[1].pastRuns.length, 7);
  assert.equal(fallback.horses[0].odds, null);
  assert.equal(fallback.horses[0].popularity, null);
  assert.equal(fallback.officialError, 'JRA_CACHE_MISS');
  assert.equal(fallback.driveInput.recentRunPolicy, '1-5重視 / 6-10補助');
});

test('official 5 runs are extended from Drive to a maximum of 10', () => {
  const official = {
    ok: true,
    race: {
      date: '2026-09-13',
      racecourse: '阪神',
      raceNo: 7,
    },
    horses: [
      {
        horseNo: 1,
        horseName: 'テストホースA',
        runningStatus: 'active',
        odds: null,
        popularity: null,
        pastRuns: makeRuns(5),
      },
      {
        horseNo: 2,
        horseName: 'テストホースB',
        runningStatus: 'active',
        odds: null,
        popularity: null,
        pastRuns: makeRuns(3),
      },
    ],
  };

  const merged = mergeOfficialJraWithDriveRows(official, baseRows);
  assert.equal(merged.driveInput.status, 'matched');
  assert.equal(merged.horses[0].pastRuns.length, 10);
  assert.ok(merged.horses[1].pastRuns.length >= 7);
  assert.equal(merged.horses[0].odds, null);
  assert.equal(merged.horses[0].popularity, null);
});

test('malformed past-run JSON fails closed without corrupting fallback horse identity', () => {
  const rows = baseRows.map((row, i) => ({
    ...row,
    '過去10走JSON': i === 0 ? '{bad-json' : row['過去10走JSON'],
  }));

  const fallback = createDriveJraFallback(
    { date: '2026-09-13', track: '阪神', race: 7 },
    rows,
    'JRA_OFFICIAL_UNAVAILABLE',
  );

  assert.equal(fallback.horses[0].pastRuns.length, 0);
  assert.equal(fallback.horses[0].horseName, 'テストホースA');
  assert.equal(fallback.dataConfidence, 'high');
});
