import test from 'node:test';
import assert from 'node:assert/strict';
import { MIRROR_SCHEMA_VERSION, TRACKS, parseDayAiText, mergeChatSnapshot } from '../publish-chass-chat-snapshot.mjs';

const ability = {
  ok: true,
  apiVersion: 'ability-compact-v1',
  date: '2026-09-15',
  track: '大井',
  organization: 'NAR',
  races: [{
    raceNumber: 1,
    raceName: 'sample',
    horses: [
      { horseNumber: 1, horseName: 'テストワン', abilityRank: 1, score: 91, winProb: 0.31, top3Prob: 0.67, predictedTime: '1:39.0', predictedTimeSec: 99, runningStyle: '先行・好位', distanceScore: 88, courseScore: 92, paceScore: 85, conditionScore: 80, runnerStatus: 'active' },
      { horseNumber: 2, horseName: 'テストツー', abilityRank: 6, score: 73, winProb: 0.08, top3Prob: 0.26, predictedTime: '1:39.8', predictedTimeSec: 99.8, runningStyle: '差し・追込', distanceScore: 81, courseScore: 77, paceScore: 90, conditionScore: 75, runnerStatus: 'active' },
    ],
  }],
};

const marketText = [
  'CHASS_DAY_AI|apiVersion=1|mode=read-only',
  'DAY|date=2026-09-15|track=大井|organization=NAR|raceCount=1|generatedAt=2026-09-15T03:00:00.000Z',
  'RACE|raceNo=1|raceName=sample|surface=ダート|distance=1600|going=良|startTime=12:00|horseCount=2|raceVolatility=62|raceValueScore=71|favoriteReliability=67|probabilityValid=true',
  'HORSE|raceNo=1|no=1|name=テストワン|abilityRank=1|evRank=2|winProb=0.31|top3Prob=0.67|time=99|score=91|odds=2.8|oddsStatus=available|popularity=1|expectedValue=0.868|expectedValuePercent=86.8|abilityPopularityGap=0|mark=◎|diamond=null|warning=null|runnerStatus=active',
  'HORSE|raceNo=1|no=2|name=テストツー|abilityRank=6|evRank=1|winProb=0.08|top3Prob=0.26|time=99.8|score=73|odds=18.2|oddsStatus=stale|popularity=7|expectedValue=1.456|expectedValuePercent=145.6|abilityPopularityGap=1|mark=null|diamond=💎|warning=null|runnerStatus=active',
  'END_RACE|raceNo=1|predictionAt=2026-09-15T02:20:00.000Z|oddsAt=2026-09-15T02:55:00.000Z|resultAt=null',
  'END_CHASS_DAY_AI',
].join('\n');

test('track registry contains JRA and NAR canonical slugs', () => {
  assert.deepEqual(TRACKS.ooi, { track: '大井', organization: 'NAR' });
  assert.deepEqual(TRACKS.nakayama, { track: '中山', organization: 'JRA' });
});

test('day-ai text parser preserves odds status and timestamps', () => {
  const parsed = parseDayAiText(marketText);
  assert.equal(parsed.day.track, '大井');
  assert.equal(parsed.races[0].horses[1].oddsStatus, 'stale');
  assert.equal(parsed.races[0].timestamps.oddsAt, '2026-09-15T02:55:00.000Z');
});

test('merged mirror contains ability, TIME, market, EV and CHASS signals', () => {
  const out = mergeChatSnapshot({ ability, marketText, slug: 'ooi' });
  assert.equal(out.schemaVersion, MIRROR_SCHEMA_VERSION);
  assert.equal(out.races[0].horses[0].predictedTime, '1:39.0');
  assert.equal(out.races[0].horses[1].odds, 18.2);
  assert.equal(out.races[0].horses[1].diamond, '💎');
  assert.equal(out.diagnostics.staleMarketHorseCount, 1);
  assert.equal(out.freshness.latestOddsAt, '2026-09-15T02:55:00.000Z');
});

test('ability-only fallback never invents market values', () => {
  const out = mergeChatSnapshot({ ability, marketText: null, slug: 'ooi' });
  assert.equal(out.diagnostics.abilityOnlyFallback, true);
  assert.equal(out.races[0].horses[0].odds, null);
  assert.equal(out.races[0].horses[0].diamond, null);
});

test('horse identity mismatch fails closed for market merge', () => {
  const bad = marketText.replace('name=テストツー', 'name=別の馬');
  const out = mergeChatSnapshot({ ability, marketText: bad, slug: 'ooi' });
  assert.equal(out.diagnostics.identityMismatchCount, 1);
  assert.equal(out.races[0].horses[1].marketIdentityVerified, false);
  assert.equal(out.races[0].horses[1].odds, null);
});
