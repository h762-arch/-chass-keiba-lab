import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('..',import.meta.url);
const context=vm.createContext({console,Date,Math,JSON,Number,String,Array,Object,Map,Set,RegExp,Intl});
context.globalThis=context;
for(const file of ['jra-normalizer.js','jra-model.js','jra-adapter.js'])vm.runInContext(fs.readFileSync(new URL(file,root),'utf8'),context,{filename:file});
const N=context.CHASS_JRA_NORMALIZER,M=context.CHASS_JRA_MODEL,A=context.CHASS_JRA_ADAPTER;

function fixture({market=true,missingTimeHorse=null}={}){
 const courses=['東京','中山','新潟','阪神','京都'];
 const horses=Array.from({length:14},(_,i)=>({
  horseNo:i+1,frameNo:Math.ceil((i+1)/2),horseName:`テストホース${i+1}`,sexAge:`牡${3+i%4}`,
  weightCarried:55+(i%4),jockey:`騎手${i+1}`,trainer:`厩舎${i+1}`,
  odds:market?Number((2.4+i*2.1).toFixed(1)):null,popularity:market?i+1:null,
  bodyWeight:i===8?null:450+i*3,bodyWeightChange:i===8?null:(i%5)-2,
  pastRuns:Array.from({length:5},(_,j)=>({
   date:`2026-0${8-j}-10`,racecourse:courses[(i+j)%courses.length],surface:'芝',distance:[1600,1800,2000,1800,1600][j],trackCondition:j===2?'稍重':'良',raceClass:'2勝クラス',
   finish:Math.min(14,1+(i+j*2)%12),fieldSize:14,time:i+1===missingTimeHorse?'':`${1+j}:${34+(i%6)+j}.2`,
   margin:Number(((i+j)%6*.2).toFixed(1)),cornerPositions:[1+(i*2+j)%13,1+(i*2+j+1)%13],last3F:33.4+(i%7)*.35+j*.1,weightCarried:55+(i%4),bodyWeight:450+i*3
  }))
 }));
 return {race:{date:'2026-09-01',racecourse:'東京',raceNo:8,raceName:'JRA Phase 1 Test',surface:'芝',distance:1800,courseType:'外回り',trackCondition:'良',weather:'晴',pace:'標準'},horses};
}

test('JRA normalizer supports the ten courses and preserves null',()=>{
 assert.equal(N.JRA_COURSES.length,10);
 const data=N.normalizeJraData(fixture());
 assert.equal(data.validation.ok,true);
 assert.equal(data.horses.length,14);
 assert.equal(data.horses[8].bodyWeight,null);
 assert.equal(data.horses[0].pastRuns.length,5);
 assert.equal(data.horses[0].pastRuns[0].laps.fiveF,null);
});

test('JRA model calculates all horses and normalizes win probability',()=>{
 const result=A.run(N.normalizeJraData(fixture()));
 assert.equal(result.state.race.raceType,'JRA');
 assert.equal(result.state.horses.length,14);
 assert.deepEqual(Array.from(result.state.horses,h=>h.horseNo),Array.from({length:14},(_,i)=>i+1));
 assert.ok(Math.abs(result.prediction.quality.winProbabilityTotal-100)<0.02);
 assert.ok(Math.abs(result.prediction.quality.placeProbabilityTotal-300)<0.05);
 assert.equal(result.prediction.quality.probabilityInvariant,true);
 for(const h of result.state.horses){
  assert.ok(h.win>=0&&h.win<100);
  assert.ok(h.place>=h.win,`${h.horseNo}: P(TOP3) must be >= P(win)`);
  assert.ok(h.second>=0&&h.second<=100);
  for(const key of ['speed','recent','distance','course','finish','pace','total'])assert.ok(Number.isFinite(h.jraIndices[key]),`${h.horseNo}:${key}`);
 }
});

test('rank simulation is deterministic and distance uncertainty widens unknown evidence',()=>{
 const data=fixture(),first=A.run(N.normalizeJraData(data)).prediction,second=A.run(N.normalizeJraData(data)).prediction;
 assert.deepEqual(Array.from(first.horses,h=>[h.win,h.second,h.place]),Array.from(second.horses,h=>[h.win,h.second,h.place]));
 const unknown=fixture();unknown.race.distance=2600;
 const result=A.run(N.normalizeJraData(unknown)).prediction;
 assert.ok(result.horses.every(h=>h.probabilityUncertainty>=.8));
 assert.ok(Math.max(...result.horses.map(h=>h.win))<50,'unknown distance must broaden the field probability distribution');
 assert.ok(result.race.predictionConfidenceReasons.includes('距離実績の不確実性'));
});

test('market heat and ability danger are separate signals',()=>{
 const result=A.run(N.normalizeJraData(fixture())).prediction;
 const favorites=result.horses.filter(h=>h.popularity<=3);
 assert.ok(favorites.every(h=>Array.isArray(h.abilityRisk)&&Array.isArray(h.marketHeat)));
 for(const horse of favorites)if(!horse.abilityRisk.length&&horse.marketHeat.length)assert.equal(horse.warningMark,'市場過熱');
});

test('market fields never alter ability or AI probabilities',()=>{
 const withMarket=A.run(N.normalizeJraData(fixture())).prediction;
 const noMarket=A.run(N.normalizeJraData(fixture({market:false}))).prediction;
 for(let i=0;i<withMarket.horses.length;i++){
  assert.deepEqual(withMarket.horses[i].jraIndices,noMarket.horses[i].jraIndices);
  assert.equal(withMarket.horses[i].win,noMarket.horses[i].win);
  assert.equal(withMarket.horses[i].place,noMarket.horses[i].place);
  assert.equal(noMarket.horses[i].ev,null);
  assert.equal(noMarket.horses[i].valueMark,'');
 }
});

test('missing TIME remains missing rather than zero and does not stop race',()=>{
 const result=A.run(N.normalizeJraData(fixture({missingTimeHorse:14}))).prediction;
 const horse=result.horses.find(h=>h.horseNo===14);
 assert.equal(horse.predictedTime,'');
 assert.equal(horse.predictedTimeScenarios,null);
 assert.equal(result.horses.length,14);
});

test('CSV rows are grouped into one horse with multiple past runs',()=>{
 const header='race_date,racecourse,race_no,race_name,surface,distance,course_type,track_condition,weather,horse_no,frame_no,horse_name,sex_age,weight_carried,jockey,trainer,odds,popularity,body_weight,body_weight_change,past_date,past_racecourse,past_surface,past_distance,past_track_condition,past_class,past_finish,past_field_size,past_time,past_margin,past_corners,past_last3f,past_weight_carried,past_body_weight';
 const row1='2026-09-01,東京,8,CSV Test,芝,1800,外回り,良,晴,1,1,CSVホース,牡4,57,騎手,厩舎,8.2,5,480,2,2026-08-01,新潟,芝,1800,良,2勝,2,14,1:46.2,0.1,3-3,33.8,57,478';
 const row2=row1.replace('2026-08-01','2026-07-01').replace('1:46.2','1:47.0');
 const data=N.normalizeJraCsv(`${header}\n${row1}\n${row2}`);
 assert.equal(data.horses.length,1);
 assert.equal(data.horses[0].pastRuns.length,2);
 assert.equal(data.horses[0].pastRuns[0].timeSeconds,106.2);
});

test('adapter never references a NAR endpoint',()=>{
 for(const file of ['jra-normalizer.js','jra-model.js','jra-adapter.js']){
  const source=fs.readFileSync(new URL(file,root),'utf8');
  assert.doesNotMatch(source,/\/api\/nar\//);
 }
});

test('app keeps JRA and NAR engines separated',()=>{
 const source=fs.readFileSync(new URL('app.js',root),'utf8');
 assert.match(source,/raceTypeOf\(state\)==='JRA'/);
 assert.match(source,/CHASS_JRA_ADAPTER\.run/);
 assert.match(source,/registerResultWaiting\(state,rid\)/);
 assert.doesNotMatch(source,/commitJraNormalized[^\n]+registerResultWaiting/);
});

test('JRA result provenance, condition delta and automatic validation remain explicit',()=>{
 const source=fs.readFileSync(new URL('app.js',root),'utf8');
 assert.match(source,/resultSource:source==='手動修正保存'\?'manual':'official'/);
 assert.match(source,/predictionTrackCondition/);
 assert.match(source,/actualTrackCondition/);
 assert.match(source,/buildJraValidationMetrics/);
 assert.match(source,/結果データ：🟠 手動入力/);
 assert.match(source,/単勝オッズ/);
 assert.match(source,/人気順/);
});
