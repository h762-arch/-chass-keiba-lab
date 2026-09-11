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

function viewerBase(origin = '') {
  return String(origin || '').replace(/\/$/, '');
}

function validatedContext({ date, track, organization } = {}) {
  if (!validViewerDate(date)) throw new Error('viewer_invalid_date');
  const org = normalizeViewerOrganization(organization);
  if (!org) throw new Error('viewer_invalid_organization');
  const normalizedTrack = normalizeViewerTrack(track, org);
  if (!normalizedTrack) throw new Error('viewer_invalid_track');
  return { date, organization: org, track: normalizedTrack };
}

export function buildViewerDayUrl({ date, track, organization, origin = '' } = {}) {
  const context = validatedContext({ date, track, organization });
  const params = new URLSearchParams({
    date: context.date,
    track: context.track,
    organization: context.organization,
    format: 'compact',
  });
  return `${viewerBase(origin)}${VIEWER_PUBLIC_API_PREFIX}/day?${params.toString()}`;
}

export function buildViewerMarketDayUrl({ date, track, organization, origin = '' } = {}) {
  const context = validatedContext({ date, track, organization });
  const params = new URLSearchParams({
    date: context.date,
    track: context.track,
    organization: context.organization,
    format: 'tabular',
  });
  return `${viewerBase(origin)}${VIEWER_PUBLIC_API_PREFIX}/day-ai?${params.toString()}`;
}

export function buildViewerRaceUrl({ date, track, organization, race, origin = '' } = {}) {
  const context = validatedContext({ date, track, organization });
  const raceNo = finiteOrNull(race);
  if (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 20) throw new Error('viewer_invalid_race');
  const params = new URLSearchParams({
    date: context.date,
    track: context.track,
    organization: context.organization,
    race: String(raceNo),
  });
  return `${viewerBase(origin)}${VIEWER_PUBLIC_API_PREFIX}/race?${params.toString()}`;
}

export function buildViewerRacesUrl({ date, track, organization, origin = '' } = {}) {
  const context = validatedContext({ date, track, organization });
  const params = new URLSearchParams({
    date: context.date,
    track: context.track,
    organization: context.organization,
  });
  return `${viewerBase(origin)}${VIEWER_PUBLIC_API_PREFIX}/races?${params.toString()}`;
}

function sanitizeHorse(raw = {}) {
  const probability = raw.probability || {};
  const predictedTime = raw.predictedTime && typeof raw.predictedTime === 'object'
    ? raw.predictedTime
    : {};
  const market = raw.market || {};
  const longshot = raw.longshot && typeof raw.longshot === 'object' ? raw.longshot : null;
  const danger = raw.danger && typeof raw.danger === 'object' ? raw.danger : null;
  const directTimeText = typeof raw.predictedTime === 'string' ? raw.predictedTime : null;

  return Object.freeze({
    horseNo: finiteOrNull(raw.horseNo ?? raw.horseNumber ?? raw.no),
    horseName: textOrNull(raw.horseName ?? raw.name) || '',
    mark: textOrNull(raw.mark),
    aiWinRate: finiteOrNull(probability.win ?? raw.win ?? raw.winProb),
    aiTop3Rate: finiteOrNull(probability.top3 ?? raw.top3 ?? raw.top3Prob),
    predictedTimeSec: finiteOrNull(predictedTime.standard ?? raw.time ?? raw.predictedTimeSec),
    predictedTimeText: textOrNull(predictedTime.text ?? directTimeText),
    odds: finiteOrNull(market.odds ?? raw.odds),
    popularity: finiteOrNull(market.popularity ?? raw.popularity ?? raw.pop),
    expectedValue: finiteOrNull(market.expectedValue ?? market.ev ?? raw.expectedValue ?? raw.ev),
    longshotMark: textOrNull(longshot?.mark ?? (typeof raw.longshot === 'string' ? raw.longshot : null) ?? raw.diamond),
    longshotReason: textOrNull(longshot?.reason),
    dangerMark: textOrNull(danger?.mark ?? (typeof raw.danger === 'string' ? raw.danger : null) ?? raw.warning),
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
    date: textOrNull(identity.date ?? identity.raceDate),
    track: textOrNull(identity.track),
    raceNo: finiteOrNull(identity.raceNo ?? identity.raceNumber),
    raceName: textOrNull(identity.raceName),
    surface: textOrNull(identity.surface),
    distance: finiteOrNull(identity.distance),
    going: textOrNull(identity.going ?? identity.trackCondition),
    startTime: textOrNull(identity.startTime ?? identity.postTime),
    fieldSize: finiteOrNull(identity.fieldSize) ?? horses.length,
    marketAvailable: Boolean(identity.marketAvailable ?? horses.some((horse) => horse.odds != null)),
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

export function sanitizeViewerRacePayload(payload = {}) {
  if (payload?.ok !== true || !Array.isArray(payload?.horses)) {
    throw new Error('viewer_invalid_race_payload');
  }
  return sanitizeRace(payload);
}


export function sanitizeViewerRacesPayload(payload = {}) {
  if (payload?.ok !== true || !Array.isArray(payload?.races)) {
    throw new Error('viewer_invalid_races_payload');
  }

  const races = payload.races
    .map((raw = {}) => Object.freeze({
      raceNo: finiteOrNull(raw.raceNo ?? raw.raceNumber),
      raceName: textOrNull(raw.raceName),
      startTime: textOrNull(raw.startTime ?? raw.postTime ?? raw.raceTime),
      surface: textOrNull(raw.surface),
      distance: finiteOrNull(raw.distance),
      going: textOrNull(raw.going ?? raw.trackCondition),
      fieldSize: finiteOrNull(raw.fieldSize),
    }))
    .filter((race) => Number.isInteger(race.raceNo))
    .sort((a, b) => Number(a.raceNo) - Number(b.raceNo));

  return Object.freeze({
    ok: true,
    date: textOrNull(payload.date),
    track: textOrNull(payload.track),
    organization: normalizeViewerOrganization(payload.organization) || textOrNull(payload.organization),
    races: Object.freeze(races),
  });
}

export function sanitizeViewerMarketPayload(payload = {}) {
  if (payload?.ok !== true || !Array.isArray(payload?.races) || !Array.isArray(payload?.horseColumns)) {
    throw new Error('viewer_invalid_market_payload');
  }

  const columns = payload.horseColumns.map(String);
  const toObject = (row) => {
    if (!Array.isArray(row)) return {};
    return Object.fromEntries(columns.map((key, index) => [key, row[index] ?? null]));
  };

  const races = payload.races.map((race) => ({
    raceNo: finiteOrNull(race?.raceNumber),
    raceName: textOrNull(race?.raceName),
    horses: Array.isArray(race?.horses)
      ? race.horses.map((row) => {
          const horse = toObject(row);
          return {
            horseNo: finiteOrNull(horse.horseNumber),
            horseName: textOrNull(horse.horseName) || '',
            odds: finiteOrNull(horse.odds),
            popularity: finiteOrNull(horse.popularity),
            expectedValue: finiteOrNull(horse.expectedValue),
            longshotMark: textOrNull(horse.diamond),
            dangerMark: textOrNull(horse.warning),
          };
        })
      : [],
  }));

  return Object.freeze({
    ok: true,
    date: textOrNull(payload.date),
    track: textOrNull(payload.track),
    organization: normalizeViewerOrganization(payload.organization) || textOrNull(payload.organization),
    races: Object.freeze(races.map((race) => Object.freeze({
      ...race,
      horses: Object.freeze(race.horses.map((horse) => Object.freeze(horse))),
    }))),
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
