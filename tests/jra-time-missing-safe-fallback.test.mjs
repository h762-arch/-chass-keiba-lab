import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadModel() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('jra-model.js', 'utf8'), context);
  return context.CHASS_JRA_MODEL;
}

function race(overrides = {}) {
  return {
    racecourse: '中山',
    distance: 1200,
    surface: 'ダート',
    trackCondition: '良',
    raceClass: '1勝',
    pace: '標準',
    ...overrides
  };
}

function run(overrides = {}) {
  return {
    distance: 1200,
    surface: 'ダート',
    racecourse: '中山',
    trackCondition: '良',
    timeSeconds: 72,
    finish: 4,
    fieldSize: 16,
    margin: 0.5,
    last3F: 36,
    cornerPositions: [5, 5],
    weightCarried: 56,
    raceClass: '1勝',
    ...overrides
  };
}

function horse(no, pastRuns, overrides = {}) {
  return {
    horseNo: no,
    horseName: `Horse${no}`,
    sexAge: '牡3',
    weightCarried: 56,
    odds: 5 + no,
    popularity: no,
    pastRuns,
    ...overrides
  };
}

test('existing primary TIME path stays primary', () => {
  const model = loadModel();
  const out = model.calculate({
    race: race(),
    horses: [
      horse(1, [run({ timeSeconds: 71.8 })]),
      horse(2, [run({ timeSeconds: 72.4 })]),
      horse(3, [run({ timeSeconds: 73.0 })])
    ]
  });

  assert.equal(out.horses.length, 3);
  for (const h of out.horses) {
    assert.match(h.predictedTime, /^\d+:\d{2}\.\d$/);
    assert.equal(h.predictedTimeType, 'レース基準補正');
    assert.equal(h.predictedTimeMissingReason, null);
  }
});

test('missing TIME gets same-surface wider-distance fallback only', () => {
  const model = loadModel();
  const out = model.calculate({
    race: race({ distance: 1200 }),
    horses: [
      horse(1, [run({ distance: 1200, timeSeconds: 72.0 })]),
      horse(2, [run({ distance: 1300, timeSeconds: 78.0 })]),
      // Difference 600m => distanceSimilarity .25.
      // Old path (>= .5) was missing; safe fallback may use it.
      horse(3, [run({ distance: 1800, timeSeconds: 112.0 })])
    ]
  });

  const h = out.horses.find(x => x.horseNo === 3);
  assert.ok(h.predictedTime);
  assert.equal(h.predictedTimeType, '距離補正・低信頼');
  assert.ok(h.predictedTimeConfidence <= 45);
  assert.equal(h.predictedTimeMissingReason, null);
});

test('debut horse remains blank instead of fabricating TIME', () => {
  const model = loadModel();
  const out = model.calculate({
    race: race(),
    horses: [
      horse(1, [run({ timeSeconds: 72.0 })]),
      horse(2, [run({ timeSeconds: 72.5 })]),
      horse(3, [])
    ]
  });

  const debut = out.horses.find(x => x.horseNo === 3);
  assert.equal(debut.predictedTime, '');
  assert.equal(debut.predictedTimeType, '');
  assert.equal(debut.predictedTimeConfidence, null);
  assert.equal(debut.predictedTimeMissingReason, 'debut_no_time_evidence');
});

test('different-surface run is never used as TIME fallback', () => {
  const model = loadModel();
  const out = model.calculate({
    race: race({ surface: '芝' }),
    horses: [
      horse(1, [run({ surface: '芝', timeSeconds: 69.5 })]),
      horse(2, [run({ surface: '芝', timeSeconds: 70.0 })]),
      horse(3, [run({ surface: 'ダート', distance: 1200, timeSeconds: 72.0 })])
    ]
  });

  const h = out.horses.find(x => x.horseNo === 3);
  assert.equal(h.predictedTime, '');
  assert.equal(h.predictedTimeMissingReason, 'no_same_surface_time_evidence');
});

test('fallback TIME is market independent', () => {
  const model = loadModel();
  const input = {
    race: race(),
    horses: [
      horse(1, [run({ timeSeconds: 72.0 })]),
      horse(2, [run({ timeSeconds: 72.5 })]),
      horse(3, [run({ distance: 1800, timeSeconds: 112.0 })], { odds: 3, popularity: 1 })
    ]
  };

  const a = model.calculate(input);
  const changedMarket = structuredClone(input);
  changedMarket.horses[2].odds = 99.9;
  changedMarket.horses[2].popularity = 16;
  const b = model.calculate(changedMarket);

  const ta = a.horses.find(x => x.horseNo === 3).predictedTime;
  const tb = b.horses.find(x => x.horseNo === 3).predictedTime;
  assert.equal(ta, tb);
});
