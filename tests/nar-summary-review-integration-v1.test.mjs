import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {createNarRetrospectiveEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {attachNarSummaryEvidence} from '../src/research/nar-summary-evidence-bridge-v1.mjs';
import {auditNarSummaryMetrics} from '../src/research/nar-summary-metric-audit-v1.mjs';
import {reviewNarPredictionEvidence} from '../src/research/nar-prediction-review-v1.mjs';
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(row=>keys.map(k=>row[k]??null))];};
async function fixture(change=()=>{}){
  const raceId='20261009-NAR-OI-1',runId='phase87-test',modelVersion='unchanged';
  const snapshot=await createNarRetrospectiveEvidenceSnapshot({raceId,runId,modelVersion,cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
    source:{spreadsheetId:'synthetic',revision:'parent',availableAt:'2026-10-09T01:30:00Z',exportedAt:'2026-10-09T02:00:00Z'},
    replayEvidence:{basis:'POST_RACE_IDENTITY_ONLY',observedAt:'2026-10-09T01:40:00Z',refs:['https://example.com/synthetic']},
    races:table([{CanonicalRace_ID:raceId,Org:'NAR',RaceDate:'2026-10-09',Course:'大井',Surface:'ダ',DistanceM:1600,TrackCondition_EARLY:'UNKNOWN'}]),
    runners:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`NAR_ARCHIVE|${100+no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:56}))),
    history:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`NAR_ARCHIVE|${100+no}`,Run_No:1,PastRaceDate:'2026-09-01',PastCourse:'大井',Surface:'ダ',DistanceM:1600,Going:'良',Finish:no,FieldSize:10,Margin:0.1,RunTime:'1:42.0',Last3F:38,Class:'B3二'}))),
    identityMap:[1,2].map(no=>({raceId,horseKey:`NAR_ARCHIVE|${100+no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:'synthetic'}))});
  const rows=[1,2].map(no=>({'レースID':'source-race','対象開催日':'2026-10-09','主催':'NAR','競馬場':'大井','馬番':no,'馬ID':String(100+no),'馬名':`馬${no}`,'保存走数':1,
    CurrentLevel:'source judgment',PeakAbility:'source peak',RecentFormShape:'上昇',ConditionTrigger:'距離短縮○','先行率':0,'4角平均位置':3,
    '近10走ベストTIME':'1:12.0（1200m）','近10走ベスト上がり':'38（ダ）','トレンド根拠':'source note','分析メモ':'research','更新日時':'2026-10-09 09:00 JST',
    '直近3走平均着順':no,'直近5走平均着順':no,'近10走平均着順':no,'直近3走平均着差':0.1,'近10走平均着差':0.1,
    '近10走勝率':no===1?100:0,'近10走複勝率':100,'同距離走数':1,'同距離勝率':no===1?100:0,'同距離複勝率':100,
    '同場走数':1,'同場勝率':no===1?100:0,'同場複勝率':100}));change(rows);
  const augmented=await attachNarSummaryEvidence(snapshot,{table:table(rows),source:{spreadsheetId:'synthetic',sheet:'NAR_近10走サマリー',revision:'capture',firstDataRow:2,capturedAt:'2026-10-09T03:00:00Z'},
    raceAssociation:{sourceRaceId:'source-race',canonicalRaceId:raceId,status:'PASS',evidenceRef:'synthetic'},
    identities:[1,2].map(no=>({horseNo:no,sourceHorseId:String(100+no),sourceName:`馬${no}`,horseKey:`NAR_ARCHIVE|${100+no}`,snapshotName:`馬${no}`,status:'PASS',evidenceRef:'synthetic'}))});
  const baseline={raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map(h=>({...structuredClone(h),pastRuns:[],timeIndex:80,courseIndex:80}))}};
  return {snapshot,augmented,baseline};
}
const run=f=>reviewNarPredictionEvidence(f.augmented,f.baseline);
async function alter(f,change){f.augmented=structuredClone(f.augmented);change(f.augmented);const {snapshotHash,...p}=f.augmented;f.augmented.snapshotHash=await stableHash(p);return f;}
test('review computes canonical audit itself and binds every horse to the correct metrics',async()=>{
  const f=await fixture(),out=await run(f),audit=await auditNarSummaryMetrics(f.augmented);
  assert.deepEqual(out.summaryMetricAudit,audit);assert.equal(out.review.summaryMetricAuditHash,audit.auditHash);
  for(const r of out.review.rows){assert.equal(r.summaryReconciliation.auditHash,audit.auditHash);assert.equal(r.summaryReconciliation.snapshotHash,f.augmented.snapshotHash);assert.equal(r.summaryReconciliation.metrics.find(m=>m.field==='近10走平均着順').sourceNumeric,r.horseNo);}
});
test('arithmetic matches remain inspection material and never claim probability or TIME use',async()=>{
  const out=await run(await fixture());for(const r of out.review.rows){assert.equal(r.summaryReconciliation.arithmeticMatches.length,14);assert.equal(r.summaryReconciliation.modelUse,'NOT_VALIDATED');
    const f=r.features.find(f=>f.family==='FORM_RESEARCH');assert.equal(f.observedProbabilityOrMarkEffect,false);assert.equal(f.observedTimeEffect,false);assert.equal(f.status,'PRESENT_NO_OBSERVED_MODEL_CHANGE');}
});
test('numeric mismatch becomes a field-specific gap with original refs',async()=>{
  const out=await run(await fixture(rows=>rows[0]['近10走勝率']=20)),g=out.review.rows[0].gaps.find(g=>g.code==='SUMMARY_NUMERIC_MISMATCH');
  assert.equal(g.field,'近10走勝率');assert.equal(g.refs.summary[0].row,2);assert.equal(g.refs.history[0].historyIndex,0);
});
test('missing raw result stays incomplete in the integrated record',async()=>{
  const f=await alter(await fixture(),s=>s.data.horses[0].pastRuns[0].finish=null),out=await run(f);
  assert.ok(out.review.rows[0].gaps.some(g=>g.field==='近10走勝率'&&g.code==='SUMMARY_RAW_INCOMPLETE'));
});
test('zero sample rate is not promoted as a known zero probability',async()=>{
  const f=await alter(await fixture(),s=>s.data.horses[0].pastRuns[0].distance=1800),out=await run(f);
  const m=out.review.rows[0].summaryReconciliation.metrics.find(m=>m.field==='同距離勝率');assert.equal(m.recomputed,null);assert.equal(m.status,'NO_RAW_SAMPLE');
  assert.ok(out.review.rows[0].gaps.some(g=>g.field==='同距離勝率'&&g.code==='SUMMARY_NO_RAW_SAMPLE'));
});
test('unsupported leading/corner/best-clock definitions stay explicit per horse',async()=>{
  const out=await run(await fixture());assert.ok(out.review.rows.every(r=>r.gaps.filter(g=>g.code==='SUMMARY_DEFINITION_OR_CONDITION_UNVERIFIED').length===4));
});
test('missing source numbers produce source gaps, not fabricated recalculated replacements',async()=>{
  const out=await run(await fixture(rows=>rows[0]['近10走勝率']=null));assert.ok(out.review.rows[0].gaps.some(g=>g.field==='近10走勝率'&&g.code==='SUMMARY_SOURCE_MISSING_OR_NONNUMERIC'));
});
test('legacy snapshot without supplement retains its original review structure',async()=>{
  const f=await fixture(),out=await reviewNarPredictionEvidence(f.snapshot,f.baseline);
  assert.equal('summaryMetricAudit' in out,false);assert.equal('summaryMetricAuditHash' in out.review,false);assert.ok(out.review.rows.every(r=>!('summaryReconciliation' in r)));
});
test('caller-supplied audit cannot hide a mismatch',async()=>{
  const f=await fixture(rows=>rows[0]['近10走勝率']=20),out=await reviewNarPredictionEvidence(f.augmented,f.baseline,{summaryMetricAudit:{allPass:true}});
  assert.equal(out.summaryMetricAudit.coverage.statusCounts.MISMATCH_UNDER_AUDIT_POLICY,1);
});
test('canonical numeric outputs, false authority and input immutability are preserved',async()=>{
  const f=await fixture(),saved=structuredClone(f),base=await reviewNarPredictionEvidence(f.snapshot,f.baseline),out=await run(f);
  assert.deepEqual(f,saved);assert.deepEqual(out.comparison.after,base.comparison.after);
  assert.equal(out.review.reviewDecision,'HOLD');assert.equal(out.review.earlyEligible,false);assert.equal(out.review.formalKpiEligible,false);assert.equal(out.review.productionActivationReady,false);
  assert.ok(Object.isFrozen(out.review.rows[0].summaryReconciliation.metrics));
  const {reviewHash,...payload}=out.review;assert.equal(reviewHash,await stableHash(payload));
});
