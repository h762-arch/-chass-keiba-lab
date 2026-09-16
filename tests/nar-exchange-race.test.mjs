import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseRaceCard,parseRuns,buildNarRacePayloadStable} from '../worker.js';
import {classifyHorseOrigin,classifyRunVenue,mergeCardIdentities,summarizeHorseOrigins} from '../src/nar/exchange-origin.mjs';

const fixture=fs.readFileSync(new URL('./fixtures/nar-exchange-kawasaki-2026-06-16-6.html',import.meta.url),'utf8');

test('川崎6RはNAR開催のままJRA 7頭/NAR 4頭を馬単位で識別する',()=>{
  const horses=parseRaceCard(fixture),summary=summarizeHorseOrigins(horses);
  assert.equal(horses.length,11);assert.deepEqual(summary.originCounts,{JRA:7,NAR:4,UNKNOWN:0});assert.equal(summary.raceHost,'NAR');assert.equal(summary.mixedOrigin,true);
  const lupo=horses.find(h=>h.horseNo==='6');assert.equal(lupo.originOrganization,'JRA');assert.match(lupo.jockey,/大井/);
});

test('所属は調教師欄だけで確定し騎手所属では推測しない',()=>{
  assert.equal(classifyHorseOrigin('小崎憲（JRA）').originOrganization,'JRA');
  assert.equal(classifyHorseOrigin('騎手（大井）').originOrganization,'NAR');
  assert.equal(classifyHorseOrigin('所属記載なし').originOrganization,'UNKNOWN');
});

test('horse originとpast-run originは独立しJRA venue表記を保持する',()=>{
  const runs=parseRuns('Ｊ京都05.10 良 右 1200 3/12 2人 1123（0.4） 2-2-1 36.2 川崎04.01 良 左 1500 1/10 1人 1381（0.1） 1-1-1 38.0',1500,'川崎');
  assert.deepEqual(runs.map(r=>[r.rawVenue,r.venue,r.runOrganization]),[['Ｊ京都','京都','JRA'],['川崎','川崎','NAR']]);
  assert.deepEqual(classifyRunVenue('Ｊ阪神'),{rawVenue:'Ｊ阪神',venue:'阪神',runOrganization:'JRA'});
});

test('detail partial missing is recovered by horseNo without using odds as ability',()=>{
  const detail=parseRaceCard(fixture).slice(0,8),fallback=parseRaceCard(fixture),odds=[{horseNo:'12',horseName:'オッズ補完馬',odds:99.9}];
  const merged=mergeCardIdentities(detail,fallback,odds);assert.equal(merged.length,12);assert.equal(merged.find(h=>h.horseNo==='9').identityRecovered,true);assert.equal(merged.find(h=>h.horseNo==='12').abilityScore,undefined);
});

test('stable payload remains organization NAR and exposes merge diagnostics',async()=>{
  const odds='<table><tr><th>枠</th><th>馬番</th><th>馬名</th><th>単勝</th></tr><tr><td>1</td><td>1</td><td>サザンホクトベガ</td><td>3.2</td></tr></table>';
  const payload=await buildNarRacePayloadStable({code:21,date:'2026-06-16',race:6,urls:{detail:'d',card:'c',odds:'o'},fetcher:async url=>url==='d'?fixture:url==='c'?fixture:odds});
  assert.equal(payload.organization,'NAR');assert.equal(payload.raceHost,'NAR');assert.deepEqual(payload.originCounts,{JRA:7,NAR:4,UNKNOWN:0});assert.equal(payload.horses.length,11);assert.equal(payload.quality.marketSeparated,true);
});
