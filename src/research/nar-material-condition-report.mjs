import {acceptNarMaterialDiagnostics} from './nar-material-diagnostic-acceptance.mjs';
import {buildNarMaterialInvestigationPlan} from './nar-material-investigation-plan.mjs';
import {auditNarVenueCodeComparison} from './nar-venue-comparison-acceptance.mjs';

const flags = {
  schemaVersion: 1, scope: 'ACCEPTED_RETAINED_CONDITIONS_ONLY', researchOnly: true,
  formalKpiEligible: false, acquisitionCertified: false, currentStatusEligible: false,
  probabilityDecision: 'MODEL_HOLD', productionActivationDecision: 'NO-GO',
  diagnosisStatus: 'NOT_ESTABLISHED', taskCompletion: 'NOT_CLAIMED',
  diagnosticProvenance: 'DECLARED_LOCAL_JSON_NOT_AUTHENTICATED',
  transportVerification: 'NOT_PERFORMED_BY_THIS_REPORT',
  venueCodeComparison: 'NOT_EVALUATED', historyCounterOverlap: 'UNKNOWN_DO_NOT_ADD'
};
const origins = ['NAR', 'JRA', 'OTHER', 'UNAVAILABLE'];
const timeFields = ['targetDistance', 'retainedRunCount', 'parsedRunCount',
  'coverageComplete', 'finiteTimeCount', 'exactFiniteTimeCount',
  'within300mFiniteTimeCount', 'invalidDistanceCount', 'nonpositiveTimeCount'];
const historyFields = ['episodeIndex', 'sourceReason', 'origin', 'dateSupported',
  'venueRecognized', 'officialReferenceCount', 'sameMonthDayReferenceCount',
  'sameVenueReferenceCount', 'dateVenueReferenceCount', 'eligibleCandidateCount',
  'sameDateVenueEpisodeCount', 'observation'];
const pick = (value, fields) => Object.fromEntries(fields.map(k => [k, value[k]]));
const tally = values => {
  const result = {};
  for (const value of [...new Set(values)].sort()) result[value] = values.filter(v => v === value).length;
  return result;
};

// Recompute acceptance from both raw inputs. A reader result or prior report
// cannot substitute for the diagnostic response. No IO or mutation ports.
export function reportNarMaterialConditions(bundle, response, options = {}) {
  const hold = reasonCodes => ({...flags, status: 'HOLD', reasonCodes, races: [], totals: null});
  try {
    const source = structuredClone(bundle), diagnostics = structuredClone(response);
    const {expectedDate, mode = 'CURRENT', now = Date.now()} = options;
    const settings = {expectedDate, mode, now};
    const accepted = acceptNarMaterialDiagnostics(source, diagnostics, settings);
    if (!['INSPECTION_READY', 'HISTORICAL_INSPECTION_READY', 'NO_DIAGNOSTIC_TASKS'].includes(accepted.status)) return hold(accepted.reasonCodes);
    const plan = buildNarMaterialInvestigationPlan(source, settings);
    const remainingTasks = plan.races.flatMap(r => r.tasks.map(t => ({
      raceId: r.raceId, kind: t.kind, requiredInput: t.input, observed: t.observed,
      requiredEvidence: t.requiredEvidence,
      status: 'UNRESOLVED', diagnosisStatus: 'NOT_ESTABLISHED'
    })));
    const reference = {
      sourceReference: plan.sourceReference, sourceUsageMode: plan.sourceUsageMode,
      sourceMirrorDecision: plan.sourceMirrorDecision,
      sourceMirrorReasons: plan.sourceMirrorReasons, sourceFreshnessStatus: plan.sourceFreshnessStatus
    };
    if (accepted.status === 'NO_DIAGNOSTIC_TASKS') return {
      ...flags, ...reference, status: 'NO_DIAGNOSTIC_TASKS', reasonCodes: [...accepted.reasonCodes],
      races: [], totals: null, remainingTasks
    };
    const sidecars = new Map(diagnostics.qualityDiagnostics.races.map(r => [r.raceId, r.diagnostics]));
    const races = [...accepted.observations].sort((a, b) => a.raceId.localeCompare(b.raceId)).map(r => {
      const rawHorses = new Map(sidecars.get(r.raceId).horses.map(h => [h.horseNo, h]));
      const time = [], history = [];
      for (const h of [...r.horses].sort((a, b) => a.horseNo - b.horseNo)) {
        const raw = rawHorses.get(h.horseNo);
        if (h.time) time.push({horseNo: h.horseNo, sourceObservation: h.time.sourceObservation,
          observation: h.time.observation, ...pick(raw.conditions.time, timeFields)});
        if (h.history) for (const ref of [...raw.conditions.history.references].sort((a, b) => a.episodeIndex - b.episodeIndex)) {
          const detail = {horseNo: h.horseNo, active: h.active, ...pick(ref, historyFields)};
          if (ref.origin === 'NAR' && ['NO_VENUE_MATCH', 'DATE_VENUE_COMBINATION_UNMATCHED'].includes(ref.observation)) {
            const audit = auditNarVenueCodeComparison(ref);
            if (audit.status !== 'CONSISTENT') throw Error(audit.reasonCodes[0]);
            detail.venueCodeComparison = audit;
          }
          history.push(detail);
        }
      }
      return {raceId: r.raceId, time, history};
    });
    const time = races.flatMap(r => r.time), history = races.flatMap(r => r.history);
    const comparisons = history.filter(h => h.venueCodeComparison).map(h => h.venueCodeComparison.comparison);
    return {
      ...flags, ...reference, venueCodeComparison: comparisons.length ? 'CONSISTENCY_CHECKED' : 'NOT_EVALUATED',
      status: accepted.status === 'HISTORICAL_INSPECTION_READY' ? 'HISTORICAL_CONDITION_REPORT_READY' : 'CONDITION_REPORT_READY',
      reasonCodes: [...accepted.reasonCodes], responseSha256: accepted.responseSha256,
      countScope: 'ACCEPTED_DIAGNOSTIC_RACES_ONLY', acceptedRaceCount: races.length,
      races, totals: {
        activeMissingTimeHorseCount: time.length, timeObservations: tally(time.map(t => t.observation)),
        timeRetainedCoverage: {complete: time.filter(t => t.coverageComplete).length, incomplete: time.filter(t => !t.coverageComplete).length},
        heldHistoryReferenceCount: history.length,
        historyOrigins: Object.fromEntries(origins.map(origin => [origin, history.filter(h => h.origin === origin).length])),
        historyObservations: tally(history.map(h => h.observation)),
        historyOriginObservations: origins.flatMap(origin => Object.entries(tally(history.filter(h => h.origin === origin).map(h => h.observation))).map(([observation, count]) => ({origin, observation, count}))),
        ...(comparisons.length ? {venueCodeComparisons: {
          heldReferenceCount: comparisons.length,
          observations: tally(comparisons.map(c => c.observation))
        }} : {})
      }, remainingTasks, formalReadiness: 'NOT_EVALUATED'
    };
  } catch (e) {
    const reason = ['VENUE_COMPARISON_UNAVAILABLE', 'VENUE_COMPARISON_INVALID'].includes(e?.message) ? e.message : 'CONDITION_REPORT_INPUT_UNREADABLE';
    return hold([reason]);
  }
}
