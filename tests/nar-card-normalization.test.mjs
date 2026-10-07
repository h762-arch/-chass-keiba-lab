import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseRaceCard} from '../worker.js';
import {classifyHorseOrigin,classifyRunVenue,summarizeHorseOrigins} from '../src/nar/exchange-origin.mjs';
const fixture=fs.readFileSync(new URL('./fixtures/nar/sonoda-20261007-r1-current-rows.html',import.meta.url),'utf8');
test('actual Sonoda rows separate carried weight, rider and sex/age for all nine runners',()=>{
 const rows=parseRaceCard(fixture);
 assert.deepEqual(rows.map(h=>[h.horseNo,h.sexAge,h.weight,h.jockey]),[
  ['1','牝5',55,'大山真 （兵庫）'],['2','牡8',57,'小谷周 （兵庫）'],
  ['3','牝3',53,'佐々世 （兵庫）'],['4','牝4',52,'高橋洸 （兵庫）'],
  ['5','牡3',57,'高畑皓 （兵庫）'],['6','牝4',55,'土方颯 （兵庫）'],
  ['7','牡8',57,'山本太 （兵庫）'],['8','牝3',55,'山本咲 （兵庫）'],
  ['9','牝3',55,'田野豊 （兵庫）']]);
 assert.deepEqual(summarizeHorseOrigins(rows).originCounts,{JRA:0,NAR:9,UNKNOWN:0});
 assert.equal(rows[8].horseName,'ヨシノマロンチャン');
});
test('Hyogo trainer affiliation is confirmed without rewriting jurisdiction or guessing missing affiliations',()=>{
 assert.deepEqual(classifyHorseOrigin('小村正（兵庫）'),{originOrganization:'NAR',originJurisdiction:'兵庫',originSource:'trainer_affiliation',originConfidence:'confirmed'});
 assert.equal(classifyHorseOrigin('小村正').originOrganization,'UNKNOWN');
 assert.equal(classifyHorseOrigin('小村正（不明）').originOrganization,'UNKNOWN');
 assert.equal(classifyRunVenue('兵庫').runOrganization,'UNKNOWN');
});
test('missing current-runner fields are not inferred from sire, trainer or historical statistics',()=>{
 const html='<table><tr><td>1</td><td>1</td><td>父名<font class="bamei"><b>テストホース</b></font></td><td>調教師（兵庫）</td><td>騎手（JRA）</td><td>55.0 牡8</td></tr></table>';
 const h=parseRaceCard(html)[0];assert.equal(h.sexAge,'');assert.equal(h.jockey,'騎手（JRA）');assert.equal(h.weight,null);assert.equal(h.originOrganization,'NAR');
});
test('unrecognised weight and ride-record shapes are preserved rather than silently truncated',()=>{
 const html='<table><tr><td>1</td><td>1</td><td>牝 3 <font class="bamei"><b>テストホース</b></font></td><td>調教師（兵庫）</td><td>99.0 騎手（兵庫）</td></tr></table>';
 const h=parseRaceCard(html)[0];assert.equal(h.weight,null);assert.equal(h.jockey,'99.0 騎手（兵庫）');assert.equal(h.sexAge,'牝3');
});
