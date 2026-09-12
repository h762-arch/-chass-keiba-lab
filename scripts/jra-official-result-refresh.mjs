import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createJraMeetingService, JRA_TRACKS } from '../jra-meeting-discovery.mjs';
import { createJraRaceService } from '../jra-race-fetch.mjs';
import {
  parseJraResult,
  resolveJraResultUrl,
  extractJraPostTime
} from '../jra-result-fetch.mjs';

function args() {
  const out = {};
  for (const item of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(item);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function tokyoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(x => x.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function sqlText(value) {
  if (value === null || value === undefined) return 'NULL';
  return `CAST(X'${Buffer.from(String(value), 'utf8').toString('hex')}' AS TEXT)`;
}

async function readOfficialText(url, max = 2_097_152) {
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

  if (!response.ok) {
    throw new Error(response.status === 404 ? 'JRA_RESULT_UNPUBLISHED' : 'JRA_HTTP_ERROR');
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > max) throw new Error('JRA_RESULT_PARSE_ERROR');

  const hint = new TextDecoder().decode(bytes.slice(0, 4096));
  const encoding = /shift[_-]?jis|sjis/i.test(
    (response.headers.get('content-type') || '') + ' ' + hint
  ) ? 'shift-jis' : 'utf-8';

  return new TextDecoder(encoding).decode(bytes);
}

const a = args();
const date = a.date || tokyoDate();
const trackInput = a.track || 'ALL';
const raceInput = Number(a.race || 0);
const strict = a.strict === 'true';
const sqlOut = a.out || '/tmp/jra-result-cache.sql';
const summaryOut = a.summary || '/tmp/jra-result-cache-summary.json';

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid date');
if (trackInput !== 'ALL' && !JRA_TRACKS.includes(trackInput)) throw new Error('invalid track');
if (!Number.isInteger(raceInput) || raceInput < 0 || raceInput > 12) throw new Error('invalid race');

const meetingService = createJraMeetingService({ timeoutMs: 15000 });
const raceService = createJraRaceService({ timeoutMs: 20000 });

let targets = [];

if (trackInput !== 'ALL' && raceInput > 0) {
  targets = [{ track: trackInput, race: raceInput }];
} else {
  const meetingRequest = new Request(
    `https://runner.invalid/api/jra/meeting?date=${encodeURIComponent(date)}`
  );
  const meetingResponse = await meetingService(
    meetingRequest,
    { ENABLE_JRA_MEETING_DISCOVERY: true }
  );
  const meetingBody = await meetingResponse.json();

  if (!meetingResponse.ok || !meetingBody?.ok || !Array.isArray(meetingBody.meetings)) {
    throw new Error(meetingBody?.error || 'JRA_MEETING_UNAVAILABLE');
  }

  for (const meeting of meetingBody.meetings) {
    if (meeting.status !== 'meeting') continue;
    if (trackInput !== 'ALL' && meeting.track !== trackInput) continue;

    for (const race of meeting.raceNumbers || []) {
      if (raceInput > 0 && Number(race) !== raceInput) continue;
      targets.push({ track: meeting.track, race: Number(race) });
    }
  }
}

const sql = [];
const successes = [];
const pending = [];
const failures = [];
const nowMs = Date.now();

for (const target of targets) {
  try {
    const q = new URLSearchParams({
      date,
      track: target.track,
      race: String(target.race)
    });

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

    const cardHtml = await readOfficialText(raceBody.sourceUrl);
    const post = extractJraPostTime(cardHtml);

    if (!post.postTime) throw new Error('JRA_RESULT_PARSE_ERROR');

    const postMs = Date.parse(`${date}T${post.postTime}:00+09:00`);
    if (Number.isFinite(postMs) && nowMs < postMs + 4 * 60 * 1000) {
      pending.push({
        date,
        track: target.track,
        race: target.race,
        reason: 'JRA_RESULT_BEFORE_POST',
        postTime: post.postTime
      });
      continue;
    }

    const resultUrl = resolveJraResultUrl(cardHtml, {
      date,
      track: target.track,
      race: target.race
    });

    const resultHtml = await readOfficialText(resultUrl);
    const parsed = parseJraResult(resultHtml, {
      date,
      track: target.track,
      race: target.race
    });

    if (
      !Array.isArray(parsed?.finishOrder) ||
      parsed.finishOrder.length < 3 ||
      !Array.isArray(parsed?.results) ||
      parsed.results.length < 3 ||
      Number(parsed?.quality?.finishOrderCount) < 3
    ) {
      throw new Error('JRA_RESULT_PARSE_ERROR');
    }

    const acquiredAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.parse(acquiredAt) + 365 * 24 * 60 * 60 * 1000
    ).toISOString();

    const body = {
      ok: true,
      ...parsed,
      sourceUrl: resultUrl,
      acquiredAt
    };

    const payload = JSON.stringify(body);
    const hash = createHash('sha256').update(payload).digest('hex');
    const key = `result|${date}|${target.track}|${target.race}`;

    sql.push(
      `INSERT INTO jra_official_cache ` +
      `(kind,cache_key,organization,race_date,track,race_no,payload_json,source_url,fetched_at,expires_at,parser_version,content_hash,updated_at) VALUES (` +
      `'result',${sqlText(key)},'JRA',${sqlText(date)},${sqlText(target.track)},${Number(target.race)},` +
      `${sqlText(payload)},${sqlText(resultUrl)},${sqlText(acquiredAt)},${sqlText(expiresAt)},` +
      `${sqlText(parsed.parserVersion || null)},${sqlText(hash)},${sqlText(acquiredAt)}) ` +
      `ON CONFLICT(cache_key) DO UPDATE SET ` +
      `payload_json=excluded.payload_json,source_url=excluded.source_url,fetched_at=excluded.fetched_at,` +
      `expires_at=excluded.expires_at,parser_version=excluded.parser_version,` +
      `content_hash=excluded.content_hash,updated_at=excluded.updated_at;`
    );

    successes.push({
      date,
      track: target.track,
      race: target.race,
      resultRows: Number(parsed.quality?.resultRows || 0),
      finishOrder: parsed.finishOrder.slice(0, 3),
      acquiredAt,
      contentHash: hash,
      sourceUrl: resultUrl
    });
  } catch (error) {
    const code = /^JRA_/.test(String(error?.message || ''))
      ? String(error.message)
      : 'JRA_OFFICIAL_UNAVAILABLE';

    if (['JRA_RESULT_BEFORE_POST', 'JRA_RESULT_UNPUBLISHED'].includes(code)) {
      pending.push({
        date,
        track: target.track,
        race: target.race,
        reason: code
      });
    } else {
      failures.push({
        date,
        track: target.track,
        race: target.race,
        error: code
      });
    }
  }

  await new Promise(resolve => setTimeout(resolve, 180));
}

fs.writeFileSync(sqlOut, sql.join('\n') + (sql.length ? '\n' : ''));

const summary = {
  ok: true,
  date,
  trackInput,
  raceInput,
  targetCount: targets.length,
  successCount: successes.length,
  pendingCount: pending.length,
  failureCount: failures.length,
  successes,
  pending,
  failures,
  generatedAt: new Date().toISOString()
};

fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (strict && successes.length !== 1) process.exitCode = 2;
else if (targets.length > 0 && successes.length === 0 && failures.length > 0) process.exitCode = 1;
