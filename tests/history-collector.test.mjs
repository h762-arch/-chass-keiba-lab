import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');

test('meeting-aware collector controls and phase UI exist',()=>{
 for(const id of ['historyCollector','historyPreset','historyStartDate','historyEndDate','historyTrackGrid','historyStart','historyPause','historyReset','historyCacheReset','historyProgressText','historyTrackProgress','historyEfficiency'])assert.match(html,new RegExp(`id=["']${id}["']`));
 assert.match(app,/phase:'meeting_discovery'/);assert.match(app,/phase='collection'/);assert.match(app,/phase='meeting_retry'/);
});

test('collector no longer expands dates tracks and twelve races into a giant plan',()=>{
 assert.doesNotMatch(app,/function historyPlan/);assert.doesNotMatch(app,/for\(let raceNo=1;raceNo<=12;raceNo\+\+\)/);assert.match(app,/historyMeetingPair/);assert.match(app,/\/api\/nar\/meeting\?/);
});

test('historical collection remains separated from realtime prediction',()=>{assert.match(app,/historical_research/);assert.match(app,/backtest_prediction/);assert.match(app,/resultLeakageGuard:true/)});

test('existing race IDs skip both NAR race and result requests',()=>{const collector=app.slice(app.indexOf('async function runHistoricalCollector'),app.indexOf('function pauseHistoricalCollector'));assert.match(collector,/raceCache\[item\.id\]\|\|cloudResearchAudit\.datasetRaceIds/);assert.match(collector,/st\.alreadySaved\+\+/)});

test('collector persists phase cursors, retries unknown meetings and stays sequential',()=>{
 assert.match(app,/HISTORY_COLLECTION_KEY='chass_history_collection_v1'/);assert.match(app,/MEETING_CALENDAR_KEY='chass_meeting_calendar_v1'/);assert.match(app,/meetingCursor/);assert.match(app,/collectionMeetingIndex/);assert.match(app,/raceIndex/);assert.match(app,/attempt<=3/);assert.match(app,/700\+Math\.floor\(Math\.random\(\)\*700\)/);
 const collector=app.slice(app.indexOf('async function runHistoricalCollector'),app.indexOf('function pauseHistoricalCollector'));assert.doesNotMatch(collector,/Promise\.all/);
});

test('progress reset does not erase saved races or meeting cache',()=>{
 const reset=app.slice(app.indexOf('function resetHistoricalCollector'),app.indexOf('async function resetMeetingCalendarCache'));assert.doesNotMatch(reset,/raceCache\s*=|meetingCalendarCache\s*=/);
 const cacheReset=app.slice(app.indexOf('async function resetMeetingCalendarCache'),app.indexOf('function bindHistoricalCollector'));assert.match(cacheReset,/meetingCalendarCache=/);assert.doesNotMatch(cacheReset,/raceCache\s*=/);
});

test('normal skips are separated from real failures',()=>{for(const key of ['nonMeetingDays','raceNotScheduled','resultWaiting','networkFailure','parseFailure','unexpectedFailure'])assert.match(app,new RegExp(key))});
