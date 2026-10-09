import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {auditNarSummaryMetrics} from '../src/research/nar-summary-metric-audit-v1.mjs';
async function fixture(change=()=>{}){
  const runs=[{date:'2026-09-02',racecourse:'大井',surface:'ダ',distance:1600,trackCondition:'良',fieldSize:10,finish:1,margin:0.1},
    {date:'2026-09-01',racecourse:'川崎',surface:'ダ',distance:1400,trackCondition:'良',fieldSize:10,finish:3,margin:0.5}];
  const values={'保存走数':2,'直近3走平均着順':2,'直近5走平均着順':2,'近10走平均着順':2,'直近3走平均着差':0.3,'近10走平均着差':0.3,
    '近10走勝率':50,'近10走複勝率':100,'同距離走数':1,'同距離勝率':100,'同距離複勝率':100,'同場走数':1,'同場勝率':100,'同場複勝率':100,
    '先行率':50,'4角平均位置':2,'近10走ベストTIME':'1:12（1200m）','近10走ベスト上がり':37};
  const s={schemaVersion:'CHASS_NAR_RETROSPECTIVE_EVIDENCE_V1',organization:'NAR',replayMode:'RETROSPECTIVE_ONLY',raceId:'test',runId:'test',modelVersion:'test',
    earlyEligible:false,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,supplementalResearch:{version:'NAR_SUMMARY_EVIDENCE_BRIDGE_V1'},
    data:{race:{date:'2026-10-09',racecourse:'大井',surface:'ダ',distance:1600,trackCondition:'UNKNOWN'},horses:[{horseKey:'id1',horseNo:1,horseName:'馬1',runningStatus:'active',pastRuns:runs}]},
    evidence:[{horseKey:'id1',family:'FORM_RESEARCH',values,refs:[{sheet:'NAR_近10走サマリー',row:2,revision:'synthetic'}]}]};
  change(s);return {...s,snapshotHash:await stableHash(s)};
}
const metric=(a,k)=>a.rows[0].metrics.find(m=>m.field===k);
test('counts, means and percentage denominators are reproduced with source/history refs',async()=>{
  const a=await auditNarSummaryMetrics(await fixture());assert.equal(a.coverage.statusCounts.MATCH_UNDER_AUDIT_POLICY,14);
  assert.equal(metric(a,'近10走勝率').recomputed,50);assert.equal(metric(a,'近10走勝率').rawSampleCount,2);
  assert.equal(metric(a,'同距離複勝率').recomputed,100);assert.equal(metric(a,'同距離複勝率').refs.history[0].historyIndex,0);
});
test('source disagreement is visible and never rewrites source or model fields',async()=>{
  const s=await fixture(s=>s.evidence[0].values['近10走勝率']=60),saved=structuredClone(s),a=await auditNarSummaryMetrics(s);
  assert.equal(metric(a,'近10走勝率').status,'MISMATCH_UNDER_AUDIT_POLICY');assert.deepEqual(s,saved);assert.equal(a.sourceMutation,'NONE');
});
test('rates use percent units, never probability fractions',async()=>{
  const a=await auditNarSummaryMetrics(await fixture(s=>s.evidence[0].values['近10走勝率']=0.5));
  assert.equal(metric(a,'近10走勝率').status,'MISMATCH_UNDER_AUDIT_POLICY');assert.equal(metric(a,'近10走勝率').recomputed,50);
});
test('unobserved or invalid finish cannot silently become a losing run',async()=>{
  for(const v of [null,0,11]){const a=await auditNarSummaryMetrics(await fixture(s=>s.data.horses[0].pastRuns[1].finish=v));
    assert.equal(metric(a,'近10走勝率').status,'RAW_INCOMPLETE');assert.equal(metric(a,'近10走勝率').recomputed,null);}
});
test('unknown outcome denominator and margin never shrink to a convenient subset',async()=>{
  const a=await auditNarSummaryMetrics(await fixture(s=>{s.data.horses[0].pastRuns[1].fieldSize=null;s.data.horses[0].pastRuns[1].margin=null;}));
  assert.equal(metric(a,'近10走平均着順').status,'RAW_INCOMPLETE');assert.equal(metric(a,'近10走平均着差').status,'RAW_INCOMPLETE');
});
test('no same-distance sample yields null rate, while zero count can match',async()=>{
  const a=await auditNarSummaryMetrics(await fixture(s=>{s.data.race.distance=1800;s.evidence[0].values['同距離走数']=0;s.evidence[0].values['同距離勝率']=0;}));
  assert.equal(metric(a,'同距離走数').status,'MATCH_UNDER_AUDIT_POLICY');assert.equal(metric(a,'同距離勝率').status,'NO_RAW_SAMPLE');assert.equal(metric(a,'同距離勝率').recomputed,null);
});
test('chronological windows preserve original history indices when raw order differs',async()=>{
  const s=await fixture(s=>s.data.horses[0].pastRuns.reverse()),a=await auditNarSummaryMetrics(s);
  assert.deepEqual(metric(a,'直近3走平均着順').refs.history.map(r=>r.historyIndex),[1,0]);
});
test('leading rate, corner label and mixed-condition best clock stay unverified',async()=>{
  const a=await auditNarSummaryMetrics(await fixture());for(const k of ['先行率','4角平均位置','近10走ベストTIME','近10走ベスト上がり']){
    assert.equal(metric(a,k).status,'UNVERIFIED_DEFINITION_OR_CONDITION');assert.equal(metric(a,k).recomputed,null);}
});
test('missing or annotated numeric claims are not parsed as verified numbers',async()=>{
  for(const v of [null,'UNKNOWN','50%','50*']){const a=await auditNarSummaryMetrics(await fixture(s=>s.evidence[0].values['近10走勝率']=v));
    assert.equal(metric(a,'近10走勝率').status,'SOURCE_MISSING_OR_NONNUMERIC');}
});
test('tampered hashes, duplicate summaries and future history are rejected',async()=>{
  const a=await fixture();a.data.race.distance=1800;await assert.rejects(auditNarSummaryMetrics(a),/HASH_MISMATCH/);
  const b=await fixture(s=>s.evidence.push(structuredClone(s.evidence[0])));await assert.rejects(auditNarSummaryMetrics(b),/AMBIGUOUS/);
  const c=await fixture(s=>s.data.horses[0].pastRuns[0].date=s.data.race.date);await assert.rejects(auditNarSummaryMetrics(c),/CURRENT_OR_FUTURE/);
});
test('missing summary remains visible and authority never promotes after numeric matches',async()=>{
  const a=await auditNarSummaryMetrics(await fixture(s=>s.evidence=[]));assert.equal(a.rows[0].status,'SUMMARY_MISSING');
  assert.equal(a.earlyEligible,false);assert.equal(a.formalKpiEligible,false);assert.equal(a.productionActivationReady,false);
});
test('stable hash binds every metric, raw source and unresolved limitation',async()=>{
  const a=await auditNarSummaryMetrics(await fixture()),{auditHash,...payload}=a;assert.equal(auditHash,await stableHash(payload));
  assert.ok(Object.isFrozen(a.rows[0].metrics));assert.equal(a.causalAbilityEvidence,false);assert.equal(a.predictionMutation,'NONE');assert.equal(a.freezeMutation,'NONE');assert.equal(a.signalMutation,'NONE');
});
