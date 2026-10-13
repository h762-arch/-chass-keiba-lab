import test from 'node:test';import assert from 'node:assert/strict';
import {extractNarOfficialHistoryLinks as parse} from '../src/prediction/nar-official-history-links.mjs';
import {assertMarketIndependentData} from '../src/prediction/precomputed-snapshot.mjs';
const options={sourceUrl:'https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTable?k_raceDate=2026%2F10%2F14&k_babaCode=21&k_raceNo=1',date:'2026-10-14',track:'川崎',code:'21',raceNo:1,observedAt:'2026-10-14T00:00:00Z',expectedHorses:[{horseNo:'1',horseName:'試験A'},{horseNo:2,horseName:'試験B'}]};
const row=(no,name,id,date='2026%2F09%2F30')=>`<tr class="tBorder"><td class="horseNum">${no}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=${id}">${name}</a></td><td><a href="../TodayRaceInfo/RaceMarkTable?k_raceDate=${date}&amp;k_babaCode=21&amp;k_raceNo=3">過去走</a></td></tr>`;
const html=()=>'<h4>2026年10月14日（水） 川　崎　第1競走 15:00発走</h4>'+row(1,'試験A','30012403217')+row(2,'試験B','30034404517');
test('official full-card links resolve provider horse IDs and full past dates without reading results',async()=>{const r=await parse(html(),options);assert.equal(r.body.rows.length,2);assert.equal(r.body.rows[0].providerHorseKey,'NAR_LINEAGE:30012403217');assert.equal(r.body.rows[0].pastRaceReferences[0].date,'2026-09-30');assert.equal(r.body.rows[0].pastRaceReferences[0].raceId,'20260930-NAR-21-03');assert.equal(r.body.resultPageFetchCount,0);assert.equal(r.body.historyFactJoinStatus,'NOT_PERFORMED');assert.doesNotThrow(()=>assertMarketIndependentData(r));assert.deepEqual(await parse(html(),options),r);});
test('current race identity and acquisition cutoff are strict even with misleading navigation text',async()=>{
 await assert.rejects(parse(html().replace('第1競走','第2競走')+'川崎第1競走',options),/CARD_IDENTITY/);
 await assert.rejects(parse(html(),{...options,date:'2026-10-15'}),/CARD_IDENTITY/);
 await assert.rejects(parse(html(),{...options,observedAt:'2026-10-14T06:00:00Z'}),/PRE_RACE_TIME/);
});
test('number/name mismatches, missing runner and duplicate provider ID cannot join',async()=>{
 for(const s of [html().replace('試験A','別馬'),html().replace('30034404517','30012403217'),html().replace(row(2,'試験B','30034404517'),'')])await assert.rejects(parse(s,options),/RUNNER_IDENTITY|RUNNER_COVERAGE/);
});
test('foreign hosts, paths and duplicate URL parameters fail closed',async()=>{
 await assert.rejects(parse(html().replace('../DataRoom/HorseMarkInfo','https://evil.example/KeibaWeb/DataRoom/HorseMarkInfo'),options),/LINK_SOURCE/);
 await assert.rejects(parse(html().replace('k_lineageLoginCode=30012403217','k_lineageLoginCode=30012403217&k_lineageLoginCode=30034404517'),options),/LINK_PARAMETER/);
 await assert.rejects(parse(html(),{...options,sourceUrl:options.sourceUrl+'&k_raceNo=2'}),/LINK_PARAMETER/);
});
test('future/same-day episodes and impossible dates are never converted into past history',async()=>{
 for(const date of ['2026%2F10%2F14','2026%2F10%2F15','2026%2F02%2F30'])await assert.rejects(parse(html().replace('2026%2F09%2F30',date),options),/PAST_RACE_IDENTITY/);
});
test('zero past links is unresolved history depth, not a fabricated no-history conclusion',async()=>{
 const s=html().replaceAll(/<td><a href="\.\.\/TodayRaceInfo\/RaceMarkTable[^<]+<\/a><\/td>/g,'');const r=await parse(s,options);assert.ok(r.body.rows.every(h=>h.pastRaceReferences.length===0));assert.equal(r.body.historyFactJoinStatus,'NOT_PERFORMED');
});
test('oversize content, unsupported source and excess or duplicate episode links reject',async()=>{
 await assert.rejects(parse('x'.repeat(1000001),options),/INPUT_INVALID/);
 await assert.rejects(parse(html(),{...options,sourceUrl:options.sourceUrl.replace('DebaTable','DebaTableSmall')}),/LINK_SOURCE/);
 const a='<a href="../TodayRaceInfo/RaceMarkTable?k_raceDate=2026%2F09%2F30&k_babaCode=21&k_raceNo=3">重複</a>';await assert.rejects(parse(html().replace('</tr>',a+'</tr>'),options),/PAST_LINK_AMBIGUOUS/);
});
