import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {diagnoseNarRaceQuality as diagnose} from '../src/prediction/nar-quality-diagnostics.mjs';

const history = (refs = []) => ({body: {schemaVersion: 2, identity: {references: refs}}});
const held = reasonCode => ({status: 'HOLD', reasonCode});
const evidence = (extra = {}) => ({schemaVersion: 1, timeMissingReason: 'time_missing_unknown', runCount: 2, sameDistanceCount: 1, sameTrackCount: 1, ...extra});
const horse = (extra = {}) => ({horseNo: 1, runnerStatus: 'active', predictedTime: null, evidence: evidence(), history: history(), ...extra});
const run = h => diagnose({horses: [h]}).diagnostics;
const freeze = x => {if (x && typeof x === 'object') {Object.values(x).forEach(freeze); Object.freeze(x);} return x;};

test('deterministic output, frozen DATA and race reference are preserved', () => {
  const race = freeze({horses: [horse()], quality: {abilityComplete: true}, snapshotHash: 'original', preAnalysisPack: {packHash: 'original'}, mark: '◎'});
  const before = JSON.stringify(race), a = diagnose(race), b = diagnose(race);
  assert.strictEqual(a.race, race); assert.deepEqual(a, b); assert.equal(JSON.stringify(race), before);
  a.diagnostics.horses[0].history.reasonCounts.EPISODE_AMBIGUOUS = 9;
  assert.equal(b.diagnostics.horses[0].history.reasonCounts.EPISODE_AMBIGUOUS, 0);
});

test('unknown upstream reason remains unknown despite retained evidence gaps', () => {
  for (const [extra, expected] of [[{runCount: 0, sameDistanceCount: 0, sameTrackCount: 0}, 'NO_PARSED_HISTORY'], [{sameDistanceCount: 0}, 'NO_SAME_DISTANCE_EVIDENCE'], [{sameTrackCount: 0}, 'NO_SAME_TRACK_EVIDENCE'], [{}, 'RETAINED_EVIDENCE_PRESENT']]) {
    const t = run(horse({evidence: evidence(extra)})).horses[0].time;
    assert.equal(t.sourceReason, 'time_missing_unknown'); assert.equal(t.observation, 'UPSTREAM_REASON_UNKNOWN'); assert.equal(t.evidenceObservation, expected);
  }
});

test('known upstream TIME reasons are copied only from the allowlist', () => {
  for (const [reason, observation] of [['time_missing_no_history', 'UPSTREAM_NO_HISTORY'], ['time_missing_no_same_surface', 'UPSTREAM_NO_SAME_SURFACE'], ['time_missing_parse', 'UPSTREAM_PARSE_UNAVAILABLE'], ['TIME_REASON_UNAVAILABLE', 'UPSTREAM_REASON_UNAVAILABLE']]) {
    assert.equal(run(horse({evidence: evidence({timeMissingReason: reason})})).horses[0].time.observation, observation);
  }
});

test('unsupported reason cannot leak arbitrary text', () => {
  const d = run(horse({evidence: evidence({timeMissingReason: 'PRIVATE_REASON'})}));
  assert.equal(d.horses[0].time.sourceReason, null); assert.equal(JSON.stringify(d).includes('PRIVATE_REASON'), false);
});

test('legacy evidence is unavailable, never replaced with fabricated zero counts', () => {
  for (const e of [null, undefined, {schemaVersion: 99}]) {
    const d = run(horse({evidence: e}));
    assert.equal(d.time.missingActiveCount, null); assert.equal(d.time.unavailableActiveCount, 1);
    assert.equal(d.horses[0].time.reasonCode, 'EVIDENCE_NOT_RETAINED');
  }
});

test('invalid counts and contradictory subsets remain unavailable', () => {
  for (const patch of [{runCount: -1}, {runCount: '2'}, {runCount: Infinity}, {runCount: 1001}, {sameDistanceCount: 3}, {sameTrackCount: null}]) {
    const t = run(horse({evidence: evidence(patch)})).horses[0].time;
    assert.equal(t.evidenceObservation, 'COUNTS_UNAVAILABLE_OR_INVALID'); assert.equal(t.runCount, null);
  }
});

test('available TIME does not read irrelevant missing-TIME evidence', () => {
  const h = horse({predictedTime: '1:40.0'}); Object.defineProperty(h, 'evidence', {get() {throw Error('private');}});
  const d = run(h); assert.deepEqual(d.horses[0].time, {status: 'AVAILABLE'}); assert.equal(d.time.missingActiveCount, 0);
});

test('Viewer TIME object is not silently accepted as restored DATA', () => {
  const d = run(horse({predictedTime: {text: '1:40.0'}}));
  assert.equal(d.horses[0].time.reasonCode, 'TIME_SHAPE_UNSUPPORTED'); assert.equal(d.time.missingActiveCount, null);
});

test('HOLD references count independently from horses and resolved references', () => {
  const d = run(horse({history: history([held('EPISODE_AMBIGUOUS'), held('EPISODE_LINK_UNMATCHED'), {status: 'RESOLVED', reasonCode: null}])}));
  assert.equal(d.history.heldReferenceCount, 2); assert.deepEqual(d.history.reasonCounts, {EPISODE_AMBIGUOUS: 1, EPISODE_LINK_UNMATCHED: 1});
});

test('unknown reference never produces misleading partial total or leaks content', () => {
  const d = diagnose({horses: [horse(), horse({horseNo: 2, history: history([held('PRIVATE_REASON')])})]}).diagnostics;
  assert.equal(d.history.status, 'PARTIAL'); assert.equal(d.history.heldReferenceCount, null); assert.equal(d.history.reasonCounts, null); assert.equal(d.history.unavailableHorseCount, 1);
  assert.equal(JSON.stringify(d).includes('PRIVATE_REASON'), false);
});

test('legacy history and absent references remain unavailable', () => {
  for (const h of [null, {body: {schemaVersion: 1}}, {body: {schemaVersion: 2, identity: {}}}]) {
    const d = run(horse({history: h})); assert.equal(d.history.status, 'UNAVAILABLE'); assert.equal(d.history.heldReferenceCount, null);
  }
});

test('oversized references are bounded rather than truncated into an exact total', () => {
  const d = run(horse({history: history(Array.from({length: 101}, () => held('EPISODE_AMBIGUOUS')))}));
  assert.equal(d.history.heldReferenceCount, null); assert.equal(d.horses[0].history.reasonCode, 'REFERENCES_UNAVAILABLE_OR_LIMIT');
});

test('inactive TIME excluded from active summary, history still covers all horses', () => {
  const d = diagnose({horses: [horse({predictedTime: '1:40.0'}), horse({horseNo: 2, runnerStatus: 'scratched', history: history([held('EPISODE_AMBIGUOUS')])})]}).diagnostics;
  assert.equal(d.activeHorseCount, 1); assert.equal(d.time.missingActiveCount, 0); assert.equal(d.history.heldReferenceCount, 1);
});

test('exceptions in optional evidence are isolated from history and race', () => {
  const h = horse(); Object.defineProperty(h, 'evidence', {get() {throw Error('PRIVATE_ERROR');}});
  const race = {horses: [h]}, out = diagnose(race);
  assert.strictEqual(out.race, race); assert.equal(out.diagnostics.horses[0].time.reasonCode, 'DIAGNOSTIC_ERROR'); assert.equal(out.diagnostics.history.heldReferenceCount, 0);
  assert.equal(JSON.stringify(out.diagnostics).includes('PRIVATE_ERROR'), false);
});

test('exceptions in history leave available TIME untouched', () => {
  const h = horse({predictedTime: '1:40.0'}); Object.defineProperty(h, 'history', {get() {throw Error('PRIVATE_ERROR');}});
  const d = run(h); assert.equal(d.time.missingActiveCount, 0); assert.equal(d.history.heldReferenceCount, null);
});

test('top-level diagnostic exception always returns identical race', () => {
  const race = {}; Object.defineProperty(race, 'horses', {get() {throw Error('PRIVATE_ERROR');}});
  const out = diagnose(race); assert.strictEqual(out.race, race); assert.deepEqual(out.diagnostics, {status: 'UNAVAILABLE', reasonCode: 'DIAGNOSTIC_ERROR'});
});

test('bad containers, sparse rows, duplicate and invalid identity preserve race', () => {
  for (const race of [null, {}, {horses: []}, {horses: new Array(2)}, {horses: [null]}, {horses: [horse(), horse()]}, {horses: [horse({horseNo: '1'})]}, {horses: [horse({runnerStatus: 'unknown'})]}, {horses: Array.from({length: 31}, (_, i) => horse({horseNo: i + 1}))}]) {
    const out = diagnose(race); assert.strictEqual(out.race, race); assert.equal(out.diagnostics.status, 'UNAVAILABLE');
  }
});

test('synthetic 9 missing TIME and 32 held references are counted exactly, not production evidence', () => {
  const horses = Array.from({length: 12}, (_, i) => horse({horseNo: i + 1, predictedTime: i < 9 ? null : '1:40.0', history: history(Array.from({length: i < 8 ? 3 : 2}, () => held(i % 2 ? 'EPISODE_AMBIGUOUS' : 'EPISODE_LINK_UNMATCHED')))}));
  const d = diagnose(freeze({horses})).diagnostics;
  assert.equal(d.time.missingActiveCount, 9); assert.equal(d.history.heldReferenceCount, 32); assert.equal(d.history.reasonCounts.EPISODE_AMBIGUOUS, 16); assert.equal(d.history.reasonCounts.EPISODE_LINK_UNMATCHED, 16);
});

test('diagnostic output carries no market, raw errors, decisions or probability values', () => {
  const d = run(horse({secret: 'PRIVATE', odds: 99, mark: '◎', win: 0.9, history: history([{status: 'RESOLVED', reasonCode: null, privateUrl: 'PRIVATE'}])}));
  const txt = JSON.stringify(d); for (const s of ['PRIVATE', 'odds', 'mark', 'win']) assert.equal(txt.includes(s), false);
  assert.equal(d.researchOnly, true); assert.equal(d.formalKpiEligible, false); assert.equal(d.productionActivationReady, false); assert.equal(d.probabilityStatus, 'MODEL_HOLD');
});

test('module remains unreferenced by other prediction modules and runtime roots', async () => {
  const dir = new URL('../src/prediction/', import.meta.url);
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.mjs') || name === 'nar-quality-diagnostics.mjs') continue;
    assert.equal((await readFile(new URL(name, dir), 'utf8')).includes('nar-quality-diagnostics'), false, name);
  }
  for (const name of ['worker.js', 'worker-entry.mjs', 'app.js', 'server.mjs']) assert.equal((await readFile(new URL('../' + name, import.meta.url), 'utf8')).includes('nar-quality-diagnostics'), false, name);
});
