import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDriveRaceSignals,
  extractJraDriveRaceRows,
  mergeOfficialJraWithDriveRows,
} from '../jra-drive-prediction-input.mjs';

const rows = [
  {
    '開催日': '2026-09-13',
    '主催': 'JRA',
    '競馬場': '阪神',
    'R': 1,
    '馬番': 1,
    '馬名': 'テストホースA',
    '最高指数': 90,
    '5走平均': 85,
    '距離指数': 88,
    'コース指数': 84,
    '前走指数': 89,
    '2走前指数': 80,
    '3走前指数': 78,
    '指数近接パターン': '最高=前走(89) / 距離=コース',
    '予想オッズ': 99.9,
    '人気': 12,
  },
  {
    '開催日': '2026-09-13',
    '主催': 'JRA',
    '競馬場': '阪神',
    'R': 1,
    '馬番': 2,
    '馬名': 'テストホースB',
    '最高指数': 50,
    '5走平均': 48,
    '距離指数': 45,
    'コース指数': 44,
    '前走指数': 50,
    '2走前指数': 42,
    '3走前指数': 40,
    '指数近接パターン': '',
    '予想オッズ': 1.2,
    '人気': 1,
  },
];

test('Drive race rows are selected only by exact JRA date track race', () => {
  const selected = extractJraDriveRaceRows(
    [...rows, { ...rows[0], '競馬場': '中山' }],
    { date: '2026-09-13', track: '阪神', race: 1 },
  );
  assert.equal(selected.length, 2);
});

test('Drive signal is normalized within the race and market columns are irrelevant', () => {
  const signals = buildDriveRaceSignals(rows);
  const a = signals.find(x => x.horseNo === 1);
  const b = signals.find(x => x.horseNo === 2);
  assert.ok(a.driveIndexSignal > b.driveIndexSignal);
  assert.ok(a.driveIndexEvidenceCount >= 4);

  const changedMarket = rows.map((r, i) => ({
    ...r,
    '予想オッズ': i ? 999 : 1.01,
    '人気': i ? 99 : 1,
  }));
  assert.deepEqual(
    buildDriveRaceSignals(changedMarket),
    signals,
  );
});

test('official past-runs are preserved and Drive market is never copied into odds/popularity', () => {
  const official = {
    ok: true,
    date: '2026-09-13',
    track: '阪神',
    race: 1,
    horses: [
      {
        horseNo: 1,
        horseName: 'テストホースA',
        runningStatus: 'active',
        odds: null,
        popularity: null,
        pastRuns: [{ date: '2026-08-01', finish: 2 }],
      },
      {
        horseNo: 2,
        horseName: 'テストホースB',
        runningStatus: 'active',
        odds: null,
        popularity: null,
        pastRuns: [{ date: '2026-08-02', finish: 3 }],
      },
    ],
  };

  const merged = mergeOfficialJraWithDriveRows(official, rows);
  assert.equal(merged.driveInput.status, 'matched');
  assert.equal(merged.driveInput.matchedHorseCount, 2);
  assert.equal(merged.driveInput.rawDriveIndicesExposed, false);
  assert.equal(merged.horses[0].pastRuns[0].finish, 2);
  assert.equal(merged.horses[0].odds, null);
  assert.equal(merged.horses[0].popularity, null);
  assert.ok(Number.isFinite(merged.horses[0].driveIndexSignal));
});

test('horse-name mismatch fails closed for that horse', () => {
  const official = {
    ok: true,
    horses: [{
      horseNo: 1,
      horseName: '別の馬名',
      runningStatus: 'active',
      pastRuns: [],
      odds: null,
      popularity: null,
    }],
  };

  const merged = mergeOfficialJraWithDriveRows(official, [rows[0]]);
  assert.equal(merged.driveInput.status, 'mismatch');
  assert.deepEqual(merged.driveInput.mismatchedHorseNos, [1]);
  assert.equal(merged.horses[0].driveIndexSignal, undefined);
});
