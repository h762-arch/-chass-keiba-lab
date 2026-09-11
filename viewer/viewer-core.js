export const VIEWER_ROLE = Object.freeze({
  name: 'VIEWER',
  permissions: Object.freeze({
    readPublicPredictions: true,
    writePredictions: false,
    readResearchData: false,
    readInternalIndices: false,
    readModelWeights: false,
    readValidationDb: false,
    changeSettings: false,
  }),
});

export const VIEWER_PUBLIC_API_PREFIX = '/api/chass/v1/public';

const ALLOWED_ORGANIZATIONS = new Set(['JRA', 'NAR']);

export const VIEWER_TRACKS = Object.freeze({
  JRA: Object.freeze(['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉']),
  NAR: Object.freeze(['帯広', '盛岡', '水沢', '浦和', '船橋', '大井', '川崎', '笠松', '金沢', '名古屋', '園田', '姫路', '高知', '佐賀', '門別']),
});

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function normalizeViewerOrganization(value) {
  const organization = String(value || '').trim().toUpperCase();
  return ALLOWED_ORGANIZATIONS.has(organization) ? organization : null;
}

export function normalizeViewerTrack(value, organization) {
  const org = normalizeViewerOrganization(organization);
  const track = String(value || '').trim();
  if (!org || !VIEWER_TRACKS[org].includes(track)) return null;
  return track;
}

export function validViewerDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

export function buildViewerDayUrl({ date, track, organization, origin = '' } = {}) {
  if (!validViewerDate(date)) throw new Error('viewer_invalid_date');
  const org = normalizeViewerOrganization(organization);
  if (!org) throw new Error('viewer_invalid_organization');
  const normalizedTrack = normalizeViewerTrack(track, org);
  if (!normalizedTrack) throw new Error('viewer_invalid_track');

  const base = String(origin || '').replace(/\/$/, '');
  const params = new URLSearchParams({
    date,
    track: normalizedTrack,
    organization: org,
    format: 'full',
  });
  return `${base}${VIEWER_PUBLIC_API_PREFIX}/day?${params.toString()}`;
}

function sanitizeHorse(raw = {}) {
  const probability = raw.probability || {};
  const predictedTime = raw.predictedTime || {};
  const market = raw.market || {};
  const longshot = raw.longshot || null;
  const danger = raw.danger || null;

  return Object.freeze({
    horseNo: finiteOrNull(raw.horseNo ?? raw.no),
    horseName: textOrNull(raw.horseName ?? raw.name) || '',
    mark: textOrNull(raw.mark),
    aiWinRate: finiteOrNull(probability.win ?? raw.win),
    aiTop3Rate: finiteOrNull(probability.top3 ?? raw.top3),
    predictedTimeSec: finiteOrNull(predictedTime.standard ?? raw.time),
    predictedTimeText: textOrNull(predictedTime.text),
    odds: finiteOrNull(market.odds ?? raw.odds),
    popularity: finiteOrNull(market.popularity ?? raw.pop),
    expectedValue: finiteOrNull(market.expectedValue ?? raw.ev),
    longshotMark: textOrNull(longshot?.mark ?? raw.longshot),
    longshotReason: textOrNull(longshot?.reason),
    dangerMark: textOrNull(danger?.mark ?? raw.danger),
    dangerReason: textOrNull(danger?.reason),
    runnerStatus: textOrNull(raw.runnerStatus) || 'active',
  });
}

function sanitizeRace(raw = {}) {
  const identity = raw.race || raw;
  const horses = Array.isArray(raw.horses) ? raw.horses.map(sanitizeHorse) : [];

  return Object.freeze({
    organization: normalizeViewerOrganization(identity.organization) || textOrNull(identity.organization),
    raceId: textOrNull(identity.raceId),
    date: textOrNull(identity.date),
    track: textOrNull(identity.track),
    raceNo: finiteOrNull(identity.raceNo),
    raceName: textOrNull(identity.raceName),
    surface: textOrNull(identity.surface),
    distance: finiteOrNull(identity.distance),
    going: textOrNull(identity.going),
    startTime: textOrNull(identity.startTime),
    fieldSize: finiteOrNull(identity.fieldSize) ?? horses.length,
    horses: Object.freeze(horses),
  });
}

export function sanitizeViewerDayPayload(payload = {}) {
  if (payload?.ok !== true || !Array.isArray(payload?.races)) {
    throw new Error('viewer_invalid_payload');
  }

  const races = payload.races
    .map(sanitizeRace)
    .sort((a, b) => Number(a.raceNo || 0) - Number(b.raceNo || 0));

  return Object.freeze({
    ok: true,
    date: textOrNull(payload.date),
    track: textOrNull(payload.track),
    organization: normalizeViewerOrganization(payload.organization) || textOrNull(payload.organization),
    generatedAt: textOrNull(payload.generatedAt),
    races: Object.freeze(races),
  });
}

export function formatViewerPercent(value) {
  const number = finiteOrNull(value);
  return number == null ? '—' : `${(number * 100).toFixed(1)}%`;
}

export function formatViewerNumber(value, digits = 2) {
  const number = finiteOrNull(value);
  return number == null ? '—' : number.toFixed(digits);
}

export function isViewerSafeEndpoint(urlLike) {
  try {
    const url = new URL(urlLike, 'https://viewer.invalid');
    return url.pathname.startsWith(`${VIEWER_PUBLIC_API_PREFIX}/`);
  } catch {
    return false;
  }
}
