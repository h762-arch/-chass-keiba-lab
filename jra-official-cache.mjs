const raceKey = (date, track, race) => `race|${date}|${track}|${Number(race)}`;

export async function readJraOfficialRaceCache(env, { date, track, race, nowMs = Date.now() } = {}) {
  const DB = env?.DB;
  if (!DB?.prepare) return null;

  let row;
  try {
    row = await DB.prepare(
      `SELECT payload_json,source_url,fetched_at,expires_at,parser_version,content_hash
         FROM jra_official_cache
        WHERE kind='race' AND cache_key=?`
    ).bind(raceKey(date, track, race)).first();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return null;
    throw error;
  }

  if (!row) return null;

  let body;
  try {
    body = JSON.parse(row.payload_json || '');
  } catch {
    throw Object.assign(new Error('JRA_CACHE_CORRUPT'), { code: 'JRA_CACHE_CORRUPT' });
  }

  if (!body?.ok || body?.organization !== 'JRA') {
    throw Object.assign(new Error('JRA_CACHE_CORRUPT'), { code: 'JRA_CACHE_CORRUPT' });
  }

  const expiresMs = Date.parse(row.expires_at || '');
  const expired = !Number.isFinite(expiresMs) || expiresMs <= Number(nowMs);
  const bridgeCache = {
    provider: 'github_actions_d1',
    kind: 'race',
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    contentHash: row.content_hash || null,
    expired,
    freshness: expired ? 'saved' : 'current'
  };

  if (!expired) {
    return {
      body: {
        ...body,
        bridgeCache
      }
    };
  }

  const sourceHorses = Array.isArray(body.horses) ? body.horses : [];
  const horses = sourceHorses.map(horse => ({
    ...horse,
    savedRunningStatus: horse?.runningStatus || 'unknown',
    runningStatus: 'active',
    liveStatusConfidence: 'unconfirmed',
    jockey: '',
    bodyWeight: null,
    bodyWeightChange: null,
    odds: null,
    popularity: null
  }));

  const rate = key => horses.length
    ? horses.filter(h => h?.[key] != null && h?.[key] !== '').length / horses.length
    : 0;

  const quality = {
    ...(body.quality || {}),
    raceParsed: body?.quality?.raceParsed === true,
    horseCount: horses.length,
    activeHorseCount: horses.length,
    horseNameRate: rate('horseName'),
    weightRate: rate('weightCarried'),
    jockeyRate: 0,
    pastRunRate: horses.length
      ? horses.filter(h => Array.isArray(h?.pastRuns) && h.pastRuns.length > 0).length / horses.length
      : 0
  };

  return {
    body: {
      ...body,
      race: {
        ...(body.race || {}),
        trackCondition: '不明',
        weather: ''
      },
      horses,
      quality,
      source: 'JRA_SAVED_OFFICIAL_BASE',
      dataConfidence: 'medium',
      liveFieldsVerified: false,
      officialStatus: 'saved',
      savedOfficialBase: {
        schemaVersion: 'jra-saved-official-base-v1',
        preservedFields: [
          'race.date',
          'race.racecourse',
          'race.raceNo',
          'race.raceName',
          'race.postTime',
          'race.surface',
          'race.distance',
          'race.direction',
          'race.courseType',
          'race.raceClass',
          'horses.horseNo',
          'horses.frameNo',
          'horses.horseName',
          'horses.sexAge',
          'horses.weightCarried',
          'horses.trainer',
          'horses.pastRuns'
        ],
        unconfirmedLiveFields: [
          'horses.runningStatus',
          'horses.jockey',
          'horses.bodyWeight',
          'horses.bodyWeightChange',
          'race.trackCondition',
          'race.weather',
          'horses.odds',
          'horses.popularity'
        ]
      },
      bridgeCache
    }
  };
}

const oddsKey = (date, track, race) => `odds|${date}|${track}|${Number(race)}`;

export async function readJraOfficialOddsCache(env, { date, track, race, nowMs = Date.now() } = {}) {
  const DB = env?.DB;
  if (!DB?.prepare) return null;

  let row;
  try {
    row = await DB.prepare(
      `SELECT payload_json,source_url,fetched_at,expires_at,parser_version,content_hash
         FROM jra_official_cache
        WHERE kind='odds' AND cache_key=?`
    ).bind(oddsKey(date, track, race)).first();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return null;
    throw error;
  }

  if (!row) return null;

  const expiresMs = Date.parse(row.expires_at || '');
  if (!Number.isFinite(expiresMs) || expiresMs <= Number(nowMs)) return null;

  let body;
  try {
    body = JSON.parse(row.payload_json || '');
  } catch {
    throw Object.assign(new Error('JRA_ODDS_CACHE_CORRUPT'), { code: 'JRA_ODDS_CACHE_CORRUPT' });
  }

  if (
    !body?.ok ||
    body?.organization !== 'JRA' ||
    !Array.isArray(body?.odds) ||
    Number(body?.quality?.oddsHorseCount) < 1
  ) {
    throw Object.assign(new Error('JRA_ODDS_CACHE_CORRUPT'), { code: 'JRA_ODDS_CACHE_CORRUPT' });
  }

  return {
    body: {
      ...body,
      bridgeCache: {
        provider: 'github_actions_d1',
        kind: 'odds',
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        contentHash: row.content_hash || null
      }
    }
  };
}


export async function readJraOfficialOddsCacheForViewer(env, { date, track, race, nowMs = Date.now() } = {}) {
  const DB = env?.DB;
  if (!DB?.prepare) return null;

  let row;
  try {
    row = await DB.prepare(
      `SELECT payload_json,source_url,fetched_at,expires_at,parser_version,content_hash
         FROM jra_official_cache
        WHERE kind='odds' AND cache_key=?`
    ).bind(oddsKey(date, track, race)).first();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return null;
    throw error;
  }

  if (!row) return null;

  const expiresMs = Date.parse(row.expires_at || '');
  const expired = !Number.isFinite(expiresMs) || expiresMs <= Number(nowMs);

  let body;
  try {
    body = JSON.parse(row.payload_json || '');
  } catch {
    throw Object.assign(new Error('JRA_ODDS_CACHE_CORRUPT'), { code: 'JRA_ODDS_CACHE_CORRUPT' });
  }

  if (
    !body?.ok ||
    body?.organization !== 'JRA' ||
    !Array.isArray(body?.odds) ||
    Number(body?.quality?.oddsHorseCount) < 1
  ) {
    throw Object.assign(new Error('JRA_ODDS_CACHE_CORRUPT'), { code: 'JRA_ODDS_CACHE_CORRUPT' });
  }

  return {
    body: {
      ...body,
      bridgeCache: {
        provider: 'github_actions_d1',
        kind: 'odds',
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        contentHash: row.content_hash || null,
        expired,
        freshness: expired ? 'saved' : 'current'
      }
    }
  };
}

const resultKey = (date, track, race) => `result|${date}|${track}|${Number(race)}`;

export async function readJraOfficialResultCache(env, { date, track, race, nowMs = Date.now() } = {}) {
  const DB = env?.DB;
  if (!DB?.prepare) return null;

  let row;
  try {
    row = await DB.prepare(
      `SELECT payload_json,source_url,fetched_at,expires_at,parser_version,content_hash
         FROM jra_official_cache
        WHERE kind='result' AND cache_key=?`
    ).bind(resultKey(date, track, race)).first();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return null;
    throw error;
  }

  if (!row) return null;

  const expiresMs = Date.parse(row.expires_at || '');
  if (!Number.isFinite(expiresMs) || expiresMs <= Number(nowMs)) return null;

  let body;
  try {
    body = JSON.parse(row.payload_json || '');
  } catch {
    throw Object.assign(new Error('JRA_RESULT_CACHE_CORRUPT'), { code: 'JRA_RESULT_CACHE_CORRUPT' });
  }

  if (
    !body?.ok ||
    body?.organization !== 'JRA' ||
    !Array.isArray(body?.finishOrder) ||
    body.finishOrder.length < 3 ||
    !Array.isArray(body?.results) ||
    body.results.length < 3 ||
    Number(body?.quality?.finishOrderCount) < 3
  ) {
    throw Object.assign(new Error('JRA_RESULT_CACHE_CORRUPT'), { code: 'JRA_RESULT_CACHE_CORRUPT' });
  }

  return {
    body: {
      ...body,
      bridgeCache: {
        provider: 'github_actions_d1',
        kind: 'result',
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        contentHash: row.content_hash || null
      }
    }
  };
}
