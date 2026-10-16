import {isDeepStrictEqual} from 'node:util';
import {compareNarVenueCodes} from '../prediction/nar-venue-code-comparison.mjs';
import {narHistoryVenues, CURRENT_NAR_HISTORY_VENUE_VERSION} from '../prediction/nar-history-venue-mapping.mjs';
import {validMirrorDate} from './nar-status-mirror-audit.mjs';

const flags = {
  scope: 'DECLARED_VENUE_COMPARISON_CONSISTENCY_ONLY', researchOnly: true,
  formalKpiEligible: false, acquisitionCertified: false,
  probabilityDecision: 'MODEL_HOLD', productionActivationDecision: 'NO-GO',
  diagnosisStatus: 'NOT_ESTABLISHED', taskCompletion: 'NOT_CLAIMED',
  identityDecision: 'UNCHANGED', baselineVersionAuthenticated: false
};
const fields = ['schemaVersion', 'status', 'scope', 'factMonthDay', 'factVenue',
  'baselineDateVenueCandidateCount', 'comparisonDateVenueCandidateCount',
  'verifiedDateVenueCandidateCount', 'codeMapDisagreementCount', 'observation'];
const refFields = ['referenceIndex', 'date', 'code', 'baselineVenue', 'comparisonVenue',
  'mappingBasis', 'codeMapDisagrees', 'monthDayMatches', 'baselineVenueMatches', 'comparisonVenueMatches'];
const pick = (value, keys) => Object.fromEntries(keys.map(k => [k, value[k]]));
const count = v => Number.isInteger(v) && v >= 0 && v <= 5;
const ensure = ok => {if (!ok) throw Error();};

// Compatibility with a table is not proof of the stored identity's rule version.
// This function performs no fetching, identity attachment, hash rewrite or repair.
export function auditNarVenueCodeComparison(reference) {
  const hold = reason => ({...flags, status: 'HOLD', reasonCodes: [reason], comparison: null});
  try {
    const r = structuredClone(reference);
    if (r?.origin !== 'NAR' || !['NO_VENUE_MATCH', 'DATE_VENUE_COMBINATION_UNMATCHED'].includes(r.observation)) {
      return {...flags, status: 'NOT_APPLICABLE', reasonCodes: [], comparison: null};
    }
    const c = r.venueCodeComparison;
    if (!c || c.status === 'UNAVAILABLE') return hold('VENUE_COMPARISON_UNAVAILABLE');
    ensure(Array.isArray(c.references) && c.references.length > 0 && c.references.length <= 5);
    ensure(typeof c.factMonthDay === 'string' && /^\d{2}\.\d{2}$/.test(c.factMonthDay) && validMirrorDate('2000-' + c.factMonthDay.replace('.', '-')));
    ensure(typeof c.factVenue === 'string' && Object.values(narHistoryVenues()).includes(c.factVenue));
    ensure(c.references.every(ref => validMirrorDate(ref?.date) && typeof ref.code === 'string' && /^\d{2}$/.test(ref.code)));
    const supplied = {...pick(c, fields), references: c.references.map(ref => pick(ref, refFields))};
    const compatible = [];
    for (const version of [undefined, CURRENT_NAR_HISTORY_VENUE_VERSION]) {
      const recomputed = compareNarVenueCodes(
        {originCircuit: 'NAR', dateText: c.factMonthDay, venue: c.factVenue},
        c.references.map(ref => ({date: ref.date, code: ref.code})), narHistoryVenues(version)
      );
      if (isDeepStrictEqual(supplied, recomputed)) compatible.push({version: version ?? 'LEGACY_UNVERSIONED', comparison: recomputed});
    }
    ensure(compatible.length > 0);
    const comparison = compatible[0].comparison, refs = comparison.references;
    for (const k of ['officialReferenceCount', 'sameMonthDayReferenceCount', 'sameVenueReferenceCount', 'dateVenueReferenceCount', 'eligibleCandidateCount', 'sameDateVenueEpisodeCount']) ensure(count(r[k]));
    ensure(r.dateSupported === true && r.venueRecognized === true && r.sameDateVenueEpisodeCount >= 1);
    ensure(r.officialReferenceCount === refs.length && r.sameMonthDayReferenceCount === refs.filter(ref => ref.monthDayMatches).length &&
      r.sameVenueReferenceCount === refs.filter(ref => ref.baselineVenueMatches).length &&
      r.dateVenueReferenceCount === comparison.baselineDateVenueCandidateCount && r.eligibleCandidateCount === r.dateVenueReferenceCount);
    ensure(r.sameMonthDayReferenceCount > 0 && r.dateVenueReferenceCount === 0 &&
      (r.observation === 'NO_VENUE_MATCH' ? r.sameVenueReferenceCount === 0 : r.sameVenueReferenceCount > 0));
    return {...flags, status: 'CONSISTENT', reasonCodes: [],
      evidenceBasis: 'DECLARED_DIAGNOSTIC_FIELDS_RECOMPUTED',
      baselineCompatibility: compatible.map(v => v.version), comparison};
  } catch { return hold('VENUE_COMPARISON_INVALID'); }
}
