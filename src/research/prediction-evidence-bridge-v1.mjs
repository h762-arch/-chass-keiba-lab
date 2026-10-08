import {stableHash, assertMarketIndependentData} from '../prediction/precomputed-snapshot.mjs';
import {calculateJraData} from '../prediction/jra-data-calculator.mjs';

export const BRIDGE_VERSION = 'CHASS_PREDICTION_EVIDENCE_BRIDGE_V1';
export const RETROSPECTIVE_BRIDGE_VERSION = 'CHASS_NAR_RETROSPECTIVE_EVIDENCE_V1';
const copy = value => structuredClone(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
const unknown = value => value == null || value === '' || /^(UNKNOWN|MISSING|HOLD|N\/A)$/i.test(String(value));
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const fail = reason => { throw new TypeError(reason); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function rows(table, required) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) fail('TABLE_REQUIRED');
  const headers = table[0];
  if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) fail('TABLE_HEADER_INVALID');
  return table.slice(1).map((row, index) => ({row: index + 2, data: Object.fromEntries(headers.map((key, i) => [key, row[i] ?? null]))}));
}
const COURSE = {京:'京都',阪:'阪神',中:'中山',東:'東京',名:'中京',新:'新潟',福:'福島',小:'小倉',札:'札幌',函:'函館'};
function historyRun(row) {
  return {date:row.PastRaceDate, racecourse:COURSE[row.PastCourse] || row.PastCourse,
    raceClass:row.Class, fieldSize:number(row.FieldSize), finish:number(row.Finish),
    surface:row.Surface, distance:number(row.DistanceM), trackCondition:row.Going,
    time:unknown(row.RunTime) ? null : row.RunTime, margin:number(row.Margin),
    cornerPositions:unknown(row.Passage) ? [] : String(row.Passage).split(/[\s→>-]+/).map(Number).filter(n => n > 0),
    last3F:number(row.Last3F), weightCarried:number(row.WeightCarried)};
}

// Inputs are bounded, offline connector exports. This module performs no network or DB IO.
export async function createPredictionEvidenceSnapshot(input = {}) {
  return buildSnapshot(input, false);
}

// Deliberately separate from EARLY: late metadata never becomes pre-off evidence.
export async function createNarRetrospectiveEvidenceSnapshot(input = {}) {
  return buildSnapshot(input, true);
}

async function buildSnapshot({raceId,runId,modelVersion,cutoffAt,offAt,source,
  races,runners,history,identityMap,replayEvidence} = {}, retrospective) {
  if (![raceId,runId,modelVersion].every(value => text(value))) fail('EXPLICIT_IDENTITY_VERSION_REQUIRED');
  if (!iso(cutoffAt) || !iso(offAt) || Date.parse(cutoffAt) >= Date.parse(offAt)) fail('PRE_OFF_CUTOFF_REQUIRED');
  if (!text(source?.spreadsheetId) || !text(source?.revision) || !iso(source?.exportedAt)) fail('SOURCE_PROVENANCE_REQUIRED');
  if (retrospective) {
    if (!iso(source?.availableAt) || Date.parse(source.availableAt) < Date.parse(offAt)
      || !iso(replayEvidence?.observedAt) || Date.parse(replayEvidence.observedAt) < Date.parse(source.availableAt)
      || Date.parse(replayEvidence.observedAt) > Date.parse(source.exportedAt)
      || replayEvidence?.basis !== 'POST_RACE_IDENTITY_ONLY'
      || !Array.isArray(replayEvidence?.refs) || !replayEvidence.refs.length
      || replayEvidence.refs.some(ref => typeof ref !== 'string' || !/^https:\/\//.test(ref))) fail('RETROSPECTIVE_PROVENANCE_REQUIRED');
  } else if (!iso(source?.availableAt) || Date.parse(source.availableAt) > Date.parse(cutoffAt) || Date.parse(source.availableAt) > Date.parse(source.exportedAt)) fail('SOURCE_NOT_AVAILABLE_AT_CUTOFF');
  // availableAt is an external declaration, never authenticated timing proof.
  const raceRows = rows(races,['CanonicalRace_ID','Org','RaceDate','Course','Surface','DistanceM']);
  const matching = raceRows.filter(item => item.data.CanonicalRace_ID === raceId);
  if (matching.length !== 1) fail('RACE_ID_AMBIGUOUS_OR_MISSING');
  const race = matching[0].data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(race.RaceDate || '') || !Number.isFinite(Date.parse(race.RaceDate))) fail('RACE_DATE_INVALID');
  if (!['JRA','NAR'].includes(race.Org)) fail('ORGANIZATION_INVALID');
  if (retrospective && race.Org !== 'NAR') fail('NAR_RETROSPECTIVE_ONLY');
  const runnerRows = rows(runners,['CanonicalRace_ID','CanonicalHorse_Key','HorseNo','HorseName','CancelStatus']);
  const historyRows = rows(history,['CanonicalRace_ID','CanonicalHorse_Key','Run_No','PastRaceDate','Finish','DistanceM']);
  const selected = runnerRows.filter(item => item.data.CanonicalRace_ID === raceId);
  if (!selected.length || selected.length > 99 || !Array.isArray(identityMap)) fail('RUNNER_IDENTITY_REQUIRED');
  const keys = new Set(), numbers = new Set();
  const evidence = [], horses = [], identities = [];
  const add = (horseKey,family,values,refs) => {
    const available = Object.values(values).some(value => Array.isArray(value) ? value.length > 0 : !unknown(value));
    evidence.push({horseKey,family,values,refs,stage:available ? 'INSPECTED' : 'MISSING',
      unavailableReason:available ? null : 'SOURCE_VALUE_MISSING',decisionUsed:false});
  };
  for (const item of selected) {
    const row = item.data, key = text(row.CanonicalHorse_Key), no = number(row.HorseNo);
    if (!key || !Number.isInteger(no) || no < 1 || keys.has(key) || numbers.has(no)) fail('RUNNER_DUPLICATE_OR_INVALID');
    keys.add(key); numbers.add(no);
    const matches = identityMap.filter(id => id.raceId === raceId && id.horseKey === key && id.horseNo === no && id.horseName === row.HorseName);
    if (matches.length !== 1 || matches[0].status !== 'PASS' || !text(matches[0].evidenceRef)) fail('RUNNER_IDENTITY_UNRESOLVED');
    identities.push({raceId,horseKey:key,horseNo:no,horseName:row.HorseName,evidenceRef:matches[0].evidenceRef,status:'CALLER_DECLARED_PASS'});
    const status = {ACTIVE:'active',SCRATCHED:'scratched',EXCLUDED:'excluded'}[row.CancelStatus];
    if (!status) fail('RUNNING_STATUS_UNKNOWN');
    const previous = historyRows.filter(h => h.data.CanonicalRace_ID === raceId && h.data.CanonicalHorse_Key === key);
    if (previous.length > 10 || new Set(previous.map(h => number(h.data.Run_No))).size !== previous.length) fail('HISTORY_DUPLICATE_OR_OVERSIZE');
    for (const h of previous) {
      if (!Number.isInteger(number(h.data.Run_No)) || number(h.data.Run_No) < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(h.data.PastRaceDate || '') || !Number.isFinite(Date.parse(h.data.PastRaceDate)) || h.data.PastRaceDate >= race.RaceDate) fail('HISTORY_CURRENT_OR_FUTURE_RACE');
    }
    previous.sort((a,b) => number(a.data.Run_No) - number(b.data.Run_No));
    const ref = {sheet:'CHASS_UNIFIED_RUNNER_EARLY',row:item.row,revision:source.revision};
    const runs = previous.map(h => historyRun(h.data));
    horses.push({horseKey:key,horseNo:no,horseName:row.HorseName,runningStatus:status,
      weightCarried:number(row.WeightCarried),sexAge:unknown(row.Sex) || unknown(row.Age) ? '' : `${row.Sex}${row.Age}`,pastRuns:runs});
    add(key,'HISTORY',{runs},previous.map(h => ({sheet:'CHASS_UNIFIED_HISTORY',row:h.row,revision:source.revision})));
    // Raw index scale is preserved; never silently converted to a 0-100 driveIndexSignal.
    add(key,'INDEX',Object.fromEntries(['PeakIndex','Avg5Index','DistanceIndex','CourseIndex','Prev1Index','Prev2Index','Prev3Index'].map(k => [k,number(row[k])])),[ref]);
    add(key,'CONDITION',{WeightCarried:number(row.WeightCarried)},[ref]);
    for (const [family,fields] of Object.entries({PRESSURE:['Pressure_Scenario'],POSITION:['Position_Pace'],PEDIGREE:['PedigreeCoverage'],SIGNAL_RESEARCH:['MainPositive','MainNegative','DevilAdvocate']})) {
      add(key,family,Object.fromEntries(fields.map(k => [k,unknown(row[k]) ? null : row[k]])),[ref]);
    }
  }
  const data = {race:{date:race.RaceDate,racecourse:race.Course,surface:race.Surface,distance:number(race.DistanceM),trackCondition:race.TrackCondition_EARLY},horses};
  assertMarketIndependentData(data);
  if (!data.race.surface || !(data.race.distance > 0)) fail('RACE_FEATURES_MISSING');
  const payload = {schemaVersion:retrospective ? RETROSPECTIVE_BRIDGE_VERSION : BRIDGE_VERSION,raceId,runId,modelVersion,organization:race.Org,cutoffAt,offAt,
    source:copy(source),identities,data,evidence,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,
    sourceAuthentication:'UNVERIFIED',trustedTiming:'UNVERIFIED',identityProof:'CALLER_DECLARED'};
  if (retrospective) Object.assign(payload,{replayMode:'RETROSPECTIVE_ONLY',earlyEligible:false,
    replayEvidence:{observedAt:replayEvidence.observedAt,basis:replayEvidence.basis,refs:copy(replayEvidence.refs)},
    cutoffMeaning:'HISTORICAL_REFERENCE_NOT_AVAILABILITY_PROOF',featureAvailability:'UNVERIFIED_AT_HISTORICAL_CUTOFF'});
  return freeze({...payload,snapshotHash:await stableHash(payload)});
}

export async function comparePredictionEvidence(snapshot,baseline) {
  if (snapshot?.schemaVersion !== BRIDGE_VERSION) fail('SNAPSHOT_VERSION_INVALID');
  const {snapshotHash,...payload} = snapshot;
  if (await stableHash(payload) !== snapshotHash) fail('SNAPSHOT_HASH_MISMATCH');
  const common = {snapshotHash,runId:snapshot.runId,modelVersion:snapshot.modelVersion,researchOnly:true,
    formalKpiEligible:false,productionActivationReady:false,freezeMutation:'NONE',signalMutation:'NONE'};
  if (snapshot.organization !== 'JRA') return {...common,status:'HOLD',reason:'NAR_CONSUMER_NOT_CONNECTED',trace:copy(snapshot.evidence)};
  if (baseline?.raceId !== snapshot.raceId || baseline?.runId !== snapshot.runId || baseline?.modelVersion !== snapshot.modelVersion) fail('BASELINE_IDENTITY_VERSION_MISMATCH');
  const input = copy(baseline.data);
  if (await stableHash(input.race) !== await stableHash(snapshot.data.race)) fail('BASELINE_RACE_CONTEXT_MISMATCH');
  const active = snapshot.data.horses.filter(h => h.runningStatus === 'active');
  if (input.horses.length !== active.length || active.some(h => input.horses.filter(b => b.horseKey === h.horseKey && b.horseNo === h.horseNo && b.runningStatus === 'active').length !== 1)) fail('BASELINE_RUNNER_IDENTITY_MISMATCH');
  const candidate = copy(input);
  for (const h of candidate.horses) {
    const supplied = active.find(row => row.horseKey === h.horseKey);
    if (supplied.pastRuns.length) h.pastRuns = copy(supplied.pastRuns);
    if (supplied.weightCarried != null) h.weightCarried = supplied.weightCarried;
  }
  assertMarketIndependentData(candidate);
  const before = calculateJraData(input), after = calculateJraData(candidate);
  const outputHash = await stableHash(after);
  const trace = [];
  for (const feature of snapshot.evidence) {
    const item = copy(feature), h = candidate.horses.find(row => row.horseKey === item.horseKey);
    const field = item.family === 'HISTORY' && h && item.values.runs.length ? 'pastRuns' : item.family === 'CONDITION' && h && item.values.WeightCarried != null ? 'weightCarried' : null;
    item.stages = item.stage === 'MISSING' ? [] : ['AVAILABLE','INSPECTED'];
    if (!field) { item.unusedReason = 'CONSUMER_MAPPING_UNSUPPORTED_OR_MISSING'; trace.push(item); continue; }
    item.stages.push('INTERPRETED','PROPAGATED','COMPARED');
    const ablated = copy(candidate), original = input.horses.find(row => row.horseKey === item.horseKey);
    ablated.horses.find(row => row.horseKey === item.horseKey)[field] = copy(original[field]);
    item.ablatedOutputHash = await stableHash(calculateJraData(ablated));
    item.decisionUsed = item.ablatedOutputHash !== outputHash;
    if (item.decisionUsed) item.stages.push('DECISION_USED');
    item.stage = item.stages.at(-1);
    item.unusedReason = item.decisionUsed ? null : 'NO_OBSERVED_MODEL_OUTPUT_CHANGE';
    item.consumer = 'calculateJraData'; trace.push(item);
  }
  return {...common,status:'COMPARED_SHADOW_ONLY',before,after,outputHash,trace,
    changed:await stableHash(before) !== outputHash,probabilityStatus:'EXISTING_MODEL_UNCALIBRATED',
    marksStatus:'NOT_GENERATED',signalStatus:'NOT_GENERATED'};
}
