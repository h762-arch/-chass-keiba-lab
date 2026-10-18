import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fixture,raceId,now,tick} from './helpers/nar-outcome-fixture-v1.mjs';
import {readNarEarlyOutcome} from '../src/research/nar-early-outcome-reader-v1.mjs';
import {summarizeEarlyEvidenceCohort} from '../src/research/early-kpi-cohort-v1.mjs';

const run=f=>readNarEarlyOutcome({DB:f.DB,raceId,now});
const assertHeld=r=>{assert.equal(r.status,'HOLD');assert.equal(r.comparison,null);assert.equal(r.formalKpiEligible,false);};
test('existing verifiers bind original stored EARLY to complete result; auth stays false',async()=>{
 const f=await fixture(),before=JSON.stringify([...f.rows]),resultBefore=JSON.stringify(f.result),old=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
 try{
  const r=await run(f);assert.equal(r.status,'READY',JSON.stringify(r));const c=r.comparison;
  assert.equal(c.matchedRunnerCount,9);assert.equal(c.timeSampleCount,9);assert.equal(c.winBrier,.08);assert.equal(c.top3Brier,.186667);assert.equal(c.timeMaeSeconds,.9);
  for(const key of ['formalKpiEligible','sourceOriginAuthenticated','resultOriginAuthenticated','externalAnchorAuthenticated','trustedDurableTime'])assert.equal(r[key],false);
  assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');
  assert.equal(f.calls.length,4);assert.deepEqual(f.calls[3].args,[raceId,'10.0.1']);assert.ok(Object.isFrozen(c));
  assert.equal(JSON.stringify([...f.rows]),before);assert.equal(JSON.stringify(f.result),resultBefore);
  assert.doesNotMatch(JSON.stringify(r),/sourceRef|finishOrder|actualTimes|horseName|snapshot_json|rawJson/);
 }finally{globalThis.fetch=old;}
});
for(const [label,change,reason] of [
 ['legacy namespace',f=>f.rows.set('nar-early:v1:'+raceId,'{}'),'NAR_LEGACY_EARLY_REQUIRES_SEPARATE_AUDIT'],
 ['missing bundle',f=>f.rows.delete('nar-initial-research:v1:'+raceId),'NAR_INITIAL_BUNDLE_MISSING'],
 ['missing receipt',f=>f.rows.delete([...f.rows.keys()].find(k=>k.startsWith('nar-commit-'))),'NAR_COMMIT_RECEIPT_MISSING'],
 ['unparseable text',f=>f.rows.set('nar-initial-research:v1:'+raceId,'{'),'NAR_EVIDENCE_READ_OR_TEXT_INVALID'],
 ['oversized text',f=>f.rows.set('nar-initial-research:v1:'+raceId,' '.repeat(300001)),'NAR_EVIDENCE_READ_OR_TEXT_INVALID'],
 ['bundle tamper',f=>{const k='nar-initial-research:v1:'+raceId,b=JSON.parse(f.rows.get(k));b.candidateSignal.reason='TAMPER';f.rows.set(k,JSON.stringify(b));},'NAR_BUNDLE_SEMANTICS_INVALID'],
 ['receipt tamper',f=>{const k=[...f.rows.keys()].find(k=>k.startsWith('nar-commit-')),b=JSON.parse(f.rows.get(k));b.observation.returnedAt++;f.rows.set(k,JSON.stringify(b));},'NAR_RECEIPT_SEMANTICS_INVALID'],
 ['wrong race row',f=>{f.row.race_id='2026-10-07|園田|8';},'NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID'],
 ['wrong model',f=>{f.row.model_version='Legacy';},'NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID'],
 ['wrong result race',f=>{f.result.raceId+='x';},'NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID'],
 ['wrong circuit',f=>{f.result.organization='JRA';},'NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID'],
 ['manual origin',f=>{f.result.resultSource='MANUAL';},'NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID'],
 ['reconstructed schema',f=>{f.result.schemaVersion=2;},'NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID'],
 ['historical result',f=>{f.result.historicalResearch=true;},'NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID'],
 ['result at post',f=>{f.result.fetchedAt=f.row.result_acquired_at='2026-10-07T04:50:00Z';},'NAR_RESULT_TIME_INVALID'],
 ['future result',f=>{f.result.fetchedAt=f.row.result_acquired_at='2026-10-08T05:00:00Z';},'NAR_RESULT_TIME_INVALID'],
 ['unequal acquisition time',f=>{f.row.result_acquired_at='2026-10-07T05:01:00Z';},'NAR_RESULT_TIME_INVALID'],
 ['timezone missing',f=>{f.result.fetchedAt=f.row.result_acquired_at='2026-10-07T14:00:00';},'NAR_RESULT_TIME_INVALID'],
 ['missing runner',f=>{f.result.horses.pop();},'NAR_RESULT_FIELD_INCOMPLETE'],
 ['duplicate runner',f=>{f.result.horses[8].horseNo=1;},'NAR_RESULT_NONFINISH_INACTIVE_OR_AMBIGUOUS'],
 ['dead heat',f=>{f.result.horses[8].position=1;},'NAR_RESULT_NONFINISH_INACTIVE_OR_AMBIGUOUS'],
 ['DNF',f=>{f.result.horses[8].position=null;},'NAR_RESULT_NONFINISH_INACTIVE_OR_AMBIGUOUS'],
 ['scratch',f=>{f.result.horses[8].horseStatus='scratched';},'NAR_RESULT_NONFINISH_INACTIVE_OR_AMBIGUOUS'],
 ['excluded',f=>{f.result.horses[8].eligible=false;},'NAR_RESULT_NONFINISH_INACTIVE_OR_AMBIGUOUS'],
 ['ambiguous position',f=>{f.result.horses[8].positionText='取消';},'NAR_RESULT_NONFINISH_INACTIVE_OR_AMBIGUOUS'],
 ['name mismatch',f=>{f.result.horses[8].horseName='別馬';},'NAR_RESULT_RUNNER_BINDING_INVALID'],
 ['unknown runner',f=>{f.result.horses[8].horseNo=10;},'NAR_RESULT_RUNNER_BINDING_INVALID'],
 ['top3 mismatch',f=>{f.result.finishOrder=[2,1,3];},'NAR_RESULT_RUNNER_BINDING_INVALID'],
 ['contradictory TIME',f=>{f.result.actualTimes['1']='1:30.0';},'NAR_RESULT_TIME_CONFLICT'],
 ['unknown TIME runner',f=>{f.result.actualTimes['99']='1:30.0';},'NAR_RESULT_TIME_RUNNER_INVALID'],
 ['malformed TIME map',f=>{f.result.actualTimes=[];},'NAR_RESULT_TIME_RUNNER_INVALID'],
 ['malformed result JSON',f=>{f.row.result_json='{';},'NAR_RESULT_READ_OR_TEXT_INVALID'],
])test('HOLD without repair: '+label,async()=>{const f=await fixture();change(f);const before=JSON.stringify([...f.rows]);const r=await run(f);assertHeld(r);assert.equal(r.reason,reason);assert.equal(JSON.stringify([...f.rows]),before);});
for(const [label,change,reason] of [
 ['missing model',r=>{delete r.predictionSnapshot.modelVersion;},'NAR_EARLY_MODEL_VERSION_MISSING'],
 ['missing win',r=>{delete r.predictionSnapshot.horses[0].win;},'NAR_EARLY_RUNNERS_OR_PROBABILITIES_INVALID'],
 ['string probability',r=>{r.predictionSnapshot.horses[0].win='20';},'NAR_EARLY_RUNNERS_OR_PROBABILITIES_INVALID'],
 ['out of range probability',r=>{r.predictionSnapshot.horses[0].place=101;},'NAR_EARLY_RUNNERS_OR_PROBABILITIES_INVALID'],
 ['current position',r=>{r.predictionSnapshot.horses[0].position=1;},'NAR_EARLY_RUNNERS_OR_PROBABILITIES_INVALID'],
 ['nested actual result',r=>{r.predictionSnapshot.horses[0].features.actualTime='1:34.0';},'NAR_EARLY_RESULT_DATA_FORBIDDEN'],
 ['result snapshot',r=>{r.predictionSnapshot.resultSnapshot={finishOrder:[1,2,3]};},'NAR_EARLY_RESULT_DATA_FORBIDDEN'],
])test('original sealed missingness stays HOLD: '+label,async()=>{const f=await fixture(change),r=await run(f);assertHeld(r);assert.equal(r.reason,reason);assert.equal(f.calls.length,3);});
for(const observation of [{outcome:'RESOLVED',startedAt:tick,returnedAt:tick+60001},{outcome:'REJECTED',startedAt:tick,returnedAt:tick},{outcome:'UNOBSERVED',startedAt:null,returnedAt:null}])
 test('unconfirmed/late original commit never qualifies: '+observation.outcome+observation.returnedAt,async()=>{assertHeld(await run(await fixture(()=>{},observation)));});
test('future EARLY is held before reading result',async()=>{const f=await fixture();assertHeld(await readNarEarlyOutcome({DB:f.DB,raceId,now:tick-1}));assert.equal(f.calls.length,3);});
test('past-run finish remains legitimate history',async()=>{assert.equal((await run(await fixture(r=>{r.predictionSnapshot.horses[0].features.pastRuns=[{date:'2026-09-01',finish:1}];}))).status,'READY');});
test('missing results stay PENDING rather than losses',async()=>{const f=await fixture();f.row=null;const r=await run(f);assert.equal(r.status,'PENDING');assert.equal(r.comparison,null);});
test('missing TIME has null mean rather than zero',async()=>{const f=await fixture(r=>r.predictionSnapshot.horses.forEach(h=>{h.predictedTime='';})),r=await run(f);assert.equal(r.status,'READY');assert.equal(r.comparison.timeMaeSeconds,null);assert.equal(r.comparison.timeSampleCount,0);});
test('no database or schema yields HOLD, never schema creation',async()=>{
 assertHeld(await readNarEarlyOutcome({raceId,now}));assertHeld(await readNarEarlyOutcome({DB:{prepare(){throw Error('NO_TABLE');}},raceId,now}));
});
test('invalid race/date rejected before DB access',async()=>{for(const id of ['2026-02-30|園田|7','2026-10-07|東京|7',raceId+'x'])assertHeld(await readNarEarlyOutcome({DB:{prepare(){throw Error('NO_READ');}},raceId:id,now}));});
test('NAR cohort routes original evidence, counts exclusions and cannot promote caller flags',async()=>{
 const f=await fixture(),targets=[{organization:'NAR',raceId},{organization:'NAR',raceId:'2026-10-07|園田|8'}];
 const r=await summarizeEarlyEvidenceCohort({DB:f.DB,targets,now,formalKpiEligible:true,sourceOriginAuthenticated:true});
 assert.equal(r.report.contractQualifiedRaceCount,1);assert.equal(r.report.heldRaceCount,1);assert.equal(r.report.NAR.metrics.meanRaceWinBrier,.08);
 assert.equal(r.report.JRA.metrics,null);assert.equal(r.formalKpiEligible,false);assert.equal(r.sourceOriginAuthenticated,false);
 assert.deepEqual(r,await summarizeEarlyEvidenceCohort({DB:f.DB,targets:targets.slice().reverse(),now}));
});
test('real SQLite SELECT queries preserve all stored bytes, no schema repair',async()=>{
 const f=await fixture(),sql=new DatabaseSync(':memory:');
 try{
  for(const table of ['research_nar_early_snapshots','research_nar_initial_bundles','research_nar_commit_observations'])sql.exec(`CREATE TABLE ${table}(storage_key TEXT PRIMARY KEY,snapshot_json TEXT)`);
  for(const [k,v] of f.rows)sql.prepare(`INSERT INTO ${k.startsWith('nar-initial-')?'research_nar_initial_bundles':'research_nar_commit_observations'} VALUES (?,?)`).run(k,v);
  sql.exec('CREATE TABLE races(race_id TEXT,model_version TEXT,result_acquired_at TEXT,result_json TEXT,PRIMARY KEY(race_id,model_version))');
  sql.prepare('INSERT INTO races VALUES (?,?,?,?)').run(raceId,'10.0.1',f.row.result_acquired_at,JSON.stringify(f.result));
  sql.exec('PRAGMA query_only=ON');const before=sql.prepare('SELECT total_changes() AS n').get().n;
  const DB={prepare(q){assert.match(q,/^SELECT\b/);return {bind(...args){return {async first(){return sql.prepare(q).get(...args)||null;}};}};}};
  const r=await readNarEarlyOutcome({DB,raceId,now});assert.equal(r.status,'READY',JSON.stringify(r));
  assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(sql.prepare('SELECT snapshot_json FROM research_nar_initial_bundles').get().snapshot_json,f.rows.get('nar-initial-research:v1:'+raceId));
 }finally{sql.close();}
});
