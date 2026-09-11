import {
  VIEWER_TRACKS,
  buildViewerDayUrl,
  buildViewerMarketDayUrl,
  buildViewerRaceUrl,
  buildViewerRacesUrl,
  formatViewerNumber,
  formatViewerPercent,
  normalizeViewerOrganization,
  normalizeViewerTrack,
  sanitizeViewerDayPayload,
  sanitizeViewerMarketPayload,
  sanitizeViewerRacePayload,
  sanitizeViewerRacesPayload,
  validViewerDate,
} from './viewer-core.js';

const elements = {
  form: document.querySelector('#viewer-form'),
  date: document.querySelector('#viewer-date'),
  organization: document.querySelector('#viewer-organization'),
  track: document.querySelector('#viewer-track'),
  submit: document.querySelector('#viewer-submit'),
  status: document.querySelector('#viewer-status'),
  summary: document.querySelector('#viewer-summary'),
  races: document.querySelector('#viewer-races'),
};

const controls = elements.form?.closest('.viewer-controls');
const trackField = elements.track?.closest('.viewer-field');
trackField?.classList.add('viewer-track-field');

let requestController = null;
let activeDay = null;
let activeContext = null;
const trackDiscoveryCache = new Map();
const expandedRaces = new Set();

const trackQuick = document.createElement('div');
trackQuick.className = 'viewer-track-quick';
trackQuick.hidden = true;
trackQuick.innerHTML = '<span class="viewer-track-quick-label">開催場</span><div class="viewer-track-chips"></div>';
elements.form?.insertAdjacentElement('afterend', trackQuick);
const trackChipBox = trackQuick.querySelector('.viewer-track-chips');

const raceNav = document.createElement('nav');
raceNav.className = 'viewer-race-nav';
raceNav.hidden = true;
raceNav.setAttribute('aria-label', 'レース移動');
controls?.insertAdjacentElement('afterend', raceNav);

const globalLegend = document.createElement('div');
globalLegend.className = 'viewer-global-legend-shell';
globalLegend.hidden = true;
raceNav.insertAdjacentElement('afterend', globalLegend);

function tokyoDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function setStatus(message = '', state = 'idle') {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
  elements.status.hidden = !message;
}

function fillTracks(preferredTrack = '') {
  const organization = normalizeViewerOrganization(elements.organization.value) || 'JRA';
  const tracks = VIEWER_TRACKS[organization];
  elements.track.replaceChildren();

  for (const track of tracks) {
    const option = document.createElement('option');
    option.value = track;
    option.textContent = track;
    elements.track.append(option);
  }

  if (normalizeViewerTrack(preferredTrack, organization)) elements.track.value = preferredTrack;
}

function markValues(horse) {
  return [horse.mark, horse.longshotMark, horse.dangerMark].filter(Boolean);
}

function markClass(value) {
  const text = String(value || '');
  if (text.includes('💎')) return 'is-longshot';
  if (text.includes('⚠')) return 'is-danger';
  if (text === '◎') return 'is-main';
  if (['○', '▲'].includes(text)) return 'is-sub';
  return 'is-mark';
}

function markCell(horse) {
  const wrapper = document.createElement('div');
  wrapper.className = 'viewer-marks';
  for (const value of markValues(horse)) {
    const span = document.createElement('span');
    span.textContent = value;
    span.classList.add(markClass(value));
    wrapper.append(span);
  }
  return wrapper;
}

function timeText(horse) {
  if (horse.predictedTimeText) return horse.predictedTimeText;
  if (horse.predictedTimeSec == null) return '—';
  const minutes = Math.floor(horse.predictedTimeSec / 60);
  const seconds = horse.predictedTimeSec - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}


function timeSeconds(horse) {
  if (Number.isFinite(Number(horse.predictedTimeSec))) return Number(horse.predictedTimeSec);
  const text = String(horse.predictedTimeText || '').trim();
  const match = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function raceRanks(race) {
  const active = race.horses.filter((horse) => horse.runnerStatus === 'active');

  const byTime = active
    .map((horse) => ({ horse, value: timeSeconds(horse) }))
    .filter((item) => item.value != null)
    .sort((a, b) => a.value - b.value || Number(a.horse.horseNo || 999) - Number(b.horse.horseNo || 999));

  const byWin = active
    .filter((horse) => horse.aiWinRate != null)
    .sort((a, b) => Number(b.aiWinRate) - Number(a.aiWinRate) || Number(a.horseNo || 999) - Number(b.horseNo || 999));

  const timeRank = new Map(byTime.map((item, index) => [Number(item.horse.horseNo), index + 1]));
  const winRank = new Map(byWin.map((horse, index) => [Number(horse.horseNo), index + 1]));

  return { timeRank, winRank };
}

function timeGapInfo(horse, ranks) {
  const no = Number(horse.horseNo);
  const timeRank = ranks.timeRank.get(no);
  const winRank = ranks.winRank.get(no);
  if (!timeRank || !winRank) return null;

  const gap = winRank - timeRank;
  if (timeRank <= 3 && gap >= 3) {
    return {
      timeRank,
      winRank,
      text: `時計${timeRank}位 / AI${winRank}位`,
    };
  }
  return null;
}

function evText(horse) {
  const ev = horse.expectedValue ?? (
    horse.aiWinRate != null && horse.odds != null
      ? Number((horse.aiWinRate * horse.odds).toFixed(2))
      : null
  );
  return ev == null ? '—' : `${formatViewerNumber(ev, 2)}×`;
}

function metric(label, value, emphasis = '') {
  const item = document.createElement('div');
  item.className = `viewer-horse-metric${emphasis ? ` ${emphasis}` : ''}`;
  const key = document.createElement('span');
  key.className = 'viewer-horse-metric-label';
  key.textContent = label;
  const val = document.createElement('strong');
  val.className = 'viewer-horse-metric-value';
  val.textContent = value;
  item.append(key, val);
  return item;
}

function horseIsFeatured(horse) {
  return ['◎', '○', '▲'].includes(String(horse.mark || ''))
    || Boolean(horse.longshotMark)
    || Boolean(horse.dangerMark);
}

function featuredHorses(race) {
  const explicit = race.horses.filter(horseIsFeatured);
  if (explicit.length) {
    const priority = (horse) => {
      if (horse.mark === '◎') return 0;
      if (horse.longshotMark) return 1;
      if (horse.mark === '○') return 2;
      if (horse.mark === '▲') return 3;
      if (horse.dangerMark) return 4;
      return 5;
    };
    return [...explicit].sort((a, b) => priority(a) - priority(b));
  }

  return [...race.horses]
    .filter((horse) => horse.runnerStatus === 'active')
    .sort((a, b) => Number(b.aiWinRate ?? -1) - Number(a.aiWinRate ?? -1))
    .slice(0, Math.min(3, race.horses.length));
}

function legendChip(symbol, label, className) {
  const chip = document.createElement('span');
  chip.className = `viewer-legend-chip ${className}`;
  chip.textContent = `${symbol} ${label}`;
  return chip;
}

function viewerLegend() {
  const legend = document.createElement('div');
  legend.className = 'viewer-focus-legend';
  legend.append(
    legendChip('◎', '本命', 'is-main'),
    legendChip('○', '対抗', 'is-sub'),
    legendChip('▲', '単穴', 'is-sub'),
    legendChip('💎', '穴', 'is-longshot'),
    legendChip('⚠', '危険', 'is-danger'),
  );
  return legend;
}

function mobileHorseCard(horse, featured = false, ranks = null) {
  const card = document.createElement('article');
  card.className = 'viewer-horse-card';
  if (featured) card.classList.add('is-featured');
  if (horse.runnerStatus !== 'active') card.classList.add('viewer-runner-inactive');

  const top = document.createElement('div');
  top.className = 'viewer-horse-card-top';

  const identity = document.createElement('div');
  identity.className = 'viewer-horse-identity';

  const no = document.createElement('span');
  no.className = 'viewer-horse-no';
  no.textContent = horse.horseNo ?? '—';

  const name = document.createElement('strong');
  name.className = 'viewer-horse-name';
  name.textContent = horse.horseName || '—';

  identity.append(no, name);

  const marks = markCell(horse);
  marks.classList.add('viewer-horse-card-marks');
  top.append(identity, marks);

  const marketAvailable = horse.popularity != null
    || horse.odds != null
    || horse.expectedValue != null
    || (horse.aiWinRate != null && horse.odds != null);

  if (marketAvailable) {
    const marketMetrics = document.createElement('div');
    marketMetrics.className = 'viewer-horse-metrics viewer-market-metrics';
    marketMetrics.append(
      metric('人気', horse.popularity == null ? '—' : `${horse.popularity}人気`, horse.popularity != null ? 'has-market' : ''),
      metric('オッズ', horse.odds == null ? '—' : formatViewerNumber(horse.odds, 1), horse.odds != null ? 'has-market' : ''),
      metric('EV', evText(horse), horse.expectedValue != null || (horse.aiWinRate != null && horse.odds != null) ? 'is-ev has-market' : 'is-ev'),
    );
    card.append(top, marketMetrics);
  } else {
    const marketMissing = document.createElement('div');
    marketMissing.className = 'viewer-market-missing-row';
    marketMissing.textContent = '市場データ未取得';
    card.append(top, marketMissing);
  }

  const predictionMetrics = document.createElement('div');
  predictionMetrics.className = 'viewer-horse-metrics viewer-prediction-metrics';

  const timeRank = ranks?.timeRank?.get(Number(horse.horseNo));
  predictionMetrics.append(
    metric('AI勝率', formatViewerPercent(horse.aiWinRate), 'is-primary'),
    metric('複勝率', formatViewerPercent(horse.aiTop3Rate), 'is-primary'),
    metric('予想TIME', timeText(horse), timeRank && timeRank <= 3 ? 'is-time-top' : ''),
  );
  card.append(predictionMetrics);

  const gapInfo = ranks ? timeGapInfo(horse, ranks) : null;
  if (gapInfo) {
    const diagnostic = document.createElement('div');
    diagnostic.className = 'viewer-time-diagnostic';
    diagnostic.textContent = `⏱ ${gapInfo.text} — TIME評価乖離`;
    diagnostic.title = '予想TIME順位に対してAI勝率順位が低い馬です。AI勝率自体は変更していません。';
    card.append(diagnostic);
  }

  const notes = [horse.longshotReason, horse.dangerReason].filter(Boolean);
  if (notes.length) {
    const note = document.createElement('p');
    note.className = 'viewer-horse-note';
    note.textContent = notes.join(' / ');
    card.append(note);
  }
  return card;
}

function horseRow(horse) {
  const row = document.createElement('tr');
  if (horse.runnerStatus !== 'active') row.classList.add('viewer-runner-inactive');
  const values = [
    markCell(horse),
    horse.horseNo ?? '—',
    horse.horseName || '—',
    horse.popularity == null ? '—' : `${horse.popularity}人気`,
    horse.odds == null ? '—' : formatViewerNumber(horse.odds, 1),
    evText(horse),
    formatViewerPercent(horse.aiWinRate),
    formatViewerPercent(horse.aiTop3Rate),
    timeText(horse),
  ];
  values.forEach((value, index) => {
    const cell = document.createElement(index === 2 ? 'th' : 'td');
    if (index === 2) cell.scope = 'row';
    if (value instanceof Node) cell.append(value);
    else cell.textContent = String(value);
    row.append(cell);
  });
  return row;
}

function raceKey(race) {
  return `${race.track || activeContext?.track || ''}:${race.raceNo || ''}`;
}

function marketStatus(race) {
  const active = race.horses.filter((horse) => horse.runnerStatus === 'active');
  const withOdds = active.filter((horse) => horse.odds != null).length;
  if (!withOdds) return { text: '市場データ 未取得', state: 'missing' };
  if (withOdds < active.length) return { text: `市場データ ${withOdds}/${active.length}`, state: 'partial' };
  return { text: '市場データ 反映済み', state: 'ready' };
}

function mobileRaceBody(race) {
  const shell = document.createElement('div');
  shell.className = 'viewer-mobile-race-body';

  const focus = featuredHorses(race);
  const ranks = raceRanks(race);
  const hasExplicit = race.horses.some(horseIsFeatured);

  const focusWrap = document.createElement('section');
  focusWrap.className = 'viewer-focus';

  const focusHead = document.createElement('div');
  focusHead.className = 'viewer-focus-head';

  const focusTitle = document.createElement('strong');
  focusTitle.textContent = hasExplicit ? '注目馬' : 'AI注目馬';

  const status = marketStatus(race);
  const marketBadge = document.createElement('span');
  marketBadge.className = `viewer-market-badge is-${status.state}`;
  marketBadge.textContent = status.text;

  focusHead.append(focusTitle, marketBadge);

  const focusList = document.createElement('div');
  focusList.className = 'viewer-focus-list';
  focus.forEach((horse) => focusList.append(mobileHorseCard(horse, true, ranks)));
  focusWrap.append(focusHead, focusList);

  const allWrap = document.createElement('div');
  allWrap.className = 'viewer-all-horses';
  allWrap.hidden = true;
  race.horses.forEach((horse) => allWrap.append(mobileHorseCard(horse, horseIsFeatured(horse), ranks)));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'viewer-expand-button';

  const key = raceKey(race);
  const setExpanded = (expanded) => {
    allWrap.hidden = !expanded;
    focusWrap.hidden = expanded;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.textContent = expanded ? '注目馬だけ表示' : `全頭を見る（${race.horses.length}頭）`;
    if (expanded) expandedRaces.add(key);
    else expandedRaces.delete(key);
  };

  toggle.addEventListener('click', () => {
    setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
  });

  shell.append(focusWrap, allWrap, toggle);
  setExpanded(expandedRaces.has(key));
  return shell;
}

function raceCard(race) {
  const article = document.createElement('article');
  article.className = 'viewer-race-card';
  article.id = `viewer-race-${race.raceNo ?? 'unknown'}`;

  const header = document.createElement('header');
  header.className = 'viewer-race-header';

  const title = document.createElement('div');
  title.className = 'viewer-race-title';
  const raceNo = document.createElement('strong');
  raceNo.textContent = `${race.raceNo ?? '—'}R`;
  const raceName = document.createElement('span');
  raceName.textContent = race.raceName || 'レース名未登録';
  title.append(raceNo, raceName);

  const meta = document.createElement('div');
  meta.className = 'viewer-race-meta';
  meta.textContent = [
    race.startTime ? `発走 ${race.startTime}` : '発走 --:--',
    race.surface && race.distance ? `${race.surface}${race.distance}m` : null,
    race.going ? `馬場 ${race.going}` : null,
    race.fieldSize ? `${race.fieldSize}頭` : null,
  ].filter(Boolean).join(' · ');
  header.append(title, meta);

  const mobile = mobileRaceBody(race);

  const scroll = document.createElement('div');
  scroll.className = 'viewer-table-scroll';
  const table = document.createElement('table');
  table.className = 'viewer-table';
  table.innerHTML = `
    <thead><tr>
      <th>印</th><th>馬番</th><th>馬名</th><th>人気</th><th>オッズ</th>
      <th>EV</th><th>AI勝率</th><th>AI複勝率</th><th>予想TIME</th>
    </tr></thead>`;
  const body = document.createElement('tbody');
  race.horses.forEach((horse) => body.append(horseRow(horse)));
  table.append(body);
  scroll.append(table);

  article.append(header, mobile, scroll);
  return article;
}

function renderRaceNav(day) {
  raceNav.replaceChildren();

  if (!day?.races?.length) {
    raceNav.hidden = true;
    globalLegend.hidden = true;
    globalLegend.hidden = true;
    return;
  }

  const top = document.createElement('div');
  top.className = 'viewer-race-nav-row';

  const label = document.createElement('span');
  label.className = 'viewer-race-nav-label';
  label.textContent = 'レース';

  const links = document.createElement('div');
  links.className = 'viewer-race-nav-links';

  for (const race of day.races) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'viewer-race-nav-link';
    const time = race.startTime ? ` ${race.startTime}` : '';
    button.textContent = `${race.raceNo ?? '—'}R${time}`;
    button.setAttribute('aria-label', `${race.raceNo ?? '—'}R${race.startTime ? ` 発走 ${race.startTime}` : ''}へ移動`);
    button.addEventListener('click', () => {
      document.getElementById(`viewer-race-${race.raceNo ?? 'unknown'}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    links.append(button);
  }

  top.append(label, links);

  raceNav.append(top);
  raceNav.hidden = false;

  globalLegend.replaceChildren();
  const legend = viewerLegend();
  legend.classList.add('viewer-global-legend');
  globalLegend.append(legend);
  globalLegend.hidden = false;
}

function renderDay(day) {
  activeDay = day;
  elements.races.replaceChildren();
  day.races.forEach((race) => elements.races.append(raceCard(race)));
  elements.summary.textContent = `${day.date || ''} ${day.track || ''} · ${day.races.length}レース`;
  elements.summary.hidden = false;
  renderRaceNav(day);
}

function updateAddressBar({ date, organization, track }) {
  const url = new URL(window.location.href);
  url.searchParams.set('date', date);
  url.searchParams.set('organization', organization);
  url.searchParams.set('track', track);
  history.replaceState(null, '', url);
}

function mutableDay(day) {
  return {
    ...day,
    races: day.races.map((race) => ({
      ...race,
      horses: race.horses.map((horse) => ({ ...horse })),
    })),
  };
}

function mergeMarket(day, marketDay) {
  const racesByNo = new Map(marketDay.races.map((race) => [Number(race.raceNo), race]));
  for (const race of day.races) {
    const marketRace = racesByNo.get(Number(race.raceNo));
    if (!marketRace) continue;
    const byNo = new Map(marketRace.horses.map((horse) => [Number(horse.horseNo), horse]));

    race.horses = race.horses.map((horse) => {
      const market = byNo.get(Number(horse.horseNo));
      if (!market) return horse;
      const expectedValue = market.expectedValue ?? (
        horse.aiWinRate != null && market.odds != null
          ? Number((horse.aiWinRate * market.odds).toFixed(2))
          : null
      );
      return {
        ...horse,
        odds: market.odds ?? horse.odds,
        popularity: market.popularity ?? horse.popularity,
        expectedValue: expectedValue ?? horse.expectedValue,
        longshotMark: market.longshotMark ?? horse.longshotMark,
        dangerMark: market.dangerMark ?? horse.dangerMark,
      };
    });
    race.marketAvailable = race.horses.some((horse) => horse.odds != null);
  }
}

function mergeRaceDetail(day, detail) {
  const target = day.races.find((race) => Number(race.raceNo) === Number(detail.raceNo));
  if (!target) return;
  const byNo = new Map(detail.horses.map((horse) => [Number(horse.horseNo), horse]));
  target.horses = target.horses.map((horse) => {
    const full = byNo.get(Number(horse.horseNo));
    if (!full) return horse;
    return {
      ...horse,
      ...full,
      odds: full.odds ?? horse.odds,
      popularity: full.popularity ?? horse.popularity,
      expectedValue: full.expectedValue ?? horse.expectedValue,
      longshotMark: full.longshotMark ?? horse.longshotMark,
      dangerMark: full.dangerMark ?? horse.dangerMark,
    };
  });
  for (const key of ['raceName', 'surface', 'distance', 'going', 'startTime', 'fieldSize']) {
    if (detail[key] != null) target[key] = detail[key];
  }
}

function mergeRaceSummaries(day, summaries) {
  const byNo = new Map(summaries.races.map((race) => [Number(race.raceNo), race]));
  for (const race of day.races) {
    const summary = byNo.get(Number(race.raceNo));
    if (!summary) continue;
    for (const key of ['raceName', 'startTime', 'surface', 'distance', 'going', 'fieldSize']) {
      if (summary[key] != null && (race[key] == null || race[key] === '')) race[key] = summary[key];
    }
  }
}

async function fetchRaceSummaries(context, signal) {
  const response = await fetch(buildViewerRacesUrl(context), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload) return null;
  try {
    return sanitizeViewerRacesPayload(payload);
  } catch {
    return null;
  }
}

async function fetchRaceDetail(context, raceNo, signal) {
  const response = await fetch(buildViewerRaceUrl({ ...context, race: raceNo }), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload) return null;
  try {
    return sanitizeViewerRacePayload(payload);
  } catch {
    return null;
  }
}

async function enrichReasons(day, context, signal) {
  const interesting = day.races.filter((race) =>
    race.horses.some((horse) => horse.longshotMark || horse.dangerMark));
  if (!interesting.length) return;

  const queue = [...interesting];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      if (signal.aborted) return;
      const race = queue.shift();
      const detail = await fetchRaceDetail(context, race.raceNo, signal).catch(() => null);
      if (detail) mergeRaceDetail(day, detail);
    }
  });

  await Promise.all(workers);
  if (!signal.aborted && activeDay === day) renderDay(day);
}

async function fetchMarketDay(context, signal) {
  const response = await fetch(buildViewerMarketDayUrl(context), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload) return null;
  try {
    return sanitizeViewerMarketPayload(payload);
  } catch {
    return null;
  }
}

async function checkTrackAvailable({ date, organization, track }) {
  const response = await fetch(buildViewerRacesUrl({ date, organization, track }), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  return Number(payload?.count || 0) > 0;
}

async function discoverAvailableTracks({ date, organization }) {
  if (!validViewerDate(date) || !normalizeViewerOrganization(organization)) return [];
  const cacheKey = `${date}|${organization}`;
  if (trackDiscoveryCache.has(cacheKey)) return trackDiscoveryCache.get(cacheKey);

  const tracks = [...VIEWER_TRACKS[organization]];
  const queue = [...tracks];
  const found = new Set();

  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const track = queue.shift();
      if (await checkTrackAvailable({ date, organization, track }).catch(() => false)) found.add(track);
    }
  });

  await Promise.all(workers);
  const available = tracks.filter((track) => found.has(track));
  trackDiscoveryCache.set(cacheKey, available);
  return available;
}

function renderTrackChips(tracks) {
  trackChipBox.replaceChildren();
  if (!tracks.length) {
    trackQuick.hidden = true;
    controls?.classList.remove('has-track-chips');
    return;
  }

  for (const track of tracks) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'viewer-track-chip';
    button.textContent = track;
    button.classList.toggle('is-active', elements.track.value === track);
    button.addEventListener('click', () => {
      elements.track.value = track;
      renderTrackChips(tracks);
      loadViewerDay();
    });
    trackChipBox.append(button);
  }

  trackQuick.hidden = false;
  controls?.classList.add('has-track-chips');
}

async function refreshTrackChips({ preferFirst = false } = {}) {
  const date = elements.date.value;
  const organization = normalizeViewerOrganization(elements.organization.value);
  if (!validViewerDate(date) || !organization) return renderTrackChips([]);

  const tracks = await discoverAvailableTracks({ date, organization });
  if (preferFirst && tracks.length && !tracks.includes(elements.track.value)) {
    elements.track.value = tracks[0];
  }
  renderTrackChips(tracks);
}

async function loadViewerDay() {
  const date = elements.date.value;
  const organization = normalizeViewerOrganization(elements.organization.value);
  const track = normalizeViewerTrack(elements.track.value, organization);

  if (!validViewerDate(date) || !organization || !track) {
    setStatus('開催日・主催・競馬場を確認してください。', 'error');
    return;
  }

  requestController?.abort();
  requestController = new AbortController();
  const { signal } = requestController;
  elements.submit.disabled = true;
  setStatus('予想を読み込んでいます…', 'loading');
  elements.summary.hidden = true;

  try {
    const context = { date, organization, track };
    const dayResponse = await fetch(buildViewerDayUrl(context), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    const payload = await dayResponse.json().catch(() => null);
    if (!dayResponse.ok) throw new Error(payload?.error?.code || `HTTP_${dayResponse.status}`);

    const day = mutableDay(sanitizeViewerDayPayload(payload));
    activeContext = context;

    const [summaries, marketDay] = await Promise.all([
      fetchRaceSummaries(context, signal).catch(() => null),
      fetchMarketDay(context, signal).catch(() => null),
    ]);
    if (summaries) mergeRaceSummaries(day, summaries);
    if (marketDay) mergeMarket(day, marketDay);

    renderDay(day);
    updateAddressBar(activeContext);
    setStatus('', 'success');

    const cached = trackDiscoveryCache.get(`${date}|${organization}`) || [];
    renderTrackChips(cached);
    enrichReasons(day, activeContext, signal).catch(() => {});
  } catch (error) {
    if (error?.name === 'AbortError') return;
    elements.races.replaceChildren();
    elements.summary.hidden = true;
    raceNav.hidden = true;
    const code = String(error?.message || 'VIEWER_LOAD_FAILED');
    const message = code === 'RACE_NOT_FOUND'
      ? 'この条件の保存済み予想はありません。'
      : '予想データを読み込めませんでした。';
    setStatus(`${message} (${code})`, 'error');
  } finally {
    elements.submit.disabled = false;
  }
}

function initialize() {
  const params = new URLSearchParams(window.location.search);
  const organization = normalizeViewerOrganization(params.get('organization')) || 'JRA';
  const date = validViewerDate(params.get('date')) ? params.get('date') : tokyoDateString();
  const requestedTrack = params.get('track') || '';

  elements.date.value = date;
  elements.organization.value = organization;
  fillTracks(requestedTrack);

  elements.organization.addEventListener('change', async () => {
    fillTracks();
    await refreshTrackChips({ preferFirst: true });
  });

  elements.date.addEventListener('change', async () => {
    await refreshTrackChips({ preferFirst: true });
  });

  elements.track.addEventListener('change', () => {
    const cached = trackDiscoveryCache.get(`${elements.date.value}|${elements.organization.value}`) || [];
    renderTrackChips(cached);
  });

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadViewerDay();
  });

  refreshTrackChips({ preferFirst: !requestedTrack }).catch(() => {});
  if (normalizeViewerTrack(requestedTrack, organization)) loadViewerDay();
  else setStatus('');
}

initialize();
