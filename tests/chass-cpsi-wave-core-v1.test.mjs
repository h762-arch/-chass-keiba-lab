import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCpsiWaveShadow,projectAndCalculateMetricShadow} from '../src/prediction/chass-cpsi-wave-core-v1.mjs';
const now=Date.parse('2026-10-18T09:55:00+09:00');
const calc=input=>calculateCpsiWaveShadow(input,{now});
const project=input=>projectAndCalculateMetricShadow(input,{now});
const raceId='2026-10-18|東京|1';
const meta=()=>({organizer:'JRA',raceId,runId:'RUN-1',inputSnapshotId:'FREEZE-1',kind:'EARLY',isPreResult:true,capturedAt:'2026-10-18T09:49:00+09:00',authorityRef:'CANONICAL_INDEX'});
const horses=()=>[1,2,3,4].map(horseNo=>({horseNo,canonicalHorseKey:`JRA|horse-${horseNo}`,canonicalIndex:{...meta(),sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:'INDEX-1',peak:95-horseNo,baseline5:80-horseNo,current:70-horseNo,prev:65-horseNo,distance:60-horseNo,course:50-horseNo}}));
const market=()=>({...meta(),authorityRef:'MARKET_AUTH',snapshotId:'MARKET-1',sourceRef:'PRE_MARKET_RECEIPT',sourceClass:'PREDICTED_ODDS',horses:[1,2,3,4].map(horseNo=>({horseNo,popularity:horseNo,odds:horseNo+1}))});
export const fixture=()=>({organization:'JRA',raceId,runId:'RUN-1',inputSnapshotId:'FREEZE-1',indexSnapshotId:'INDEX-1',marketSnapshotId:'MARKET-1',freezeAt:'2026-10-18T09:50:00+09:00',postAt:'2026-10-18T10:30:00+09:00',race:{raceDate:'2026-10-18',track:'東京',raceNo:1,raceType:'JRA',surface:'芝',waveEligibility:'JRA_STANDARD_INDEX'},horses:horses(),market:market()});
const evidence=()=>({...meta(),snapshotId:'WAVE-EVIDENCE-1',indexSnapshotId:'INDEX-1',marketSnapshotId:'MARKET-1',indexAuthorityRef:'CANONICAL_INDEX',favoriteHighestIndexRank:1,multiClusterCount:0,clusterAuthorityRef:'CL_AUTH',marketGapCount:0,marketGapAuthorityRef:'MG_AUTH'});
const args=()=>{const f=fixture();return {organization:f.organization,raceId:f.raceId,race:{...f.race,metricInputFreeze:Object.fromEntries(['runId','inputSnapshotId','indexSnapshotId','marketSnapshotId','freezeAt','postAt'].map(k=>[k,f[k]])),originalEarlyMarket:f.market},horses:f.horses};};
test('canonical CPSI uses frozen weights and numeric A/B/C, full JRA 55:45 formula',()=>{
 const f=fixture();f.waveEvidence=evidence();const r=calc(f);
 assert.equal(r.cpsi.numericMaterializedCount,4);assert.equal(r.cpsi.rows[0].scoreMode,'CORE_COMPLETE');
 assert.equal(r.cpsi.rows[0].cpsiMainCompat,80);assert.equal(r.cpsi.rows[3].cpsiMainCompat,20);
 assert.equal(r.cpsi.rows[0].rank,1);assert.equal(r.wave.status,'NUMERIC_SHADOW');
 const q=[.5,1/3,.25],sum=q.reduce((a,b)=>a+b),p=q.map(v=>v/sum);
 const entropy=-p.reduce((s,v)=>s+v*Math.log(v),0)/Math.log(3)*100;
 assert.equal(r.wave.waveScore,Math.round(.55*0+.45*(.4*(100*.9/3.9)+.4*entropy)));
 assert.equal(r.formalKpiEligible,false);assert.equal(r.sourceOriginAuthenticated,false);
});
test('missing evidence remains unavailable with available-weight normalization',()=>{
 const r=calc(fixture());assert.equal(r.wave.status,'PARTIAL_NUMERIC_SHADOW');assert.equal(r.wave.components.FIM,null);
 assert.deepEqual(r.wave.componentCoverage,{structuralWeightPct:25,marketWeightPct:80});
});
test('one core cannot produce MainCompat or a rank',()=>{
 const f=fixture();for(const h of f.horses)for(const k of ['peak','baseline5','distance','course'])h.canonicalIndex[k]=null;
 const r=calc(f);assert.equal(r.cpsi.numericMaterializedCount,0);assert.ok(r.cpsi.rows.every(h=>h.rank===null&&h.cpsiMainCompat===null));
});
test('Prev proxy and partial C retain explicit status and overlapping neutral weight',()=>{
 const f=fixture();for(const h of f.horses){h.canonicalIndex.current=null;h.canonicalIndex.course=null;}
 const row=calc(f).cpsi.rows[0];assert.equal(row.components.B.status,'RESOLVED_PROXY');assert.equal(row.components.C.status,'PARTIAL_NEUTRAL_PRIMITIVE');
 assert.equal(row.primitiveStatus.course,'UNKNOWN');assert.equal(row.neutralizedWeightPct,50);assert.equal(row.partialWeightPct,20);assert.equal(row.cpsiResolvedOnly,100);
});
test('singleton neutral is labelled and ties use lower percentile',()=>{
 const f=fixture();for(const h of f.horses)h.canonicalIndex.current=50;
 assert.equal(calc(f).cpsi.rows[0].components.B.value,0);
 for(const h of f.horses.slice(1))h.canonicalIndex.current=null;
 const row=calc(f).cpsi.rows[0];assert.equal(row.components.B.value,50);assert.equal(row.primitiveStatus.current,'SINGLETON_NEUTRAL');
});
test('odds changes do not alter CPSI or its rankings',()=>{
 const f=fixture(),before=calc(f).cpsi;f.market.horses.forEach((h,i)=>{h.popularity=4-i;h.odds=20+i;});
 assert.deepEqual(calc(f).cpsi,before);
});
test('missing canonical data is not fabricated from raw ability',()=>{
 const f=fixture();f.horses=f.horses.map(({horseNo})=>({horseNo,raw:{highest:99},win:70,odds:2}));
 assert.equal(calc(f).cpsi.numericMaterializedCount,0);
});
for(const [name,mutate] of [
 ['wrong race',f=>f.market.raceId='2026-10-18|京都|1'],
 ['wrong circuit',f=>f.market.organizer='NAR'],
 ['wrong Run',f=>f.market.runId='OTHER'],
 ['mixed freeze',f=>f.market.inputSnapshotId='OTHER'],
 ['wrong market ID',f=>f.market.snapshotId='OTHER'],
 ['future capture',f=>f.market.capturedAt='2099-01-01T00:00:00Z'],
 ['after cutoff',f=>f.market.capturedAt='2026-10-18T09:51:00+09:00'],
 ['old day',f=>f.market.capturedAt='2026-10-17T09:49:00+09:00'],
 ['ambiguous time',f=>f.market.capturedAt='2026-10-18 09:49'],
 ['FINAL phase',f=>f.market.kind='FINAL'],
 ['post-start clock',f=>f.postAt='2026-10-18T09:54:00+09:00'],
 ['future cutoff',f=>f.freezeAt='2026-10-18T09:56:00+09:00'],
 ['missing freeze',f=>delete f.inputSnapshotId],
 ['race mismatch',f=>f.race.track='京都'],
 ['race circuit conflict',f=>f.race.raceType='NAR'],
 ['invalid calendar capture',f=>f.market.capturedAt='2026-02-30T09:49:00+09:00'],
 ['duplicate runner',f=>f.horses[1].horseNo=1],
 ['mixed index',f=>f.horses[1].canonicalIndex.sourceSnapshotId='OTHER'],
 ['index camelCase marketGap',f=>f.horses[0].canonicalIndex.marketGap=99],
 ['index odds',f=>f.horses[0].canonicalIndex.odds=2],
 ['result at root',f=>f.result={finishOrder:[1,2,3]}],
 ['nested result',f=>f.horses[0].canonicalIndex.resultSnapshot={finishOrder:[1,2,3]}],
 ['evidence mixed index',f=>{f.waveEvidence=evidence();f.waveEvidence.indexSnapshotId='OTHER';}]
])test(`rejects ${name}`,()=>{const f=fixture();mutate(f);const r=calc(f);assert.equal(r.status,'HOLD');assert.equal(r.cpsi,null);assert.equal(r.wave,null);});
test('bad market roster/odds outside top three remains HOLD',()=>{
 for(const mutate of [f=>f.market.horses.pop(),f=>f.market.horses[3].odds=null,f=>f.market.horses[3].popularity=1,f=>f.market.horses[0].odds=.5]){
  const f=fixture();mutate(f);assert.equal(calc(f).wave.waveScore,null);
 }
});
const domain=()=>({...meta(),sourceSnapshotId:'D-1',indexSnapshotId:'INDEX-1',sourceClass:'PRE_COMPONENT_SCORER',use:'SHADOW',status:'RESOLVED',value:100});
test('D-G require matching metadata and authorized shadow use',()=>{
 const f=fixture();f.horses[0].cpsiDomains={D:domain()};assert.equal(calc(f).cpsi.rows[0].components.D.status,'RESOLVED');
 for(const mutate of [s=>s.organizer='NAR',s=>s.raceId='OTHER',s=>s.inputSnapshotId='OTHER',s=>s.indexSnapshotId='OTHER',s=>s.capturedAt='2099-01-01T00:00:00Z',s=>s.use='FORMAL',s=>s.result={finishOrder:[1]},s=>s.marketGap=99]){
  const q=fixture(),d=domain();mutate(d);q.horses[0].cpsiDomains={D:d};assert.equal(calc(q).status,'HOLD');
 }
});
for(const [tag,reason] of [['新馬','NEWCOMER_SPECIALIST_REQUIRED'],['障害','JUMP_SPECIALIST_REQUIRED'],['ばんえい','BANEI_SPECIALIST_REQUIRED']])test(`routes ${tag} without generic Wave`,()=>{
 const f=fixture();f.race.raceName=tag;const r=calc(f);assert.equal(r.wave.status,'NOT_APPLICABLE');assert.equal(r.wave.waveScore,null);assert.deepEqual(r.wave.reasons,[reason]);
});
test('unverified population has no generic Wave',()=>{const f=fixture();delete f.race.waveEligibility;assert.equal(calc(f).wave.waveScore,null);});
test('scratches are excluded from the active denominator',()=>{
 const f=fixture();f.horses[3].horseStatus='scratched';f.market.horses.pop();const r=calc(f);assert.equal(r.cpsi.activeRunnerCount,3);assert.equal(r.cpsi.rows.length,3);
});
test('all scratched cannot produce NAR Wave from residual SC/MC',()=>{
 const f=fixture();f.horses.forEach(h=>h.runnerStatus='scratched');assert.equal(calc(f).wave.waveScore,null);
});
test('NAR uses only matching PRE SC/MC and keeps NAR classes',()=>{
 const f=fixture();f.organization='NAR';f.race.raceType='NAR';f.race.waveEligibility='NAR_FLAT';f.market=null;f.horses.forEach(h=>h.canonicalIndex=null);
 f.narWaveScMc={...meta(),organizer:'NAR',snapshotId:'NAR-WAVE-1',indexSnapshotId:'INDEX-1',marketSnapshotId:'MARKET-1',SC:60,MC:40};
 let r=calc(f);assert.equal(r.wave.waveScore,51);assert.equal(r.wave.waveClass,'WATCH');assert.equal(r.wave.noJraWeightsReused,true);
 f.narWaveScMc.organizer='JRA';assert.equal(calc(f).status,'HOLD');
});
test('source authority labels do not claim authenticated origin or Production readiness',()=>{
 const r=calc(fixture());assert.equal(r.sourceOriginAuthenticated,false);assert.equal(r.productionExecutionAuthorized,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');
});
test('accessors are rejected without running them and inputs are unchanged',()=>{
 const f=fixture(),before=structuredClone(f);calc(f);assert.deepEqual(f,before);
 let called=0;Object.defineProperty(f.market,'capturedAt',{enumerable:true,get(){called++;return '2099';}});assert.equal(calc(f).status,'HOLD');assert.equal(called,0);
});
test('runtime adapter consumes same-race batch and rejects invalid batch without fallback',()=>{
 const a=args();a.race.cpsiCanonicalIndexSnapshot={...meta(),snapshotId:'INDEX-1',horses:a.horses.map(h=>({horseNo:h.horseNo,...Object.fromEntries(['peak','baseline5','current','prev','distance','course'].map(k=>[k,h.canonicalIndex[k]]))}))};
 assert.equal(project(a).cpsi.numericMaterializedCount,4);
 a.race.cpsiCanonicalIndexSnapshot.raceId='OTHER';assert.equal(project(a).status,'HOLD');
});
test('batch source cannot hide outcome or market columns during projection',()=>{
 const a=args();a.race.cpsiCanonicalIndexSnapshot={...meta(),snapshotId:'INDEX-1',horses:[{horseNo:1,peak:90,marketGap:2}]};assert.equal(project(a).status,'HOLD');
});
test('application adapter preserves market metadata instead of stripping conflicts',()=>{
 const a=args();a.race.originalEarlyMarket.raceId='OTHER';assert.equal(project(a).status,'HOLD');
});
test('application adapter does not invent a cutoff and blocks result-bearing state',()=>{
 const a=args();delete a.race.metricInputFreeze;assert.equal(project(a).status,'HOLD');
 const b=args();b.hasResult=true;assert.equal(project(b).status,'HOLD');
});
test('default clock rejects future cutoff without a test clock override',()=>{
 const f=fixture();f.freezeAt='2099-01-01T00:00:00Z';assert.equal(calculateCpsiWaveShadow(f).status,'HOLD');
});
