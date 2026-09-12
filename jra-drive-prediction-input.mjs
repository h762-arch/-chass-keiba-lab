/**
 * CHASS JRA Drive Prediction Input v1.4.2
 *
 * Hybrid input:
 * - JRA official card/past-runs remain the primary ability evidence.
 * - Private Drive JRA_指数マスター is read server-side only.
 * - Drive forecast odds/popularity are NOT copied into horse market fields.
 * - Only a normalized, market-independent Drive index signal is exposed to the app.
 * - If Drive is unavailable, official JRA data still works unchanged.
 */

import { handleJraRaceRequest as handleOfficialJraRaceRequest } from './jra-race-fetch.mjs';
import {
  getDriveReadReadiness,
  readChassArchiveSheet,
  sanitizeDriveReadError,
} from './google-drive-readonly-import.mjs';

export const JRA_DRIVE_INPUT_SCHEMA_VERSION = 'jra-drive-input-v1.4.2';
export const JRA_DRIVE_INDEX_SHEET = 'JRA_指数マスター';

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
  }));
}

export function mergeOfficialJraWithDriveRows(official = {}, rows = []) {
  const signals = buildDriveRaceSignals(rows);
  const byNo = new Map(signals.map(x => [Number(x.horseNo), x]));
  let matched = 0;
  const mismatchedHorseNos = [];
  const missingHorseNos = [];

  const horses = (official.horses || []).map(horse => {
    const no = Number(horse?.horseNo);
    const signal = byNo.get(no);
    if (!signal) {
      missingHorseNos.push(no);
      return horse;
    }

    const officialName = horseNameKey(horse?.horseName);
    if (officialName && signal.horseNameKey && officialName !== signal.horseNameKey) {
      mismatchedHorseNos.push(no);
      return horse;
    }

    matched += 1;

    // IMPORTANT:
    // Do not copy Drive 予想オッズ / 人気 into odds / popularity.
    // Ability remains market-independent until the normal official odds stage.
    return {
      ...horse,
      driveIndexSignal: signal.driveIndexSignal,
      driveIndexEvidenceCount: signal.driveIndexEvidenceCount,
      driveClusterStrength: signal.driveClusterStrength,
      driveInputSource: JRA_DRIVE_INDEX_SHEET,
    };
  });

  const activeCount = horses.filter(h => h?.runningStatus !== 'scratched' && h?.runningStatus !== 'excluded').length;
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
      missingHorseNos: missingHorseNos.filter(Number.isFinite),
      mismatchedHorseNos,
      marketReferenceExcludedFromAbility: true,
      rawDriveIndicesExposed: false,
    },
  };
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
        marketReferenceExcludedFromAbility: true,
        rawDriveIndicesExposed: false,
      },
    };
  }

  const context = resolveOfficialJraDriveContext(official);

  try {
    const sheet = await readChassArchiveSheet(
      env,
      JRA_DRIVE_INDEX_SHEET,
      {
        organization: 'JRA',
        maxRows: 5000,
        maxColumn: 'AA',
      },
    );

    const rows = extractJraDriveRaceRows(sheet.records, context);
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
        marketReferenceExcludedFromAbility: true,
        rawDriveIndicesExposed: false,
      },
    };
  }
}

export async function handleJraRaceRequest(request, env = {}) {
  const officialResponse = await handleOfficialJraRaceRequest(request, env);
  if (!officialResponse.ok) return officialResponse;

  let official;
  try {
    official = await officialResponse.clone().json();
  } catch {
    return officialResponse;
  }

  if (!official?.ok) return officialResponse;

  const merged = await addJraDrivePredictionInput(env, official);

  return new Response(JSON.stringify(merged, null, 2), {
    status: officialResponse.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-chass-jra-drive-input': merged?.driveInput?.status || 'unknown',
    },
  });
}
