import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseRaceMeta} from '../worker.js';
const header=fs.readFileSync(new URL('./fixtures/nar/sonoda-20261007-r1-race-header.html',import.meta.url),'utf8');
test('actual Sonoda official header yields current race name and preserves race metadata',()=>{
 assert.deepEqual(parseRaceMeta(header),{raceName:'Ｃ３三３歳以上',distance:1400,weather:'晴',trackCondition:'稍重',postTime:'10:40',surface:'ダート'});
});
test('past-run midium names never replace a missing current race name',()=>{
 const s='<title>地方競馬 データ情報</title><tr class="dbitem"><td>出馬表</td></tr><span class="midium">前走特別</span>';
 assert.equal(parseRaceMeta(s).raceName,'');
 assert.equal(parseRaceMeta('<font class="bamei"><b>馬名</b></font><span class="midium">前走特別</span>').raceName,'');
});
test('explicit official name precedes navigation headings and supports class tokens and single quotes',()=>{
 assert.equal(parseRaceMeta("<h2>出馬表メニュー</h2><span class='label midium current'><b>公式特別</b></span><tr class='dbitem'>").raceName,'公式特別');
});
test('existing heading names survive and generic titles or unbounded spans stay unknown',()=>{
 assert.equal(parseRaceMeta('<h2>既存特別</h2>').raceName,'既存特別');
 assert.equal(parseRaceMeta('<title>地方競馬 データ情報</title>').raceName,'');
 assert.equal(parseRaceMeta('<span class="midium">出所不明の競走</span>').raceName,'');
});
