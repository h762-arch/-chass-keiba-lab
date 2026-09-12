import {
  VIEWER_TRACKS,
  buildViewerDayUrl,
  buildViewerDateRacesUrl,
  buildViewerMarketDayUrl,
  buildViewerRaceUrl,
  buildViewerRacesUrl,
  buildViewerRecentUrl,
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
let noDataState = false;
const trackDiscoveryCache = new Map();
const expandedRaces = new Set();
const expandedSecondaryRaces = new Set();

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


const availabilityHint = document.createElement('div');
availabilityHint.className = 'viewer-availability-hint';
availabilityHint.hidden = true;
trackQuick.insertAdjacentElement('afterend', availabilityHint);

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


function setNoDataControls(date) {
  noDataState = true;

  const option = document.createElement('option');
  option.value = '';
  option.textContent = '保存データなし';
  option.selected = true;

  elements.track.replaceChildren(option);
  elements.track.disabled = true;
  elements.submit.disabled = true;
  elements.submit.textContent = '予想なし';

  controls?.classList.add('viewer-no-data');
  trackQuick.hidden = true;
  trackChipBox.replaceChildren();

  if (date) elements.track.setAttribute('aria-label', `${date} は保存データなし`);
}

function restoreDataControls(preferredTrack = '') {
  noDataState = false;
  elements.track.disabled = false;
  elements.submit.disabled = false;
  elements.submit.textContent = '予想を表示';
  controls?.classList.remove('viewer-no-data');
  elements.track.removeAttribute('aria-label');

  const organization = normalizeViewerOrganization(elements.organization.value) || 'JRA';
  const current = normalizeViewerTrack(elements.track.value, organization);
  if (!current || elements.track.options.length <= 1) {
    fillTracks(preferredTrack);
  }

  if (normalizeViewerTrack(preferredTrack, organization)) {
    elements.track.value = preferredTrack;
  }
}

function markValues(horse) {
  return [horse.mark, horse.longshotMark, horse.dangerMark].filter(Boolean);
}

function markClass(value) {
  const text = String(value || '');
  if (text.includes('💎')) return 'is-longshot';
  if (text.includes('⚠')) return 'is-danger';
  if (text === '◎') return 'is-main';
  if (['○', '▲', '△'].includes(text)) return 'is-sub';
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
  const direct = horse.predictedTimeSec;
  if (direct != null && direct !== '' && Number.isFinite(Number(direct))) {
    const value = Number(direct);
    return value > 0 ? value : null;
  }

  const text = String(horse.predictedTimeText || '').trim();
  if (!text || text === '—') return null;

  const match = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(text);
  if (!match) return null;

  const value = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function raceRanks(race) {
  const active = race.horses.filter((horse) => horse.runnerStatus === 'active');

  const byTime = active
    .map((horse) => ({ horse, value: timeSeconds(horse) }))
    .filter((item) => item.value != null)
    .sort((a, b) => a.value - b.value || Number(a.horse.horseNo || 999) - Number(b.horse.horseNo || 999));

  const byWin = active
    .filter((horse) => horse.aiWinRate != null && Number.isFinite(Number(horse.aiWinRate)))
    .sort((a, b) => Number(b.aiWinRate) - Number(a.aiWinRate) || Number(a.horseNo || 999) - Number(b.horseNo || 999));

  const byAbility = active
    .filter((horse) => horse.abilityScore != null && Number.isFinite(Number(horse.abilityScore)))
    .sort((a, b) => Number(b.abilityScore) - Number(a.abilityScore) || Number(a.horseNo || 999) - Number(b.horseNo || 999));

  const timeRank = new Map();
  let previousTime = null;
  let currentTimeRank = 0;
  byTime.forEach((item, index) => {
    if (previousTime == null || Math.abs(item.value - previousTime) > 1e-9) currentTimeRank = index + 1;
    timeRank.set(Number(item.horse.horseNo), currentTimeRank);
    previousTime = item.value;
  });

  const winRank = new Map();
  let previousWin = null;
  let currentWinRank = 0;
  byWin.forEach((horse, index) => {
    const value = Number(horse.aiWinRate);
    if (previousWin == null || Math.abs(value - previousWin) > 1e-12) currentWinRank = index + 1;
    winRank.set(Number(horse.horseNo), currentWinRank);
    previousWin = value;
  });

  const abilityRank = new Map();
  let previousAbility = null;
  let currentAbilityRank = 0;
  byAbility.forEach((horse, index) => {
    const value = Number(horse.abilityScore);
    if (previousAbility == null || Math.abs(value - previousAbility) > 1e-9) currentAbilityRank = index + 1;
    abilityRank.set(Number(horse.horseNo), currentAbilityRank);
    previousAbility = value;
  });

  return { timeRank, winRank, abilityRank };
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

function liveExpectedValue(horse) {
  if (horse.aiWinRate == null || horse.odds == null) return null;
  const probability = Number(horse.aiWinRate);
  const odds = Number(horse.odds);
  if (!Number.isFinite(probability) || probability < 0) return null;
  if (!Number.isFinite(odds) || odds <= 0) return null;
  return Number((probability * odds).toFixed(2));
}

function evText(horse) {
  const ev = liveExpectedValue(horse);
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

const SECONDARY_MARKS = new Set(['○', '▲', '△']);

function horseHasPrimarySignal(horse) {
  return horse.mark === '◎'
    || Boolean(horse.longshotMark)
    || Boolean(horse.dangerMark);
}

function horseHasSecondarySignal(horse) {
  return SECONDARY_MARKS.has(String(horse.mark || ''));
}

function horseIsMarked(horse) {
  return horseHasPrimarySignal(horse) || horseHasSecondarySignal(horse);
}

function primaryHorses(race) {
  const explicit = race.horses.filter(horseHasPrimarySignal);
  if (explicit.length) {
    const priority = (horse) => {
      if (horse.mark === '◎') return 0;
      if (horse.longshotMark) return 1;
      if (horse.dangerMark) return 2;
      return 3;
    };
    return [...explicit].sort((a, b) => priority(a) - priority(b));
  }

  return [...race.horses]
    .filter((horse) => horse.runnerStatus === 'active')
    .sort((a, b) => Number(b.aiWinRate ?? -1) - Number(a.aiWinRate ?? -1))
    .slice(0, Math.min(1, race.horses.length));
}

function secondaryHorses(race, primary, ranks = null) {
  const primaryNos = new Set(primary.map((horse) => Number(horse.horseNo)));
  const markPriority = new Map([
    ['○', 0],
    ['▲', 1],
    ['△', 2],
  ]);

  return race.horses
    .filter((horse) =>
      !primaryNos.has(Number(horse.horseNo))
      && horseHasSecondarySignal(horse)
    )
    .sort((a, b) => {
      const markDiff = (markPriority.get(String(a.mark || '')) ?? 99)
        - (markPriority.get(String(b.mark || '')) ?? 99);
      if (markDiff) return markDiff;

      const aAbilityRank = resolvedAbilityRank(a, ranks) ?? 999;
      const bAbilityRank = resolvedAbilityRank(b, ranks) ?? 999;
      const abilityDiff = aAbilityRank - bAbilityRank;
      if (abilityDiff) return abilityDiff;

      const winDiff = Number(b.aiWinRate ?? -1) - Number(a.aiWinRate ?? -1);
      if (winDiff) return winDiff;

      return Number(a.horseNo ?? 999) - Number(b.horseNo ?? 999);
    });
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
    legendChip('△', '連下', 'is-sub'),
    legendChip('💎', '穴', 'is-longshot'),
    legendChip('⚠', '危険', 'is-danger'),
  );
  return legend;
}

function resolvedAbilityRank(horse, ranks) {
  const computed = ranks?.abilityRank?.get(Number(horse.horseNo));
  if (computed != null) return computed;
  const provided = Number(horse.abilityRank);
  return Number.isFinite(provided) && provided > 0 ? provided : null;
}

function abilityBadge(horse, ranks = null) {
  const panel = document.createElement('div');
  panel.className = 'viewer-ability-panel';
  panel.title = '公開用総合能力指数と能力順位';

  const scoreBox = document.createElement('div');
  scoreBox.className = 'viewer-ability-stat viewer-ability-score';

  const scoreLabel = document.createElement('span');
  scoreLabel.textContent = '能力';

  const score = document.createElement('strong');
  score.textContent = horse.abilityScore == null ? '—' : formatViewerNumber(horse.abilityScore, 1);
  scoreBox.append(scoreLabel, score);

  const rankBox = document.createElement('div');
  rankBox.className = 'viewer-ability-stat viewer-ability-rank';

  const rankLabel = document.createElement('span');
  rankLabel.textContent = '順位';

  const rank = document.createElement('strong');
  const abilityRank = resolvedAbilityRank(horse, ranks);
  rank.textContent = abilityRank == null ? '—' : `${abilityRank}位`;

  rankBox.append(rankLabel, rank);
  panel.append(scoreBox, rankBox);
  return panel;
}

function shortComment(horse, ranks) {
  const facts = [];
  const no = Number(horse.horseNo);
  const aiRank = ranks?.winRank?.get(no);
  const timeRank = ranks?.timeRank?.get(no);

  const abilityRank = resolvedAbilityRank(horse, ranks);
  if (abilityRank != null && abilityRank <= 3) {
    facts.push(`能力${abilityRank}位`);
  }
  if (aiRank != null && aiRank <= 3) {
    facts.push(`AI勝率${aiRank}位`);
  }
  if (timeRank != null && timeRank <= 3) {
    facts.push(`予想TIME${timeRank}位`);
  }
  const liveEv = liveExpectedValue(horse);
  if (liveEv != null && liveEv >= 1) {
    facts.push(`EV ${formatViewerNumber(liveEv, 2)}×`);
  }

  const reasons = [];
  if (horse.longshotReason) reasons.push(`💎 ${horse.longshotReason}`);
  if (horse.dangerReason) reasons.push(`⚠ ${horse.dangerReason}`);

  if (!reasons.length) {
    if (horse.mark === '◎') reasons.push('◎ 本命評価');
    else if (horse.mark === '○') reasons.push('○ 対抗評価');
    else if (horse.mark === '▲') reasons.push('▲ 単穴評価');
    else if (horse.mark === '△') reasons.push('△ 連下評価');
    else if (horse.longshotMark) reasons.push('💎 穴評価');
    else if (horse.dangerMark) reasons.push('⚠ 注意評価');
  }

  return [...facts, ...reasons].filter(Boolean).join('・');
}

function mobileHorseCard(horse, featured = false, ranks = null) {
  const card = document.createElement('article');
  card.className = 'viewer-horse-card';
  if (featured) card.classList.add('is-featured');
  if (horse.runnerStatus !== 'active') card.classList.add('viewer-runner-inactive');

  const top = document.createElement('div');
  top.className = 'viewer-horse-card-top viewer-horse-card-top-v36';

  const marks = markCell(horse);
  marks.classList.add('viewer-horse-card-marks', 'is-leading');
  if (!marks.childElementCount) marks.classList.add('is-empty');

  const identity = document.createElement('div');
  identity.className = 'viewer-horse-identity';

  const no = document.createElement('span');
  no.className = 'viewer-horse-no';
  no.textContent = horse.horseNo ?? '—';

  const name = document.createElement('strong');
  name.className = 'viewer-horse-name';
  name.textContent = horse.horseName || '—';

  identity.append(no, name);

  const ability = abilityBadge(horse, ranks);
  top.append(marks, identity, ability);

  const marketAvailable = horse.popularity != null
    || horse.odds != null;

  if (marketAvailable) {
    const marketMetrics = document.createElement('div');
    marketMetrics.className = 'viewer-horse-metrics viewer-market-metrics';
    marketMetrics.append(
      metric('人気', horse.popularity == null ? '—' : `${horse.popularity}人気`, horse.popularity != null ? 'has-market' : ''),
      metric('オッズ', horse.odds == null ? '—' : formatViewerNumber(horse.odds, 1), horse.odds != null ? 'has-market' : ''),
      metric('EV', evText(horse), liveExpectedValue(horse) != null ? 'is-ev has-market' : 'is-ev'),
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

  const comment = featured ? shortComment(horse, ranks) : '';
  if (comment) {
    const note = document.createElement('p');
    note.className = 'viewer-short-comment';
    note.textContent = comment;
    card.append(note);
  }

  const gapInfo = ranks ? timeGapInfo(horse, ranks) : null;
  if (gapInfo) {
    const diagnostic = document.createElement('div');
    diagnostic.className = 'viewer-time-diagnostic';
    diagnostic.textContent = `⏱ ${gapInfo.text} — TIME評価乖離`;
    diagnostic.title = '予想TIME順位に対してAI勝率順位が低い馬です。AI勝率自体は変更していません。';
    card.append(diagnostic);
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

  const ranks = raceRanks(race);
  const primary = primaryHorses(race);
  const secondary = secondaryHorses(race, primary, ranks);
  const hasPrimarySignal = primary.some(horseHasPrimarySignal);

  const focusWrap = document.createElement('section');
  focusWrap.className = 'viewer-focus';

  const focusHead = document.createElement('div');
  focusHead.className = 'viewer-focus-head';

  const focusTitle = document.createElement('strong');
  focusTitle.textContent = hasPrimarySignal ? '注目馬' : 'AI注目馬';

  const status = marketStatus(race);
  const marketBadge = document.createElement('span');
  marketBadge.className = `viewer-market-badge is-${status.state}`;
  marketBadge.textContent = status.text;

  focusHead.append(focusTitle, marketBadge);

  const focusList = document.createElement('div');
  focusList.className = 'viewer-focus-list';
  primary.forEach((horse) => focusList.append(mobileHorseCard(horse, true, ranks)));
  focusWrap.append(focusHead, focusList);

  const secondaryWrap = document.createElement('div');
  secondaryWrap.className = 'viewer-secondary-horses';
  secondaryWrap.hidden = true;
  secondary.forEach((horse) => secondaryWrap.append(mobileHorseCard(horse, true, ranks)));

  const allWrap = document.createElement('div');
  allWrap.className = 'viewer-all-horses';
  allWrap.hidden = true;
  race.horses.forEach((horse) =>
    allWrap.append(mobileHorseCard(horse, horseIsMarked(horse), ranks))
  );

  const actions = document.createElement('div');
  actions.className = 'viewer-action-row';
  const key = raceKey(race);

  const secondaryToggle = document.createElement('button');
  secondaryToggle.type = 'button';
  secondaryToggle.className = 'viewer-secondary-button';

  const allToggle = document.createElement('button');
  allToggle.type = 'button';
  allToggle.className = 'viewer-expand-button';

  const setSecondary = (expanded) => {
    secondaryWrap.hidden = !expanded;
    secondaryToggle.hidden = secondary.length === 0;
    secondaryToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    secondaryToggle.textContent = expanded
      ? '○▲△を閉じる'
      : `○▲△を見る（${secondary.length}頭）`;
    if (expanded) expandedSecondaryRaces.add(key);
    else expandedSecondaryRaces.delete(key);
  };

  const setAll = (expanded) => {
    allWrap.hidden = !expanded;
    focusWrap.hidden = expanded;
    secondaryWrap.hidden = expanded ? true : !expandedSecondaryRaces.has(key);
    secondaryToggle.hidden = expanded || secondary.length === 0;
    allToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    allToggle.textContent = expanded
      ? '注目馬に戻す'
      : `全頭を見る（${race.horses.length}頭）`;
    if (expanded) expandedRaces.add(key);
    else expandedRaces.delete(key);
  };

  secondaryToggle.addEventListener('click', () => {
    setSecondary(secondaryToggle.getAttribute('aria-expanded') !== 'true');
  });

  allToggle.addEventListener('click', () => {
    setAll(allToggle.getAttribute('aria-expanded') !== 'true');
  });

  actions.append(secondaryToggle, allToggle);
  shell.append(focusWrap, secondaryWrap, allWrap, actions);

  setSecondary(expandedSecondaryRaces.has(key));
  setAll(expandedRaces.has(key));
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
  day.races.forEach(normalizeDuplicateMainMarks);
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


function horseIdentityKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[\s　・･·.．"'’“”`´()（）[\]【】{}「」『』\-‐‑‒–—―]/g, '')
    .toUpperCase();
}

function horseNameDistance(left, right) {
  const a = horseIdentityKey(left);
  const b = horseIdentityKey(right);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a === b) return 0;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function resolveHorseIdentity(baseHorse, candidates, used = new Set()) {
  const baseName = horseIdentityKey(baseHorse?.horseName);
  const available = candidates.filter((candidate) => !used.has(candidate));

  if (baseName) {
    const exact = available.filter(
      (candidate) => horseIdentityKey(candidate?.horseName) === baseName,
    );
    if (exact.length === 1) return exact[0];

    // Minor spelling discrepancy only when one unique candidate is clearly closest.
    if (baseName.length >= 5) {
      const fuzzy = available
        .map((candidate) => ({
          candidate,
          distance: horseNameDistance(baseHorse.horseName, candidate?.horseName),
        }))
        .filter((item) => item.distance <= 2)
        .sort((a, b) => a.distance - b.distance);

      if (fuzzy.length === 1) return fuzzy[0].candidate;
      if (fuzzy.length >= 2 && fuzzy[0].distance < fuzzy[1].distance) {
        return fuzzy[0].candidate;
      }
    }

    // If a name exists but does not agree, do not fall back to horse number.
    return null;
  }

  // Number fallback is allowed only when the base name is absent.
  const number = Number(baseHorse?.horseNo);
  if (Number.isFinite(number)) {
    const byNo = available.filter((candidate) => Number(candidate?.horseNo) === number);
    if (byNo.length === 1) return byNo[0];
  }

  return null;
}

function normalizeDuplicateMainMarks(race) {
  const mains = race.horses.filter(
    (horse) => horse.runnerStatus === 'active' && horse.mark === '◎',
  );
  if (mains.length <= 1) return;

  const keep = [...mains].sort((a, b) => {
    const winDiff = Number(b.aiWinRate ?? -1) - Number(a.aiWinRate ?? -1);
    if (winDiff) return winDiff;

    const abilityDiff = Number(b.abilityScore ?? -1) - Number(a.abilityScore ?? -1);
    if (abilityDiff) return abilityDiff;

    return Number(a.horseNo ?? 999) - Number(b.horseNo ?? 999);
  })[0];

  for (const horse of mains) {
    if (horse !== keep) horse.mark = null;
  }
}

function mergeMarket(day, marketDay) {
  const racesByNo = new Map(marketDay.races.map((race) => [Number(race.raceNo), race]));

  for (const race of day.races) {
    const marketRace = racesByNo.get(Number(race.raceNo));
    if (!marketRace) continue;

    const used = new Set();

    race.horses = race.horses.map((horse) => {
      const market = resolveHorseIdentity(horse, marketRace.horses, used);

      // If identity cannot be safely resolved, do not attach market values
      // from a different runner.
      if (!market) {
        return {
          ...horse,
          odds: null,
          popularity: null,
          expectedValue: null,
        };
      }

      used.add(market);

      const expectedValue = (
        horse.aiWinRate != null && market.odds != null
          ? Number((horse.aiWinRate * market.odds).toFixed(2))
          : null
      );

      return {
        ...horse,
        horseNo: market.horseNo ?? horse.horseNo,
        horseName: market.horseName || horse.horseName,
        abilityScore: market.abilityScore ?? horse.abilityScore,
        abilityRank: market.abilityRank ?? horse.abilityRank,
        odds: market.odds ?? null,
        popularity: market.popularity ?? null,
        expectedValue,
        longshotMark: market.longshotMark ?? horse.longshotMark,
        dangerMark: market.dangerMark ?? horse.dangerMark,
      };
    });

    race.marketAvailable = race.horses.some((horse) => horse.odds != null);
    normalizeDuplicateMainMarks(race);
  }
}

function mergeRaceDetail(day, detail) {
  const target = day.races.find((race) => Number(race.raceNo) === Number(detail.raceNo));
  if (!target) return;

  const used = new Set();

  target.horses = target.horses.map((horse) => {
    const full = resolveHorseIdentity(horse, detail.horses, used);
    if (!full) return horse;

    used.add(full);

    return {
      ...horse,
      ...full,
      // Current horse identity may already have been corrected from market data.
      horseNo: horse.horseNo ?? full.horseNo,
      horseName: horse.horseName || full.horseName,
      odds: horse.odds ?? full.odds,
      popularity: horse.popularity ?? full.popularity,
      expectedValue: horse.expectedValue ?? full.expectedValue,
      longshotMark: full.longshotMark ?? horse.longshotMark,
      dangerMark: full.dangerMark ?? horse.dangerMark,
    };
  });

  normalizeDuplicateMainMarks(target);

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

async function fetchDateRaceSummaries({ date, organization }, signal = undefined) {
  const response = await fetch(buildViewerDateRacesUrl({ date, organization }), {
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

async function discoverAvailableTracks({ date, organization }, signal = undefined) {
  if (!validViewerDate(date) || !normalizeViewerOrganization(organization)) return [];
  const cacheKey = `${date}|${organization}`;
  if (trackDiscoveryCache.has(cacheKey)) return trackDiscoveryCache.get(cacheKey);

  const summaries = await fetchDateRaceSummaries({ date, organization }, signal).catch(() => null);
  const found = new Set(
    (summaries?.races || [])
      .filter((race) => race.predictionAvailable !== false)
      .map((race) => race.track)
      .filter(Boolean),
  );

  const available = VIEWER_TRACKS[organization].filter((track) => found.has(track));
  trackDiscoveryCache.set(cacheKey, available);
  return available;
}

async function fetchLatestSavedContext(organization, signal = undefined) {
  const response = await fetch(buildViewerRecentUrl({ organization, limit: 20 }), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload) return null;

  let recent;
  try {
    recent = sanitizeViewerRacesPayload(payload);
  } catch {
    return null;
  }

  const found = recent.races.find((race) =>
    race.predictionAvailable !== false
    && validViewerDate(race.date)
    && normalizeViewerTrack(race.track, organization));

  return found
    ? { date: found.date, organization, track: found.track, raceNo: found.raceNo }
    : null;
}

function hideAvailabilityHint() {
  availabilityHint.hidden = true;
  availabilityHint.replaceChildren();
}

async function showNoSavedDate({ date, organization }, signal = undefined) {
  elements.races.replaceChildren();
  elements.summary.hidden = true;
  raceNav.hidden = true;
  globalLegend.hidden = true;
  renderTrackChips([]);
  setStatus('');
  setNoDataControls(date);

  const latest = await fetchLatestSavedContext(organization, signal).catch(() => null);

  availabilityHint.replaceChildren();

  const copy = document.createElement('div');
  copy.className = 'viewer-availability-copy';

  const title = document.createElement('strong');
  title.className = 'viewer-availability-title';
  title.textContent = 'この日の保存済み予想はありません';

  const sub = document.createElement('span');
  sub.className = 'viewer-availability-sub';
  sub.textContent = `${date} · ${organization}`;

  copy.append(title, sub);
  availabilityHint.append(copy);

  if (latest) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'viewer-availability-button is-primary';
    button.textContent = `最新 ${latest.date} ${latest.track} を見る`;
    button.addEventListener('click', async () => {
      elements.date.value = latest.date;
      elements.organization.value = latest.organization;
      restoreDataControls(latest.track);
      elements.track.value = latest.track;
      hideAvailabilityHint();
      await refreshTrackChips({ preferFirst: false });
      await loadViewerDay();
    });
    availabilityHint.append(button);
  } else {
    const note = document.createElement('span');
    note.className = 'viewer-availability-note';
    note.textContent = '予想が保存されると自動で表示対象になります。';
    availabilityHint.append(note);
  }

  availabilityHint.hidden = false;
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

async function refreshTrackChips({ preferFirst = false, showFallback = false, signal = undefined } = {}) {
  const date = elements.date.value;
  const organization = normalizeViewerOrganization(elements.organization.value);
  if (!validViewerDate(date) || !organization) {
    renderTrackChips([]);
    return [];
  }

  const tracks = await discoverAvailableTracks({ date, organization }, signal);

  if (tracks.length) {
    const preferred = tracks.includes(elements.track.value)
      ? elements.track.value
      : tracks[0];
    restoreDataControls(preferred);
    hideAvailabilityHint();
    if (preferFirst && !tracks.includes(elements.track.value)) {
      elements.track.value = tracks[0];
    }
    renderTrackChips(tracks);
    return tracks;
  }

  renderTrackChips([]);
  if (showFallback) await showNoSavedDate({ date, organization }, signal);
  return [];
}

async function loadViewerDay() {
  const date = elements.date.value;
  const organization = normalizeViewerOrganization(elements.organization.value);

  if (!validViewerDate(date) || !organization) {
    setStatus('開催日・主催を確認してください。', 'error');
    return;
  }

  requestController?.abort();
  requestController = new AbortController();
  const { signal } = requestController;
  elements.submit.disabled = true;
  elements.submit.textContent = '読み込み中…';
  setStatus('予想を読み込んでいます…', 'loading');
  elements.summary.hidden = true;

  try {
    const availableTracks = await refreshTrackChips({
      preferFirst: true,
      showFallback: true,
      signal,
    });

    if (!availableTracks.length) return;

    let track = normalizeViewerTrack(elements.track.value, organization);
    if (!track || !availableTracks.includes(track)) {
      track = availableTracks[0];
      elements.track.value = track;
      renderTrackChips(availableTracks);
    }

    restoreDataControls(track);
    hideAvailabilityHint();
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
    if (code === 'RACE_NOT_FOUND') {
      await showNoSavedDate({ date, organization }, signal).catch(() => {});
    } else {
      setStatus(`予想データを読み込めませんでした。 (${code})`, 'error');
    }
  } finally {
    elements.submit.disabled = noDataState;
    elements.submit.textContent = noDataState ? '予想なし' : '予想を表示';
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
    restoreDataControls();
    fillTracks();
    hideAvailabilityHint();
    await refreshTrackChips({ preferFirst: true, showFallback: true });
  });

  elements.date.addEventListener('change', async () => {
    restoreDataControls();
    hideAvailabilityHint();
    await refreshTrackChips({ preferFirst: true, showFallback: true });
  });

  elements.track.addEventListener('change', () => {
    const cached = trackDiscoveryCache.get(`${elements.date.value}|${elements.organization.value}`) || [];
    renderTrackChips(cached);
  });

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadViewerDay();
  });

  refreshTrackChips({ preferFirst: !requestedTrack, showFallback: true }).catch(() => {});
  if (normalizeViewerTrack(requestedTrack, organization)) loadViewerDay();
  else setStatus('');
}

initialize();
