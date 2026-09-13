from pathlib import Path

ROOT = Path.cwd()


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


# 1) Expired JRA D1 race cache => SAVED_OFFICIAL_BASE
cache_path = "jra-official-cache.mjs"
cache = read(cache_path)
start = cache.find("export async function readJraOfficialRaceCache")
end = cache.find("const oddsKey =", start)
if start < 0 or end < 0:
    raise SystemExit("jra-official-cache.mjs: race cache markers not found")

new_race_reader = '''export async function readJraOfficialRaceCache(env, { date, track, race, nowMs = Date.now() } = {}) {
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

'''
cache = cache[:start] + new_race_reader + cache[end:]
write(cache_path, cache)


# 2) Header distinguishes fresh vs saved D1
race_path = "jra-race-fetch.mjs"
race = read(race_path)
race = replace_once(
    race,
    '''      const cached=await readJraOfficialRaceCache(env,{date,track,race,nowMs:now()});
      if(cached)return send(cached.body,200,'D1-HIT');''',
    '''      const cached=await readJraOfficialRaceCache(env,{date,track,race,nowMs:now()});
      if(cached){
        const freshness=cached.body?.bridgeCache?.freshness;
        return send(cached.body,200,freshness==='saved'?'D1-SAVED':'D1-HIT');
      }''',
    "jra-race-fetch cache state",
)
write(race_path, race)


# 3) official_only=1 bypasses Drive merge/fallback
#    Used only by the Official D1 smoke workflow.
drive_path = "jra-drive-prediction-input.mjs"
drive = read(drive_path)
drive = replace_once(
    drive,
    '''export async function handleJraRaceRequest(request, env = {}) {
  const officialResponse = await handleOfficialJraRaceRequest(request, env);

  let official = null;''',
    '''export async function handleJraRaceRequest(request, env = {}) {
  const officialResponse = await handleOfficialJraRaceRequest(request, env);
  const requestUrl = new URL(request.url);
  const officialOnly = requestUrl.searchParams.get('official_only') === '1';

  if (officialOnly) return officialResponse;

  let official = null;''',
    "official_only bypass",
)
write(drive_path, drive)


# 4) Frontend accepts saved base, but labels live fields as unconfirmed
client_path = "jra-race-client.js"
client = read(client_path)
client = replace_once(
    client,
    "if(!response.ok||!data.ok)throw Error(data.error||'JRA_OFFICIAL_UNAVAILABLE');if(data.dataConfidence!=='high'||!data.quality?.raceParsed||data.quality.horseCount<2||data.quality.horseNameRate!==1||data.quality.weightRate!==1||data.quality.jockeyRate!==1)throw Error('JRA_PARSER_INCOMPLETE');commit(data,generation);",
    "if(!response.ok||!data.ok)throw Error(data.error||'JRA_OFFICIAL_UNAVAILABLE');const savedOfficial=data.source==='JRA_SAVED_OFFICIAL_BASE';if((!savedOfficial&&data.dataConfidence!=='high')||!data.quality?.raceParsed||data.quality.horseCount<2||data.quality.horseNameRate!==1||data.quality.weightRate!==1||(!savedOfficial&&data.quality.jockeyRate!==1))throw Error('JRA_PARSER_INCOMPLETE');commit(data,generation);",
    "saved-base validation",
)
client = replace_once(
    client,
    "const sourceLabel=data.source==='JRA_DRIVE_FRIDAY_BASE'?'Drive事前データ':'JRA公式';",
    "const sourceLabel=data.source==='JRA_DRIVE_FRIDAY_BASE'?'Drive事前データ':data.source==='JRA_SAVED_OFFICIAL_BASE'?'JRA保存済み公式データ（ライブ項目未確認）':'JRA公式';",
    "saved-base source label",
)
write(client_path, client)


# 5) Refresh v1.2. Old v1.1 becomes manual-only to avoid duplicate schedules.
old_refresh_path = ".github/workflows/CHASS-JRA-Official-Cache-Refresh-v1.1.yml"
refresh_v11 = read(old_refresh_path)
old_schedule = '''  schedule:
    - cron: "15 21,0,3 * * *"
'''
if old_schedule not in refresh_v11:
    raise SystemExit("Refresh v1.1 schedule anchor not found")

legacy = refresh_v11.replace(
    "name: CHASS JRA Official Cache Refresh v1.1",
    "name: CHASS JRA Official Cache Refresh v1.1 (Manual Legacy)",
    1,
).replace(old_schedule, "", 1)
write(old_refresh_path, legacy)

refresh_v12 = refresh_v11.replace(
    "name: CHASS JRA Official Cache Refresh v1.1",
    "name: CHASS JRA Official Cache Refresh v1.2",
    1,
).replace(
    '    - cron: "15 21,0,3 * * *"',
    '    - cron: "15 21,0,3,6,9,12 * * *"',
    1,
).replace(
    "## CHASS JRA Official Cache Refresh v1.1",
    "## CHASS JRA Official Cache Refresh v1.2",
    1,
)
refresh_v12 = replace_once(
    refresh_v12,
    '            echo "- Cloudflare Worker -> JRA direct fetch: not used"',
    '            echo "- Cloudflare Worker -> JRA direct fetch: not used"\n'
    '            echo "- Schedule JST: 06:15 / 09:15 / 12:15 / 15:15 / 18:15 / 21:15"\n'
    '            echo "- Race cache TTL: unchanged at 6 hours"',
    "refresh v1.2 summary",
)
write(".github/workflows/CHASS-JRA-Official-Cache-Refresh-v1.2.yml", refresh_v12)


# 6) Official-only D1 smoke workflow
smoke = '''name: CHASS JRA Official D1 Only Smoke v1.0

on:
  workflow_dispatch:
    inputs:
      date:
        description: "日付 YYYY-MM-DD。空欄なら日本時間の今日"
        required: false
        default: ""
        type: string
      track:
        description: "JRA競馬場"
        required: true
        default: "中山"
        type: choice
        options:
          - 札幌
          - 函館
          - 福島
          - 新潟
          - 東京
          - 中山
          - 中京
          - 京都
          - 阪神
          - 小倉
      race:
        description: "レース番号"
        required: true
        default: "1"
        type: choice
        options:
          - "1"
          - "2"
          - "3"
          - "4"
          - "5"
          - "6"
          - "7"
          - "8"
          - "9"
          - "10"
          - "11"
          - "12"
      expected_freshness:
        description: "ANY=current/savedどちらでも可"
        required: true
        default: "ANY"
        type: choice
        options:
          - ANY
          - current
          - saved

permissions:
  contents: read

concurrency:
  group: chass-jra-official-d1-only-smoke
  cancel-in-progress: false

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    env:
      PRODUCTION_BASE_URL: https://chass-keiba-lab7.h7625421.workers.dev
      INPUT_DATE: ${{ inputs.date }}
      INPUT_TRACK: ${{ inputs.track }}
      INPUT_RACE: ${{ inputs.race }}
      EXPECTED_FRESHNESS: ${{ inputs.expected_freshness }}

    steps:
      - name: Resolve date
        id: date
        shell: bash
        run: |
          set -euo pipefail
          DATE_ARG="${INPUT_DATE:-}"
          if [ -z "$DATE_ARG" ]; then
            DATE_ARG="$(TZ=Asia/Tokyo date +%F)"
          fi
          printf '%s' "$DATE_ARG" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          echo "value=$DATE_ARG" >> "$GITHUB_OUTPUT"

      - name: Call official-only endpoint
        id: call
        shell: bash
        run: |
          set -euo pipefail
          : > /tmp/jra-official-only.json
          : > /tmp/jra-official-only.headers

          CODE="$(curl -sS --max-time 25 \
            -D /tmp/jra-official-only.headers \
            --get "$PRODUCTION_BASE_URL/api/jra/race" \
            --data-urlencode "date=${{ steps.date.outputs.value }}" \
            --data-urlencode "track=$INPUT_TRACK" \
            --data-urlencode "race=$INPUT_RACE" \
            --data-urlencode "official_only=1" \
            -o /tmp/jra-official-only.json \
            -w '%{http_code}' || true)"

          echo "HTTP=$CODE"
          grep -iE '^(HTTP/|x-chass-jra-race-cache:|x-chass-jra-source:|cf-ray:|server:)' /tmp/jra-official-only.headers || true
          cat /tmp/jra-official-only.json
          test "$CODE" = "200"

          node <<'NODE' >> "$GITHUB_OUTPUT"
          const fs = require('fs');
          const x = JSON.parse(fs.readFileSync('/tmp/jra-official-only.json','utf8'));
          if (x.ok !== true) throw new Error('official_only_not_ok');
          if (x.organization !== 'JRA') throw new Error('not_jra');
          if (!x.quality?.raceParsed || Number(x.quality?.horseCount) < 2) throw new Error('race_quality_incomplete');
          if (x.bridgeCache?.provider !== 'github_actions_d1') throw new Error('not_d1_official_cache');
          if (!['current','saved'].includes(x.bridgeCache?.freshness)) throw new Error('invalid_freshness');
          if (!['JRA_OFFICIAL','JRA_SAVED_OFFICIAL_BASE'].includes(x.source)) throw new Error(`unexpected_source:${x.source}`);
          if (x.driveInput != null) throw new Error('drive_fallback_or_merge_detected');
          if (x.bridgeCache.freshness === 'saved') {
            if (x.source !== 'JRA_SAVED_OFFICIAL_BASE') throw new Error('saved_source_mismatch');
            if (x.liveFieldsVerified !== false) throw new Error('saved_live_fields_not_marked_unverified');
          }
          console.log(`freshness=${x.bridgeCache.freshness}`);
          console.log(`source=${x.source}`);
          console.log(`horse_count=${x.quality.horseCount}`);
          NODE

          CACHE_HEADER="$(awk 'BEGIN{IGNORECASE=1} /^x-chass-jra-race-cache:/{gsub("\\r",""); print $2}' /tmp/jra-official-only.headers | tail -n 1)"
          case "$CACHE_HEADER" in
            D1-HIT|D1-SAVED) ;;
            *) echo "::error::Unexpected X-CHASS-JRA-Race-Cache: $CACHE_HEADER"; exit 1 ;;
          esac

      - name: Verify expected freshness
        shell: bash
        run: |
          set -euo pipefail
          if [ "$EXPECTED_FRESHNESS" != "ANY" ] && [ "$EXPECTED_FRESHNESS" != "${{ steps.call.outputs.freshness }}" ]; then
            echo "::error::Expected $EXPECTED_FRESHNESS but got ${{ steps.call.outputs.freshness }}"
            exit 1
          fi

      - name: Summary
        if: always()
        shell: bash
        run: |
          {
            echo "## CHASS JRA Official D1 Only Smoke v1.0"
            echo
            echo "- Date: ${{ steps.date.outputs.value }}"
            echo "- Track: $INPUT_TRACK"
            echo "- Race: ${INPUT_RACE}R"
            echo "- Official D1 freshness: ${{ steps.call.outputs.freshness || 'unknown' }}"
            echo "- Source: ${{ steps.call.outputs.source || 'unknown' }}"
            echo "- Horse count: ${{ steps.call.outputs.horse_count || 'unknown' }}"
            echo "- Drive merge/fallback: NOT USED"
            echo "- Purpose: JRA公式D1だけで読めるかを独立確認"
          } >> "$GITHUB_STEP_SUMMARY"
'''
write(".github/workflows/CHASS-JRA-Official-D1-Only-Smoke-v1.0.yml", smoke)


# 7) Regression tests
saved_base_test = '''import test from 'node:test';
import assert from 'node:assert/strict';
import { readJraOfficialRaceCache } from '../jra-official-cache.mjs';

function envFor(row) {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return { first: async () => row };
          }
        };
      }
    }
  };
}

const baseBody = {
  ok: true,
  organization: 'JRA',
  source: 'JRA_OFFICIAL',
  dataConfidence: 'high',
  race: {
    date: '2026-09-13', racecourse: '中山', raceNo: 1, raceName: 'テスト',
    postTime: '10:00', surface: '芝', distance: 1600, direction: '右',
    courseType: '外回り', raceClass: '3歳未勝利', trackCondition: '良', weather: '晴'
  },
  horses: [
    {
      horseNo: 1, frameNo: 1, horseName: 'テストホースA', sexAge: '牡3',
      weightCarried: 57, jockey: '騎手A', trainer: '調教師A',
      bodyWeight: 480, bodyWeightChange: 2, runningStatus: 'active',
      odds: null, popularity: null,
      pastRuns: [{ date: '2026-08-01', racecourse: '新潟', distance: 1600, time: '1:34.0' }]
    },
    {
      horseNo: 2, frameNo: 2, horseName: 'テストホースB', sexAge: '牝3',
      weightCarried: 55, jockey: '騎手B', trainer: '調教師B',
      bodyWeight: 450, bodyWeightChange: -2, runningStatus: 'active',
      odds: null, popularity: null,
      pastRuns: [{ date: '2026-08-02', racecourse: '新潟', distance: 1600, time: '1:34.5' }]
    }
  ],
  quality: {
    raceParsed: true, horseCount: 2, activeHorseCount: 2,
    horseNameRate: 1, weightRate: 1, jockeyRate: 1, pastRunRate: 1
  }
};

function row(expiresAt) {
  return {
    payload_json: JSON.stringify(baseBody),
    source_url: 'https://www.jra.go.jp/',
    fetched_at: '2026-09-13T03:15:00.000Z',
    expires_at: expiresAt,
    parser_version: 'jra-official-card-v1',
    content_hash: 'abc123'
  };
}

test('fresh JRA D1 race cache remains current official data', async () => {
  const result = await readJraOfficialRaceCache(
    envFor(row('2026-09-13T09:15:00.000Z')),
    { date: '2026-09-13', track: '中山', race: 1, nowMs: Date.parse('2026-09-13T06:00:00.000Z') }
  );
  assert.equal(result.body.source, 'JRA_OFFICIAL');
  assert.equal(result.body.dataConfidence, 'high');
  assert.equal(result.body.bridgeCache.freshness, 'current');
  assert.equal(result.body.bridgeCache.expired, false);
  assert.equal(result.body.horses[0].jockey, '騎手A');
  assert.equal(result.body.horses[0].bodyWeight, 480);
});

test('expired JRA D1 race cache becomes SAVED_OFFICIAL_BASE', async () => {
  const result = await readJraOfficialRaceCache(
    envFor(row('2026-09-13T09:15:00.000Z')),
    { date: '2026-09-13', track: '中山', race: 1, nowMs: Date.parse('2026-09-13T12:00:00.000Z') }
  );

  assert.equal(result.body.source, 'JRA_SAVED_OFFICIAL_BASE');
  assert.equal(result.body.dataConfidence, 'medium');
  assert.equal(result.body.liveFieldsVerified, false);
  assert.equal(result.body.bridgeCache.freshness, 'saved');
  assert.equal(result.body.bridgeCache.expired, true);
  assert.equal(result.body.race.distance, 1600);
  assert.equal(result.body.race.racecourse, '中山');
  assert.equal(result.body.race.trackCondition, '不明');
  assert.equal(result.body.race.weather, '');
  assert.equal(result.body.horses[0].horseName, 'テストホースA');
  assert.equal(result.body.horses[0].weightCarried, 57);
  assert.equal(result.body.horses[0].pastRuns.length, 1);
  assert.equal(result.body.horses[0].jockey, '');
  assert.equal(result.body.horses[0].bodyWeight, null);
  assert.equal(result.body.horses[0].bodyWeightChange, null);
  assert.equal(result.body.horses[0].liveStatusConfidence, 'unconfirmed');
  assert.ok(result.body.savedOfficialBase.unconfirmedLiveFields.includes('horses.runningStatus'));
  assert.ok(result.body.savedOfficialBase.unconfirmedLiveFields.includes('horses.jockey'));
  assert.ok(result.body.savedOfficialBase.unconfirmedLiveFields.includes('horses.bodyWeight'));
});

test('missing D1 row still returns null so Drive fallback can run', async () => {
  const result = await readJraOfficialRaceCache(
    envFor(null),
    { date: '2026-09-13', track: '中山', race: 1, nowMs: Date.now() }
  );
  assert.equal(result, null);
});
'''
write("tests/jra-official-saved-base.test.mjs", saved_base_test)

print("CHASS JRA official saved-base patch prepared.")
