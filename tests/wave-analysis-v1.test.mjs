import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWave,createWaveArtifact,verifyWaveArtifact,saveWaveArtifact,operationalClass} from '../src/prediction/wave-analysis-v1.mjs';
const now=Date.parse('2026-10-22T09:55:00+09:00');
function fixture(circuit='NAR',N=4){
 const raceId='2026-10-22|浦和|1',meta={organizer:circuit,raceId,runId:'R',inputSnapshotId:'I',kind:'EARLY',isPreResult:true,capturedAt:'2026-10-22T09:49:00+09:00',authorityRef:'INDEX'};
 return {race:{raceDate:'2026-10-22',track:'浦和',raceNo:1,raceType:circuit,surface:'ダート',waveEligibility:circuit==='NAR'?'NAR_FLAT':'JRA_STANDARD_INDEX',metricInputFreeze:{runId:'R',inputSnapshotId:'I',indexSnapshotId:'X',marketSnapshotId:'M',freezeAt:'2026-10-22T09:50:00+09:00',postAt:'2026-10-22T10:30:00+09:00'},originalEarlyMarket:{...meta,authorityRef:'MARKET',snapshotId:'M',sourceRef:'file:market',sourceClass:'PREDICTED_ODDS',horses:Array.from({length:N},(_,i)=>({horseNo:i+1,popularity:i+1,odds:i+2}))},waveEvidence:{...meta,snapshotId:'E',indexSnapshotId:'X',marketSnapshotId:'M',indexAuthorityRef:'INDEX',favoriteHighestIndexRank:1,multiClusterCount:0,clusterAuthorityRef:'CL',marketGapCount:0,marketGapAuthorityRef:'MG'}},horses:Array.from({length:N},(_,i)=>({horseNo:i+1,canonicalHorseKey:`${circuit}:${i+1}`,canonicalIndex:{...meta,sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:'X',peak:90-i,baseline5:80-i,current:null,prev:70-i,distance:60-i,course:50-i}}))};
}
const calc=root=>analyzeWave(root,{now});
test('JRA and NAR formulas keep distinct structural weights; full score is not a probability',()=>{
 const nar=calc(fixture('NAR',12)),jra=calc(fixture('JRA',12));
 assert.equal(nar.operational.mode,'FULL_CANONICAL');assert.equal(nar.canonical.structuralChaos,0);
 assert.ok(jra.canonical.structuralChaos>0);assert.equal(jra.canonical.components.FS,100*5/11);assert.equal('FS' in nar.canonical.components,false);
 assert.equal(nar.sourceOriginAuthenticated,false);assert.equal(nar.formalKpiEligible,false);assert.equal(nar.operational.confidence,'UNRATED_CANONICAL');assert.equal(jra.operational.confidence,'HIGH');
});
test('available weights do not fill missing counts with zero; recovery remains pending',()=>{
 const f=fixture();delete f.race.waveEvidence.multiClusterCount;const a=calc(f);
 assert.equal(a.operational.mode,'AVAILABLE_WEIGHT_CURRENT');assert.equal(a.canonical.components.CD,null);assert.equal(a.status,'RECOVERY_PENDING');
});
test('market-only and structure-only remain explicit and never affect marks',()=>{
 const market=fixture();delete market.race.waveEvidence;const a=calc(market);assert.equal(a.operational.mode,'MARKET_ONLY_CURRENT');assert.equal(a.operational.canonicalComparable,false);
 const structure=fixture();delete structure.race.originalEarlyMarket;const b=calc(structure);assert.equal(b.operational.mode,'STRUCTURE_ONLY_CURRENT');assert.equal(b.canonical.score,null);assert.equal(b.operational.confidence,'LOW');
});
function noCurrent(){const f=fixture();delete f.race.waveEvidence;delete f.race.originalEarlyMarket;return f;}
const prior=(score=33)=>({recordId:'P1',raceId:'2026-10-21|浦和|1',organization:'NAR',track:'浦和',authorityFamily:'NAR_WAVE',formulaFamily:'NAR_HARAN_V01',semanticVersion:1,scoreScale:'0_100_CONTEXT_SCORE',preResultFrozen:true,resultLeakage:false,currentEvidence:true,mode:'FULL_CANONICAL',score,contentHash:'sha256:'+'a'.repeat(64),freezeAt:'2026-10-21T09:50:00+09:00',postAt:'2026-10-21T10:30:00+09:00'});
test('unread prior cannot turn into a made-up 50; explicit empty set permits labelled cold start',()=>{
 assert.equal(calc(noCurrent()).operational.score,null);
 const a=analyzeWave(noCurrent(),{now,priors:[]});assert.equal(a.operational.score,50);assert.equal(a.operational.origin,'COLD_START');assert.equal(a.operational.currentEvidence,false);assert.equal(a.operational.decisionInfluence,'DISPLAY_ONLY');
});
test('prior selects nearest eligible scope, median retains half points, no recursive or future/cross-circuit data',()=>{
 const a=analyzeWave(noCurrent(),{now,priors:[prior(33),{...prior(34),recordId:'P2'},{...prior(99),recordId:'P3',track:'大井'},{...prior(80),recordId:'P4',mode:'HISTORICAL_PRIOR'},{...prior(80),recordId:'P5',organization:'JRA'}]});
 assert.equal(a.operational.score,33.5);assert.equal(a.operational.prior.count,2);assert.equal(a.operational.currentEvidence,false);
 const b=analyzeWave(noCurrent(),{now,priors:[{...prior(),freezeAt:'2026-10-23T09:00:00+09:00'}]});assert.equal(b.operational.mode,'COLD_START_NEUTRAL');
});
test('forged incomplete markets, mixed snapshots, missing identities, future cutoffs and POST fail closed',()=>{
 for(const mutate of [f=>f.race.originalEarlyMarket.horses.pop(),f=>f.race.originalEarlyMarket.horses[0].odds='2',f=>f.race.waveEvidence.marketSnapshotId='OTHER',f=>f.horses[0].canonicalHorseKey=null,f=>f.result={finishOrder:[1,2,3]},f=>f.race.metricInputFreeze.freezeAt='2026-10-22T11:00:00+09:00',f=>f.race.waveEvidence.VFS=50]){
  const f=fixture();mutate(f);assert.equal(calc(f).status,'ERROR_TERMINAL');
 }
});
test('population and post-start checks do not produce apparently current research',()=>{
 const f=fixture();f.race.waveEligibility='NEWCOMER';assert.equal(calc(f).status,'ERROR_TERMINAL');assert.equal(analyzeWave(fixture(),{now:Date.parse('2026-10-22T12:00:00+09:00')}).status,'ERROR_TERMINAL');
});
test('null and absent primitives cannot prevent an independent Wave calculation',()=>{
 const f=fixture();for(const h of f.horses)for(const k of ['peak','baseline5','current','prev','distance','course'])h.canonicalIndex[k]=null;
 assert.ok(Number.isFinite(calc(f).operational.score));
});
test('analysis leaves source forecasts and signals byte-identical',()=>{
 const f=fixture();for(const h of f.horses)Object.assign(h,{win:25,place:50,abilityMark:'◎',warningMark:'',valueMark:'💎',ev:120});const before=JSON.stringify(f);calc(f);assert.equal(JSON.stringify(f),before);
});
test('class boundaries are exact including fractional prior median',()=>{
 assert.deepEqual([0,34,35,49,50,64,65,100].map(operationalClass),['LOW','LOW','LOW-MID','LOW-MID','WATCH','WATCH','HIGH','HIGH']);
});
test('physical save/readback is idempotent; export recomputes at original analysis time; tampering fails',async()=>{
 const a=await createWaveArtifact(fixture(),{now}),data=new Map(),store={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 const s=await saveWaveArtifact(store,a);assert.equal(s.status,'READBACK_VERIFIED');await saveWaveArtifact(store,a);assert.equal(data.size,1);await verifyWaveArtifact(JSON.parse(JSON.stringify(a)));
 const bad=structuredClone(a);bad.body.result.operational.score=100;await assert.rejects(verifyWaveArtifact(bad),/HASH/);
 const broken={getItem:()=>null,setItem(){}};await assert.rejects(saveWaveArtifact(broken,a));
});
test('accessors are not executed and impossible numeric inputs are rejected',()=>{
 const f=fixture();Object.defineProperty(f.race,'waveEvidence',{enumerable:true,get(){throw Error('getter must not run');}});assert.equal(calc(f).reasons[0],'WAVE_INPUT_INVALID');
});
test('batch isolates rejected race and caps input without forecast writes',async()=>{
 const {createWaveBatch}=await import('../src/prediction/wave-analysis-v1.mjs');
 const bad=fixture();bad.result={finishOrder:[1,2,3]};const rows=await createWaveBatch([fixture(),bad],{now});
 assert.ok(rows[0].artifact);assert.equal(rows[1].artifact,null);assert.match(rows[1].error,/POST_RESULT/);
 await assert.rejects(createWaveBatch(Array(25).fill(fixture()),{now}),/COUNT_INVALID/);
});

// App source integration: do not replace the getter under test.
async function appSourceHarness(){
 const vm=await import('node:vm'),{readFile}=await import('node:fs/promises');
 const window={__CHASS_TEST__:true,CHASS_CPSI_SOURCE_RECOVERY:{sourceInputFromRoot:r=>r,sourceRootFromInput:r=>({race:{raceDate:r.race.raceDate},horses:r.horses})}};
 const context=vm.createContext({window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,document:{getElementById:()=>null},localStorage:{getItem:()=>null,setItem(){throw Error('unexpected write');}}});
 vm.runInContext(await readFile(new URL('../app.js',import.meta.url),'utf8'),context);
 return {window,app:window.CHASS_TEST};
}
test('real current-input getter accepts a saved prediction and returns an isolated copy',async()=>{
 const {window,app}=await appSourceHarness(),f=fixture();f.predictionSnapshot={createdAt:f.race.metricInputFreeze.freezeAt,horses:structuredClone(f.horses),race:structuredClone(f.race)};app.setState(f);
 const before=JSON.stringify(f),input=window.CHASS_WAVE_INPUT();assert.ok(input);assert.equal(calc(input).operational.mode,'FULL_CANONICAL');input.horses[0].canonicalIndex.peak=999;assert.equal(JSON.stringify(app.getState()),before);
});
test('CPSI preview retains full imported Wave source before market-blind projection',async()=>{
 const {window,app}=await appSourceHarness(),f=fixture();app.previewCpsiFirst(f);
 const input=window.CHASS_WAVE_INPUT();assert.ok(input.race.originalEarlyMarket);assert.ok(input.race.waveEvidence);assert.equal(calc(input).status,'ANALYSIS_TERMINAL');
 assert.equal(JSON.stringify(input),JSON.stringify(f));
});
test('saved legacy forecast without freeze is diagnosed, never assigned invented Run/time',async()=>{
 const {window,app}=await appSourceHarness(),f=fixture();delete f.race.metricInputFreeze;f.predictionSnapshot={createdAt:'2026-10-22T09:50:00+09:00'};app.setState(f);
 const input=window.CHASS_WAVE_INPUT();assert.equal(input.race.metricInputFreeze,undefined);assert.equal(calc(input).reasons[0],'INPUT_FREEZE_ID_MISSING');
});
test('saved result is still rejected when the current-input button reads a saved forecast',async()=>{
 const {window,app}=await appSourceHarness(),f=fixture();f.predictionSnapshot={};f.result={finishOrder:[1,2,3]};app.setState(f);assert.equal(calc(window.CHASS_WAVE_INPUT()).reasons[0],'POST_RESULT_FIELD_FORBIDDEN');
});
test('missing freeze and post-start errors have specific actionable Japanese guidance',async()=>{
 const {waveFailureMessage}=await import('../src/prediction/wave-analysis-ui-v1.mjs');
 assert.match(waveFailureMessage('INPUT_FREEZE_ID_MISSING'),/取得・固定情報/);assert.match(waveFailureMessage('CUTOFF_OR_PRESTART_INVALID'),/発走後/);assert.match(waveFailureMessage('POST_RESULT_FIELD_FORBIDDEN'),/保存済み分析/);
});
