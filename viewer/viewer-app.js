import {
  VIEWER_TRACKS,
  buildViewerDayUrl,
  formatViewerNumber,
  formatViewerPercent,
  normalizeViewerOrganization,
  normalizeViewerTrack,
  sanitizeViewerDayPayload,
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

let requestController = null;

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

function setStatus(message, state = 'idle') {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
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

  if (normalizeViewerTrack(preferredTrack, organization)) {
    elements.track.value = preferredTrack;
  }
}

function markCell(horse) {
  const wrapper = document.createElement('div');
  wrapper.className = 'viewer-marks';
  for (const value of [horse.mark, horse.longshotMark, horse.dangerMark]) {
    if (!value) continue;
    const span = document.createElement('span');
    span.textContent = value;
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

function horseRow(horse) {
  const row = document.createElement('tr');
  if (horse.runnerStatus !== 'active') row.classList.add('viewer-runner-inactive');

  const values = [
    markCell(horse),
    horse.horseNo ?? '—',
    horse.horseName || '—',
    formatViewerPercent(horse.aiWinRate),
    formatViewerPercent(horse.aiTop3Rate),
    horse.odds == null ? '—' : formatViewerNumber(horse.odds, 1),
    horse.popularity == null ? '—' : `${horse.popularity}人気`,
    horse.expectedValue == null ? '—' : formatViewerNumber(horse.expectedValue, 2),
    timeText(horse),
  ];

  values.forEach((value, index) => {
    const cell = document.createElement(index === 2 ? 'th' : 'td');
    if (index === 2) cell.scope = 'row';
    if (value instanceof Node) cell.append(value);
    else cell.textContent = String(value);
    row.append(cell);
  });

  const notes = [horse.longshotReason, horse.dangerReason].filter(Boolean);
  if (notes.length) row.title = notes.join(' / ');
  return row;
}

function raceCard(race) {
  const article = document.createElement('article');
  article.className = 'viewer-race-card';

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
    race.startTime,
    race.surface && race.distance ? `${race.surface}${race.distance}m` : null,
    race.going ? `馬場 ${race.going}` : null,
    race.fieldSize ? `${race.fieldSize}頭` : null,
  ].filter(Boolean).join(' · ');

  header.append(title, meta);

  const scroll = document.createElement('div');
  scroll.className = 'viewer-table-scroll';
  const table = document.createElement('table');
  table.className = 'viewer-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>印</th>
        <th>馬番</th>
        <th>馬名</th>
        <th>AI勝率</th>
        <th>AI複勝率</th>
        <th>単勝</th>
        <th>人気</th>
        <th>期待値</th>
        <th>予想TIME</th>
      </tr>
    </thead>
  `;
  const body = document.createElement('tbody');
  race.horses.forEach((horse) => body.append(horseRow(horse)));
  table.append(body);
  scroll.append(table);
  article.append(header, scroll);
  return article;
}

function renderDay(day) {
  elements.races.replaceChildren();
  for (const race of day.races) elements.races.append(raceCard(race));
  elements.summary.textContent = `${day.date || ''} ${day.track || ''} · ${day.races.length}レース`;
  elements.summary.hidden = false;
}

function updateAddressBar({ date, organization, track }) {
  const url = new URL(window.location.href);
  url.searchParams.set('date', date);
  url.searchParams.set('organization', organization);
  url.searchParams.set('track', track);
  history.replaceState(null, '', url);
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
  elements.submit.disabled = true;
  setStatus('保存済み予想を読み込んでいます…', 'loading');
  elements.summary.hidden = true;

  try {
    const endpoint = buildViewerDayUrl({ date, organization, track });
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: requestController.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.error?.code || `HTTP_${response.status}`;
      throw new Error(code);
    }
    const day = sanitizeViewerDayPayload(payload);
    renderDay(day);
    updateAddressBar({ date, organization, track });
    setStatus('閲覧専用 · 保存済み予想', 'success');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    elements.races.replaceChildren();
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

  elements.organization.addEventListener('change', () => fillTracks());
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadViewerDay();
  });

  if (normalizeViewerTrack(requestedTrack, organization)) loadViewerDay();
  else setStatus('開催日・主催・競馬場を選択してください。');
}

initialize();
