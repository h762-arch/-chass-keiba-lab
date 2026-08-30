import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseResult,parseRaceCard,parseTanFuku,parseRuns,compactTimeToSec,buildAbilityFeatures,predictTimeFromRuns,secToRaceTime} from '../worker.js';

const fixture=name=>readFile(new URL(`./fixtures/${name}`,import.meta.url),'utf8');

test('result parser keeps full official result fields',async()=>{
  const result=parseResult(await fixture('result.html'));
  assert.deepEqual(result.finishOrder.slice(0,3),['12','11','3']);
  assert.equal(result.actualTimes['12'],'1:40.3');
  assert.equal(result.results[0].horseName,'テストホース');
  assert.equal(result.results[0].last3f,38.1);
  assert.equal(result.results[0].bodyWeight,482);
  assert.equal(result.results[0].bodyWeightChange,2);
});

test('race card and odds parsers map horses without mixing market into ability',async()=>{
  const card=parseRaceCard(await fixture('race-card.html'));
  const odds=parseTanFuku(await fixture('odds.html'));
  assert.deepEqual(card.map(x=>x.horseNo),['3','12']);
  assert.equal(card.find(x=>x.horseNo==='12').horseName,'テストホース');
  assert.equal(odds.find(x=>x.horseNo==='3').popularity,1);
  assert.equal(odds.find(x=>x.horseNo==='12').odds,4.8);
});

test('past-run parser and compact TIME conversion remain stable',async()=>{
  const runs=parseRuns(await fixture('runs.txt'),1500,'船橋');
  assert.equal(compactTimeToSec('1403'),100.3);
  assert.equal(runs.length,2);
  assert.equal(runs[0].exactDistance,true);
  assert.equal(runs[0].sameTrack,true);
  assert.equal(runs[0].last3f,38.1);
});

test('ability features are market-independent and keep missing evidence null',async()=>{
  const runs=parseRuns(await fixture('runs.txt'),1500,'船橋');
  const features=buildAbilityFeatures(runs,1500,56);
  assert.equal(features.evidence.runs,2);
  assert.equal(features.evidence.sameDistance,1);
  assert.equal(features.weightEffect,50);
  assert.equal(features.classStrength,null);
  assert.equal('odds' in features,false);
  assert.equal('popularity' in features,false);
});

test('TIME model returns standard, favored and adverse scenarios',async()=>{
  const runs=parseRuns(await fixture('runs.txt'),1500,'船橋');
  const prediction=predictTimeFromRuns(runs,1500);
  assert.equal(prediction.time,'1:40.3');
  assert.equal(prediction.scenarios.standard,'1:40.3');
  assert.equal(prediction.scenarios.paceFavored,'1:39.7');
  assert.equal(prediction.scenarios.paceAdverse,'1:40.9');
  assert.equal(secToRaceTime(119.96),'2:00.0');
});
