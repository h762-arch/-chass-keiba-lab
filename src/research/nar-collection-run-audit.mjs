import {isDeepStrictEqual} from 'node:util';
import {auditNarStatusMirror} from './nar-status-mirror-audit.mjs';

const flags = {scope: 'RECORDED_NAR_COLLECTION_RUN_ONLY', sourceReferenceBasis: 'DECLARED_LOCAL_BUNDLE',
  researchOnly: true, formalKpiEligible: false, acquisitionCertified: false, currentStatusEligible: false,
  probabilityDecision: 'MODEL_HOLD', productionActivationDecision: 'NO-GO', diagnosisStatus: 'NOT_ESTABLISHED'};
const tracks = {'10':'盛岡','11':'水沢','18':'浦和','19':'船橋','20':'大井','21':'川崎','22':'金沢','23':'笠松','24':'名古屋','27':'園田','28':'姫路','31':'高知','32':'佐賀','36':'門別'};
const routes = ['RaceList', 'RaceList_ipat', 'RaceList_mobile'];
const sourceReasons = ['SOURCE_DEADLINE','SOURCE_HTTP','SOURCE_SIZE','SOURCE_URL','SOURCE_DECODE','MEETING_UNCONFIRMED','MEETING_SOURCE_FAILED'];
const meetingReasons = ['MEETING_SOURCE_UNAVAILABLE','MEETING_UNAVAILABLE','MEETING_UNCONFIRMED','MEETING_CONFIGURATION_INVALID'];
const benign = ['SAVED','ALREADY_SAVED','NON_MEETING','NOT_SELECTED_LIMIT'];
const reasons = [...meetingReasons,...benign,'DEADLINE','POST_TIME_REACHED','POST_TIME_UNKNOWN','ABILITY_INSUFFICIENT','CONFIGURATION_INVALID','SCHEMA_UNAVAILABLE','CARD_IDENTITY','SOURCE_OR_SAVE_FAILED','DATED_TRIAL_CONFIGURATION_INVALID','AUTO_RESULT_PRIORITY'];
const statuses = ['COMPLETED','SKIPPED','BLOCKED','STOPPED','NOT_STARTED','DISABLED','SCHEDULED','INVALID','UNKNOWN'];
const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 1000000;
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const ensure = (ok, code) => {if (!ok) throw Error(code);};
const safeReason = v => reasons.includes(v) ? v : 'UNRECOGNIZED_RECORDED_REASON';

// The mirror verdict and the latest retained collection-run verdict are separate.
// No network, database, collector execution or status mutation is performed.
export function auditNarCollectionRun(bundle, {expectedDate, now = Date.now()} = {}) {
  let mirrorAudit = null;
  const hold = reason => ({...flags, status: 'HOLD', reasonCodes: [reason], mirrorAudit, run: null});
  try {
    const b = structuredClone(bundle);
    mirrorAudit = auditNarStatusMirror({expectedDate, now, commitSha: b?.commitSha, attempt: b?.attempt, manifest: b?.manifest, snapshot: b?.snapshot});
    if (mirrorAudit.status !== 'VERIFIED') return hold('SOURCE_MIRROR_HOLD');
    const p = b.snapshot.payload, r = p.narRunAudit;
    if (r?.status === 'NO_RUN_RECORDED') return hold('NO_RUN_RECORDED');
    if (r?.status !== 'RECORDED') return hold('RUN_AUDIT_UNAVAILABLE');
    ensure(iso(r.scheduledAt) && r.runDate === expectedDate && new Date(Date.parse(r.scheduledAt) + 9*3600000).toISOString().slice(0,10) === expectedDate && Date.parse(r.scheduledAt) <= Date.parse(b.snapshot.capturedAt), 'RUN_TIME_INVALID');
    ensure(['attempted','saved','autoResultProcessed'].every(k => count(r[k])) && r.saved <= r.attempted && r.saved <= p.savedRaceCount, 'RUN_COUNTS_INVALID');
    for (const [key, field] of [['lastNarRunAt','scheduledAt'],['lastNarStatus','runStatus'],['lastNarReason','reason'],['lastNarAttempted','attempted'],['lastNarSaved','saved'],['lastNarEvents','events']]) {
      ensure(isDeepStrictEqual(p[key], r[field]), 'RUN_PUBLIC_FIELDS_INVALID');
    }
    ensure(Array.isArray(r.events) && r.events.length <= 64, 'RUN_EVENTS_INVALID');
    const events = r.events.map(e => {
      ensure(e && typeof e === 'object' && typeof e.reason === 'string', 'RUN_EVENTS_INVALID');
      const out = {reason: safeReason(e.reason)};
      if (e.track !== undefined) {ensure(Object.values(tracks).includes(e.track), 'RUN_EVENTS_INVALID');out.track = e.track;}
      if (e.raceId !== undefined) {
        const match = typeof e.raceId === 'string' ? e.raceId.match(/^(\d{8})-NAR-(\d{2})-(\d{2})$/) : null;
        ensure(match && match[1] === expectedDate.replaceAll('-','') && tracks[match[2]] && Number(match[3]) >= 1 && (!out.track || out.track === tracks[match[2]]), 'RUN_EVENTS_INVALID');
        out.raceId = e.raceId;
      }
      if (e.meetingAttempts !== undefined) {
        ensure(meetingReasons.includes(e.reason) && Array.isArray(e.meetingAttempts) && e.meetingAttempts.length > 0 && e.meetingAttempts.length <= 3, 'RUN_ATTEMPTS_INVALID');
        let previous = -1;
        out.meetingAttempts = e.meetingAttempts.map(a => {
          const index = routes.indexOf(a?.route);
          ensure(index > previous && sourceReasons.includes(a.reason), 'RUN_ATTEMPTS_INVALID');previous = index;
          const value = {route: a.route, reason: a.reason};
          if (a.reason === 'SOURCE_HTTP') {ensure(Number.isInteger(a.httpStatus) && a.httpStatus >= 100 && a.httpStatus <= 599, 'RUN_ATTEMPTS_INVALID');value.httpStatus = a.httpStatus;}
          else ensure(a.httpStatus === undefined, 'RUN_ATTEMPTS_INVALID');
          return value;
        });
      }
      return out;
    });
    const reasonCodes = [], ageMs = now - Date.parse(r.scheduledAt);
    if (ageMs > 1800000) reasonCodes.push('RECORDED_RUN_STALE');
    if (r.runStatus !== 'COMPLETED') reasonCodes.push('RUN_NOT_COMPLETED');
    if (r.reason !== null) reasonCodes.push('RUN_REASON_RECORDED');
    for (const reason of meetingReasons) if (events.some(e => e.reason === reason)) reasonCodes.push(reason);
    if (events.some(e => !benign.includes(e.reason) && !meetingReasons.includes(e.reason))) reasonCodes.push('RECORDED_EVENTS_REQUIRE_REVIEW');
    if (r.attempted > 0 && r.saved === 0) reasonCodes.push('NO_SAVE_RECORDED');
    else if (r.attempted > r.saved) reasonCodes.push('ATTEMPT_SAVE_GAP_RECORDED');
    if (r.attempted === 0 && !events.length) reasonCodes.push('ZERO_ATTEMPT_REASON_UNAVAILABLE');
    else if (r.attempted === 0 && events.some(e => !['NON_MEETING','ALREADY_SAVED'].includes(e.reason))) reasonCodes.push('NO_ACQUISITION_ATTEMPT_RECORDED');
    return {...flags, status: reasonCodes.length ? 'HOLD' : 'OBSERVED', reasonCodes, mirrorAudit,
      sourceReference: {date: expectedDate, commitSha: b.commitSha, capturedAt: b.snapshot.capturedAt, payloadSha256: b.snapshot.payloadSha256},
      collectionOutcome: r.saved > 0 ? 'SAVE_RECORDED' : r.attempted > 0 ? 'ATTEMPT_WITHOUT_SAVE' : 'NO_ATTEMPT_RECORDED',
      eventCoverage: 'LATEST_RECORD_RETAINED_EVENTS_ONLY_NOT_FULL_RUN_HISTORY',
      run: {scheduledAt: r.scheduledAt, runDate: r.runDate, runStatus: statuses.includes(r.runStatus) ? r.runStatus : 'UNKNOWN',
        reason: r.reason === null ? null : safeReason(r.reason), attempted: r.attempted, saved: r.saved,
        autoResultProcessed: r.autoResultProcessed, ageMs, events},
      savedRaceCount: p.savedRaceCount, rejectedRowCount: p.rejectedRowCount};
  } catch (e) {
    const allowed = ['RUN_TIME_INVALID','RUN_COUNTS_INVALID','RUN_PUBLIC_FIELDS_INVALID','RUN_EVENTS_INVALID','RUN_ATTEMPTS_INVALID'];
    return hold(allowed.includes(e?.message) ? e.message : 'COLLECTION_AUDIT_INPUT_UNREADABLE');
  }
}
