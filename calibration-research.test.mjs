import test from 'node:test';
import assert from 'node:assert/strict';
import '../calibration-research.js';

const api=globalThis.CHASS_CALIBRATION_RESEARCH;
function record({org='JRA',index=0,invalidTime=false,missing=false}={}){
 const day=String(index%28+1).padStart(2,'0'),prediction=`2026-01-${day}T01:00:00.000Z`,result=invalidTime?'2025-12-01T01:00:00.000Z':`2026-01-${day}T05:00:00.000Z`;
 const track=org==='JRA'?'東京':'大井',raceType=org;
 const horses=[1,2,3,4].map(no=>({horseNo:no,horseName:`馬${no}`,win:missing&&no===4?null:[40,30,20,10][no-1],place:[80,70,60,40][no-1],predictedTime:missing&&no===4?null:`1:${String(58+no).padStart(2,'0')}.0`,runningStyle:['逃げ','先行','差し','追込'][no-1],weightCarried:53+no,pastRuns:[{distance:no===1?1800:2000}]}));
 return {race:{raceType,track,raceDate:`2026-01-${day}`,distance:2000,surface:'芝',trackCondition:'良',weather:'晴'},predictionSnapshot:{raceType,createdAt:prediction,race:{raceType,track,distance:2000,surface:'芝',trackCondition:'良',weather:'晴'},horses},resultSnapshot:{fetchedAt:result,finishOrder:[1,2,3,4],actualTimes:{1:'1:59.5',2:'2:00.0',3:'2:01.5',4:'2:03.0'}}};
}

test('JRAとNARを独立集計する',()=>{const report=api.buildCalibrationResearch([record({org:'JRA'}),record({org:'NAR'})]);assert.equal(report.organizations.JRA.raceCount,1);assert.equal(report.organizations.NAR.raceCount,1)});
test('結果時刻が予想以前のレースを除外する',()=>{const report=api.buildCalibrationResearch([record(),record({index:1,invalidTime:true})]);assert.equal(report.organizations.JRA.raceCount,1);assert.equal(report.organizations.JRA.excludedTemporalCount,1)});
test('Brier・Log Loss・ECEを有限値で返す',()=>{const metric=api.buildCalibrationResearch([record()]).organizations.JRA.win;assert.equal(metric.sampleCount,4);assert.ok(Number.isFinite(metric.brier));assert.ok(Number.isFinite(metric.logLoss));assert.ok(Number.isFinite(metric.ece))});
test('TIMEのMAE・平均・中央値・最大誤差を返す',()=>{const metric=api.buildCalibrationResearch([record()]).organizations.JRA.time;assert.equal(metric.sampleCount,4);assert.equal(metric.mae,0.5);assert.equal(metric.meanError,0.5);assert.equal(metric.medianError,0.5);assert.equal(metric.maxAbsoluteError,1)});
test('TIMEを競馬場・距離・馬場・脚質・斤量・距離変化別に分解する',()=>{const by=api.buildCalibrationResearch([record()]).organizations.JRA.time.byCondition;for(const key of ['track','distance','surface','going','weather','runningStyle','weightBand','distanceChange'])assert.ok(Array.isArray(by[key])&&by[key].length>0,key)});
test('50R未満は較正候補を評価せず本番採用しない',()=>{const candidate=api.buildCalibrationResearch(Array.from({length:49},(_,i)=>record({index:i}))).organizations.JRA.calibrationCandidates.win;assert.equal(candidate.eligible,false);assert.equal(candidate.adopted,false);assert.equal(candidate.officialPredictionDelta,0)});
test('50R以上は時間順Walk-Forwardで3候補をShadow比較する',()=>{const candidate=api.buildCalibrationResearch(Array.from({length:50},(_,i)=>record({index:i}))).organizations.JRA.calibrationCandidates.top3;assert.equal(candidate.eligible,true);assert.equal(candidate.adopted,false);assert.equal(candidate.candidates.length,3);assert.ok(candidate.trainSampleCount>candidate.testSampleCount);assert.equal(candidate.officialPredictionDelta,0)});
test('欠損値を0として補完せず対象から除外する',()=>{const data=api.buildCalibrationResearch([record({missing:true})]).organizations.JRA;assert.equal(data.win.sampleCount,3);assert.equal(data.time.sampleCount,3)});
test('研究結果全体はShadowかつ本番モデル変更なし',()=>{const report=api.buildCalibrationResearch([record()]);assert.equal(report.mode,'shadow');assert.equal(report.adopted,false);assert.equal(report.officialModelChanged,false)});
