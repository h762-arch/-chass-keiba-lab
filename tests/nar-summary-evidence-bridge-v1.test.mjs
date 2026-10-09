import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {createNarRetrospectiveEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
import {reviewNarPredictionEvidence} from '../src/research/nar-prediction-review-v1.mjs';
import {attachNarSummaryEvidence} from '../src/research/nar-summary-evidence-bridge-v1.mjs';
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(row=>keys.map(k=>row[k]??null))];};
async function fixture(){
  const raceId='20261009-NAR-OI-1',runId='phase85-test',modelVersion='unchanged';
  const snapshot=await createNarRetrospectiveEvidenceSnapshot({raceId,runId,modelVersion,cutoffAt:'2026-10-09T00:00:00Z',offAt:'2026-10-09T01:00:00Z',
    source:{spreadsheetId:'synthetic',revision:'parent',availableAt:'2026-10-09T01:30:00Z',exportedAt:'2026-10-09T02:00:00Z'},
    replayEvidence:{basis:'POST_RACE_IDENTITY_ONLY',observedAt:'2026-10-09T01:40:00Z',refs:['https://example.com/synthetic']},
    races:table([{CanonicalRace_ID:raceId,Org:'NAR',RaceDate:'2026-10-09',Course:'大井',Surface:'ダ',DistanceM:1600,TrackCondition_EARLY:'UNKNOWN'}]),
    runners:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`NAR_ARCHIVE|${100+no}`,HorseNo:no,HorseName:`馬${no}`,CancelStatus:'ACTIVE',WeightCarried:56}))),
    history:table([1,2].map(no=>({CanonicalRace_ID:raceId,CanonicalHorse_Key:`NAR_ARCHIVE|${100+no}`,Run_No:1,PastRaceDate:'2026-09-01',PastCourse:'大井',Surface:'ダ',DistanceM:1600,Going:'良',Finish:2,FieldSize:10,RunTime:'1:42.0',Last3F:38,Class:'B3二'}))),
    identityMap:[1,2].map(no=>({raceId,horseKey:`NAR_ARCHIVE|${100+no}`,horseNo:no,horseName:`馬${no}`,status:'PASS',evidenceRef:'synthetic'}))});
  const rows=[1,2].map(no=>({'レースID':'source-race','対象開催日':'2026-10-09','主催':'NAR','競馬場':'大井','馬番':no,'馬ID':String(100+no),'馬名':`馬${no}`,'保存走数':1,
    CurrentLevel:'source judgment',PeakAbility:'source peak',RecentFormShape:'上昇',ConditionTrigger:'距離短縮○','先行率':0,'4角平均位置':3,
    '近10走ベストTIME':'1:12.0（1200m）','近10走ベスト上がり':'38（ダ）','トレンド根拠':'source note','分析メモ':'unverified research','更新日時':'2026-10-09 09:00 JST'}));
  const input={table:table(rows),source:{spreadsheetId:'synthetic',sheet:'NAR_近10走サマリー',revision:'capture',firstDataRow:2,capturedAt:'2026-10-09T03:00:00Z'},
    raceAssociation:{sourceRaceId:'source-race',canonicalRaceId:raceId,status:'PASS',evidenceRef:'synthetic association'},
    identities:[1,2].map(no=>({horseNo:no,sourceHorseId:String(100+no),sourceName:`馬${no}`,horseKey:`NAR_ARCHIVE|${100+no}`,snapshotName:`馬${no}`,status:'PASS',evidenceRef:'synthetic identity'}))};
  const baseline={raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),horses:snapshot.data.horses.map(h=>({...structuredClone(h),pastRuns:[],timeIndex:80,courseIndex:80}))}};
  return {snapshot,input,baseline};
}
const cell=(f,row,key,value)=>{f.input.table[row][f.input.table[0].indexOf(key)]=value;};
test('source-native summaries enter snapshot and integrated review without changing model output',async()=>{
  const f=await fixture(),saved=structuredClone(f),s=await attachNarSummaryEvidence(f.snapshot,f.input);
  const before=await reviewNarPredictionEvidence(f.snapshot,f.baseline),after=await reviewNarPredictionEvidence(s,f.baseline);
  assert.deepEqual(after.comparison.after,before.comparison.after);assert.deepEqual(f,saved);
  assert.ok(after.review.rows.every(r=>r.features.some(e=>e.family==='FORM_RESEARCH'&&e.status==='PRESENT_NO_OBSERVED_MODEL_CHANGE')));
  assert.ok(after.review.rows.every(r=>r.gaps.some(g=>g.family==='FORM_RESEARCH'&&g.code==='SOURCE_FACTOR_NOT_MAPPED')));
});
test('mixed-distance clocks, annotated closing and zero percentages remain literal source values',async()=>{
  const f=await fixture(),s=await attachNarSummaryEvidence(f.snapshot,f.input),e=s.evidence.find(e=>e.family==='FORM_RESEARCH');
  assert.equal(e.values['近10走ベストTIME'],'1:12.0（1200m）');assert.equal(e.values['近10走ベスト上がり'],'38（ダ）');assert.equal(e.values['先行率'],0);
  assert.equal(e.refs[0].row,2);assert.equal(e.refs[0].capturedAt,f.input.source.capturedAt);assert.equal(e.decisionUsed,false);
});
test('partial capture lists uncovered horses without fabricated summaries',async()=>{
  const f=await fixture();f.input.table.pop();const s=await attachNarSummaryEvidence(f.snapshot,f.input);
  assert.deepEqual(s.supplementalResearch.missingHorseKeys,['NAR_ARCHIVE|102']);assert.equal(s.evidence.filter(e=>e.family==='FORM_RESEARCH').length,1);
});
test('UNKNOWN and HOLD are not copied as positive evidence',async()=>{
  const f=await fixture();cell(f,1,'CurrentLevel','UNKNOWN');cell(f,1,'ConditionTrigger','HOLD');
  const s=await attachNarSummaryEvidence(f.snapshot,f.input),e=s.evidence.find(e=>e.family==='FORM_RESEARCH');assert.equal(e.values.CurrentLevel,null);assert.equal(e.values.ConditionTrigger,null);
});
test('wrong race, date, organization and course reject the entire attachment',async()=>{
  for(const [key,v] of [['レースID','other'],['対象開催日','2026-10-08'],['主催','JRA'],['競馬場','川崎']]){const f=await fixture();cell(f,1,key,v);await assert.rejects(attachNarSummaryEvidence(f.snapshot,f.input),/SUMMARY_RACE_CONTEXT_MISMATCH/);}
  const serial=await fixture();cell(serial,1,'対象開催日',46304);await attachNarSummaryEvidence(serial.snapshot,serial.input);
  cell(serial,1,'対象開催日',46304.5);await assert.rejects(attachNarSummaryEvidence(serial.snapshot,serial.input),/RACE_CONTEXT_MISMATCH/);
});
test('duplicate rows and unresolved source identities are not silently joined',async()=>{
  const a=await fixture();a.input.table.push(a.input.table[1]);await assert.rejects(attachNarSummaryEvidence(a.snapshot,a.input),/AMBIGUOUS_OR_MISSING/);
  const b=await fixture();b.input.identities[0].status='UNKNOWN';await assert.rejects(attachNarSummaryEvidence(b.snapshot,b.input),/IDENTITY_UNRESOLVED/);
  const c=await fixture();cell(c,1,'馬ID','official-other');await assert.rejects(attachNarSummaryEvidence(c.snapshot,c.input),/AMBIGUOUS_OR_MISSING/);
});
test('name differences need explicit reviewed alias and preserve both names',async()=>{
  const f=await fixture();cell(f,1,'馬名','source alias');f.input.identities[0].sourceName='source alias';
  await assert.rejects(attachNarSummaryEvidence(f.snapshot,f.input),/EXPLICIT_ALIAS_REQUIRED/);
  f.input.identities[0].approvedAlias='馬1';const s=await attachNarSummaryEvidence(f.snapshot,f.input);
  assert.equal(s.supplementalResearch.audit[0].sourceName,'source alias');assert.equal(s.data.horses[0].horseName,'馬1');
});
test('summary history count must match the bounded source history',async()=>{
  const f=await fixture();cell(f,1,'保存走数',10);await assert.rejects(attachNarSummaryEvidence(f.snapshot,f.input),/HISTORY_COUNT_MISMATCH/);
});
test('fresh attachment never enters a pre-off snapshot or backdates acquisition',async()=>{
  const f=await fixture(),s=structuredClone(f.snapshot);s.schemaVersion='CHASS_PREDICTION_EVIDENCE_BRIDGE_V1';await assert.rejects(attachNarSummaryEvidence(s,f.input),/RETROSPECTIVE_RESEARCH_SNAPSHOT_REQUIRED/);
  f.input.source.capturedAt='2026-10-09T00:30:00Z';await assert.rejects(attachNarSummaryEvidence(f.snapshot,f.input),/CAPTURE_PROVENANCE_REQUIRED/);
});
test('wrong spreadsheet and missing explicit race association reject attachment',async()=>{
  const a=await fixture();a.input.source.spreadsheetId='other';await assert.rejects(attachNarSummaryEvidence(a.snapshot,a.input),/CAPTURE_PROVENANCE_REQUIRED/);
  const b=await fixture();b.input.raceAssociation.status='HOLD';await assert.rejects(attachNarSummaryEvidence(b.snapshot,b.input),/RACE_ASSOCIATION_REQUIRED/);
});
test('tampered parent, duplicate headers and repeated attachment are rejected',async()=>{
  const a=await fixture();a.snapshot=structuredClone(a.snapshot);a.snapshot.data.horses[0].horseName='tampered';await assert.rejects(attachNarSummaryEvidence(a.snapshot,a.input),/SNAPSHOT_HASH_MISMATCH/);
  const b=await fixture();b.input.table[0].push('馬名');await assert.rejects(attachNarSummaryEvidence(b.snapshot,b.input),/BOUNDED_TABLE_REQUIRED/);
  const c=await fixture(),s=await attachNarSummaryEvidence(c.snapshot,c.input);await assert.rejects(attachNarSummaryEvidence(s,c.input),/ALREADY_ATTACHED/);
});
test('new hash binds source refs and audit while all authority flags stay false',async()=>{
  const f=await fixture(),s=await attachNarSummaryEvidence(f.snapshot,f.input),{snapshotHash,...payload}=s;
  assert.equal(snapshotHash,await stableHash(payload));assert.notEqual(snapshotHash,f.snapshot.snapshotHash);assert.ok(Object.isFrozen(s.supplementalResearch.audit));
  assert.equal(s.earlyEligible,false);assert.equal(s.formalKpiEligible,false);assert.equal(s.productionActivationReady,false);assert.equal(s.supplementalResearch.modelDriver,false);
});
