import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isImportantResearchRecord,researchHash,researchIdentity,researchSyncEnabled,runResearchSyncQueue} from '../research-storage-sync.mjs';
import {runScheduledTasks} from '../worker.js';

test('research identity strictly separates JRA and NAR',()=>{
  assert.deepEqual(researchIdentity({race:{raceType:'JRA',date:'2026-09-06',track:'中山',raceNo:11}},'x'),{organization:'JRA',raceDate:'2026-09-06',track:'中山',raceNo:11});
  assert.deepEqual(researchIdentity({race:{date:'2026-09-06',track:'大井',raceNo:11}},'x'),{organization:'NAR',raceDate:'2026-09-06',track:'大井',raceNo:11});
});

test('feature flags default off and hashes are stable',()=>{
  assert.deepEqual(researchSyncEnabled({}),{drive:false,airtable:false});
  assert.deepEqual(researchSyncEnabled({ENABLE_DRIVE_SYNC:'true',ENABLE_AIRTABLE_INDEX:'1'}),{drive:true,airtable:true});
  assert.equal(researchHash({b:2,a:1}),researchHash({a:1,b:2}));
});

test('Airtable selection keeps only important research records',()=>{
  assert.equal(isImportantResearchRecord({predictionSnapshot:{horses:[{horseNo:1}]}}),false);
  assert.equal(isImportantResearchRecord({predictionSnapshot:{horses:[{horseNo:1,longshotMark:'💎'}]}}),true);
  assert.equal(isImportantResearchRecord({validationSnapshot:{failures:[{code:'MISS'}]}}),true);
});

test('disabled external sync performs no D1 or network work',async()=>{
  const result=await runResearchSyncQueue(null,{});
  assert.deepEqual(result,{processed:0,skipped:true,reason:'disabled'});
});

test('scheduled priority is Auto Result then Historical then Research Sync',async()=>{
  const calls=[];
  const result=await runScheduledTasks({}, {env:{ENABLE_DRIVE_SYNC:'true'},resultRunner:async()=>{calls.push('auto');return {processed:0}},historicalRunner:async()=>{calls.push('historical');return {processed:0}},researchRunner:async()=>{calls.push('research');return {processed:1}}});
  assert.deepEqual(calls,['auto','historical','research']);
  assert.equal(result.research.processed,1);
});

test('migration is additive and source keeps secrets server-side',async()=>{
  const [migration,source,gitignore]=await Promise.all([readFile(new URL('../migrations/0004_research_storage_sync.sql',import.meta.url),'utf8'),readFile(new URL('../research-storage-sync.mjs',import.meta.url),'utf8'),readFile(new URL('../.gitignore',import.meta.url),'utf8')]);
  assert.match(migration,/research_sync_queue/);assert.match(migration,/research_archive_manifest/);assert.match(migration,/research_airtable_manifest/);assert.doesNotMatch(migration,/DROP\s+(?:TABLE|COLUMN)/i);
  assert.match(source,/GOOGLE_DRIVE_REFRESH_TOKEN/);assert.match(source,/AIRTABLE_TOKEN/);assert.doesNotMatch(source,/console\.(?:log|info|warn|error)\([^\n]*(?:TOKEN|SECRET|PASSWORD)/i);
  assert.match(gitignore,/\.env/);
});
