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
  const expiresMs = Date.parse(row.expires_at || '');
  if (!Number.isFinite(expiresMs) || expiresMs <= Number(nowMs)) return null;

  let body;
  try {
    body = JSON.parse(row.payload_json || '');
  } catch {
    throw Object.assign(new Error('JRA_CACHE_CORRUPT'), { code: 'JRA_CACHE_CORRUPT' });
  }

  if (!body?.ok || body?.organization !== 'JRA') {
    throw Object.assign(new Error('JRA_CACHE_CORRUPT'), { code: 'JRA_CACHE_CORRUPT' });
  }

  return {
    body: {
      ...body,
      bridgeCache: {
        provider: 'github_actions_d1',
        kind: 'race',
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        contentHash: row.content_hash || null
      }
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
