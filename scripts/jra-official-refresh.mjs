import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createJraMeetingService, JRA_TRACKS } from '../jra-meeting-discovery.mjs';
import { createJraRaceService } from '../jra-race-fetch.mjs';

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

const a = args();
const date = a.date || tokyoDate();
const trackInput = a.track || 'ALL';
const raceInput = Number(a.race || 0);
const sqlOut = a.out || '/tmp/jra-cache.sql';
const summaryOut = a.summary || '/tmp/jra-cache-summary.json';

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid date');
if (trackInput !== 'ALL' && !JRA_TRACKS.includes(trackInput)) throw new Error('invalid track');
if (!Number.isInteger(raceInput) || raceInput < 0 || raceInput > 12) throw new Error('invalid race');

const meetingService = createJraMeetingService({ timeoutMs: 15000 });
const raceService = createJraRaceService({ timeoutMs: 20000 });

const meetingRequest = new Request(`https://runner.invalid/api/jra/meeting?date=${encodeURIComponent(date)}`);
const meetingResponse = await meetingService(meetingRequest, { ENABLE_JRA_MEETING_DISCOVERY: true });
const meetingBody = await meetingResponse.json();

const now = new Date();
const checkedAt = now.toISOString();
const meetingNext = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();

function sqlText(value) {
  if (value === null || value === undefined) return 'NULL';
  return `CAST(X'${Buffer.from(String(value), 'utf8').toString('hex')}' AS TEXT)`;
}

const sql = ['BEGIN IMMEDIATE;'];

if (meetingBody?.ok && Array.isArray(meetingBody.meetings)) {
  sql.push(
    `INSERT INTO jra_meeting_calendar ` +
    `(date,status,meetings_json,checked_at,next_refresh_at,source,parser_version,error_code) VALUES (` +
    `${sqlText(date)},'complete',${sqlText(JSON.stringify(meetingBody.meetings))},${sqlText(checkedAt)},${sqlText(meetingNext)},` +
    `${sqlText(meetingBody.source || 'JRA_OFFICIAL')},${sqlText(meetingBody.parserVersion || null)},NULL) ` +
    `ON CONFLICT(date) DO UPDATE SET ` +
    `status=excluded.status,meetings_json=excluded.meetings_json,checked_at=excluded.checked_at,` +
    `next_refresh_at=excluded.next_refresh_at,source=excluded.source,parser_version=excluded.parser_version,error_code=NULL;`
  );
}

let targets = [];
if (trackInput !== 'ALL' && raceInput > 0) {
  targets = [{ track: trackInput, race: raceInput }];
} else if (meetingBody?.ok && Array.isArray(meetingBody.meetings)) {
  for (const meeting of meetingBody.meetings) {
    if (meeting.status !== 'meeting') continue;
    if (trackInput !== 'ALL' && meeting.track !== trackInput) continue;
    for (const race of meeting.raceNumbers || []) {
      if (raceInput > 0 && Number(race) !== raceInput) continue;
      targets.push({ track: meeting.track, race: Number(race) });
    }
  }
}

const successes = [];
const failures = [];

for (const target of targets) {
  const q = new URLSearchParams({ date, track: target.track, race: String(target.race) });
  const request = new Request(`https://runner.invalid/api/jra/race?${q}`);
  const response = await raceService(request, { ENABLE_JRA_AUTO_FETCH: false });
  const body = await response.json();

  if (
    response.ok &&
    body?.ok &&
    body?.dataConfidence === 'high' &&
    body?.quality?.raceParsed &&
    Number(body?.quality?.horseCount) >= 2
  ) {
    const fetchedAt = body.fetchedAt || new Date().toISOString();
    const expiresAt = new Date(Date.parse(fetchedAt) + 6 * 60 * 60 * 1000).toISOString();
    const payload = JSON.stringify(body);
    const hash = createHash('sha256').update(payload).digest('hex');
    const key = `race|${date}|${target.track}|${target.race}`;

    sql.push(
      `INSERT INTO jra_official_cache ` +
      `(kind,cache_key,organization,race_date,track,race_no,payload_json,source_url,fetched_at,expires_at,parser_version,content_hash,updated_at) VALUES (` +
      `'race',${sqlText(key)},'JRA',${sqlText(date)},${sqlText(target.track)},${Number(target.race)},` +
      `${sqlText(payload)},${sqlText(body.sourceUrl || null)},${sqlText(fetchedAt)},${sqlText(expiresAt)},` +
      `${sqlText(body.parserVersion || null)},${sqlText(hash)},${sqlText(new Date().toISOString())}) ` +
      `ON CONFLICT(cache_key) DO UPDATE SET ` +
      `payload_json=excluded.payload_json,source_url=excluded.source_url,fetched_at=excluded.fetched_at,` +
      `expires_at=excluded.expires_at,parser_version=excluded.parser_version,content_hash=excluded.content_hash,updated_at=excluded.updated_at;`
    );

    successes.push({
      date,
      track: target.track,
      race: target.race,
      horseCount: Number(body.quality.horseCount),
      fetchedAt,
      contentHash: hash
    });
  } else {
    failures.push({
      date,
      track: target.track,
      race: target.race,
      status: response.status,
      error: body?.error || 'unknown'
    });
  }

  await new Promise(resolve => setTimeout(resolve, 150));
}

sql.push('COMMIT;');
fs.writeFileSync(sqlOut, sql.join('\n') + '\n');

const summary = {
  ok: true,
  date,
  trackInput,
  raceInput,
  meetingOk: meetingBody?.ok === true,
  targetCount: targets.length,
  successCount: successes.length,
  failureCount: failures.length,
  successes,
  failures,
  generatedAt: new Date().toISOString()
};

fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (trackInput !== 'ALL' && raceInput > 0 && successes.length !== 1) process.exitCode = 1;
else if (targets.length > 0 && successes.length === 0) process.exitCode = 1;
