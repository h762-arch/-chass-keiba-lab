import {compareNarVenueCodes} from './nar-venue-code-comparison.mjs';
// Pure condition observations over retained DATA. No prediction or identity repair.
const unavailable = reasonCode => ({status: 'UNAVAILABLE', reasonCode});
const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000;
const venues = {3:'帯広',10:'盛岡',11:'水沢',18:'浦和',19:'船橋',20:'大井',21:'川崎',22:'笠松',23:'金沢',24:'名古屋',27:'園田',28:'姫路',31:'高知',32:'佐賀',36:'門別'};
const dateText = v => typeof v === 'string' && /^(?:0[1-9]|1[0-2])\.(?:0[1-9]|[12]\d|3[01])$/.test(v);

export function auditNarTimeInputConditions(horse, race) {
  try {
    const targetDistance = race?.race?.distance;
    if (!Number.isInteger(targetDistance) || targetDistance < 800 || targetDistance > 3600) return unavailable('TARGET_DISTANCE_UNAVAILABLE');
    const b = horse.history?.body, episodes = b?.episodes;
    if (![1,2].includes(b?.schemaVersion) || !Array.isArray(episodes) || episodes.length > 5 || b.retainedCount !== episodes.length) return unavailable('RETAINED_EPISODES_UNAVAILABLE');
    const e = horse.evidence;
    const coverageComplete = count(b.parsedCount) && b.parsedCount === episodes.length && e?.schemaVersion === 1 && e.runCount === b.parsedCount;
    const facts = episodes.map(x => x?.facts);
    if (facts.some(f => !f || typeof f !== 'object')) return unavailable('RETAINED_FACTS_UNAVAILABLE');
    const finite = facts.filter(f => Number.isFinite(f.timeSec));
    // Mirrors candidate predicates in worker.js predictTimeFromRuns, no time calculation.
    const exact = finite.filter(f => f.distance === targetDistance);
    const near = finite.filter(f => typeof f.distance === 'number' && Number.isFinite(f.distance) && f.distance > 0 && Math.abs(f.distance - targetDistance) <= 300);
    const invalidDistanceCount = finite.filter(f => typeof f.distance !== 'number' || !Number.isFinite(f.distance) || f.distance <= 0).length;
    const nonpositiveTimeCount = finite.filter(f => f.timeSec <= 0).length;
    const observation = !coverageComplete ? 'RETAINED_COVERAGE_INCOMPLETE' : nonpositiveTimeCount ? 'NONPOSITIVE_TIME_RETAINED' : exact.length ? 'EXACT_TIME_CANDIDATE_PRESENT' : near.length ? 'NEAR_TIME_CANDIDATE_PRESENT' : invalidDistanceCount ? 'DISTANCE_FACTS_UNAVAILABLE' : finite.length ? 'NO_FINITE_TIME_WITHIN_300M' : 'NO_FINITE_TIME_RETAINED';
    return {status:'OBSERVED', scope:'RETAINED_FACTS_ONLY', targetDistance, retainedRunCount:episodes.length,
      parsedRunCount:count(b.parsedCount) ? b.parsedCount : null, coverageComplete,
      finiteTimeCount:finite.length, exactFiniteTimeCount:exact.length, within300mFiniteTimeCount:near.length,
      invalidDistanceCount, nonpositiveTimeCount, observation};
  } catch { return unavailable('CONDITION_AUDIT_ERROR'); }
}

export function auditNarHistoryMatchConditions(horse, race) {
  try {
    const b = horse.history?.body, episodes = b?.episodes, refs = b?.identity?.references;
    if (b?.schemaVersion !== 2 || !Array.isArray(episodes) || episodes.length > 5 || !Array.isArray(refs) || refs.length > 5) return unavailable('IDENTITY_EPISODES_UNAVAILABLE');
    const rows = race?.historyLinks?.body?.rows;
    if (!Array.isArray(rows) || rows.length > 30) return unavailable('OFFICIAL_LINK_ROWS_UNAVAILABLE');
    const matchedRows = rows.filter(r => r?.horseNo === horse.horseNo && r?.horseName === horse.horseName);
    if (matchedRows.length !== 1) return unavailable('RUNNER_LINK_ROW_UNAVAILABLE');
    const official = matchedRows[0].pastRaceReferences;
    if (!Array.isArray(official) || official.length > 5 || official.some(r => typeof r?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !/^\d{1,2}$/.test(String(r.code)))) return unavailable('OFFICIAL_REFERENCES_UNAVAILABLE');
    const held = refs.filter(r => r?.status === 'HOLD'), details = [];
    for (const ref of held) {
      if (!['EPISODE_AMBIGUOUS','EPISODE_LINK_UNMATCHED'].includes(ref.reasonCode)) return unavailable('HELD_REFERENCE_UNSUPPORTED');
      const candidates = episodes.map((e,i) => ({e,i})).filter(({e}) => e?.observationKey === ref.observationKey && e?.contentHash === ref.contentHash);
      if (candidates.length !== 1 || !candidates[0].e.facts) return unavailable('EPISODE_REFERENCE_UNAVAILABLE');
      const {e,i} = candidates[0], f = e.facts;
      const origin = f.originCircuit === 'NAR' ? 'NAR' : f.originCircuit === 'JRA' ? 'JRA' : f.originCircuit ? 'OTHER' : 'UNAVAILABLE';
      const dateSupported = dateText(f.dateText), venueRecognized = Object.values(venues).includes(f.venue);
      const sameMonthDay = dateSupported ? official.filter(r => f.dateText === r.date.slice(5).replace('-','.')) : [];
      const sameVenue = venueRecognized ? official.filter(r => f.venue === venues[Number(r.code)]) : [];
      const combined = sameMonthDay.filter(r => f.venue === venues[Number(r.code)]);
      const sameDateVenueEpisodeCount = episodes.filter(other => other?.facts?.dateText === f.dateText && other?.facts?.venue === f.venue).length;
      // Original bridge checks NAR circuit, month/day and venue, then uniqueness.
      const eligibleCandidateCount = origin === 'NAR' ? combined.length : 0;
      const observation = origin !== 'NAR' ? 'ORIGIN_NOT_NAR' : !dateSupported ? 'DATE_TEXT_UNSUPPORTED' : !venueRecognized ? 'VENUE_NOT_RECOGNIZED' : !official.length ? 'NO_OFFICIAL_PAST_REFERENCES' : !sameMonthDay.length ? 'NO_MONTH_DAY_MATCH' : !sameVenue.length ? 'NO_VENUE_MATCH' : !combined.length ? 'DATE_VENUE_COMBINATION_UNMATCHED' : combined.length > 1 || sameDateVenueEpisodeCount > 1 ? 'MULTIPLE_CANDIDATES_OR_EPISODES' : 'MATCHING_CANDIDATE_PRESENT';
      details.push({episodeIndex:i+1, sourceReason:ref.reasonCode, origin, dateSupported, venueRecognized,
        officialReferenceCount:official.length, sameMonthDayReferenceCount:sameMonthDay.length,
        sameVenueReferenceCount:sameVenue.length, dateVenueReferenceCount:combined.length,
        eligibleCandidateCount, sameDateVenueEpisodeCount, observation, ...(origin === 'NAR' && ['NO_VENUE_MATCH','DATE_VENUE_COMBINATION_UNMATCHED'].includes(observation) ? {venueCodeComparison:compareNarVenueCodes(f, official, venues)} : {})});
    }
    const observations = {};
    for (const d of details) observations[d.observation] = (observations[d.observation] || 0) + 1;
    return {status:'OBSERVED', scope:'RETAINED_IDENTITY_LINKS_ONLY', heldReferenceCount:details.length, observations, references:details};
  } catch { return unavailable('CONDITION_AUDIT_ERROR'); }
}
