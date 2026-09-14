import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractHorseRefsFromRaceHtml,parseNarHorseMarkInfo,summarizeRecentHistory,getNarRaceHistory} from '../src/nar/nar-recent-history.mjs';

test('extractHorseRefsFromRaceHtml extracts lineage code and name',()=>{
  const html='<a href="/KeibaWeb/DataRoom/HorseMarkInfo?k_lineageLoginCode=30007403486">サトノエンパイア</a>';
  assert.deepEqual(extractHorseRefsFromRaceHtml(html),[{lineageCode:'30007403486',horseName:'サトノエンパイア',url:'https://www.keiba.go.jp/KeibaWeb/DataRoom/HorseMarkInfo?k_lineageLoginCode=30007403486'}]);
});

test('extractHorseRefsFromRaceHtml accepts non-HorseMarkInfo links carrying lineage code',()=>{
  const html='<a href="/KeibaWeb/TodayRaceInfo/SomeHorsePage?k_lineageLoginCode=30007403486&foo=1">サトノエンパイア</a>';
  const refs=extractHorseRefsFromRaceHtml(html);
  assert.equal(refs.length,1);
  assert.equal(refs[0].lineageCode,'30007403486');
  assert.equal(refs[0].horseName,'サトノエンパイア');
});

test('getNarRaceHistory resolves lineage IDs from RaceMarkTable when DebaTableSmall has none',async()=>{
  const deba='<html><body><div>ダート1600ｍ</div><span>サトノエンパイア</span></body></html>';
  const mark='<a href="/KeibaWeb/TodayRaceInfo/AnyHorseLink?k_lineageLoginCode=30007403486">サトノエンパイア</a>';
  const horse=`<h4>サトノエンパイア</h4><table><tr><td>2026/09/01</td><td>大井</td><td>1</td><td>テスト</td><td>C1</td><td>1600</td><td>晴</td><td>良</td><td>ナ</td><td>12</td><td>1</td><td>1</td><td>2</td><td>1</td><td>1:42.0</td><td>0.0</td><td>38.0</td><td>480</td><td>騎手</td><td>56.0</td><td>調教師</td><td>1,000,000</td><td>相手</td></tr></table>`;
  const fetcher=async url=>{
    const u=String(url);
    if(u.includes('/DebaTableSmall?'))return new Response(deba,{status:200});
    if(u.includes('/RaceMarkTable?'))return new Response(mark,{status:200});
    if(u.includes('/DataRoom/HorseMarkInfo?'))return new Response(horse,{status:200});
    return new Response('not found',{status:404});
  };
  const payload=await getNarRaceHistory({
    code:'20',date:'2026/09/14',race:'1',fetcher,
    raceCardParser:()=>[{horseNo:1,horseName:'サトノエンパイア'}]
  });
  assert.equal(payload.resolvedHorseCount,1);
  assert.equal(payload.unresolvedHorseCount,0);
  assert.equal(payload.horses[0].lineageCode,'30007403486');
});

test('parseNarHorseMarkInfo parses official HorseMarkInfo row layout',()=>{
  const html=`<h4>サトノエンパイア</h4><table><tr><td>2026/07/21</td><td>大井</td><td>12</td><td>三宅坂賞Ｂ３二選抜特別</td><td>Ｂ３二</td><td>1800</td><td>晴</td><td>良</td><td>ナ</td><td>16</td><td>2</td><td>3</td><td>6</td><td>5</td><td>1:55.4</td><td>1.5</td><td>39.1</td><td>439</td><td>和田譲 (大井)</td><td>56.0</td><td>赤嶺亮</td><td>400,000</td><td>ナンパセン</td></tr></table>`;
  const x=parseNarHorseMarkInfo(html,{limit:10,lineageCode:'30007403486'});
  assert.equal(x.runs.length,1);assert.equal(x.runs[0].distance,1800);assert.equal(x.runs[0].finish,5);assert.equal(x.runs[0].margin,1.5);assert.equal(x.runs[0].last3f,39.1);assert.equal(x.runs[0].weightCarried,56);
});

test('summarizeRecentHistory detects rising current form and same-distance trigger',()=>{
  const runs=[
    {finish:2,margin:.2,distance:1600,track:'大井',date:'2026-09-01',time:'1:43.0',timeSec:103,last3f:39},
    {finish:3,margin:.4,distance:1600,track:'大井',date:'2026-08-10',time:'1:43.5',timeSec:103.5,last3f:39.4},
    {finish:3,margin:.8,distance:1600,track:'大井',date:'2026-07-01',time:'1:44.0',timeSec:104,last3f:39.5},
    {finish:8,margin:2.0,distance:1400,track:'大井',date:'2026-06-01',time:'1:29.0',timeSec:89,last3f:40},
    {finish:9,margin:2.2,distance:1400,track:'大井',date:'2026-05-01',time:'1:30.0',timeSec:90,last3f:40.5},
    {finish:7,margin:1.8,distance:1400,track:'大井',date:'2026-04-01',time:'1:29.5',timeSec:89.5,last3f:40.2}
  ];
  const s=summarizeRecentHistory(runs,{targetDistance:1600,targetTrack:'大井'});
  assert.equal(s.recentFormShape,'rising');assert.equal(s.currentLevel,'high');assert.equal(s.sameDistanceTop3Rate,100);assert.ok(s.conditionTriggers.includes('same_distance_top3:3/3'));
});

test('wrapper delegates legacy worker and only intercepts recent-history routes',async()=>{
  const entry=await readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8');
  assert.match(entry,/import baseWorker,\{parseRaceCard\} from '\.\/worker\.js'/);
  assert.match(entry,/\/api\/nar\/history\/horse/);
  assert.match(entry,/\/api\/nar\/history\/race/);
  assert.match(entry,/return baseWorker\.fetch\(request,env,ctx\)/);
  assert.match(entry,/baseWorker\.scheduled/);
});

test('migration 0008 is additive only',async()=>{
  const sql=await readFile(new URL('../migrations/0008_nar_recent_history_cache.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS nar_horse_history_cache/i);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS nar_race_history_manifest/i);
  assert.doesNotMatch(sql,/\b(?:DROP|DELETE|ALTER)\b/i);
});
