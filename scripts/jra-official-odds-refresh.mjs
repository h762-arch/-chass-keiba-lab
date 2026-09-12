import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createJraRaceService } from '../jra-race-fetch.mjs';
import { parseJraWinOdds } from '../jra-odds-fetch.mjs';

function args() {
  const out = {};
  for (const item of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(item);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function sqlText(value) {
  if (value === null || value === undefined) return 'NULL';
  return `CAST(X'${Buffer.from(String(value), 'utf8').toString('hex')}' AS TEXT)`;
}

async function readOfficialText(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.7,en;q=0.5',
      'Cache-Control': 'no-cache',
      'Referer': 'https://www.jra.go.jp/'
    },
    redirect: 'error'
  });

  if (!response.ok) throw new Error(response.status === 404 ? 'JRA_RACE_NOT_FOUND' : 'JRA_HTTP_ERROR');

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 2_097_152) throw new Error('JRA_ODDS_PARSE_ERROR');

  const hint = new TextDecoder().decode(bytes.slice(0, 4096));
  const encoding = /shift[_-]?jis|sjis/i.test(
    (response.headers.get('content-type') || '') + ' ' + hint
  ) ? 'shift-jis' : 'utf-8';

  return new TextDecoder(encoding).decode(bytes);
}

const a = args();
const date = a.date || '';
const track = a.track || '';
const race = Number(a.race || 0);
const sqlOut = a.out || '/tmp/jra-odds-cache.sql';
const summaryOut = a.summary || '/tmp/jra-odds-cache-summary.json';

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid date');
if (!track) throw new Error('invalid track');
if (!Number.isInteger(race) || race < 1 || race > 12) throw new Error('invalid race');

const raceService = createJraRaceService({ timeoutMs: 20000 });
const q = new URLSearchParams({ date, track, race: String(race) });

const raceResponse = await raceService(
  new Request(`https://runner.invalid/api/jra/race?${q}`),
  { ENABLE_JRA_AUTO_FETCH: false }
);
const raceBody = await raceResponse.json();

if (
  !raceResponse.ok ||
  !raceBody?.ok ||
  !raceBody?.sourceUrl ||
  raceBody?.dataConfidence !== 'high'
) {
  throw new Error(raceBody?.error || 'JRA_RACE_SOURCE_UNAVAILABLE');
}

const html = await readOfficialText(raceBody.sourceUrl);
const parsed = parseJraWinOdds(html, { date, track, race });

if (
  !Array.isArray(parsed?.odds) ||
  Number(parsed?.quality?.oddsHorseCount) < 1
) {
  throw new Error('JRA_ODDS_UNAVAILABLE');
}

const acquiredAt = new Date().toISOString();
const isFinal = parsed.oddsSnapshotType === 'final';
const expiresAt = new Date(
  Date.parse(acquiredAt) + (isFinal ? 24 * 60 * 60 * 1000 : 20 * 60 * 1000)
).toISOString();

const body = {
  ok: true,
  ...parsed,
  sourceUrl: raceBody.sourceUrl,
  acquiredAt
};

const payload = JSON.stringify(body);
const hash = createHash('sha256').update(payload).digest('hex');
const key = `odds|${date}|${track}|${race}`;

const sql =
  `INSERT INTO jra_official_cache ` +
  `(kind,cache_key,organization,race_date,track,race_no,payload_json,source_url,fetched_at,expires_at,parser_version,content_hash,updated_at) VALUES (` +
  `'odds',${sqlText(key)},'JRA',${sqlText(date)},${sqlText(track)},${race},` +
  `${sqlText(payload)},${sqlText(raceBody.sourceUrl)},${sqlText(acquiredAt)},${sqlText(expiresAt)},` +
  `${sqlText(parsed.parserVersion || null)},${sqlText(hash)},${sqlText(acquiredAt)}) ` +
  `ON CONFLICT(cache_key) DO UPDATE SET ` +
  `payload_json=excluded.payload_json,source_url=excluded.source_url,fetched_at=excluded.fetched_at,` +
  `expires_at=excluded.expires_at,parser_version=excluded.parser_version,` +
  `content_hash=excluded.content_hash,updated_at=excluded.updated_at;`;

fs.writeFileSync(sqlOut, sql + '\n');

const summary = {
  ok: true,
  date,
  track,
  race,
  activeHorseCount: Number(parsed.quality?.activeHorseCount || 0),
  oddsHorseCount: Number(parsed.quality?.oddsHorseCount || 0),
  oddsCoverage: Number(parsed.quality?.oddsCoverage || 0),
  complete: parsed.quality?.complete === true,
  oddsSnapshotType: parsed.oddsSnapshotType,
  acquiredAt,
  expiresAt,
  contentHash: hash,
  sourceUrl: raceBody.sourceUrl
};

fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
