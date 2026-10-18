/**
 * CHASS Favorite Trust & Collapse v2.1.1, caller-evidence SHADOW evaluator.
 * JRA/NAR separate validation. Strictly observational, no storage, no effects.
 * CPSI is the only ability-index input; this module does not calculate CPSI.
 * The caller must authenticate source provenance; metadata validation is not authentication.
 */
export const FAVORITE_V21_SHADOW_VERSION = 'FAVORITE_TRUST_COLLAPSE_V2.1.1_SHADOW_REVIEWED';
export const FAVORITE_V21_SCENARIOS = Object.freeze(['BASE', 'FAVORITE_FRIENDLY', 'FAVORITE_HOSTILE']);
const FORMAL_MARKS = new Set(['◎', '○', '▲', '△', '☆']);
const LOW_EVIDENCE_NEGATIVES = new Set([
  'LOW_SAMPLE','UNKNOWN','CPSI','CPSI_RANK_LOW','ABILITY','INDEX','PEAK','AVG',
  'LOW_EV','ODDS_HIGH','WAVE_HIGH','FIRST_CLASS_ONLY','DISTANCE_UNKNOWN',
  'COURSE_UNKNOWN','FINAL_ODDS_CHANGED','FIRST_DISTANCE_ONLY','NEW_CLASS_ONLY',
]);
const FAMILY = Object.freeze({
  CPSI:'ABILITY',ABILITY:'ABILITY',INDEX:'ABILITY',PEAK:'ABILITY',AVG:'ABILITY',
  CPSI_RANK_LOW:'ABILITY', PACE:'PACE_POSITION', POSITION:'PACE_POSITION',
  FRONT_PRESSURE:'PACE_POSITION',POSITION_FRAGILITY:'PACE_POSITION',
  CURRENT:'CURRENT_FORM',RECENT_CLASS:'CURRENT_FORM',
  CLASS:'CLASS_TRANSFER',CLASS_CHANGE:'CLASS_TRANSFER',
  DISTANCE:'EXACT_CONDITION',COURSE:'EXACT_CONDITION',EXACT_TIME:'EXACT_CONDITION',
  CONDITION:'EXACT_CONDITION',WEIGHT_RIDER:'RIDER_WEIGHT',TRAINING:'TRAINING_CONDITION',
});
const CANONICAL_FAMILIES = new Set(Object.values(FAMILY));
const JRA_VENUES = new Set(['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉']);
const NAR_VENUES = new Set(['帯広','門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀']);
const string = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const integer = n => Number.isInteger(n) && n > 0 && n < 100;
const finiteScore = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

function fail(reason) { throw new Error(`FAVORITE_V21_SHADOW_INPUT_REJECTED:${reason}`); }
/** Reject unlisted keys, unknown objects, getters and prototypes before examining values. */
function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (depth > 7) fail('DEPTH');
  if (value === null || ['string','number','boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('NONFINITE');
    if (typeof value === 'string' && value.length > 3000) fail('TEXT_BOUND');
    return value;
  }
  if (typeof value !== 'object') fail('TYPE');
  if (!plain(value) && !Array.isArray(value)) fail('PROTOTYPE');
  if (seen.has(value)) fail('CYCLE');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('PROTOTYPE');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length.value;
    if (length > 64) fail('ARRAY_BOUND');
    if (Reflect.ownKeys(value).length !== length + 1) fail('ARRAY_KEYS');
    const out = [];
    for (let i = 0; i < length; i++) {
      const d = descriptors[String(i)];
      if (!d) fail('ARRAY_HOLE');
      if (!Object.hasOwn(d, 'value')) fail('GETTER');
      if (!d.enumerable) fail('HIDDEN_KEY');
      out.push(sanitize(d.value, depth + 1, seen));
    }
    seen.delete(value);
    return out;
  }
  const obj = {};
  if (Reflect.ownKeys(value).length > 40) fail('KEY_BOUND');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('SYMBOL_KEY');
    if (['__proto__','constructor','prototype'].includes(key)) fail('KEY');
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value')) fail('GETTER');
    if (!d.enumerable) fail('HIDDEN_KEY');
    if (/^(result|post|actual|finish|payout|final|late|t15|t5|live|winning)/i.test(key)) {
      fail('POST_OR_LATE_FIELD');
    }
    obj[key] = sanitize(d.value, depth + 1, seen);
  }
  seen.delete(value);
  return obj;
}
function exactKeys(obj, permitted, label) {
  if (!plain(obj) || Object.keys(obj).some(k => !permitted.includes(k))) fail(label);
}
function cleanFamilies(raw) {
  if (!Array.isArray(raw) || raw.length > 16 || raw.some(x => !string(x))) fail('FAMILY_SCHEMA');
  if (raw.some(x => !Object.hasOwn(FAMILY,x) && !CANONICAL_FAMILIES.has(x))) fail('UNKNOWN_FAMILY');
  return new Set(raw.map(x => Object.hasOwn(FAMILY,x) ? FAMILY[x] : x));
}
function scenarioList(input, label) {
  if (!Array.isArray(input) || input.some(s => !FAVORITE_V21_SCENARIOS.includes(s))) fail(label);
  return new Set(input);
}
function cpsiState(input) {
  exactKeys(input, ['value','rank','eligibleHorses','coreUsable','uncertainty','authority',
    'preResult','marketBlind','coveragePct','neutralizedWeightPct'], 'CPSI_SCHEMA');
  if (typeof input.preResult !== 'boolean' || typeof input.marketBlind !== 'boolean') fail('CPSI_SCHEMA');
  for (const key of ['coveragePct','neutralizedWeightPct']) {
    if (input[key] != null && !finiteScore(input[key])) fail('CPSI_COVERAGE');
  }
  // CPSI v1 core groups are A/B/C; do not count seven primitives as seven cores.
  if (!Number.isInteger(input.coreUsable) || input.coreUsable < 0 || input.coreUsable > 3)
    fail('CPSI_CORE');
  if (input.value !== null && !finiteScore(input.value)) fail('CPSI_VALUE');
  const valid = finiteScore(input.value) && Number.isInteger(input.coreUsable)
    && input.coreUsable >= 2 && input.preResult === true && input.marketBlind === true
    && ['CANONICAL','RECONSTRUCTED_SHADOW'].includes(input.authority);
  if (valid && (!integer(input.rank)
      || !integer(input.eligibleHorses) || input.rank > input.eligibleHorses)) fail('CPSI_RANK');
  return valid ? `NUMERIC_${input.authority}` : 'INSUFFICIENT';
}
function checkChallengers(input, favoriteNo, roster, favoriteCpsi) {
  if (!Array.isArray(input) || input.length > 32) fail('CHALLENGER_BOUND');
  const seen = new Set();
  const keys = new Set();
  return input.map(x => {
    exactKeys(x, ['horseNo','horseKey','beatingScenarios','evidenceFamilies','preResult',
      'routeDescription','routeSourceId','cpsi'], 'CHALLENGER_SCHEMA');
    if (!integer(x.horseNo) || x.horseNo === favoriteNo || seen.has(x.horseNo)) fail('CHALLENGER_ID');
    seen.add(x.horseNo);
    if (!string(x.horseKey) || keys.has(x.horseKey) || !string(x.routeDescription)
        || !string(x.routeSourceId)) fail('CHALLENGER_PROOF');
    keys.add(x.horseKey);
    if (roster && roster.get(x.horseNo) !== x.horseKey) fail('CHALLENGER_ROSTER');
    if (typeof x.preResult !== 'boolean') fail('CHALLENGER_SCHEMA');
    const scenarios = scenarioList(x.beatingScenarios, 'CHALLENGER_SCENARIO');
    const fam = cleanFamilies(x.evidenceFamilies);
    const cpsi = x.cpsi == null ? 'INSUFFICIENT' : cpsiState(x.cpsi);
    if (roster && cpsi !== 'INSUFFICIENT' && x.cpsi.eligibleHorses > roster.size) fail('CPSI_ROSTER');
    if (cpsi !== 'INSUFFICIENT' && finiteScore(favoriteCpsi.value)
        && x.cpsi.eligibleHorses !== favoriteCpsi.eligibleHorses) fail('CPSI_COHORT');
    return {horseNo:x.horseNo, routeSourceId:x.routeSourceId, scenarios, credible:x.preResult === true
      && cpsi !== 'INSUFFICIENT' && finiteScore(x.cpsi.neutralizedWeightPct)
      && x.evidenceFamilies.includes('CPSI') && fam.size >= 2
      && Array.from(fam).some(f => f !== 'ABILITY')};
  });
}
function checkRace(input) {
  const match = /^(\d{4}-\d{2}-\d{2})\|([^|]+)\|([1-9]|1[0-2])$/.exec(input.raceId);
  if (!match || !Number.isFinite(Date.parse(match[1]+'T00:00:00Z'))
      || new Date(match[1]+'T00:00:00Z').toISOString().slice(0,10) !== match[1]
      || !(input.circuit === 'JRA' ? JRA_VENUES : NAR_VENUES).has(match[2])) fail('RACE_CIRCUIT');
  return match;
}
const isoTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Metadata consistency only. Does not authenticate records or certify real-time acquisition. */
function checkContext(input, race) {
  if (input.evidenceContext == null) return null;
  const c = input.evidenceContext;
  exactKeys(c,['raceId','circuit','earlySnapshotId','runId','inputFreezeId','sourceId',
    'sourceAt','freezeAt','scheduledStartAt','population','runners'], 'EVIDENCE_CONTEXT');
  if (c.raceId !== input.raceId || c.circuit !== input.circuit
      || c.earlySnapshotId !== input.earlySnapshotId || !string(c.runId)
      || !string(c.inputFreezeId) || !string(c.sourceId)) fail('EVIDENCE_BINDING');
  if (![c.sourceAt,c.freezeAt,c.scheduledStartAt].every(isoTime)
      || Date.parse(c.sourceAt) > Date.parse(c.freezeAt)
      || Date.parse(c.freezeAt) >= Date.parse(c.scheduledStartAt)
      || new Date(Date.parse(c.scheduledStartAt)+9*3600000).toISOString().slice(0,10) !== race[1])
    fail('EVIDENCE_TIME');
  if (!['FLAT','NEWCOMER','JUMP','BANEI'].includes(c.population)) fail('POPULATION');
  if ((race[2] === '帯広') !== (c.population === 'BANEI')) fail('POPULATION');
  if (!Array.isArray(c.runners) || c.runners.length < 4 || c.runners.length > 32) fail('ROSTER');
  const roster = new Map(), keys = new Set();
  for (const r of c.runners) {
    exactKeys(r,['horseNo','horseKey'],'ROSTER');
    if (!integer(r.horseNo) || !string(r.horseKey) || roster.has(r.horseNo) || keys.has(r.horseKey)) fail('ROSTER');
    roster.set(r.horseNo,r.horseKey); keys.add(r.horseKey);
  }
  if (!roster.has(input.favoriteHorseNo) || input.earlyPopularity > roster.size) fail('ROSTER');
  return {roster,population:c.population};
}
function checkJointSeats(input, rivals) {
  if (input.jointSeatProofs == null) return new Set();
  if (!Array.isArray(input.jointSeatProofs) || input.jointSeatProofs.length > 3) fail('JOINT_PROOF');
  const verified = new Set();
  const seen = new Set();
  for (const proof of input.jointSeatProofs) {
    exactKeys(proof,['scenario','horseNos','routeSourceIds','compatible','sourceId','displacementDescription'], 'JOINT_PROOF');
    if (!FAVORITE_V21_SCENARIOS.includes(proof.scenario) || seen.has(proof.scenario)
        || typeof proof.compatible !== 'boolean' || !string(proof.sourceId)
        || !string(proof.displacementDescription)
        || !Array.isArray(proof.horseNos) || proof.horseNos.length !== 3
        || new Set(proof.horseNos).size !== 3 || !Array.isArray(proof.routeSourceIds)
        || proof.routeSourceIds.length !== 3) fail('JOINT_PROOF');
    seen.add(proof.scenario);
    const matched = proof.horseNos.every((n,i) => rivals.some(r => r.horseNo === n && r.credible
      && r.scenarios.has(proof.scenario) && r.routeSourceId === proof.routeSourceIds[i]));
    // A caller assertion is explicitly not independently verified evidence.
    if (matched && proof.compatible === true) verified.add(proof.scenario);
  }
  return verified;
}
/**
 * No predictions or gates are changed. The returned label is a *Shadow candidate*
 * and must never be projected automatically into the frozen Original EARLY.
 */
export function evaluateFavoriteV21Shadow(raw) {
  const input = sanitize(raw);
  exactKeys(input, [
    'raceId','circuit','favoriteHorseNo','earlyPopularity','earlySnapshotId','earlyFrozen',
    'originalFormalMark','cpsi','recentStarts','negatives','directNegatives','challengers',
    'survivalScenarios','collapseScenarios','rescueRebuttalScenarios','scenarioStatus',
    'paceStressInBase','wideFieldRoute','hasResult','hasLateMarket',
    'evidenceContext','jointSeatProofs',
  ], 'CASE_SCHEMA');
  if (!string(input.raceId) || !['JRA','NAR'].includes(input.circuit)
     || !integer(input.favoriteHorseNo) || !string(input.earlySnapshotId)
     || input.earlyFrozen !== true) fail('ORIGINAL_EARLY_FREEZE');
  const race = checkRace(input);
  if (!['',...FORMAL_MARKS].includes(input.originalFormalMark)) fail('FORMAL_MARK');
  if (!Number.isInteger(input.recentStarts) || input.recentStarts < 0 || input.recentStarts > 999)
    fail('RECENT_STARTS');
  if (typeof input.paceStressInBase !== 'boolean' || typeof input.wideFieldRoute !== 'boolean')
    fail('BOOLEAN');
  if (input.hasResult !== false || input.hasLateMarket !== false) fail('RESULT_OR_LATE_MARKET');
  if (!integer(input.earlyPopularity) || input.earlyPopularity > 32) fail('EARLY_POPULARITY');
  const context = checkContext(input,race);
  if (!plain(input.scenarioStatus)) fail('SCENARIO_STATUS');
  exactKeys(input.scenarioStatus, FAVORITE_V21_SCENARIOS, 'SCENARIO_STATUS');
  const cpsiStatus = cpsiState(input.cpsi);
  if (context && cpsiStatus !== 'INSUFFICIENT' && input.cpsi.eligibleHorses > context.roster.size)
    fail('CPSI_ROSTER');
  const negativeFamilies = raw => {
    if (!Array.isArray(raw) || raw.length > 16 || raw.some(x => !string(x))) fail('FAMILY_SCHEMA');
    return new Set([...cleanFamilies(raw.filter(x => !LOW_EVIDENCE_NEGATIVES.has(x)))].filter(x => x !== 'ABILITY'));
  };
  const negative = negativeFamilies(input.negatives);
  const direct = negativeFamilies(input.directNegatives);
  const independent = new Set(Array.from(negative).filter(f => direct.has(f)));
  const rivals = checkChallengers(input.challengers, input.favoriteHorseNo,context?.roster,input.cpsi);
  const joint = checkJointSeats(input,rivals);
  const collapsing = scenarioList(input.collapseScenarios, 'COLLAPSE_SCENARIOS');
  const survival = scenarioList(input.survivalScenarios, 'SURVIVAL_SCENARIOS');
  const rescue = scenarioList(input.rescueRebuttalScenarios, 'RESCUE_SCENARIOS');
  const counting = scenario => rivals.filter(x => x.credible && x.scenarios.has(scenario)).length;
  const countBase = counting('BASE');
  const countHostile = counting('FAVORITE_HOSTILE');
  const paceWatch = Boolean(input.paceStressInBase && FORMAL_MARKS.has(input.originalFormalMark));
  const common = {
    version:FAVORITE_V21_SHADOW_VERSION,
    sourceOriginAuthenticated:false,
    cpsiStatus,
    cpsiCoreUsable:input.cpsi.coreUsable,
    cpsiNeutralizedWeightPct:input.cpsi.neutralizedWeightPct ?? null,
    cpsiCoveragePct:input.cpsi.coveragePct ?? null,
    originalEarlyMutation:false,
    productionWrite:false,
    formalKpiEligible:false,
    aiProbabilityMutation:false,
    scoreMutation:false,
    warningAuthority:'SHADOW_ONLY',
    evidenceBasis:'CALLER_ASSERTED_METADATA_ONLY',
    liveAcquisitionVerified:false,
    winAssessment:'NOT_IMPLEMENTED',
    top3Assessment:'SCENARIO_REVIEW_ONLY',
    circuit:input.circuit,
    raceId:input.raceId,
    favoriteHorseNo:input.favoriteHorseNo,
    distinctDirectNegativeFamilies:independent.size,
    baseChallengerCount:countBase,
    hostileChallengerCount:countHostile,
    paceStressWatch:paceWatch,
  };
  const output = (label, reason) => Object.freeze({...common,label,reason});
  if (input.earlyPopularity > 3) return output('NO_WARNING','FORMAL_WARNING_SCOPE_EXCLUDED');
  if (FORMAL_MARKS.has(input.originalFormalMark)) return output('WATCH_RECHECK','FORMAL_MARK_CONFLICT_SHADOW_REVIEW_ONLY');
  if (!context) return output('WATCH_RECHECK','EVIDENCE_CONTEXT_MISSING');
  if (context.population !== 'FLAT') return output('WATCH_RECHECK','SPECIALTY_PATH_REQUIRED');
  if (cpsiStatus === 'INSUFFICIENT') return output('WATCH_RECHECK','CPSI_INSUFFICIENT');
  if (!finiteScore(input.cpsi.neutralizedWeightPct)) return output('WATCH_RECHECK','CPSI_UNCERTAINTY_MISSING');
  if (Number.isInteger(input.recentStarts) && input.recentStarts <= 2 && independent.size < 3)
    return output('WATCH_RECHECK','LOW_SAMPLE_GROWTH_GUARD');
  if (FAVORITE_V21_SCENARIOS.some(s => input.scenarioStatus[s] !== 'PRE_FROZEN'))
    return output('WATCH_RECHECK','SCENARIO_PROOF_INCOMPLETE');
  if (independent.size < 2) return output('WATCH_RECHECK','INDEPENDENT_NEGATIVE_INSUFFICIENT');
  const viable = FAVORITE_V21_SCENARIOS.filter(s => counting(s) >= 3 && joint.has(s) && collapsing.has(s)
    && !rescue.has(s) && !survival.has(s));
  if (viable.length === 0) return output('WATCH_RECHECK','NO_COMPLETE_CALLER_THREE_SEAT_PROOF');
  if (viable.includes('BASE') && viable.includes('FAVORITE_HOSTILE')
      && viable.includes('FAVORITE_FRIENDLY') && independent.size >= 4)
    return output('SHADOW_⚠️⚠️⚠️','CALLER_THREE_SCENARIO_CANDIDATE');
  if (viable.includes('BASE') && viable.includes('FAVORITE_HOSTILE') && independent.size >= 3)
    return output('SHADOW_⚠️⚠️','CALLER_MULTI_SCENARIO_CANDIDATE');
  return output('SHADOW_⚠️','CALLER_SINGLE_SCENARIO_CANDIDATE');
}
