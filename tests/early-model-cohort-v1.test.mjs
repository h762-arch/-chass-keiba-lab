import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,now} from './helpers/nar-outcome-fixture-v1.mjs';
import {summarizeEarlyEvidenceCohort as summarize} from '../src/research/early-kpi-cohort-v1.mjs';
import {auditEarlyOutcomeSqliteV1 as audit} from '../src/research/early-outcome-sqlite-audit-v1.mjs';
const make=(raceNo,modelVersion='model-A',change=()=>{},runnerCount=9)=>fixture(r=>{r.predictionSnapshot.modelVersion=modelVersion;change(r);},undefined,{raceNo,runnerCount});
const stronger=r=>r.predictionSnapshot.horses.forEach((h,i)=>{h.win=i?2.5:80;h.place=i?26.25:90;});
const target=f=>({organization:'NAR',raceId:f.row.race_id});
function database(fixtures){
 const raw=new Map(fixtures.flatMap(f=>[...f.rows])),calls=[];
 return {calls,prepare(sql){assert.match(sql,/^SELECT\b/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|PRAGMA)\b/i);
  return {bind(...args){return {async first(){calls.push({sql,args});
   if(sql.includes('FROM races ')){const f=fixtures.find(f=>f.row.race_id===args[0]&&f.row.model_version===args[1]);return !f||f.missingResult?null:{...f.row,result_json:JSON.stringify(f.result)};}
   const value=raw.get(args[0]);return value===undefined?null:sql.startsWith('SELECT 1 ')?{present:1}:{raw:value};
  }};}};
 }};
}
const run=fixtures=>summarize({DB:database(fixtures),targets:fixtures.map(target),now});
const safe=r=>{assert.equal(r.formalKpiEligible,false);assert.equal(r.sourceOriginAuthenticated,false);assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');for(const model of r.report.NAR.models){assert.equal(model.formalKpiEligible,false);assert.equal(model.sourceOriginAuthenticated,false);assert.equal(model.formalKpiReadiness,'HOLD');assert.equal(model.productionActivationDecision,'NO-GO');}};
test('single model preserves existing metrics and identifies their exact version',async()=>{
 const f=await make(7),r=await run([f]),n=r.report.NAR;assert.equal(n.modelScope,'SINGLE_MODEL_VERSION');assert.equal(n.mixedModelAggregateWithheld,false);
 assert.equal(r.modelBoundaryVersion,'CHASS_EARLY_MODEL_COHORT_BOUNDARY_V1');
 assert.equal(n.models.length,1);assert.equal(n.models[0].modelVersion,'model-A');assert.equal(n.metrics.meanRaceWinBrier,.08);assert.deepEqual(n.metrics,n.models[0].metrics);safe(r);
});
test('different versions get separate means and no mixed-model aggregate',async()=>{
 const a=await make(7),b=await make(8,'model-B',stronger),r=await run([a,b]),n=r.report.NAR;
 assert.equal(n.modelScope,'MULTIPLE_MODEL_VERSIONS_SEPARATED');assert.equal(n.mixedModelAggregateWithheld,true);assert.equal(n.metrics,null);
 assert.deepEqual(n.models.map(m=>[m.modelVersion,m.contractQualifiedRaceCount,m.metrics.meanRaceWinBrier]),[['model-A',1,.08],['model-B',1,.005]]);
 assert.equal(r.report.contractQualifiedRaceCount,2);assert.equal(r.report.heldRaceCount,0);assert.equal(r.report.JRA.metrics,null);safe(r);
});
test('same version retains the mean of race means',async()=>{const r=await run([await make(7),await make(8,'model-A',stronger)]);assert.equal(r.report.NAR.models.length,1);assert.equal(r.report.NAR.metrics.meanRaceWinBrier,.0425);assert.equal(r.report.NAR.models[0].contractQualifiedRaceCount,2);});
test('unequal field sizes do not become runner-weighted model means',async()=>{
 const small=await make(8,'model-A',r=>r.predictionSnapshot.horses.forEach(h=>{h.win=100/3;h.place=100;}),3),r=await run([await make(7),small]),m=r.report.NAR.metrics;
 assert.equal(m.unit,'MEAN_OF_RACE_MEANS');assert.equal(m.matchedRunnerCount,12);assert.equal(m.meanRaceWinBrier,.151111);assert.notEqual(m.meanRaceWinBrier,.115556);
});
test('TIME missingness stays within each model and null is not zero',async()=>{
 const r=await run([await make(7),await make(8,'model-B',r=>r.predictionSnapshot.horses.forEach(h=>{h.predictedTime='';}))]),[a,b]=r.report.NAR.models;
 assert.equal(a.metrics.timeSampleCount,9);assert.equal(a.metrics.timeRaceCount,1);assert.equal(a.metrics.meanRaceTimeMaeSeconds,.9);
 assert.equal(b.metrics.timeSampleCount,0);assert.equal(b.metrics.timeRaceCount,0);assert.equal(b.metrics.meanRaceTimeMaeSeconds,null);
});
test('same-model TIME mean excludes only missing-TIME races',async()=>{const r=await run([await make(7),await make(8,'model-A',r=>r.predictionSnapshot.horses.forEach(h=>{h.predictedTime='';}))]);assert.equal(r.report.NAR.metrics.meanRaceTimeMaeSeconds,.9);assert.equal(r.report.NAR.metrics.timeRaceCount,1);assert.equal(r.report.NAR.models[0].contractQualifiedRaceCount,2);});
test('pending version is excluded without inventing a model score or loss',async()=>{const a=await make(7),b=await make(8,'model-B');b.missingResult=true;const r=await run([a,b]);assert.equal(r.report.NAR.models.length,1);assert.equal(r.report.heldRaceCount,1);assert.equal(r.report.reasonCounts.NAR_STORED_RESULT_MISSING,1);assert.equal(r.report.NAR.metrics.meanRaceWinBrier,.08);safe(r);});
test('all pending means empty groups and null metrics',async()=>{const a=await make(7);a.missingResult=true;const r=await run([a]);assert.deepEqual(r.report.NAR.models,[]);assert.equal(r.report.NAR.metrics,null);assert.equal(r.report.NAR.modelScope,'NO_QUALIFIED_MODEL');assert.equal(r.report.NAR.mixedModelAggregateWithheld,false);});
test('malformed original version has no fallback to current app/model',async()=>{const a=await make(7,'');const r=await run([a]);assert.equal(r.report.reasonCounts.NAR_EARLY_MODEL_VERSION_MISSING,1);assert.deepEqual(r.report.NAR.models,[]);});
test('version strings are exact identities and never normalized into one model',async()=>{const r=await run([await make(7,'model-A'),await make(8,'model-A ')]);assert.equal(r.report.NAR.models.length,2);assert.equal(r.report.NAR.metrics,null);});
test('prototype-looking version is a harmless array entry, not an object key',async()=>{const r=await run([await make(7,'__proto__'),await make(8,'constructor')]);assert.deepEqual(r.report.NAR.models.map(m=>m.modelVersion),['__proto__','constructor']);assert.equal({}.polluted,undefined);safe(r);});
test('target order does not change sorted model groups or cohort',async()=>{const a=await make(7,'Z'),b=await make(8,'A');assert.deepEqual(await run([a,b]),await run([b,a]));});
test('model groups and inputs are immutable; outputs contain no result details',async()=>{const a=await make(7),before=JSON.stringify([...a.rows]),resultBefore=JSON.stringify(a.result),r=await run([a]);assert.ok(Object.isFrozen(r.report.NAR.models));assert.ok(Object.isFrozen(r.report.NAR.models[0].metrics));assert.equal(JSON.stringify([...a.rows]),before);assert.equal(JSON.stringify(a.result),resultBefore);assert.doesNotMatch(JSON.stringify(r),/sourceRef|horseName|finishOrder|actualTimes|snapshot_json/);});
test('optimistic caller flags do not promote model groups',async()=>{const a=await make(7),r=await summarize({DB:database([a]),targets:[target(a)],now,formalKpiEligible:true,sourceOriginAuthenticated:true});safe(r);});
test('model grouping adds no database reads or acquisition',async()=>{const a=await make(7),b=await make(8,'model-B'),DB=database([a,b]),old=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};try{const r=await summarize({DB,targets:[target(b),target(a)],now});assert.equal(DB.calls.length,8);assert.equal(r.report.NAR.models.length,2);}finally{globalThis.fetch=old;}});
test('existing read-only SQLite and CLI deliver separated model groups unchanged',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'chass-model-groups-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const evidence=join(dir,'evidence.sqlite'),results=join(dir,'results.sqlite'),targets=join(dir,'targets.json'),fixtures=[await make(7),await make(8,'model-B',stronger)],e=new DatabaseSync(evidence),s=new DatabaseSync(results);
 try{for(const table of ['research_nar_early_snapshots','research_nar_initial_bundles','research_nar_commit_observations'])e.exec(`CREATE TABLE ${table}(storage_key TEXT PRIMARY KEY,snapshot_json TEXT)`);
  s.exec('CREATE TABLE races(race_id TEXT,model_version TEXT,result_acquired_at TEXT,result_json TEXT,PRIMARY KEY(race_id,model_version))');
  for(const f of fixtures){for(const [k,raw] of f.rows)e.prepare(`INSERT INTO ${k.startsWith('nar-initial-')?'research_nar_initial_bundles':'research_nar_commit_observations'} VALUES (?,?)`).run(k,raw);
   s.prepare('INSERT INTO races VALUES (?,?,?,?)').run(f.row.race_id,f.row.model_version,f.row.result_acquired_at,JSON.stringify(f.result));}
 }finally{e.close();s.close();}
 writeFileSync(targets,JSON.stringify(fixtures.map(target)));const before=[readFileSync(evidence),readFileSync(results)];
 const r=await audit(JSON.stringify({evidenceDbPath:evidence,resultsDbPath:results,targets:fixtures.map(target),evaluatedAt:new Date(now).toISOString()}));
 assert.equal(r.status,'READ_COMPLETE');assert.equal(r.report.modelBoundaryVersion,'CHASS_EARLY_MODEL_COHORT_BOUNDARY_V1');assert.equal(r.report.NAR.metrics,null);assert.equal(r.report.NAR.models.length,2);assert.equal(r.filesUnchanged,true);safe(r);
 const p=spawnSync(process.execPath,[new URL('../scripts/audit-early-outcome-sqlite-v1.mjs',import.meta.url).pathname,'--evidence-db',evidence,'--results-db',results,'--targets',targets],{encoding:'utf8',timeout:15000});
 assert.equal(p.status,0,p.stderr);const cli=JSON.parse(p.stdout);assert.equal(cli.report.NAR.metrics,null);assert.equal(cli.report.NAR.mixedModelAggregateWithheld,true);assert.deepEqual(cli.report.NAR.models,r.report.NAR.models);safe(cli);
 assert.deepEqual(readFileSync(evidence),before[0]);assert.deepEqual(readFileSync(results),before[1]);
});
