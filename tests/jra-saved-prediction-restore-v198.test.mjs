import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');

test('v1.9.8 exact saved prediction restore is installed',()=>{
  assert.match(app,/CHASS-JRA-SAVED-PREDICTION-RESTORE-v1\.9\.8/);
  assert.match(app,/function exactSavedJraRace\(draft\)/);
  assert.match(app,/function activateJraSelectionState\(draft,\{renderNow=true\}=\{\}\)/);
});

test('saved prediction lookup is exact JRA race identity only',()=>{
  const start=app.indexOf('function exactSavedJraRace');
  const end=app.indexOf('\nfunction activateJraSelectionState',start);
  assert.ok(start>=0&&end>start);
  const body=app.slice(start,end);
  assert.match(body,/source\?\.\[nextId\]/);
  assert.match(body,/saved\?\.predictionSnapshot/);
  assert.match(body,/recordIdentity\.organization!=='JRA'/);
  assert.match(body,/recordIdentity\.raceId!==nextId/);
  assert.match(body,/predictionIdentity\.organization!=='JRA'/);
  assert.match(body,/predictionIdentity\.raceId!==nextId/);
});

test('restore is attempted before clean empty fallback',()=>{
  const start=app.indexOf('function activateJraSelectionState');
  const end=app.indexOf('\nfunction ensureJraRaceSelectionState',start);
  assert.ok(start>=0&&end>start);
  const body=app.slice(start,end);
  const restore=body.indexOf("restoreSavedRace(saved,{organization:'JRA',raceId:nextId})");
  const blank=body.indexOf("state=emptyRaceState('JRA')");
  assert.ok(restore>=0&&blank>restore);
  assert.match(body,/saveCurrentRace\(nextId\)/);
});

test('all JRA selection paths use restore-aware transition',()=>{
  assert.match(app,/return activateJraSelectionState\(jraDraftFromSelection\(\),\{renderNow\}\)/);
  assert.match(app,/if\(mode==='JRA'\)return activateJraSelectionState\(next,\{renderNow:false\}\)/);
});

test('v1.9.7 odds and result identity guards remain',()=>{
  assert.match(app,/CHASS-JRA-RACE-STATE-ISOLATION-v1\.9\.7/);
  assert.match(app,/if\(!same\|\|!jraPayloadMatchesActive\(data\)\)return false;/);
  assert.match(app,/layerMatchesActive\(state,state\.predictionSnapshot,'prediction'\)/);
});
