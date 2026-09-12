import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeElement {
  constructor() {
    this.disabled = false;
    this.textContent = '';
    this.open = false;
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  click() {
    for (const fn of this.listeners.get('click') || []) fn({ type: 'click' });
  }
}

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function makeContext(fetchImpl) {
  const elements = new Map([
    ['jraOfficialLoad', new FakeElement()],
    ['jraStatus', new FakeElement()],
    ['jraDataFile', new FakeElement()],
    ['jraManualFallback', new FakeElement()],
    ['liveOddsSync', new FakeElement()],
    ['liveOddsStatus', new FakeElement()]
  ]);

  const listeners = new Map();

  const addEventListener = (type, fn) => {
    const list = listeners.get(type) || [];
    list.push(fn);
    listeners.set(type, list);
  };

  const removeEventListener = (type, fn) => {
    const list = listeners.get(type) || [];
    listeners.set(type, list.filter(item => item !== fn));
  };

  const dispatchEvent = event => {
    for (const fn of listeners.get(event?.type) || []) fn(event);
    return true;
  };

  const context = {
    console,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    CustomEvent: FakeCustomEvent,
    fetch: fetchImpl,
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      }
    }
  };

  context.window = {
    CHASS_FEATURES: {},
    addEventListener,
    removeEventListener,
    dispatchEvent
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('jra-odds-client.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('jra-race-client.js', 'utf8'), context);

  return { context, elements };
}

const selection = { date: '2026-09-12', track: '中山', race: 1 };

const racePayload = {
  ok: true,
  organization: 'JRA',
  quality: {
    raceParsed: true,
    horseCount: 12,
    activeHorseCount: 12,
    horseNameRate: 1,
    weightRate: 1,
    jockeyRate: 1
  },
  dataConfidence: 'high'
};

const oddsPayload = {
  ok: true,
  organization: 'JRA',
  odds: Array.from({ length: 12 }, (_, i) => ({
    horseNo: i + 1,
    odds: 2 + i,
    popularity: i + 1
  })),
  quality: {
    activeHorseCount: 12,
    oddsHorseCount: 12,
    oddsCoverage: 1,
    complete: true
  },
  oddsSnapshotType: 'live',
  bridgeCache: {
    provider: 'github_actions_d1',
    kind: 'odds'
  }
};

test('successful official race load automatically chains JRA odds once', async () => {
  const calls = [];
  let applied = 0;
  let committed = 0;

  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).startsWith('/api/jra/race?')) {
      return { ok: true, json: async () => racePayload };
    }
    if (String(url).startsWith('/api/jra/odds?')) {
      return { ok: true, json: async () => oddsPayload };
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const { context } = makeContext(fetchImpl);

  const odds = context.window.CHASS_JRA_ODDS_CLIENT.create({
    isActive: () => true,
    getSelection: () => selection,
    getGeneration: () => 7,
    apply: () => { applied += 1; }
  });
  odds.setActive(true);

  const race = context.window.CHASS_JRA_RACE_CLIENT.create({
    isActive: () => true,
    getSelection: () => selection,
    getGeneration: () => 7,
    commit: () => { committed += 1; }
  });
  race.setActive(true);

  await race.load();
  await new Promise(resolve => setTimeout(resolve, 180));

  assert.equal(committed, 1);
  assert.equal(applied, 1);
  assert.equal(calls.filter(x => x.startsWith('/api/jra/race?')).length, 1);
  assert.equal(calls.filter(x => x.startsWith('/api/jra/odds?')).length, 1);
});

test('odds failure never rolls back a successful race commit', async () => {
  let committed = 0;
  let applied = 0;

  const fetchImpl = async url => {
    if (String(url).startsWith('/api/jra/race?')) {
      return { ok: true, json: async () => racePayload };
    }
    if (String(url).startsWith('/api/jra/odds?')) {
      return {
        ok: false,
        json: async () => ({ ok: false, error: 'JRA_ODDS_CACHE_MISS' })
      };
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const { context, elements } = makeContext(fetchImpl);

  const odds = context.window.CHASS_JRA_ODDS_CLIENT.create({
    isActive: () => true,
    getSelection: () => selection,
    getGeneration: () => 11,
    apply: () => { applied += 1; }
  });
  odds.setActive(true);

  const race = context.window.CHASS_JRA_RACE_CLIENT.create({
    isActive: () => true,
    getSelection: () => selection,
    getGeneration: () => 11,
    commit: () => { committed += 1; }
  });
  race.setActive(true);

  await race.load();
  await new Promise(resolve => setTimeout(resolve, 180));

  assert.equal(committed, 1);
  assert.equal(applied, 0);
  assert.match(elements.get('jraStatus').textContent, /予想計算完了/);
  assert.match(elements.get('liveOddsStatus').textContent, /JRAオッズ取得エラー/);
});

test('event for a different race is ignored', async () => {
  let oddsCalls = 0;
  const fetchImpl = async url => {
    if (String(url).startsWith('/api/jra/odds?')) oddsCalls += 1;
    return { ok: true, json: async () => oddsPayload };
  };

  const { context } = makeContext(fetchImpl);

  const odds = context.window.CHASS_JRA_ODDS_CLIENT.create({
    isActive: () => true,
    getSelection: () => selection,
    getGeneration: () => 1,
    apply: () => {}
  });
  odds.setActive(true);

  context.window.dispatchEvent(new FakeCustomEvent('chass:jra-race-ready', {
    detail: { date: '2026-09-12', track: '中山', race: 2, generation: 1 }
  }));

  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(oddsCalls, 0);
});
