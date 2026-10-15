import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {runNarVersionedSaveRehearsal as run,runNarVersionedSaveRehearsalCli as cli} from '../scripts/nar-versioned-save-rehearsal.mjs';
import {versionedSaveFixture,REHEARSAL_SCENARIOS} from './fixtures/nar/phase1409-versioned-save-fixtures.mjs';
const url=(path='RaceList',code='22')=>`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/${path}?k_babaCode=${code}&k_raceDate=2026%2F10%2F16&k_raceNo=1`;
function pass(r){assert.equal(r.status,'PASS',JSON.stringify(r));assert.ok(Object.values(r.checks).every(Boolean));assert.equal(r.productionEvidence,false);assert.equal(r.database,'SQLITE_MEMORY');assert.equal(r.transport,'FIXTURE_ONLY');assert.equal(r.researchOnly,true);assert.equal(r.formalKpiEligible,false);assert.equal(r.productionActivationReady,false);assert.equal(r.probabilityStatus,'MODEL_HOLD');assert.equal(r.resultPageRequestCount,0);}
test('Phase140.9 production parsers, identity bridge, SQLite shared store and status/viewer accept both versioned routes',async()=>{
 const original=globalThis.fetch;let externalCalls=0;
 try{globalThis.fetch=async()=>{externalCalls++;throw Error('EXTERNAL_FORBIDDEN');};const r=await run();pass(r);assert.equal(externalCalls,0);assert.equal(r.first.saved,2);assert.equal(r.savedRaceCount,2);assert.equal(r.rejectedRowCount,0);assert.equal(r.sharedObservationCount,8);assert.equal(r.fixtureRequestCount,8);assert.deepEqual(r.races.map(x=>x.track),['金沢','笠松']);
 for(const race of r.races){assert.equal(race.resolvedEpisodeCount,4);assert.equal(race.rollingAvailableCount,4);assert.equal(race.timeCount,2);assert.equal(race.preAnalysisContract,'CHASS_PRE_ANALYSIS_PACK_V4');assert.equal(race.versions.routing.recordedVersion,'NAR_VENUE_ROUTING_22_23_V1');assert.equal(race.versions.history.versionedHorseCount,2);assert.deepEqual(race.versions.history.recordedVersions,['NAR_HISTORY_VENUES_22_23_V1']);}
 }finally{globalThis.fetch=original;}
});
test('Phase140.9 rerun skips both saved races and leaves snapshot/shared bytes unchanged',async()=>{const r=await run();pass(r);assert.equal(r.rerun.attempted,0);assert.equal(r.rerun.saved,0);assert.equal(r.rerun.events.filter(x=>x.reason==='ALREADY_SAVED').length,2);assert.equal(r.checks.readAndRerunNoWrites,true);assert.equal(r.checks.rerunPreservesRows,true);});
test('Phase140.9 wrong-venue card blocks its save while the other route still completes',async()=>{const r=await run('swapped_card');pass(r);assert.equal(r.first.saved,1);assert.equal(r.savedRaceCount,1);assert.equal(r.sharedObservationCount,4);assert.ok(r.first.events.some(x=>x.raceId.includes('-22-')&&x.reason==='CARD_IDENTITY'));assert.equal(r.races[0].track,'笠松');});
test('Phase140.9 failed History link retains ability/TIME and uses explicit HOLD without invented identities',async()=>{const r=await run('history_link_failure');pass(r);assert.equal(r.savedRaceCount,2);assert.equal(r.sharedObservationCount,4);const h=r.races.find(x=>x.track==='金沢');assert.equal(h.timeCount,2);assert.equal(h.linkStatus,'HOLD');assert.equal(h.storeReason,'HISTORY_IDENTITY_UNAVAILABLE');assert.equal(h.resolvedEpisodeCount,0);assert.equal(h.versions.routing.status,'VERSIONED');assert.equal(h.versions.history.notRetainedHorseCount,2);assert.equal(h.versions.history.versionedHorseCount,0);});
test('Phase140.9 TIME candidate gap remains missing while ability and versioned History still save',async()=>{const r=await run('time_gap');pass(r);assert.equal(r.savedRaceCount,2);assert.equal(r.sharedObservationCount,8);const h=r.races.find(x=>x.track==='笠松');assert.equal(h.horseCount,2);assert.equal(h.timeCount,1);assert.equal(h.resolvedEpisodeCount,4);});
test('Phase140.9 unsupported saved version is rejected with recomputed outer hash, without hiding the other route',async()=>{const r=await run('tampered_readback');pass(r);assert.equal(r.first.saved,2);assert.equal(r.savedRaceCount,1);assert.equal(r.rejectedRowCount,1);assert.equal(r.sharedObservationCount,8);assert.equal(r.races.find(x=>x.track==='金沢').readerAccepted,false);assert.equal(r.races.find(x=>x.track==='笠松').readerAccepted,true);assert.equal(r.checks.rerunPreservesRows,true);});
test('Phase140.9 each rehearsal creates a fresh database and never accumulates previous observations',async()=>{const first=await run(),second=await run();pass(first);pass(second);assert.equal(first.sharedObservationCount,8);assert.equal(second.sharedObservationCount,8);assert.equal(second.first.saved,2);});
test('Phase140.9 CLI rejects DB paths, external URLs, arbitrary flags and unsupported scenarios',async()=>{
 for(const args of [['--db','production.sqlite'],['--url','https://PRIVATE'],['--scenario'],['--scenario',''],['--scenario','PRIVATE'],['--scenario','baseline','--write']]){const r=await cli(args);assert.equal(r.status,'REJECTED');assert.equal(r.productionEvidence,false);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}
 assert.equal((await run({DB:'PRIVATE'})).status,'REJECTED');assert.equal(REHEARSAL_SCENARIOS.length,5);
});
test('Phase140.9 synthetic transport refuses result/horse pages, other hosts, codes and dates',()=>{
 for(const u of [url('RaceMarkTable'),url('HorseMarkInfo'),url().replace('www.keiba.go.jp','PRIVATE.example'),url('RaceList','21'),url().replace('2026%2F10%2F16','2026%2F10%2F17')])assert.throws(()=>versionedSaveFixture(u),/FIXTURE_/);
});
test('Phase140.9 direct CLI emits a synthetic PASS report and fails unsupported arguments',()=>{
 const script=fileURLToPath(new URL('../scripts/nar-versioned-save-rehearsal.mjs',import.meta.url)),ok=spawnSync(process.execPath,[script],{encoding:'utf8'});assert.equal(ok.status,0,ok.stderr);pass(JSON.parse(ok.stdout));const bad=spawnSync(process.execPath,[script,'--db','production.sqlite'],{encoding:'utf8'});assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stdout).status,'REJECTED');
});
test('Phase140.9 rehearsal has no production runtime import sites',async()=>{
 for(const name of ['worker.js','worker-entry.mjs','server.mjs','app.js','src/prediction/nar-ability-precompute.mjs'])assert.equal((await readFile(new URL('../'+name,import.meta.url),'utf8')).includes('nar-versioned-save-rehearsal'),false,name);
});
