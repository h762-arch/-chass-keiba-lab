import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');

test('historical research collector controls exist',()=>{
  for(const id of ['historyCollector','historyPreset','historyStartDate','historyEndDate','historyTrackGrid','historyStart','historyPause','historyReset','historyProgressText'])
    assert.match(html,new RegExp(`id=["']${id}["']`));
});

test('historical collection is explicitly separated from realtime prediction',()=>{
  assert.match(app,/historical_research/);
  assert.match(app,/backtest_prediction/);
  assert.match(app,/resultLeakageGuard:true/);
});

test('existing race ids are skipped rather than overwritten',()=>{
  assert.match(app,/raceCache\[item\.id\]\|\|cloudResearchAudit\.datasetRaceIds/);
});

test('collector persists cursor and uses throttled sequential fetch',()=>{
  assert.match(app,/HISTORY_COLLECTION_KEY='chass_history_collection_v1'/);
  assert.match(app,/st\.cursor=i\+1/);
  assert.match(app,/700\+Math\.floor\(Math\.random\(\)\*700\)/);
});
