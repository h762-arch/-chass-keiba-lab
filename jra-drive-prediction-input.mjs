/**
 * CHASS JRA Drive Prediction Input v1.5.0
 *
 * Stable pre-race architecture:
 * - Friday Drive pre-data (JRA_指数マスター) is a real app fallback source.
 * - JRA official data remains the preferred live/current source when available.
 * - Official success => merge market-independent Drive index signal + Drive past-runs.
 * - Official failure => restore the race from Friday Drive pre-data.
 * - Drive 予想オッズ / 人気 are never copied into ability odds/popularity fields.
 * - Drive may store up to 10 historical runs in 過去10走JSON.
 * - The model naturally emphasizes recent runs; runs 6-10 are supporting evidence.
 */

import { handleJraRaceRequest as handleOfficialJraRaceRequest } from './jra-race-fetch.mjs';
import {
  getDriveReadReadiness,
  readChassArchiveSheet,
  sanitizeDriveReadError,
} from './google-drive-readonly-import.mjs';

export const JRA_DRIVE_INPUT_SCHEMA_VERSION = 'jra-drive-input-v1.5.0';
export const JRA_DRIVE_INDEX_SHEET = 'JRA_指数マスター';
export const JRA_DRIVE_PAST_RUN_LIMIT = 10;

const toNumber = value => {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

const text = value => value == null ? '' : String(value).trim();

const horseNameKey = value => text(value)
  .normalize('NFKC')
  .replace(/\s+/g, '')
  .toUpperCase();

const normalizeSurface = value => {
  const s = text(value);
  if (/ダ|dirt/i.test(s)) return 'ダート';
  if (/芝|turf/i.test(s)) return '芝';
  return '';
};

const normalizeCorners = value => {
  const raw = Array.isArray(value)
    ? value
    : text(value).split(/[-→>\s]+/);
  return raw
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0);
};

const pastRunKey = run => [
  text(run?.date),
  text(run?.racecourse),
  text(run?.raceName),
  String(toNumber(run?.distance) ?? ''),
  text(run?.time),
].join('|');

function normalizeDrivePastRun(run = {}) {
  return {
    date: text(run.date ?? run.raceDate),
    racecourse: text(run.racecourse ?? run.track),
    raceName: text(run.raceName ?? run.name),
    raceClass: text(run.raceClass ?? run.class),
    finish: toNumber(run.finish ?? run.position),
    fieldSize: toNumber(run.fieldSize ?? run.field_size),
    jockey: text(run.jockey),
    weightCarried: toNumber(run.weightCarried ?? run.weight),
    distance: toNumber(run.distance),
    surface: normalizeSurface(run.surface),
    time: text(run.time ?? run.raceTime),
    trackCondition: text(run.trackCondition ?? run.condition) || '不明',
    bodyWeight: toNumber(run.bodyWeight ?? run.body_weight),
    cornerPositions: normalizeCorners(run.cornerPositions ?? run.corners),
    last3F: toNumber(run.last3F ?? run.last3f),
    margin: toNumber(run.margin),
    historicalStatus: text(run.historicalStatus) || 'finished',
  };
}

export function parseDrivePastRuns(row = {}) {
  const candidates = [
    row['過去10走JSON'],
    row['過去走JSON'],
    row['past_runs_json'],
    row['pastRuns'],
  ];

  let parsed = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      parsed = candidate;
      break;
    }
    const raw = text(candidate);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (Array.isArray(value)) {
        parsed = value;
        break;
      }
    } catch {
      // Fail closed: malformed historical JSON is ignored for this horse.
    }
  }

  return parsed
    .map(normalizeDrivePastRun)
    .filter(run =>
      run.date ||
      run.racecourse ||
      run.raceName ||
      run.finish != null ||
      run.distance != null ||
      run.time
    )
    .slice(0, JRA_DRIVE_PAST_RUN_LIMIT);
}

export function mergePastRuns(primary = [], backup = [], limit = JRA_DRIVE_PAST_RUN_LIMIT) {
  const out = [];
  const seen = new Set();

  for (const run of [...(primary || []), ...(backup || [])]) {
    if (!run || typeof run !== 'object') continue;
    const normalized = normalizeDrivePastRun(run);
    const key = pastRunKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }

  return out;
}

export function resolveOfficialJraDriveContext(official = {}) {
  const rawRaceNo =
    official?.raceNo ??
    official?.race?.raceNo ??
    (typeof official?.race === 'number' || typeof official?.race === 'string'
      ? official.race
      : null);

  return {
    date: official?.date || official?.race?.date || '',
    track:
      official?.track ||
      official?.racecourse ||
      official?.race?.racecourse ||
      official?.race?.track ||
      '',
    race: Number(rawRaceNo),
  };
}

export function resolveRequestContext(request) {
  const url = new URL(request.url);
  return {
    date: text(url.searchParams.get('date')),
    track: text(url.searchParams.get('track')),
    race: Number(url.searchParams.get('race')),
  };
}

function weighted(parts) {
  const valid = parts.filter(x => Number.isFinite(x.value) && x.weight > 0);
  const den = valid.reduce((s, x) => s + x.weight, 0);
  return den ? valid.reduce((s, x) => s + x.value * x.weight, 0) / den : null;
}

function percentileScore(values, value) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length || !Number.isFinite(value)) return null;
  if (sorted.length === 1) return 70;
  const below = sorted.filter(x => x < value).length;
  const equal = sorted.filter(x => x === value).length;
  const p = 100 * (below + Math.max(0, equal - 1) / 2) / Math.max(1, sorted.length - 1);
  return Number(Math.max(15, Math.min(95, 15 + p * 0.8)).toFixed(1));
}

function rowComposite(row) {
  const highest = toNumber(row['最高指数']);
  const avg5 = toNumber(row['5走平均']);
  const distance = toNumber(row['距離指数']);
  const course = toNumber(row['コース指数']);
  const previous = toNumber(row['前走指数']);
  const second = toNumber(row['2走前指数']);
  const third = toNumber(row['3走前指数']);
  const recent = weighted([
    { value: previous, weight: 60 },
    { value: second, weight: 25 },
    { value: third, weight: 15 },
  ]);
  const composite = weighted([
    { value: highest, weight: 20 },
    { value: avg5, weight: 25 },
    { value: distance, weight: 20 },
    { value: course, weight: 15 },
    { value: recent, weight: 20 },
  ]);
  const evidenceCount = [highest, avg5, distance, course, previous, second, third]
    .filter(Number.isFinite).length;
  const clusterText = text(row['指数近接パターン']);
  const clusterStrength = Math.min(
    3,
    (clusterText.match(/=/g) || []).length + (clusterText.match(/\//g) || []).length,
  );
  return { composite, evidenceCount, clusterStrength };
}

export function extractJraDriveRaceRows(records = [], context = {}) {
  const date = text(context.date);
  const track = text(context.track);
  const race = Number(context.race);
  if (!date || !track || !Number.isInteger(race) || race < 1 || race > 12) {
    throw Object.assign(new Error('JRA_DRIVE_INVALID_CONTEXT'), {
      code: 'JRA_DRIVE_INVALID_CONTEXT',
    });
  }

  return (Array.isArray(records) ? records : []).filter(row =>
    text(row['主催']).toUpperCase() === 'JRA' &&
    text(row['開催日']) === date &&
    text(row['競馬場']) === track &&
    Number(row['R']) === race
  );
}

export function buildDriveRaceSignals(rows = []) {
  const prepared = rows
    .map(row => {
      const horseNo = toNumber(row['馬番']);
      if (!Number.isInteger(horseNo) || horseNo < 1) return null;
      const c = rowComposite(row);
      return {
        horseNo,
        horseName: text(row['馬名']),
        horseNameKey: horseNameKey(row['馬名']),
        composite: c.composite,
        evidenceCount: c.evidenceCount,
        clusterStrength: c.clusterStrength,
        pastRuns: parseDrivePastRuns(row),
      };
    })
    .filter(Boolean);

  const composites = prepared.map(x => x.composite).filter(Number.isFinite);
  return prepared.map(x => ({
    horseNo: x.horseNo,
    horseName: x.horseName,
    horseNameKey: x.horseNameKey,
    driveIndexSignal: percentileScore(composites, x.composite),
    driveIndexEvidenceCount: x.evidenceCount,
    driveClusterStrength: x.clusterStrength,
    pastRuns: x.pastRuns,
  }));
}

export function mergeOfficialJraWithDriveRows(official = {}, rows = []) {
  const signals = buildDriveRaceSignals(rows);
  const byNo = new Map(signals.map(x => [Number(x.horseNo), x]));
  let matched = 0;
  let drivePastRunHorseCount = 0;
  const mismatchedHorseNos = [];
  const missingHorseNos = [];

  const horses = (official.horses || []).map(horse => {
    const no = Number(horse?.horseNo);
    const signal = byNo.get(no);
    if (!signal) {
      missingHorseNos.push(no);
      return {
        ...horse,
        pastRuns: mergePastRuns(horse?.pastRuns || [], [], JRA_DRIVE_PAST_RUN_LIMIT),
      };
    }

    const officialName = horseNameKey(horse?.horseName);
    if (officialName && signal.horseNameKey && officialName !== signal.horseNameKey) {
      mismatchedHorseNos.push(no);
      return {
        ...horse,
        pastRuns: mergePastRuns(horse?.pastRuns || [], [], JRA_DRIVE_PAST_RUN_LIMIT),
      };
    }

    matched += 1;
    if (signal.pastRuns.length) drivePastRunHorseCount += 1;

    // IMPORTANT:
    // Do not copy Drive 予想オッズ / 人気 into odds / popularity.
    // Ability remains market-independent until the normal official odds stage.
    return {
      ...horse,
      pastRuns: mergePastRuns(
        horse?.pastRuns || [],
        signal.pastRuns,
        JRA_DRIVE_PAST_RUN_LIMIT,
      ),
      driveIndexSignal: signal.driveIndexSignal,
      driveIndexEvidenceCount: signal.driveIndexEvidenceCount,
      driveClusterStrength: signal.driveClusterStrength,
      driveInputSource: JRA_DRIVE_INDEX_SHEET,
    };
  });

  const activeCount = horses.filter(
    h => h?.runningStatus !== 'scratched' && h?.runningStatus !== 'excluded',
  ).length;

  const status = !rows.length
    ? 'not_found'
    : matched === activeCount
      ? 'matched'
      : matched > 0
        ? 'partial'
        : 'mismatch';

  return {
    ...official,
    horses,
    driveInput: {
      schemaVersion: JRA_DRIVE_INPUT_SCHEMA_VERSION,
      status,
      sourceSheet: JRA_DRIVE_INDEX_SHEET,
      matchedHorseCount: matched,
      officialHorseCount: horses.length,
      driveRowCount: rows.length,
      drivePastRunHorseCount,
      pastRunLimit: JRA_DRIVE_PAST_RUN_LIMIT,
      recentRunPolicy: '1-5重視 / 6-10補助',
      missingHorseNos: missingHorseNos.filter(Number.isFinite),
      mismatchedHorseNos,
      marketReferenceExcludedFromAbility: true,
      rawDriveIndicesExposed: false,
    },
  };
}

function baseHorseFromDriveRow(row, signal = null) {
  return {
    horseNo: toNumber(row['馬番']),
    frameNo: toNumber(row['枠番']),
    horseName: text(row['馬名']),
    sexAge: text(row['性齢']),
    weightCarried: toNumber(row['斤量']),
    jockey: text(row['騎手']).replace(/^[△▲☆★◇]/, '').trim(),
    trainer: text(row['調教師']),
    bodyWeight: toNumber(row['馬体重']),
    bodyWeightChange: toNumber(row['馬体重増減']),
    runningStatus: text(row['出走状態']) || 'active',
    odds: null,
    popularity: null,
    pastRuns: signal?.pastRuns || parseDrivePastRuns(row),
    driveIndexSignal: signal?.driveIndexSignal ?? null,
    driveIndexEvidenceCount: signal?.driveIndexEvidenceCount ?? 0,
    driveClusterStrength: signal?.driveClusterStrength ?? 0,
    driveInputSource: JRA_DRIVE_INDEX_SHEET,
  };
}

const rate = (horses, key) => {
  if (!horses.length) return 0;
  return horses.filter(h => h?.[key] != null && h?.[key] !== '').length / horses.length;
};

export function createDriveJraFallback(context = {}, rows = [], fallbackReason = 'JRA_OFFICIAL_UNAVAILABLE') {
  const selected = extractJraDriveRaceRows(rows, context);
  if (selected.length < 2) {
    throw Object.assign(new Error('JRA_DRIVE_FALLBACK_NOT_FOUND'), {
      code: 'JRA_DRIVE_FALLBACK_NOT_FOUND',
    });
  }

  const first = selected[0];
  const signals = buildDriveRaceSignals(selected);
  const byNo = new Map(signals.map(x => [Number(x.horseNo), x]));

  const horses = selected
    .map(row => baseHorseFromDriveRow(row, byNo.get(Number(row['馬番']))))
    .filter(h => Number.isInteger(h.horseNo) && h.horseNo > 0)
    .sort((a, b) => a.horseNo - b.horseNo);

  const uniqueHorseNos = new Set(horses.map(h => h.horseNo));
  if (uniqueHorseNos.size !== horses.length) {
    throw Object.assign(new Error('JRA_DRIVE_FALLBACK_DUPLICATE_HORSE_NO'), {
      code: 'JRA_DRIVE_FALLBACK_DUPLICATE_HORSE_NO',
    });
  }

  const race = {
    date: text(context.date),
    racecourse: text(context.track),
    raceNo: Number(context.race),
    raceName: text(first['レース名']),
    postTime: text(first['発走時刻']),
    surface: normalizeSurface(first['芝/ダ']),
    distance: toNumber(first['距離m']),
    direction: text(first['回り']),
    courseType: text(first['コース区分']),
    raceClass: text(first['クラス']),
    trackCondition: '不明',
    weather: '',
    pace: '標準',
  };

  const quality = {
    raceParsed: Boolean(
      race.date &&
      race.racecourse &&
      Number.isInteger(race.raceNo) &&
      race.surface &&
      race.distance &&
      horses.length >= 2
    ),
    horseCount: horses.length,
    activeHorseCount: horses.filter(
      h => h.runningStatus !== 'scratched' && h.runningStatus !== 'excluded',
    ).length,
    horseNameRate: rate(horses, 'horseName'),
    weightRate: rate(horses, 'weightCarried'),
    jockeyRate: rate(horses, 'jockey'),
    pastRunRate: horses.filter(h => h.pastRuns.length > 0).length / horses.length,
  };

  const dataConfidence =
    quality.raceParsed &&
    quality.horseNameRate === 1 &&
    quality.weightRate === 1 &&
    quality.jockeyRate === 1
      ? 'high'
      : 'low';

  if (dataConfidence !== 'high') {
    throw Object.assign(new Error('JRA_DRIVE_FALLBACK_INCOMPLETE'), {
      code: 'JRA_DRIVE_FALLBACK_INCOMPLETE',
    });
  }

  return {
    ok: true,
    organization: 'JRA',
    race,
    horses,
    quality,
    source: 'JRA_DRIVE_FRIDAY_BASE',
    dataConfidence,
    fetchedAt: new Date().toISOString(),
    officialStatus: 'unavailable',
    officialError: text(fallbackReason) || 'JRA_OFFICIAL_UNAVAILABLE',
    liveFieldsVerified: false,
    driveStoredAt: text(first['登録日時']),
    driveInput: {
      schemaVersion: JRA_DRIVE_INPUT_SCHEMA_VERSION,
      status: 'fallback',
      sourceSheet: JRA_DRIVE_INDEX_SHEET,
      driveRowCount: selected.length,
      matchedHorseCount: horses.length,
      drivePastRunHorseCount: horses.filter(h => h.pastRuns.length > 0).length,
      pastRunLimit: JRA_DRIVE_PAST_RUN_LIMIT,
      recentRunPolicy: '1-5重視 / 6-10補助',
      marketReferenceExcludedFromAbility: true,
      rawDriveIndicesExposed: false,
    },
  };
}

async function readDriveRaceRows(env = {}, context = {}) {
  const readiness = getDriveReadReadiness(env);
  if (!readiness.enabled || !readiness.configured) {
    throw Object.assign(new Error('JRA_DRIVE_FALLBACK_DISABLED'), {
      code: 'JRA_DRIVE_FALLBACK_DISABLED',
    });
  }

  const sheet = await readChassArchiveSheet(
    env,
    JRA_DRIVE_INDEX_SHEET,
    {
      organization: 'JRA',
      maxRows: 5000,
      // Existing sheet is A:AA. Future Friday data may append
      // 過去10走JSON and related metadata without breaking old rows.
      maxColumn: 'AZ',
    },
  );

  return extractJraDriveRaceRows(sheet.records, context);
}

export async function addJraDrivePredictionInput(env = {}, official = {}) {
  const readiness = getDriveReadReadiness(env);
  if (!readiness.enabled || !readiness.configured) {
    return {
      ...official,
      driveInput: {
        schemaVersion: JRA_DRIVE_INPUT_SCHEMA_VERSION,
        status: 'disabled',
        sourceSheet: JRA_DRIVE_INDEX_SHEET,
        pastRunLimit: JRA_DRIVE_PAST_RUN_LIMIT,
        recentRunPolicy: '1-5重視 / 6-10補助',
        marketReferenceExcludedFromAbility: true,
        rawDriveIndicesExposed: false,
      },
    };
  }

  const context = resolveOfficialJraDriveContext(official);

  try {
    const rows = await readDriveRaceRows(env, context);
    return mergeOfficialJraWithDriveRows(official, rows);
  } catch (error) {
    const safe = sanitizeDriveReadError(error);
    return {
      ...official,
      driveInput: {
        schemaVersion: JRA_DRIVE_INPUT_SCHEMA_VERSION,
        status: 'unavailable',
        sourceSheet: JRA_DRIVE_INDEX_SHEET,
        errorCode: safe.code,
        pastRunLimit: JRA_DRIVE_PAST_RUN_LIMIT,
        recentRunPolicy: '1-5重視 / 6-10補助',
        marketReferenceExcludedFromAbility: true,
        rawDriveIndicesExposed: false,
      },
    };
  }
}

async function tryDriveFallback(request, env, officialError) {
  try {
    const context = resolveRequestContext(request);
    const rows = await readDriveRaceRows(env, context);
    const fallback = createDriveJraFallback(context, rows, officialError);
    return new Response(
      request.method === 'HEAD' ? null : JSON.stringify(fallback, null, 2),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-chass-jra-drive-input': 'fallback',
          'x-chass-jra-source': 'drive-friday-base',
        },
      },
    );
  } catch {
    return null;
  }
}

export async function handleJraRaceRequest(request, env = {}) {
  const officialResponse = await handleOfficialJraRaceRequest(request, env);

  let official = null;
  try {
    official = await officialResponse.clone().json();
  } catch {
    official = null;
  }

  if (officialResponse.ok && official?.ok) {
    const merged = await addJraDrivePredictionInput(env, official);

    return new Response(
      request.method === 'HEAD' ? null : JSON.stringify(merged, null, 2),
      {
        status: officialResponse.status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-chass-jra-drive-input': merged?.driveInput?.status || 'unknown',
          'x-chass-jra-source': 'official-plus-drive',
        },
      },
    );
  }

  const officialError =
    official?.error ||
    `JRA_OFFICIAL_HTTP_${officialResponse.status || 503}`;

  const fallbackResponse = await tryDriveFallback(
    request,
    env,
    officialError,
  );

  if (fallbackResponse) return fallbackResponse;
  return officialResponse;
}
