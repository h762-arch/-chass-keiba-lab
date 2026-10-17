import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

export const VERSION = 'CHASS_V2220_COURSE_ASSET_RUNTIME_V1';
const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ASSET_DIR = resolve(here, '../../assets/chass/course');
const verifiedAssets=new WeakSet();
const policyFlags=()=>({researchOnly:true,sourceOriginAuthenticated:false,integrityBasis:'LOCAL_MANIFEST_CHECKSUMS_ONLY',
  formalKpiReadiness:'HOLD',formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',productionExecutionAuthorized:false});
function deepFreeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;}
function safeInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error();
  const out={};
  for(const key of ['organizer','venue','venueCode','surface','distance','layout','railVariant']){
    const d=Object.getOwnPropertyDescriptor(input,key);
    if(!d)continue;
    if(!Object.hasOwn(d,'value'))throw Error();
    if(d.value===undefined)continue;
    if(d.value!==null&&!['string','number'].includes(typeof d.value))throw Error();
    if(typeof d.value==='string'&&(d.value.length>200||/[\x00-\x1f\x7f]/.test(d.value)))throw Error();
    out[key]=d.value;
  }
  return out;
}

export class CourseAssetError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CourseAssetError';
    this.code = code;
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseCsv(text) {
  if (typeof text !== 'string') throw new CourseAssetError('COURSE_ASSET_CSV_INVALID');
  const rows = [];
  let row = [], field = '', quoted = false, closed=false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') {quoted = false;closed=true;}
      else field += ch;
      continue;
    }
    if(ch==='\r'&&text[i+1]==='\n')continue;
    if (ch === '"') {if(field||closed)throw new CourseAssetError('COURSE_ASSET_CSV_INVALID');quoted = true;}
    else if (ch === ',') { row.push(field); field = '';closed=false; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '';closed=false; }
    else {if(closed||ch==='\r')throw new CourseAssetError('COURSE_ASSET_CSV_INVALID');field += ch;}
  }
  if (quoted) throw new CourseAssetError('COURSE_ASSET_CSV_UNCLOSED_QUOTE');
  if (field.length || row.length||closed) { row.push(field); rows.push(row); }
  if (!rows.length || !rows[0].length) throw new CourseAssetError('COURSE_ASSET_CSV_EMPTY');
  const header = rows[0].map((x, i) => i === 0 ? x.replace(/^\uFEFF/, '') : x);
  if(header.some(x=>!x||x==='__proto__'||x==='constructor'||x==='prototype')||new Set(header).size!==header.length||rows.length>2000)throw new CourseAssetError('COURSE_ASSET_CSV_INVALID');
  return rows.slice(1).filter(r => r.some(x => String(x).trim() !== '')).map(r => {
    if(r.length!==header.length)throw new CourseAssetError('COURSE_ASSET_CSV_INVALID');
    const out = Object.create(null);
    header.forEach((h, i) => out[h] = r[i] ?? '');
    return out;
  });
}

const num = value => {
  if (value == null || (typeof value==='string'&&!value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const norm = value => String(value ?? '').trim();
const organizerNorm = x => norm(x).toUpperCase();
const surfaceNorm = x => {
  const s = norm(x);
  if (s === 'ダ' || s === 'ダート' || /^D$/i.test(s)) return 'ダート';
  if (s === '芝' || /^T$/i.test(s)) return '芝';
  if (s === 'ばんえい') return 'ばんえい';
  return s;
};
const isResolved = x => x !== '' && x !== 'UNRESOLVED' && x !== 'UNKNOWN';

function summarizeCoverage(rows) {
  const allow = new Set([
    'NAR_COURSE_GEOMETRY_ROWS_FINAL', 'NAR_DISTANCE_PROFILE_ROWS_FINAL',
    'NAR_VENUES_COVERED_FINAL', 'NAR_OFFICIAL_START_ANCHORS_FINAL',
    'NAR_START_MAP_PENDING_CONVENTIONAL_FINAL',
    'NAR_PROFILE_ID_DUPLICATES_FINAL', 'NAR_GEOMETRY_ORPHANS_FINAL'
  ]);
  return Object.fromEntries(rows.filter(r=>allow.has(r.Metric)&&Number.isSafeInteger(num(r.Value))&&num(r.Value)>=0).map(r=>[r.Metric,{value:num(r.Value)}]));
}

function validateManifest(manifest) {
  if (!manifest || manifest.version !== VERSION || manifest.mode !== 'STATIC_SNAPSHOT_SHADOW') {
    throw new CourseAssetError('COURSE_ASSET_MANIFEST_INVALID');
  }
  if (!manifest.assets || typeof manifest.assets !== 'object') {
    throw new CourseAssetError('COURSE_ASSET_MANIFEST_INVALID');
  }
  const required={geometry:['course-geometry-v1.csv','STATIC_CANONICAL'],distanceProfiles:['course-distance-profile-v1.csv','STATIC_CANONICAL'],coverage:['course-sample-coverage-v1.csv','SHADOW_GUARD_ONLY']};
  const forbidden={historicalRaw:'CHASS_COURSE_HIST_SAMPLE_V1',frameAggregate:'CHASS_COURSE_FRAME_AGG_V1',biasShadow:'CHASS_COURSE_BIAS_SHADOW_V1',forwardJoin:'CHASS_COURSE_FORWARD_JOIN_V1',forwardReadiness:'CHASS_COURSE_FORWARD_READINESS_V1'};
  if(Object.keys(manifest.assets).length!==8)throw new CourseAssetError('COURSE_ASSET_POLICY_INVALID');
  for(const [k,[file,use]] of Object.entries(required)){
    const s=manifest.assets[k];
    if(s?.file!==file||s?.runtimeUse!==use||s?.bundled!==true||!/^[a-f0-9]{64}$/.test(s?.sha256||''))throw new CourseAssetError('COURSE_ASSET_POLICY_INVALID');
  }
  for(const [k,tab] of Object.entries(forbidden)){
    const s=manifest.assets[k];
    if(s?.bundled!==false||s?.runtimeUse!=='FORBIDDEN'||s?.sourceTab!==tab||s?.file!=null)throw new CourseAssetError('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
  }
  for(const k of ['productionDriveDirectRead','resultLeakageAllowed','validationOnlyLeakageAllowed','unknownIsNegative','longFirstTurnImpliesSlow']){
    if(manifest.policy?.[k]!==false)throw new CourseAssetError('COURSE_ASSET_POLICY_INVALID');
  }
  const tabs=['CHASS_COURSE_PROFILE_V1','CHASS_COURSE_DISTANCE_PROFILE_V1','CHASS_COURSE_SAMPLE_COVERAGE_V1'];
  if(typeof manifest.source?.spreadsheetId!=='string'||!Array.isArray(manifest.source?.tabs)||manifest.source.tabs.length!==3||tabs.some(t=>!manifest.source.tabs.includes(t)))throw new CourseAssetError('COURSE_ASSET_POLICY_INVALID');
}

export async function loadCourseAssets({assetDir = DEFAULT_ASSET_DIR} = {}) {
  const manifestPath = resolve(assetDir, 'course-asset-manifest-v1.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  validateManifest(manifest);

  const loaded = {};
  for (const key of ['geometry','distanceProfiles','coverage']) {
    const spec=manifest.assets[key];
    const path = resolve(assetDir, spec.file);
    const bytes=await readFile(path);
    if(bytes.length>2000000)throw new CourseAssetError('COURSE_ASSET_SIZE_INVALID');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== spec.sha256) {
      throw new CourseAssetError('COURSE_ASSET_CHECKSUM_MISMATCH', `${key}:${actual}`);
    }
    loaded[key] = parseCsv(text);
    const forbiddenColumns=Object.keys(loaded[key][0]||{}).filter(k=>/result|forward|finishorder|payout|actualtime|validationonly/i.test(k));
    if(forbiddenColumns.length)throw new CourseAssetError('COURSE_ASSET_PRE_COLUMN_FORBIDDEN');
  }

  const geometry = loaded.geometry ?? [];
  const profiles = loaded.distanceProfiles ?? [];
  const coverage = loaded.coverage ?? [];
  if (!geometry.length || !profiles.length||!coverage.length) throw new CourseAssetError('COURSE_ASSET_REQUIRED_DATA_MISSING');
  if(['Metric','Value','Status','Definition','Source','AsOf','Gate','Notes'].some(k=>!Object.hasOwn(coverage[0],k)))throw new CourseAssetError('COURSE_COVERAGE_SCHEMA_INVALID');

  const geometryIds = new Set();
  for (const row of geometry) {
    if(!['JRA','NAR'].includes(row.Organizer)||!['PROCESS_CONTEXT','SPECIALIST_CONTEXT'].includes(row.ProductionUse)||!row.Venue||!row.VenueCode||!row.Surface||!row.Layout||!row.RailVariant)throw new CourseAssetError('COURSE_GEOMETRY_SCHEMA_INVALID');
    if (!row.CourseGeometry_ID || geometryIds.has(row.CourseGeometry_ID)) {
      throw new CourseAssetError('COURSE_GEOMETRY_ID_DUPLICATE_OR_BLANK');
    }
    geometryIds.add(row.CourseGeometry_ID);
    if(['LapLength_m','FinishStraight_m','ElevationDiff_m'].some(k=>row[k]!==''&&(num(row[k])===null||num(row[k])<0)))throw new CourseAssetError('COURSE_GEOMETRY_SCHEMA_INVALID');
    if(row.ProductionUse==='PROCESS_CONTEXT'&&row.FreezeEligible!=='YES')throw new CourseAssetError('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
    if(/FORWARD|VALIDATION_ONLY|POST_RESULT|SHADOW_ONLY/.test(row.GeometryStatus))throw new CourseAssetError('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
  }
  const profileIds = new Set();
  for (const row of profiles) {
    if(!['JRA','NAR'].includes(row.Organizer)||!['PROCESS_CONTEXT','SPECIALIST_CONTEXT'].includes(row.ProductionUse)||!Number.isSafeInteger(num(row.Distance_m))||num(row.Distance_m)<=0||!row.Venue||!row.VenueCode||!row.Surface||!row.Layout||!row.RailVariant)throw new CourseAssetError('COURSE_PROFILE_SCHEMA_INVALID');
    if (!row.CourseProfile_ID || profileIds.has(row.CourseProfile_ID)) {
      throw new CourseAssetError('COURSE_PROFILE_ID_DUPLICATE_OR_BLANK');
    }
    profileIds.add(row.CourseProfile_ID);
    if(row.FirstTurnDistance_m!==''&&(num(row.FirstTurnDistance_m)===null||num(row.FirstTurnDistance_m)<0))throw new CourseAssetError('COURSE_PROFILE_SCHEMA_INVALID');
    if(row.TurnCount!==''&&row.TurnCount!=='UNRESOLVED'&&(!Number.isSafeInteger(num(row.TurnCount))||num(row.TurnCount)<0))throw new CourseAssetError('COURSE_PROFILE_SCHEMA_INVALID');
    if(row.ProductionUse==='PROCESS_CONTEXT'&&row.FreezeEligible!=='YES')throw new CourseAssetError('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
    if(/FORWARD|VALIDATION_ONLY|POST_RESULT|SHADOW_ONLY/.test(row.ProfileStatus))throw new CourseAssetError('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
    if (!geometryIds.has(row.CourseGeometry_ID)) {
      throw new CourseAssetError('COURSE_PROFILE_GEOMETRY_ORPHAN', row.CourseProfile_ID);
    }
    const g=geometry.find(x=>x.CourseGeometry_ID===row.CourseGeometry_ID);
    if(['Organizer','Venue','VenueCode','Surface','Layout','RailVariant'].some(k=>row[k]!==g[k]))throw new CourseAssetError('COURSE_PROFILE_GEOMETRY_IDENTITY_CONFLICT');
  }

  const assets=deepFreeze({
    version: VERSION,
    manifest,
    geometry,
    profiles,
    coverageSummary: summarizeCoverage(coverage),
    integrity: 'PASS'
  });
  verifiedAssets.add(assets);
  return assets;
}

function profileCandidates(assets, input, ignoreOrganizer = false) {
  const org = organizerNorm(input.organizer);
  const venue = norm(input.venue);
  const code = norm(input.venueCode).toUpperCase();
  const surface = surfaceNorm(input.surface);
  const distance = Number(input.distance);
  const layout = norm(input.layout);
  const rail = norm(input.railVariant);

  return assets.profiles.filter(r => {
    if (!ignoreOrganizer && organizerNorm(r.Organizer) !== org) return false;
    if(code&&norm(r.VenueCode).toUpperCase()!==code)return false;
    if(venue&&norm(r.Venue)!==venue)return false;
    if (surfaceNorm(r.Surface) !== surface) return false;
    if (Number(r.Distance_m) !== distance) return false;
    if (layout && norm(r.Layout) !== layout) return false;
    if (rail && norm(r.RailVariant) !== rail) return false;
    return true;
  });
}

function baseHold(reason, input, extra = {}) {
  return {
    version: VERSION,
    status: 'HOLD',
    terminal: true,
    usableForPre: false,
    reasons: [reason],
    input: {
      organizer: organizerNorm(input?.organizer),
      venue: norm(input?.venue),
      venueCode: norm(input?.venueCode).toUpperCase(),
      surface: surfaceNorm(input?.surface),
      distance: Number(input?.distance),
      layout: norm(input?.layout),
      railVariant: norm(input?.railVariant)
    },
    ...extra,
    ...policyFlags()
  };
}

function startState(profile) {
  const special = profile.ProfileStatus === 'SPECIAL_DISCIPLINE_PROFILE_READY' || profile.StartMapStatus === 'SPECIAL_DISCIPLINE_START';
  if (special) return 'SPECIALIST';
  if (/^OFFICIAL_/.test(profile.StartMapStatus) && isResolved(profile.StartToFirstCornerClass)) return 'RESOLVED';
  if (/PENDING/.test(profile.StartMapStatus) || !isResolved(profile.StartToFirstCornerClass)) return 'PENDING';
  return 'PARTIAL';
}

function frontPressureGeometryCue(startClass) {
  if (['SHORT', 'SPECIAL_START'].includes(startClass)) return 'AMPLIFY_POSITIONAL_CONFLICT';
  if (startClass === 'MEDIUM' || startClass === 'APPROX_300M') return 'NEUTRAL_TO_POSITIONAL';
  if (String(startClass).startsWith('LONG')) return 'DOES_NOT_IMPLY_SLOW';
  if (startClass === 'BANEI_SPECIALIST') return 'NOT_APPLICABLE_SPECIALIST';
  return 'UNKNOWN_DO_NOT_INFER';
}

function closingAccessCue(geometry) {
  const straight = num(geometry.FinishStraight_m);
  if (straight == null) return 'UNKNOWN';
  if (straight >= 450) return 'LONG_STRAIGHT_ACCESS';
  if (straight <= 250) return 'SHORT_STRAIGHT_POSITION_SENSITIVE';
  return 'STANDARD_STRAIGHT';
}

function resolveLoadedCourseContext(assets, input = {}) {
  if (!assets || !verifiedAssets.has(assets)) return baseHold('COURSE_ASSET_NOT_LOADED', input);
  const org = organizerNorm(input.organizer);
  const distance = Number(input.distance);
  if (!['JRA', 'NAR'].includes(org) || !Number.isSafeInteger(distance) || distance <= 0 || !surfaceNorm(input.surface)||(!norm(input.venue)&&!norm(input.venueCode))) {
    return baseHold('COURSE_IDENTITY_INPUT_INVALID', input);
  }

  let candidates = profileCandidates(assets, input, false);
  if (!candidates.length) {
    const crossCircuit = profileCandidates(assets, input, true);
    if (crossCircuit.length && crossCircuit.every(r => organizerNorm(r.Organizer) !== org)) {
      return baseHold('CIRCUIT_ISOLATION_MISMATCH', input);
    }

    // Detect a known identity where caller supplied a rail/layout not represented by the authority.
    const relaxed = assets.profiles.filter(r =>
      organizerNorm(r.Organizer) === org &&
      (input.venueCode ? norm(r.VenueCode).toUpperCase() === norm(input.venueCode).toUpperCase() : norm(r.Venue) === norm(input.venue)) &&
      surfaceNorm(r.Surface) === surfaceNorm(input.surface) &&
      Number(r.Distance_m) === distance
    );
    if (relaxed.length && input.layout && !relaxed.some(r => norm(r.Layout) === norm(input.layout))) {
      return baseHold('COURSE_LAYOUT_UNRESOLVED', input, {candidateLayouts: [...new Set(relaxed.map(r => r.Layout))]});
    }
    if (relaxed.length && input.railVariant && !relaxed.some(r => norm(r.RailVariant) === norm(input.railVariant))) {
      return baseHold('COURSE_RAIL_VARIANT_UNRESOLVED', input, {candidateRailVariants: [...new Set(relaxed.map(r => r.RailVariant))]});
    }
    return baseHold('COURSE_PROFILE_NOT_FOUND', input);
  }

  // If route is omitted and multiple route-specific profiles survive, guessing is prohibited.
  const uniqueProfileIds = [...new Set(candidates.map(r => r.CourseProfile_ID))];
  if (uniqueProfileIds.length !== 1) {
    return baseHold('COURSE_PROFILE_IDENTITY_AMBIGUOUS', input, {
      candidateProfileIds: uniqueProfileIds,
      candidateLayouts: [...new Set(candidates.map(r => r.Layout))],
      candidateRailVariants: [...new Set(candidates.map(r => r.RailVariant))]
    });
  }
  const profile = candidates[0];
  if(surfaceNorm(input.surface)==='芝'&&!norm(input.railVariant))return baseHold('COURSE_RAIL_VARIANT_REQUIRED',input);
  const geometryMatches = assets.geometry.filter(g => g.CourseGeometry_ID === profile.CourseGeometry_ID);
  if (geometryMatches.length !== 1) return baseHold('COURSE_GEOMETRY_RESOLUTION_FAILED', input, {courseProfileId: profile.CourseProfile_ID});
  const geometry = geometryMatches[0];
  if (organizerNorm(geometry.Organizer) !== org) return baseHold('CIRCUIT_ISOLATION_MISMATCH', input);

  const ss = startState(profile);
  const specialist = ss === 'SPECIALIST';
  const pending = ss === 'PENDING';
  const partial=ss==='PARTIAL';
  const status = specialist ? 'SPECIALIST_CONTEXT' : pending||partial ? 'DEGRADED_TERMINAL' : 'READY';
  const reasons = [];
  if (pending) reasons.push('COURSE_START_DETAIL_PENDING');
  if(partial)reasons.push('COURSE_START_DETAIL_UNVERIFIED');
  if (specialist) reasons.push('SPECIAL_DISCIPLINE_SEPARATE_MODEL_REQUIRED');

  return {
    version: VERSION,
    status,
    terminal: true,
    usableForPre: true,
    genericFlatPaceEligible: !specialist,
    reasons,
    courseProfileId: profile.CourseProfile_ID,
    courseGeometryId: profile.CourseGeometry_ID,
    identity: {
      organizer: profile.Organizer,
      venue: profile.Venue,
      venueCode: profile.VenueCode,
      surface: profile.Surface,
      distance: num(profile.Distance_m),
      layout: profile.Layout,
      railVariant: profile.RailVariant
    },
    geometry: {
      direction: geometry.Direction || null,
      lapLengthM: num(geometry.LapLength_m),
      finishStraightM: num(geometry.FinishStraight_m),
      elevationDiffM: num(geometry.ElevationDiff_m),
      widthM: geometry.Width_m || null,
      curveType: geometry.CurveType || null,
      spiralCurve: geometry.SpiralCurve || null,
      slopeProfile: geometry.SlopeProfile || null,
      tags: geometry.GeometryTags || null,
      dataQuality: geometry.DataQuality || null
    },
    distanceProfile: {
      startLocation: isResolved(profile.StartLocation) ? profile.StartLocation : null,
      firstTurnDistanceM: num(profile.FirstTurnDistance_m),
      turnCount: num(profile.TurnCount),
      startToFirstCornerClass: isResolved(profile.StartToFirstCornerClass) ? profile.StartToFirstCornerClass : null,
      startMapStatus: profile.StartMapStatus,
      profileStatus: profile.ProfileStatus,
      dataQuality: profile.DataQuality || null
    },
    paceHandoff: {
      frontPressureGeometryCue: frontPressureGeometryCue(profile.StartToFirstCornerClass),
      leadSettlementEaseState: String(profile.StartToFirstCornerClass).startsWith('LONG') ? 'DO_NOT_ASSUME_SETTLEMENT' : 'REQUIRES_HORSE_JOCKEY_INTENT',
      closingAccessState: closingAccessCue(geometry),
      longSprintDemandState: num(geometry.FinishStraight_m) >= 450 ? 'POTENTIAL_LONG_SPRINT_DEMAND' : 'CONTEXT_REQUIRED',
      routeCostState: 'REQUIRES_DRAW_POSITION_PACE_BRANCH'
    },
    historicalSupport: {
      mode: 'SHADOW_GUARDED',
      coefficientsPromoted: false,
      summary: assets.coverageSummary,
      rawHistoricalRunnerDataBundled: false,
      validationOnlyAssetsBundled: false
    },
    lineage: {
      geometrySourceVersion: geometry.SourceVersion,
      geometrySourceUrl: geometry.OfficialSourceURL,
      profileSourceVersion: profile.SourceVersion,
      profileSourceUrl: profile.OfficialSourceURL,
      archiveSpreadsheetId: assets.manifest.source.spreadsheetId,
      sourceTabs: assets.manifest.source.tabs,
      snapshotGeneratedAt: assets.manifest.generatedAt
    },
    ...policyFlags()
  };
}

export function resolveCourseContextFromAssets(assets,input={}){
  try{return resolveLoadedCourseContext(assets,safeInput(input));}
  catch{return baseHold('COURSE_IDENTITY_INPUT_INVALID',{});}
}

export async function resolveCourseContext(input, options = {}) {
  let safe;
  try {
    safe=safeInput(input);
    const assets = await loadCourseAssets(options);
    return resolveCourseContextFromAssets(assets, safe);
  } catch (error) {
    const reason = error instanceof CourseAssetError ? error.code : 'COURSE_ASSET_LOAD_FAILED';
    return baseHold(reason, safe??{}, {integrity: 'FAIL'});
  }
}
