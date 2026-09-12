import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeViewerMarketPayload } from '../viewer/viewer-core.js';

const core = fs.readFileSync(new URL('../viewer/viewer-core.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

const columns = [
  'horseNumber','horseName','abilityRank','score','winProb','top3Prob',
  'odds','popularity','expectedValue','evRank','abilityPopularityGap','diamond','warning'
];

function row({
  no, name, rank = 1, score = 80, win = 0.2, top3 = 0.5,
  odds = null, popularity = null, ev = null, diamond = null, warning = null,
}) {
  return [no, name, rank, score, win, top3, odds, popularity, ev, null, null, diamond, warning];
}

test('stale overlay falls back to saved odds/popularity without pretending they are current', () => {
  const payload = {
    ok: true,
    date: '2026-09-12',
    track: '阪神',
    organization: 'JRA',
    horseColumns: columns,
    races: [{
      raceNumber: 11,
      raceName: 'チャレンジカップ',
      horses: [row({ no: 7, name: 'ジーティーアダマン', odds: 10.8, popularity: 5 })],
    }],
    viewerMarketMode: 'fresh-final-overlay-v1',
    viewerMarketOverlay: [{
      raceNumber: 11,
      horses: [{
        horseNumber: 7,
        horseName: 'ジーティーアダマン',
        odds: null,
        popularity: null,
        oddsStatus: 'stale',
        oddsFetchedAt: '2026-09-12T06:30:00.000Z',
        marketDataSource: 'saved_snapshot',
      }],
    }],
  };

  const out = sanitizeViewerMarketPayload(payload);
  const horse = out.races[0].horses[0];

  assert.equal(horse.odds, 10.8);
  assert.equal(horse.popularity, 5);
  assert.equal(horse.marketStatus, 'saved');
  assert.equal(horse.marketDataSource, 'saved_snapshot_fallback');
});

test('final overlay still wins over saved snapshot', () => {
  const payload = {
    ok: true,
    date: '2026-09-12',
    track: '阪神',
    organization: 'JRA',
    horseColumns: columns,
    races: [{
      raceNumber: 11,
      raceName: 'チャレンジカップ',
      horses: [row({ no: 7, name: 'ジーティーアダマン', odds: 10.8, popularity: 5 })],
    }],
    viewerMarketMode: 'fresh-final-overlay-v1',
    viewerMarketOverlay: [{
      raceNumber: 11,
      horses: [{
        horseNumber: 7,
        horseName: 'ジーティーアダマン',
        odds: 12.4,
        popularity: 6,
        oddsStatus: 'final',
        oddsFetchedAt: '2026-09-12T07:50:00.000Z',
        marketDataSource: 'result_final',
      }],
    }],
  };

  const horse = sanitizeViewerMarketPayload(payload).races[0].horses[0];
  assert.equal(horse.odds, 12.4);
  assert.equal(horse.popularity, 6);
  assert.equal(horse.marketStatus, 'final');
  assert.equal(horse.marketDataSource, 'result_final');
});

test('unavailable overlay with no saved odds stays unavailable', () => {
  const payload = {
    ok: true,
    date: '2026-09-12',
    track: '阪神',
    organization: 'JRA',
    horseColumns: columns,
    races: [{
      raceNumber: 12,
      raceName: '3歳以上1勝クラス',
      horses: [row({ no: 14, name: 'スターフュージョン' })],
    }],
    viewerMarketMode: 'fresh-final-overlay-v1',
    viewerMarketOverlay: [{
      raceNumber: 12,
      horses: [{
        horseNumber: 14,
        horseName: 'スターフュージョン',
        odds: null,
        popularity: null,
        oddsStatus: 'unavailable',
        oddsFetchedAt: null,
        marketDataSource: null,
      }],
    }],
  };

  const horse = sanitizeViewerMarketPayload(payload).races[0].horses[0];
  assert.equal(horse.odds, null);
  assert.equal(horse.popularity, null);
  assert.equal(horse.marketStatus, 'unavailable');
});

test('horse identity guard remains horseNo + normalized horseName', () => {
  assert.match(core, /const sameNo = finiteOrNull\(item\?\.horseNumber\) === horseNo/);
  assert.match(core, /return overlayName === normalizedName/);
});

test('viewer explicitly labels saved market instead of current market', () => {
  assert.match(app, /marketStatus === 'saved'/);
  assert.match(app, /保存市場/);
  assert.match(core, /saved_snapshot_fallback/);
});

test('worker public API contract and persisted viewer overlay remain intact', () => {
  assert.match(worker, /async function publicViewerMarketOverlay\(day,races,env\)/);
  assert.match(worker, /payload\.viewerMarketOverlay=await publicViewerMarketOverlay\(day,races,env\)/);
  assert.match(worker, /payload\.viewerMarketMode='fresh-final-overlay-v1'/);
  assert.match(worker, /marketEvaluationMode:'saved-snapshot-only'/);
});
