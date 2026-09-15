import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyTimedStage,parsePostTime,pickMarketFavorite,pickFinalFavorite,abilityRankForHorse} from '../src/research/favorite-risk-snapshot.mjs';

test('classifyTimedStage separates EARLY, T15 and T5 without post-time leakage',()=>{
  assert.equal(classifyTimedStage(21),'EARLY');
  assert.equal(classifyTimedStage(15),'T15');
  assert.equal(classifyTimedStage(10),'T5');
  assert.equal(classifyTimedStage(5),'T5');
  assert.equal(classifyTimedStage(-0.01),null);
});

test('parsePostTime interprets local race clock as JST',()=>{
  const ms=parsePostTime('2026-09-15','14:30');
  assert.equal(new Date(ms).toISOString(),'2026-09-15T05:30:00.000Z');
});

test('market favorite keeps market ranking separate from ability ranking',()=>{
  const prediction={horses:[
    {horseNo:1,horseName:'A',overall:70,win:.30,place:.60},
    {horseNo:2,horseName:'B',overall:80,win:.20,place:.50}
  ]};
  const market={horses:[
    {horseNo:1,horseName:'A',odds:2.1,popularity:1},
    {horseNo:2,horseName:'B',odds:3.0,popularity:2}
  ]};
  const f=pickMarketFavorite(market,prediction);
  assert.equal(f.horseNo,1);
  assert.equal(f.abilityRank,2);
  assert.equal(f.aiOutside3Rate,.4);
  assert.equal(f.secondFavoriteOdds,3);
});

test('final favorite is determined from official final popularity and result',()=>{
  const prediction={horses:[{horseNo:4,horseName:'Fav',overall:60,win:.25,place:.55}]};
  const result={horses:[
    {horseNo:4,horseName:'Fav',finalPopularity:1,finalOdds:2.2,finish:5},
    {horseNo:2,horseName:'Other',finalPopularity:2,finalOdds:3.1,finish:1}
  ]};
  const f=pickFinalFavorite(result,prediction);
  assert.equal(f.horseNo,4);
  assert.equal(f.finish,5);
  assert.equal(f.top3Flag,0);
  assert.equal(f.outside3Flag,1);
});

test('ability rank supports ties and ignores missing scores',()=>{
  const prediction={horses:[
    {horseNo:1,overall:80},{horseNo:2,overall:80},{horseNo:3,overall:70},{horseNo:4}
  ]};
  assert.equal(abilityRankForHorse(prediction,1),1);
  assert.equal(abilityRankForHorse(prediction,2),1);
  assert.equal(abilityRankForHorse(prediction,3),3);
  assert.equal(abilityRankForHorse(prediction,4),null);
});

test('migration 0009 is additive and keeps JRA/NAR physically separate',async()=>{
  const sql=await readFile(new URL('../migrations/0009_favorite_risk_snapshots.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS jra_favorite_risk_snapshots/i);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS nar_favorite_risk_snapshots/i);
  assert.doesNotMatch(sql,/\b(?:DROP|DELETE|ALTER)\b/i);
});
