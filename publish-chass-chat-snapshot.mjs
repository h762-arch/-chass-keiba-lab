import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIRROR_SCHEMA_VERSION = 'chass-chat-mirror-v1';
export const WORKER_ORIGIN = 'https://chass-keiba-lab7.h7625421.workers.dev';

export const TRACKS = Object.freeze({
  sapporo: { track: '札幌', organization: 'JRA' },
  hakodate: { track: '函館', organization: 'JRA' },
  fukushima: { track: '福島', organization: 'JRA' },
  niigata: { track: '新潟', organization: 'JRA' },
  tokyo: { track: '東京', organization: 'JRA' },
  nakayama: { track: '中山', organization: 'JRA' },
  chukyo: { track: '中京', organization: 'JRA' },
  kyoto: { track: '京都', organization: 'JRA' },
  hanshin: { track: '阪神', organization: 'JRA' },
  kokura: { track: '小倉', organization: 'JRA' },
  ooi: { track: '大井', organization: 'NAR' },
  funabashi: { track: '船橋', organization: 'NAR' },
  kawasaki: { track: '川崎', organization: 'NAR' },
  urawa: { track: '浦和', organization: 'NAR' },
  monbetsu: { track: '門別', organization: 'NAR' },
  sonoda: { track: '園田', organization: 'NAR' },
  himeji: { track: '姫路', organization: 'NAR' },
  morioka: { track: '盛岡', organization: 'NAR' },
  mizusawa: { track: '水沢', organization: 'NAR' },
  kanazawa: { track: '金沢', organization: 'NAR' },
  kasamatsu: { track: '笠松', organization: 'NAR' },
  nagoya: { track: '名古屋', organization: 'NAR' },
  kochi: { track: '高知', organization: 'NAR' },
  saga: { track: '佐賀', organization: 'NAR' },
  obihiro: { track: '帯広', organization: 'NAR' },
});

function jstDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() === Number(match[2]) - 1 && d.getUTCDate() === Number(match[3]);
}

function scalar(value) {
  if (value === 'null' || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

function parsePipeLine(line) {
  const parts = String(line || '').trim().split('|');
  const type = parts.shift() || '';
  const fields = {};
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    fields[part.slice(0, index)] = scalar(part.slice(index + 1));
  }
  return { type, fields };
}

export function parseDayAiText(text) {
  const result = { day: null, races: [] };
  const raceMap = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const { type, fields } = parsePipeLine(raw);
    if (type === 'DAY') result.day = fields;
    if (type === 'RACE') {
      const raceNo = Number(fields.raceNo);
      if (!Number.isInteger(raceNo)) throw new Error('Invalid raceNo in RACE line.');
      const race = { ...fields, raceNo, horses: [], timestamps: {} };
      raceMap.set(raceNo, race);
      result.races.push(race);
    }
    if (type === 'HORSE') {
      const raceNo = Number(fields.raceNo);
      const horseNo = Number(fields.no);
      if (!Number.isInteger(raceNo) || !Number.isInteger(horseNo)) throw new Error('Invalid HORSE identity.');
      const race = raceMap.get(raceNo);
      if (!race) throw new Error(`HORSE appeared before RACE ${raceNo}.`);
      race.horses.push({ ...fields, raceNo, no: horseNo });
    }
    if (type === 'END_RACE') {
      const raceNo = Number(fields.raceNo);
      const race = raceMap.get(raceNo);
      if (!race) throw new Error(`END_RACE without RACE ${raceNo}.`);
      race.timestamps = {
        predictionAt: fields.predictionAt ?? null,
        oddsAt: fields.oddsAt ?? null,
        resultAt: fields.resultAt ?? null,
      };
    }
  }
  return result;
}

function maxIso(values) {
  const valid = values.filter(Boolean).filter(v => Number.isFinite(Date.parse(v)));
  if (!valid.length) return null;
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　]+/g, '').trim();
}

export function mergeChatSnapshot({ ability, marketText, slug }) {
  if (ability?.ok !== true || ability?.apiVersion !== 'ability-compact-v1') throw new Error('Invalid ability snapshot.');
  if (!TRACKS[slug]) throw new Error(`Unsupported track slug: ${slug}`);
  const expected = TRACKS[slug];
  if (ability.track !== expected.track || ability.organization !== expected.organization) throw new Error('Ability snapshot track identity mismatch.');
  const market = marketText ? parseDayAiText(marketText) : { day: null, races: [] };
  if (market.day) {
    if (market.day.date !== ability.date || market.day.track !== ability.track || market.day.organization !== ability.organization) {
      throw new Error('DAY_AI identity mismatch.');
    }
  }
  const marketByRace = new Map(market.races.map(r => [Number(r.raceNo), r]));
  let identityMismatchCount = 0;
  let marketHorseCount = 0;
  let staleMarketHorseCount = 0;
  let unavailableMarketHorseCount = 0;
  const races = (ability.races || []).map(ar => {
    const mr = marketByRace.get(Number(ar.raceNumber)) || null;
    const marketByNo = new Map((mr?.horses || []).map(h => [Number(h.no), h]));
    const horses = (ar.horses || []).map(ah => {
      const mh = marketByNo.get(Number(ah.horseNumber)) || null;
      const sameName = !mh || normalizeName(mh.name) === normalizeName(ah.horseName);
      const usable = !!mh && sameName;
      if (mh && !sameName) identityMismatchCount += 1;
      const oddsStatus = usable ? (mh.oddsStatus ?? null) : null;
      if (usable && mh.odds != null) marketHorseCount += 1;
      if (oddsStatus === 'stale') staleMarketHorseCount += 1;
      if (!usable || oddsStatus === 'unavailable' || mh?.odds == null) unavailableMarketHorseCount += 1;
      return {
        horseNumber: ah.horseNumber,
        horseName: ah.horseName,
        abilityRank: ah.abilityRank ?? null,
        score: ah.score ?? null,
        winProb: ah.winProb ?? null,
        top3Prob: ah.top3Prob ?? null,
        predictedTime: ah.predictedTime ?? null,
        predictedTimeSec: ah.predictedTimeSec ?? null,
        runningStyle: ah.runningStyle ?? null,
        distanceScore: ah.distanceScore ?? null,
        courseScore: ah.courseScore ?? null,
        paceScore: ah.paceScore ?? null,
        conditionScore: ah.conditionScore ?? null,
        mark: usable ? (mh.mark ?? ah.mark ?? null) : (ah.mark ?? null),
        odds: usable ? (mh.odds ?? null) : null,
        oddsStatus,
        popularity: usable ? (mh.popularity ?? null) : null,
        expectedValue: usable ? (mh.expectedValue ?? null) : null,
        expectedValuePercent: usable ? (mh.expectedValuePercent ?? null) : null,
        evRank: usable ? (mh.evRank ?? null) : null,
        abilityPopularityGap: usable ? (mh.abilityPopularityGap ?? null) : null,
        diamond: usable ? (mh.diamond ?? null) : null,
        warning: usable ? (mh.warning ?? null) : null,
        runnerStatus: usable ? (mh.runnerStatus ?? ah.runnerStatus ?? 'active') : (ah.runnerStatus ?? 'active'),
        marketIdentityVerified: usable,
      };
    });
    return {
      raceNumber: ar.raceNumber,
      raceName: mr?.raceName ?? ar.raceName ?? null,
      surface: mr?.surface ?? null,
      distance: mr?.distance ?? null,
      going: mr?.going ?? null,
      startTime: mr?.startTime ?? null,
      horseCount: horses.length,
      raceVolatility: mr?.raceVolatility ?? null,
      raceValueScore: mr?.raceValueScore ?? null,
      favoriteReliability: mr?.favoriteReliability ?? null,
      probabilityValid: mr?.probabilityValid ?? null,
      timestamps: mr?.timestamps || { predictionAt: null, oddsAt: null, resultAt: null },
      horses,
    };
  });
  const latestPredictionAt = maxIso(races.map(r => r.timestamps?.predictionAt));
  const latestOddsAt = maxIso(races.map(r => r.timestamps?.oddsAt));
  const latestResultAt = maxIso(races.map(r => r.timestamps?.resultAt));
  return {
    ok: true,
    schemaVersion: MIRROR_SCHEMA_VERSION,
    sourceSystem: 'CHASS KEIBA LAB',
    sourceOfTruth: 'Cloudflare D1',
    transport: 'GitHub static mirror for ChatGPT read access',
    date: ability.date,
    track: ability.track,
    trackSlug: slug,
    organization: ability.organization,
    raceCount: races.length,
    totalHorseCount: races.reduce((sum, r) => sum + r.horses.length, 0),
    freshness: { latestPredictionAt, latestOddsAt, latestResultAt },
    diagnostics: {
      marketTextAvailable: !!market.day,
      marketHorseCount,
      staleMarketHorseCount,
      unavailableMarketHorseCount,
      identityMismatchCount,
      abilityOnlyFallback: !market.day,
    },
    races,
  };
}

async function request(url, { accept, allow404 = false, attempts = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { headers: { accept }, signal: controller.signal });
      if (response.status === 404 && allow404) return null;
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < attempts) {
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          continue;
        }
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Request failed.');
}

async function fetchTrack(date, slug) {
  const meta = TRACKS[slug];
  const abilityUrl = `${WORKER_ORIGIN}/api/chass/v1/public/ai-snapshot/${date}/${slug}.json`;
  const abilityResponse = await request(abilityUrl, { accept: 'application/json', allow404: true });
  if (!abilityResponse) return null;
  const ability = await abilityResponse.json();
  if (ability?.date !== date) throw new Error(`Ability date mismatch for ${slug}.`);

  const query = new URLSearchParams({ date, track: meta.track, organization: meta.organization, format: 'text' });
  const dayAiUrl = `${WORKER_ORIGIN}/api/chass/v1/public/day-ai?${query}`;
  let marketText = null;
  try {
    const response = await request(dayAiUrl, { accept: 'text/plain', allow404: true });
    marketText = response ? await response.text() : null;
  } catch (error) {
    console.warn(JSON.stringify({ slug, marketFallback: 'ability-only', error: String(error?.message || error) }));
  }
  return mergeChatSnapshot({ ability, marketText, slug });
}

async function writeSnapshot(root, snapshot) {
  const base = path.join(root, 'chat-snapshot', snapshot.date, snapshot.trackSlug);
  await mkdir(base, { recursive: true });
  const summary = {
    ok: true,
    schemaVersion: snapshot.schemaVersion,
    date: snapshot.date,
    track: snapshot.track,
    trackSlug: snapshot.trackSlug,
    organization: snapshot.organization,
    raceCount: snapshot.raceCount,
    totalHorseCount: snapshot.totalHorseCount,
    freshness: snapshot.freshness,
    diagnostics: snapshot.diagnostics,
    races: snapshot.races.map(r => ({
      raceNumber: r.raceNumber,
      raceName: r.raceName,
      surface: r.surface,
      distance: r.distance,
      going: r.going,
      startTime: r.startTime,
      horseCount: r.horseCount,
      raceVolatility: r.raceVolatility,
      raceValueScore: r.raceValueScore,
      favoriteReliability: r.favoriteReliability,
      timestamps: r.timestamps,
      horses: r.horses.map(h => ({
        horseNumber: h.horseNumber,
        horseName: h.horseName,
        abilityRank: h.abilityRank,
        score: h.score,
        winProb: h.winProb,
        top3Prob: h.top3Prob,
        predictedTime: h.predictedTime,
        odds: h.odds,
        oddsStatus: h.oddsStatus,
        popularity: h.popularity,
        expectedValue: h.expectedValue,
        evRank: h.evRank,
        diamond: h.diamond,
        warning: h.warning,
      })),
    })),
  };
  await writeFile(path.join(base, 'day.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  for (const race of snapshot.races) {
    const racePayload = {
      ok: true,
      schemaVersion: snapshot.schemaVersion,
      date: snapshot.date,
      track: snapshot.track,
      trackSlug: snapshot.trackSlug,
      organization: snapshot.organization,
      freshness: snapshot.freshness,
      diagnostics: snapshot.diagnostics,
      race,
    };
    const name = `race-${String(race.raceNumber).padStart(2, '0')}.json`;
    await writeFile(path.join(base, name), `${JSON.stringify(racePayload, null, 2)}\n`, 'utf8');
  }
  return base;
}

export async function main() {
  const date = String(process.env.SNAPSHOT_DATE || '').trim() || jstDate();
  const requested = String(process.env.TRACK_SLUG || 'all').trim().toLowerCase();
  const outputRoot = path.resolve(process.env.OUTPUT_ROOT || '.');
  if (!validDate(date)) throw new Error('SNAPSHOT_DATE must be a real YYYY-MM-DD date.');
  const slugs = requested === 'all' ? Object.keys(TRACKS) : requested.split(',').map(x => x.trim()).filter(Boolean);
  if (!slugs.length || slugs.some(slug => !TRACKS[slug])) throw new Error('TRACK_SLUG must be all or a supported comma-separated slug list.');

  const published = [];
  const missing = [];
  for (const slug of slugs) {
    try {
      const snapshot = await fetchTrack(date, slug);
      if (!snapshot) {
        missing.push(slug);
        continue;
      }
      const outputPath = await writeSnapshot(outputRoot, snapshot);
      published.push({ slug, track: snapshot.track, organization: snapshot.organization, raceCount: snapshot.raceCount, totalHorseCount: snapshot.totalHorseCount, outputPath, freshness: snapshot.freshness });
    } catch (error) {
      console.error(JSON.stringify({ slug, error: String(error?.stack || error) }));
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  console.log(JSON.stringify({ ok: true, schemaVersion: MIRROR_SCHEMA_VERSION, date, requested, published, missing }));
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) await main();
