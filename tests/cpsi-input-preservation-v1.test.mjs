import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sourceInputFromRoot} from '../src/prediction/cpsi-source-recovery-v1.mjs';
import * as core from '../src/prediction/chass-cpsi-wave-core-v1.mjs';
import {d1RecordRows} from '../worker.js';
import {readD1HoldAudit} from '../src/research/cloud-hold-audit-v1.mjs';
const now=Date.parse('2026-10-21T08:00:00+09:00'),copy=x=>JSON.parse(JSON.stringify(x));
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function fixture(){
 const raceId='2026-10-21|浦和|1',freeze={runId:'SYNTHETIC-RUN',inputSnapshotId:'SYNTHETIC-INPUT',indexSnapshotId:'SYNTHETIC-INDEX',freezeAt:'2026-10-21T07:59:00+09:00',postAt:'2026-10-21T12:20:00+09:00'};
 const meta={organizer:'NAR',raceId,runId:freeze.runId,inputSnapshotId:freeze.inputSnapshotId,kind:'EARLY',isPreResult:true,capturedAt:'2026-10-21T07:58:00+09:00',authorityRef:'SYNTHETIC',sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:freeze.indexSnapshotId};
 return {race:{category:'地方競馬',raceType:'NAR',raceDate:'2026-10-21',track:'浦和',raceNo:1,raceName:'SYNTHETIC TEST',postTime:'12:20',distance:1400,surface:'ダート',metricInputFreeze:freeze},horses:[1,2,3,4].map(horseNo=>({horseNo,horseName:`SYNTHETIC-${horseNo}`,canonicalHorseKey:`SYNTHETIC|${horseNo}`,canonicalIndex:{...meta,peak:100-horseNo,baseline5:90-horseNo,prev:80-horseNo,distance:70-horseNo,course:60-horseNo},horseStatus:'active',win:25,place:60,overall:80,odds:null,popularity:null,predictedTime:'',dataConfidence:50})),result:null,actualTimes:{},predictionSnapshot:null,marketSnapshot:null,finalSnapshot:null,validationCompleted:false};
}
function harness(){
 const window={__CHASS_TEST__:true,CHASS_CPSI_WAVE_CORE:{projectAndCalculateMetricShadow:args=>core.projectAndCalculateMetricShadow(args,{now})}};
 vm.runInNewContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),{window,console,Date:Clock,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:()=>null,setItem:()=>{throw Error('unexpected storage write')}}});
 return window.CHASS_TEST;
}
test('NAR auto conversion retains supplied CPSI race and runner evidence',()=>{
 const app=harness(),s=fixture(),d={...s.race,horses:s.horses};
 const r=app.buildAbilityRoot(d,'2026-10-21','浦和',1);
 assert.deepEqual(copy(r.race.metricInputFreeze),s.race.metricInputFreeze);
 assert.deepEqual(copy(r.horses[0].canonicalIndex),s.horses[0].canonicalIndex);
 assert.equal(r.horses[0].canonicalHorseKey,s.horses[0].canonicalHorseKey);
});
test('evidence is cloned across auto conversion and both Snapshot projections',()=>{
 const app=harness(),s=fixture(),r=app.buildAbilityRoot({...s.race,horses:s.horses},'2026-10-21','浦和',1),race=app.snapshotRace(s.race),horse=app.predictionHorse(s.horses[0]);
 r.race.metricInputFreeze.runId='MUTATED';race.metricInputFreeze.runId='MUTATED';r.horses[0].canonicalIndex.peak=999;horse.canonicalIndex.peak=999;
 assert.equal(s.race.metricInputFreeze.runId,'SYNTHETIC-RUN');assert.equal(s.horses[0].canonicalIndex.peak,99);
});
test('absent evidence is never manufactured and still produces HOLD',()=>{
 const app=harness(),s=fixture();delete s.race.metricInputFreeze;for(const h of s.horses){delete h.canonicalHorseKey;delete h.canonicalIndex;}
 const r=app.buildAbilityRoot({...s.race,horses:s.horses},'2026-10-21','浦和',1);
 assert.equal(Object.hasOwn(r.race,'metricInputFreeze'),false);assert.equal(Object.hasOwn(r.horses[0],'canonicalHorseKey'),false);
 app.setState(s);app.makeSnapshot();assert.deepEqual(copy(app.getState().predictionSnapshot.cpsiWaveShadow.reasons),['INPUT_FREEZE_ID_MISSING']);
});
test('saved prediction alone retains a recoverable exact CPSI source context',()=>{
 const app=harness(),s=fixture(),before=sourceInputFromRoot(s,{now});app.setState(s);app.makeSnapshot();
 const p=app.getState().predictionSnapshot,after=sourceInputFromRoot({race:p.race,horses:p.horses},{now});
 assert.deepEqual(after,before);assert.equal(app.verifySnapshotIntegrity(app.getState()).status,'verified');
});
test('existing Original EARLY is never backfilled or resealed after evidence changes',()=>{
 const app=harness(),s=fixture();delete s.race.metricInputFreeze;app.setState(s);app.makeSnapshot();
 const before=JSON.stringify(s.predictionSnapshot),hash=app.snapshotFingerprint(s.predictionSnapshot);
 s.race.metricInputFreeze=fixture().race.metricInputFreeze;s.horses[0].canonicalIndex.peak=999;app.makeSnapshot();
 assert.equal(JSON.stringify(s.predictionSnapshot),before);assert.equal(app.snapshotFingerprint(s.predictionSnapshot),hash);
});
test('preservation does not admit mismatched source identities',()=>{
 const app=harness(),s=fixture();s.horses[0].canonicalIndex.runId='OTHER';app.setState(s);app.makeSnapshot();
 assert.deepEqual(copy(s.predictionSnapshot.cpsiWaveShadow.reasons),['SOURCE_IDENTITY_OR_SNAPSHOT_MISMATCH']);
 assert.throws(()=>sourceInputFromRoot({race:s.predictionSnapshot.race,horses:s.predictionSnapshot.horses},{now}),/SOURCE_IDENTITY_OR_SNAPSHOT_MISMATCH/);
});
test('post-start input is held and never turned into a fresh PRE',()=>{
 const app=harness(),s=fixture();s.race.metricInputFreeze.postAt='2026-10-21T08:00:00+09:00';app.setState(s);app.makeSnapshot();
 assert.deepEqual(copy(s.predictionSnapshot.cpsiWaveShadow.reasons),['CUTOFF_OR_PRESTART_INVALID']);
});
test('batch index and authorized domain evidence survive deep-copy projection',()=>{
 const app=harness(),s=fixture();s.race.cpsiCanonicalIndexSnapshot={snapshotId:'TEST-BATCH',horses:[]};s.horses[0].cpsiDomains={D:{status:'UNKNOWN'}};
 const r=app.buildAbilityRoot({...s.race,horses:s.horses},'2026-10-21','浦和',1),race=app.snapshotRace(r.race),horse=app.predictionHorse(r.horses[0]);
 assert.deepEqual(copy(race.cpsiCanonicalIndexSnapshot),s.race.cpsiCanonicalIndexSnapshot);assert.deepEqual(copy(horse.cpsiDomains),s.horses[0].cpsiDomains);
 race.cpsiCanonicalIndexSnapshot.horses.push({horseNo:99});horse.cpsiDomains.D.status='MUTATED';assert.equal(s.race.cpsiCanonicalIndexSnapshot.horses.length,0);assert.equal(s.horses[0].cpsiDomains.D.status,'UNKNOWN');
});
test('real serializer and mock SQL readback preserve the independent prediction source',async()=>{
 const app=harness(),s=fixture();app.setState(s);app.makeSnapshot();const saved=copy(s),r=d1RecordRows('2026-10-21|浦和|1',saved).race;
 const row={race_id:r.raceId,model_version:r.modelVersion,status:r.status,updated_at:r.updatedAt,race_json:r.raceJson,prediction_json:r.predictionJson,market_json:r.marketJson,final_json:r.finalJson,result_json:r.resultJson,validation_json:r.validationJson};
 const db={prepare(sql){assert.match(sql,/^SELECT /);return {bind(){return {async first(){return copy(row)}}}}}};
 const read=await readD1HoldAudit(db,r.raceId,r.modelVersion),p=read.record.predictionSnapshot;
 assert.deepEqual(p,saved.predictionSnapshot);assert.deepEqual(sourceInputFromRoot({race:p.race,horses:p.horses},{now}),sourceInputFromRoot(fixture(),{now}));
});
test('preserving source evidence does not change marks, probabilities, market or formal eligibility',()=>{
 const a=harness(),b=harness(),x=fixture(),y=fixture();delete y.race.metricInputFreeze;for(const h of y.horses){delete h.canonicalHorseKey;delete h.canonicalIndex;}
 a.setState(x);b.setState(y);a.makeSnapshot();b.makeSnapshot();
 for(let i=0;i<x.horses.length;i++)for(const key of ['win','place','abilityMark','finalMark','warningMark','valueMark'])assert.equal(x.horses[i][key],y.horses[i][key]);
 assert.deepEqual(copy(x.marketSnapshot),copy(y.marketSnapshot));assert.equal(x.predictionSnapshot.cpsiWaveShadow.formalKpiEligible,false);assert.equal(x.predictionSnapshot.cpsiWaveShadow.sourceOriginAuthenticated,false);
});
