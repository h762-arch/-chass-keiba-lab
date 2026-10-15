import {auditNarTimeInputConditions,auditNarHistoryMatchConditions} from './nar-quality-condition-audit.mjs';
// Pure diagnostics: only pure helper imports; no IO, hashing or model calls.
// Phase140.3: optional status sidecar after row restoration; never in Viewer/writer.
// Input is restored DATA (predictedTime is string|null), not Viewer horses.
const timeReasons = new Map([
  ['time_missing_no_history', 'UPSTREAM_NO_HISTORY'],
  ['time_missing_no_same_surface', 'UPSTREAM_NO_SAME_SURFACE'],
  ['time_missing_parse', 'UPSTREAM_PARSE_UNAVAILABLE'],
  ['time_missing_unknown', 'UPSTREAM_REASON_UNKNOWN'],
  ['TIME_REASON_UNAVAILABLE', 'UPSTREAM_REASON_UNAVAILABLE']
]);
const historyReasons = ['EPISODE_AMBIGUOUS', 'EPISODE_LINK_UNMATCHED'];
const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000 ? n : null;
const unavailable = reasonCode => ({status: 'UNAVAILABLE', reasonCode});

function timeDiagnostic(h) {
  try {
    if (typeof h.predictedTime === 'string' && h.predictedTime.trim()) return {status: 'AVAILABLE'};
    if (h.predictedTime !== null && h.predictedTime !== undefined && h.predictedTime !== '') return unavailable('TIME_SHAPE_UNSUPPORTED');
    const e = h.evidence;
    if (e?.schemaVersion !== 1) return unavailable('EVIDENCE_NOT_RETAINED');
    const sourceReason = timeReasons.has(e.timeMissingReason) ? e.timeMissingReason : null;
    const runCount = count(e.runCount), sameDistanceCount = count(e.sameDistanceCount), sameTrackCount = count(e.sameTrackCount);
    const countsValid = runCount !== null && sameDistanceCount !== null && sameTrackCount !== null && sameDistanceCount <= runCount && sameTrackCount <= runCount;
    // Evidence gaps describe observations, not a proven cause of missing TIME.
    const evidenceObservation = !countsValid ? 'COUNTS_UNAVAILABLE_OR_INVALID' : runCount === 0 ? 'NO_PARSED_HISTORY' : sameDistanceCount === 0 ? 'NO_SAME_DISTANCE_EVIDENCE' : sameTrackCount === 0 ? 'NO_SAME_TRACK_EVIDENCE' : 'RETAINED_EVIDENCE_PRESENT';
    return {status: 'MISSING', sourceReason, observation: timeReasons.get(sourceReason) || 'UPSTREAM_REASON_UNAVAILABLE', evidenceObservation,
      runCount: countsValid ? runCount : null, sameDistanceCount: countsValid ? sameDistanceCount : null, sameTrackCount: countsValid ? sameTrackCount : null};
  } catch { return unavailable('DIAGNOSTIC_ERROR'); }
}

function historyDiagnostic(h) {
  try {
    const b = h.history?.body;
    if (b?.schemaVersion !== 2) return unavailable('IDENTITY_NOT_RETAINED');
    const refs = b.identity?.references;
    if (!Array.isArray(refs) || refs.length > 100) return unavailable('REFERENCES_UNAVAILABLE_OR_LIMIT');
    const reasonCounts = Object.fromEntries(historyReasons.map(r => [r, 0]));
    let heldReferenceCount = 0;
    for (const ref of refs) {
      if (ref?.status === 'RESOLVED' && ref.reasonCode === null) continue;
      if (ref?.status !== 'HOLD' || !historyReasons.includes(ref.reasonCode)) return unavailable('REFERENCE_UNSUPPORTED');
      heldReferenceCount++;
      reasonCounts[ref.reasonCode]++;
    }
    return {status: 'OBSERVED', heldReferenceCount, reasonCounts};
  } catch { return unavailable('DIAGNOSTIC_ERROR'); }
}

function diagnose(race) {
  const input = race?.horses;
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) return unavailable('HORSES_UNAVAILABLE_OR_LIMIT');
  const horses = [];
  const seen = new Set();
  for (const h of input) {
    const horseNo = h?.horseNo;
    if (!Number.isInteger(horseNo) || horseNo < 1 || horseNo > 30 || seen.has(horseNo)) return unavailable('HORSE_IDENTITY_INVALID');
    seen.add(horseNo);
    const runnerStatus = h.runnerStatus || h.horseStatus || 'active';
    if (!['active', 'scratched', 'excluded', 'withdrawn'].includes(runnerStatus)) return unavailable('RUNNER_STATUS_UNSUPPORTED');
    const time = timeDiagnostic(h), history = historyDiagnostic(h);
    const conditions = {
      time: time.status === 'MISSING' ? auditNarTimeInputConditions(h, race) : {status:'NOT_APPLICABLE'},
      history: history.status === 'OBSERVED' && history.heldReferenceCount > 0 ? auditNarHistoryMatchConditions(h, race) : {status:'NOT_APPLICABLE'}
    };
    horses.push({horseNo, active: runnerStatus === 'active', time, history, conditions});
  }
  const active = horses.filter(h => h.active), missing = active.filter(h => h.time.status === 'MISSING');
  const unavailableTimeCount = active.filter(h => h.time.status === 'UNAVAILABLE').length;
  const observations = {};
  for (const h of missing) observations[h.time.observation] = (observations[h.time.observation] || 0) + 1;
  const observedHistory = horses.filter(h => h.history.status === 'OBSERVED');
  const historyStatus = observedHistory.length === horses.length ? 'OBSERVED' : observedHistory.length ? 'PARTIAL' : 'UNAVAILABLE';
  const partial = unavailableTimeCount > 0 || historyStatus !== 'OBSERVED';
  return {schemaVersion: 1, status: partial ? 'PARTIAL' : 'OBSERVED', researchOnly: true, formalKpiEligible: false, productionActivationReady: false,
    probabilityStatus: 'MODEL_HOLD', horseCount: horses.length, activeHorseCount: active.length,
    time: {status: unavailableTimeCount ? 'PARTIAL' : 'OBSERVED', observedMissingActiveCount: missing.length,
      missingActiveCount: unavailableTimeCount ? null : missing.length, unavailableActiveCount: unavailableTimeCount, observations},
    history: {status: historyStatus, unavailableHorseCount: horses.length - observedHistory.length,
      heldReferenceCount: historyStatus === 'OBSERVED' ? observedHistory.reduce((n, h) => n + h.history.heldReferenceCount, 0) : null,
      reasonCounts: historyStatus === 'OBSERVED' ? Object.fromEntries(historyReasons.map(r => [r, observedHistory.reduce((n, h) => n + h.history.reasonCounts[r], 0)])) : null}, horses};
}

// Always return the same race reference. Never attach diagnostics to DATA,
// quality, Pack or hashes; caller must restore/validate the race independently.
export function diagnoseNarRaceQuality(race) {
  try { return {race, diagnostics: diagnose(race)}; }
  catch { return {race, diagnostics: unavailable('DIAGNOSTIC_ERROR')}; }
}

// Inputs are already restored/verified DATA. This helper does not validate rows.
// Only bounded diagnostic projections leave this function, never DATA references.
export function diagnoseNarRestoredRaceBatch(restoredRaces, {diagnoseRace = diagnoseNarRaceQuality} = {}) {
  try {
    if (!Array.isArray(restoredRaces) || restoredRaces.length > 500) return {schemaVersion: 1, status: 'UNAVAILABLE', reasonCode: 'DIAGNOSTIC_INPUT_INVALID', races: []};
    const races = [];
    for (const entry of restoredRaces) {
      const raceId = entry?.raceId;
      if (typeof raceId !== 'string' || !/^\d{8}-NAR-\d{2}-\d{2}$/.test(raceId)) return {schemaVersion: 1, status: 'UNAVAILABLE', reasonCode: 'DIAGNOSTIC_INPUT_INVALID', races: []};
      let diagnostics;
      try {
        const result = diagnoseRace(entry.data);
        if (result?.race !== entry.data || !['OBSERVED', 'PARTIAL', 'UNAVAILABLE'].includes(result?.diagnostics?.status)) throw Error();
        diagnostics = result.diagnostics;
      } catch { diagnostics = unavailable('DIAGNOSTIC_ERROR'); }
      races.push({raceId, diagnostics});
    }
    return {schemaVersion: 1, status: races.length === 0 ? 'EMPTY' : races.every(r => r.diagnostics.status === 'OBSERVED') ? 'OBSERVED' : 'PARTIAL', races};
  } catch { return {schemaVersion: 1, status: 'UNAVAILABLE', reasonCode: 'DIAGNOSTIC_ERROR', races: []}; }
}
