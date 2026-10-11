import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {buildJraPdfOfficialCardEvidence as build} from '../src/research/jra-pdf-official-card-evidence-v1.mjs';
import {resolveJraPdfEvidence as resolve} from '../src/research/jra-pdf-identity-resolution-v1.mjs';
const original=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const table=objects=>{const h=[...new Set(objects.flatMap(Object.keys))];return [h,...objects.map(o=>h.map(k=>o[k]??null))];};
function fixture(){
 const card=parseJraRaceCard(original),r=card.race,sourceRaceId=`${r.date.replaceAll('-','')}_${r.racecourse}_${r.raceNo}`;
 return {html:original,sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=fixture',capturedAt:`${r.date}T00:00:00Z`,nowAt:`${r.date}T00:01:00Z`,maxAgeMs:120000,
 pdfInput:{sourceRaceId,canonicalRaceId:'synthetic-JRA-race',sourceSpreadsheetId:'synthetic-pdf',manifestTable:table([{Race_ID:sourceRaceId,'開催日':r.date,'競馬場':r.racecourse,'レース番号':r.raceNo,'芝ダ障':r.surface,'距離':r.distance,'出走頭数':card.horses.length}]),
 runnerTable:table(card.horses.map(h=>({Race_ID:sourceRaceId,'開催日':r.date,'競馬場':r.racecourse,R:r.raceNo,'馬番':h.horseNo,'馬名':h.horseName,Horse_Key:`TEMP|${h.horseName}`,'取消状態':'UNKNOWN'}))),
 historyTable:table(card.horses.flatMap(h=>[1,2,3,4,5].map(n=>({Race_ID:sourceRaceId,Horse_Key:`TEMP|${h.horseName}`,'馬番':h.horseNo,'馬名':h.horseName,Run_No:n,'過去走日付':'UNKNOWN','競馬場':'UNKNOWN','芝ダ':'UNKNOWN','距離':'UNKNOWN','着順':'UNKNOWN','走破TIME':'UNKNOWN'}))))}};
}
test('observed official horse link format joins exact PDF field without mutating it',()=>{
 const f=fixture(),before=structuredClone(f),out=build(f);assert.deepEqual(f,before);assert.equal(out.matchedHorseIds,3);assert.equal(out.formalKpiEligible,false);assert.equal(out.source.preOffDeclared,true);assert.equal(out.resolutionInput.pdfInput.statuses.length,3);
 assert.equal(out.resolutionInput.horseMapTable[1][3],'JRA_OFFICIAL|2024103651');assert.equal(resolve(out.resolutionInput).joinedCount,3);
});
test('post-off capture joins identities but never restores historical starter state',()=>{
 const f=fixture(),d=parseJraRaceCard(f.html).race.date;f.capturedAt=`${d}T12:00:00Z`;f.nowAt=`${d}T12:01:00Z`;const out=build(f);assert.equal(out.matchedHorseIds,3);assert.equal(out.resolutionInput.pdfInput.statuses.length,0);assert.equal(out.source.preOffDeclared,false);assert.equal(out.audit.filter(a=>a.reason==='OFFICIAL_STARTER_STATE_NOT_PRE_OFF').length,3);
});
test('an observation reaching post time is not a pre-off status proof',()=>{
 const f=fixture(),r=parseJraRaceCard(f.html).race;f.capturedAt=`${r.date}T${r.postTime}:00+09:00`;f.nowAt=f.capturedAt;assert.equal(build(f).resolutionInput.pdfInput.statuses.length,0);
});
test('stale and reversed clocks reject rather than reusing saved status',()=>{
 const f=fixture();f.maxAgeMs=1;assert.throws(()=>build(f),/CAPTURE_STALE/);const g=fixture();g.nowAt=g.capturedAt.replace('00:00:00','00:00:00');g.capturedAt=g.nowAt.replace('00:00:00','00:01:00');assert.throws(()=>build(g),/CLOCK_REQUIRED/);
});
test('source URL must be the JRA official card origin and path',()=>{
 for(const sourceUrl of ['https://evil.example/JRADB/accessD.html','https://www.jra.go.jp.evil.example/JRADB/accessD.html','https://www.jra.go.jp/JRADB/accessU.html','https://user@www.jra.go.jp/JRADB/accessD.html'])assert.throws(()=>build({...fixture(),sourceUrl}),/URL_REQUIRED/);
});
test('foreign horse links cannot become official identity',()=>{
 const f=fixture();f.html=f.html.replace('/JRADB/accessU.html?CNAME=pw01dud002024103651/A4','https://evil.example/JRADB/accessU.html?CNAME=pw01dud002024103651/A4');assert.equal(build(f).matchedHorseIds,2);
});
test('missing or ambiguous horse ID holds one runner rather than guessing',()=>{
 const f=fixture();f.html=f.html.replace('pw01dud002024103651/A4','unknown');assert.equal(build(f).matchedHorseIds,2);
 const g=fixture();g.html=g.html.replace('>マイネルシードル</a>','>マイネルシードル</a><a href="/JRADB/accessU.html?CNAME=pw01dud002024103651/A4">マイネルシードル</a>');assert.throws(()=>build(g),/RUNNER_CONFLICT/);
});
test('official ID reuse is rejected even when runner names match',()=>{
 const f=fixture();f.html=f.html.replace('pw01dud002024100023/67','pw01dud002024103651/A4');assert.throws(()=>build(f),/ID_REUSED/);
});
test('race context, runner names and field mismatch reject',()=>{
 const f=fixture();f.pdfInput.runnerTable[1][f.pdfInput.runnerTable[0].indexOf('馬名')]='other';assert.throws(()=>build(f),/IDENTITY_CONFLICT|RUNNER_CONFLICT/);
 const g=fixture();g.pdfInput.manifestTable[1][g.pdfInput.manifestTable[0].indexOf('距離')]=2800;assert.throws(()=>build(g),/CONTEXT_CONFLICT/);
});
test('known exact history match resolves a full year independent of PDF slot number',()=>{
 const f=fixture();
 const pastCell='<td class="past p1"><p class="date">2026年8月2日</p><p class="rc">新潟</p><p class="dist">芝1600</p><p class="place">4着</p><p class="time">1:42.0</p></td>';
 f.html=f.html.replace('<td class="past p1"></td>',pastCell);
 const past=parseJraRaceCard(f.html).horses[0].pastRuns[0];assert.ok(past?.date&&past.time);
 const h=f.pdfInput.historyTable[0],selected=f.pdfInput.historyTable[1];
 for(const [k,v] of Object.entries({'過去走日付':past.date.slice(5).replace('-','/'),'競馬場':past.racecourse,'芝ダ':past.surface,'距離':String(past.distance),'着順':String(past.finish),'走破TIME':past.time}))selected[h.indexOf(k)]=v;
 const out=build(f);assert.equal(out.matchedHistoryDates,1);assert.equal(out.resolutionInput.historyDateEvidence[0].fullDate,past.date);
 selected[h.indexOf('走破TIME')]='9:99.9';assert.equal(build(f).matchedHistoryDates,0);
});
test('UNKNOWN slots and market columns do not generate date proofs or signals',()=>{
 const out=build(fixture());assert.equal(out.matchedHistoryDates,0);assert.equal(JSON.stringify(out.resolutionInput).includes('163.3'),false);assert.equal(out.freezeMutation,'NONE');assert.equal(out.adopted,false);
});
test('oversize HTML and malformed PDF exports reject before generating evidence',()=>{
 assert.throws(()=>build({...fixture(),html:'x'.repeat(1000001)}),/HTML_REQUIRED/);const f=fixture();f.pdfInput.historyTable.pop();assert.throws(()=>build(f),/HISTORY_SLOT/);
});
