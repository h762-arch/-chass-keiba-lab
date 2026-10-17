// Shared Node/browser/Worker PURE resolver: never imports fs, crypto, fetch or runtime globals.
// Call only with assets verified by the environment adapter. Shadow-only; NOT a production model.
export const COURSE_CORE_VERSION='CHASS_COURSE_ASSET_CORE_V1';
export const ASSET_VERSION='CHASS_V2220_COURSE_ASSET_RUNTIME_V1';
const norm=x=>String(x??'').trim();
const org=x=>norm(x).toUpperCase();
const surface=x=>{const v=norm(x);return v==='ダ'||v==='ダート'||/^D$/i.test(v)?'ダート':v==='芝'||/^T$/i.test(v)?'芝':v;};
const num=x=>x==null||(typeof x==='string'&&!x.trim())?null:Number.isFinite(Number(x))?Number(x):null;
const resolved=x=>!!x&&!['UNRESOLVED','UNKNOWN'].includes(x);
const flags=()=>({researchOnly:true,sourceOriginAuthenticated:false,integrityBasis:'LOCAL_MANIFEST_CHECKSUMS_ONLY',formalKpiReadiness:'HOLD',formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',productionExecutionAuthorized:false});
export const safeCourseInput=input=>{
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error('COURSE_IDENTITY_INPUT_INVALID');
 const output={};for(const k of ['organizer','venue','venueCode','surface','distance','layout','railVariant']){
  const d=Object.getOwnPropertyDescriptor(input,k);if(!d)continue;
  if(!Object.hasOwn(d,'value')||(d.value!==null&&d.value!==undefined&&!['string','number'].includes(typeof d.value)))throw Error('COURSE_IDENTITY_INPUT_INVALID');
  if(typeof d.value==='string'&&(d.value.length>200||/[\x00-\x1f\x7f]/.test(d.value)))throw Error('COURSE_IDENTITY_INPUT_INVALID');
  if(d.value!==undefined)output[k]=d.value;
 }return output;
};
export const parseCourseCsv=text=>{
 if(typeof text!=='string'||text.length>2_000_000)throw Error('COURSE_ASSET_CSV_INVALID');
 const records=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else field+=c;continue;}
  if(c==='\r'&&text[i+1]==='\n')continue;
  if(c==='"'){if(field||closed)throw Error('COURSE_ASSET_CSV_INVALID');quoted=true;}
  else if(c===','){row.push(field);field='';closed=false;}
  else if(c==='\n'){row.push(field);records.push(row);row=[];field='';closed=false;}
  else{if(closed||c==='\r')throw Error('COURSE_ASSET_CSV_INVALID');field+=c;}
 }
 if(quoted)throw Error('COURSE_ASSET_CSV_UNCLOSED_QUOTE');
 if(field||row.length||closed){row.push(field);records.push(row);}
 const header=records.shift()?.map((x,i)=>i===0?x.replace(/^\uFEFF/,''):x);
 if(!header?.length||records.length>2_000||header.some(x=>!x||['__proto__','prototype','constructor'].includes(x))||new Set(header).size!==header.length)throw Error('COURSE_ASSET_CSV_INVALID');
 return records.filter(row=>row.some(x=>x.trim()!=='')).map(row=>{if(row.length!==header.length)throw Error('COURSE_ASSET_CSV_INVALID');const o=Object.create(null);header.forEach((key,i)=>o[key]=row[i]);return o;});
};
export function validateCourseDataset(manifest,loaded){
 if(!manifest||manifest.version!==ASSET_VERSION||manifest.mode!=='STATIC_SNAPSHOT_SHADOW')throw Error('COURSE_ASSET_MANIFEST_INVALID');
 const policy=['productionDriveDirectRead','resultLeakageAllowed','validationOnlyLeakageAllowed','unknownIsNegative','longFirstTurnImpliesSlow'];
 if(policy.some(k=>manifest.policy?.[k]!==false))throw Error('COURSE_ASSET_POLICY_INVALID');
 const tabs=['CHASS_COURSE_PROFILE_V1','CHASS_COURSE_DISTANCE_PROFILE_V1','CHASS_COURSE_SAMPLE_COVERAGE_V1'];
 if(typeof manifest.source?.spreadsheetId!=='string'||!Array.isArray(manifest.source?.tabs)||tabs.some(x=>!manifest.source.tabs.includes(x)))throw Error('COURSE_ASSET_POLICY_INVALID');
 const rules={geometry:'STATIC_CANONICAL',distanceProfiles:'STATIC_CANONICAL',coverage:'SHADOW_GUARD_ONLY'};
 for(const [key,role] of Object.entries(rules)){
  const s=manifest.assets?.[key];if(s?.runtimeUse!==role||s?.bundled!==true||!/^course-[a-z0-9-]+\.csv$/.test(s.file)||!/^([a-f0-9]{64})$/.test(s.sha256))throw Error('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
 }
 for(const [key,tab] of Object.entries({historicalRaw:'CHASS_COURSE_HIST_SAMPLE_V1',frameAggregate:'CHASS_COURSE_FRAME_AGG_V1',biasShadow:'CHASS_COURSE_BIAS_SHADOW_V1',forwardJoin:'CHASS_COURSE_FORWARD_JOIN_V1',forwardReadiness:'CHASS_COURSE_FORWARD_READINESS_V1'})){
  const s=manifest.assets?.[key];if(s?.bundled!==false||s?.runtimeUse!=='FORBIDDEN'||s?.sourceTab!==tab||s.file!=null)throw Error('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
 }
 const geometry=loaded.geometry,profiles=loaded.distanceProfiles,coverage=loaded.coverage;
 if(!geometry?.length||!profiles?.length||!coverage?.length)throw Error('COURSE_ASSET_REQUIRED_DATA_MISSING');
 for(const rows of [geometry,profiles,coverage]){
  if(Object.keys(rows[0]||{}).some(x=>/result|forward|finishorder|payout|actualtime|validationonly/i.test(x)))throw Error('COURSE_ASSET_PRE_COLUMN_FORBIDDEN');
 }
 if(['Metric','Value','Status','Definition','Source','AsOf','Gate','Notes'].some(x=>!Object.hasOwn(coverage[0],x)))throw Error('COURSE_COVERAGE_SCHEMA_INVALID');
 const geometries=new Map(),ids=new Set();
 for(const g of geometry){
  if(!['JRA','NAR'].includes(g.Organizer)||!['PROCESS_CONTEXT','SPECIALIST_CONTEXT'].includes(g.ProductionUse)||!g.Venue||!g.VenueCode||!g.Surface||!g.Layout||!g.RailVariant)throw Error('COURSE_GEOMETRY_SCHEMA_INVALID');
  if(!g.CourseGeometry_ID||geometries.has(g.CourseGeometry_ID))throw Error('COURSE_GEOMETRY_ID_DUPLICATE_OR_BLANK');
  geometries.set(g.CourseGeometry_ID,g);
  if(['LapLength_m','FinishStraight_m','ElevationDiff_m'].some(k=>g[k]!==''&&(num(g[k])===null||num(g[k])<0)))throw Error('COURSE_GEOMETRY_SCHEMA_INVALID');
  if(g.ProductionUse==='PROCESS_CONTEXT'&&g.FreezeEligible!=='YES')throw Error('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
  if(/FORWARD|VALIDATION_ONLY|POST_RESULT|SHADOW_ONLY/.test(g.GeometryStatus))throw Error('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
 }
 for(const r of profiles){
  if(!['JRA','NAR'].includes(r.Organizer)||!['PROCESS_CONTEXT','SPECIALIST_CONTEXT'].includes(r.ProductionUse)||!Number.isSafeInteger(num(r.Distance_m))||num(r.Distance_m)<=0||!r.Venue||!r.VenueCode||!r.Surface||!r.Layout||!r.RailVariant)throw Error('COURSE_PROFILE_SCHEMA_INVALID');
  if(!r.CourseProfile_ID||ids.has(r.CourseProfile_ID))throw Error('COURSE_PROFILE_ID_DUPLICATE_OR_BLANK');ids.add(r.CourseProfile_ID);
  if(r.FirstTurnDistance_m!==''&&(num(r.FirstTurnDistance_m)===null||num(r.FirstTurnDistance_m)<0))throw Error('COURSE_PROFILE_SCHEMA_INVALID');
  if(r.TurnCount!==''&&r.TurnCount!=='UNRESOLVED'&&(!Number.isSafeInteger(num(r.TurnCount))||num(r.TurnCount)<0))throw Error('COURSE_PROFILE_SCHEMA_INVALID');
  const g=geometries.get(r.CourseGeometry_ID);if(!g)throw Error('COURSE_PROFILE_GEOMETRY_ORPHAN');
  if(['Organizer','Venue','VenueCode','Surface','Layout','RailVariant'].some(k=>r[k]!==g[k]))throw Error('COURSE_PROFILE_GEOMETRY_IDENTITY_CONFLICT');
  if(r.ProductionUse==='PROCESS_CONTEXT'&&r.FreezeEligible!=='YES')throw Error('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
  if(/FORWARD|VALIDATION_ONLY|POST_RESULT|SHADOW_ONLY/.test(r.ProfileStatus))throw Error('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
 }
 return true;
}
export function summarizeCourseCoverage(rows){
 // Match the existing Node PRE contract: static inventory counts only.
 // Forward/validation/production readiness and free-text fields stay outside PRE.
 const keys=new Set([
  'NAR_COURSE_GEOMETRY_ROWS_FINAL','NAR_DISTANCE_PROFILE_ROWS_FINAL',
  'NAR_VENUES_COVERED_FINAL','NAR_OFFICIAL_START_ANCHORS_FINAL',
  'NAR_START_MAP_PENDING_CONVENTIONAL_FINAL',
  'NAR_PROFILE_ID_DUPLICATES_FINAL','NAR_GEOMETRY_ORPHANS_FINAL'
 ]);
 return Object.fromEntries(rows
  .filter(row=>keys.has(row.Metric)&&Number.isSafeInteger(num(row.Value))&&num(row.Value)>=0)
  .map(row=>[row.Metric,{value:num(row.Value)}]));
}
function hold(reason,input,more={}){return {version:ASSET_VERSION,status:'HOLD',terminal:true,usableForPre:false,reasons:[reason],input:{organizer:org(input?.organizer),venue:norm(input?.venue),venueCode:org(input?.venueCode),surface:surface(input?.surface),distance:num(input?.distance),layout:norm(input?.layout),railVariant:norm(input?.railVariant)},...more,...flags()};}
export function resolveCourseContextCore(assets,unsafeInput={}){
 let input;try{input=safeCourseInput(unsafeInput);}catch{return hold('COURSE_IDENTITY_INPUT_INVALID',{});}
 if(!assets||assets.integrity!=='PASS')return hold('COURSE_ASSET_NOT_LOADED',input);
 const organization=org(input.organizer),distance=num(input.distance),sf=surface(input.surface),venue=norm(input.venue),code=org(input.venueCode),layout=norm(input.layout),rail=norm(input.railVariant);
 if(!['JRA','NAR'].includes(organization)||!Number.isSafeInteger(distance)||distance<=0||!sf||(!venue&&!code))return hold('COURSE_IDENTITY_INPUT_INVALID',input);
 const base=(r,ignoreOrg=false)=> (ignoreOrg||org(r.Organizer)===organization)&&(!code||org(r.VenueCode)===code)&&(!venue||norm(r.Venue)===venue)&&surface(r.Surface)===sf&&num(r.Distance_m)===distance;
 const matches=assets.profiles.filter(r=>base(r)&&(!layout||r.Layout===layout)&&(!rail||r.RailVariant===rail));
 if(matches.length===0){
  const cross=assets.profiles.filter(r=>base(r,true)&&(!layout||r.Layout===layout)&&(!rail||r.RailVariant===rail));
  if(cross.length&&cross.every(r=>r.Organizer!==organization))return hold('CIRCUIT_ISOLATION_MISMATCH',input);
  const relaxed=assets.profiles.filter(r=>base(r));
  if(relaxed.length&&layout&&!relaxed.some(r=>r.Layout===layout))return hold('COURSE_LAYOUT_UNRESOLVED',input,{candidateLayouts:[...new Set(relaxed.map(r=>r.Layout))]});
  if(relaxed.length&&rail&&!relaxed.some(r=>r.RailVariant===rail))return hold('COURSE_RAIL_VARIANT_UNRESOLVED',input,{candidateRailVariants:[...new Set(relaxed.map(r=>r.RailVariant))]});
  return hold('COURSE_PROFILE_NOT_FOUND',input);
 }
 if(matches.length!==1)return hold('COURSE_PROFILE_IDENTITY_AMBIGUOUS',input,{candidateProfileIds:matches.map(r=>r.CourseProfile_ID),candidateLayouts:[...new Set(matches.map(r=>r.Layout))],candidateRailVariants:[...new Set(matches.map(r=>r.RailVariant))]});
 if(sf==='芝'&&!rail)return hold('COURSE_RAIL_VARIANT_REQUIRED',input);
 const r=matches[0],g=assets.geometry.find(g=>g.CourseGeometry_ID===r.CourseGeometry_ID);
 if(!g)return hold('COURSE_GEOMETRY_RESOLUTION_FAILED',input,{courseProfileId:r.CourseProfile_ID});
 if(org(g.Organizer)!==organization)return hold('CIRCUIT_ISOLATION_MISMATCH',input);
 const specialist=r.ProfileStatus==='SPECIAL_DISCIPLINE_PROFILE_READY'||r.StartMapStatus==='SPECIAL_DISCIPLINE_START';
 const startStatus=specialist?'SPECIALIST':/^OFFICIAL_/.test(r.StartMapStatus)&&resolved(r.StartToFirstCornerClass)?'RESOLVED':/PENDING/.test(r.StartMapStatus)||!resolved(r.StartToFirstCornerClass)?'PENDING':'PARTIAL';
 const status=specialist?'SPECIALIST_CONTEXT':startStatus==='RESOLVED'?'READY':'DEGRADED_TERMINAL',reasons=specialist?['SPECIAL_DISCIPLINE_SEPARATE_MODEL_REQUIRED']:startStatus==='PENDING'?['COURSE_START_DETAIL_PENDING']:startStatus==='PARTIAL'?['COURSE_START_DETAIL_UNVERIFIED']:[];
 const first=r.StartToFirstCornerClass,straight=num(g.FinishStraight_m);
 const front=['SHORT','SPECIAL_START'].includes(first)?'AMPLIFY_POSITIONAL_CONFLICT':['MEDIUM','APPROX_300M'].includes(first)?'NEUTRAL_TO_POSITIONAL':String(first).startsWith('LONG')?'DOES_NOT_IMPLY_SLOW':first==='BANEI_SPECIALIST'?'NOT_APPLICABLE_SPECIALIST':'UNKNOWN_DO_NOT_INFER';
 return {version:ASSET_VERSION,status,terminal:true,usableForPre:true,genericFlatPaceEligible:!specialist,reasons,courseProfileId:r.CourseProfile_ID,courseGeometryId:r.CourseGeometry_ID,
  identity:{organizer:r.Organizer,venue:r.Venue,venueCode:r.VenueCode,surface:r.Surface,distance:num(r.Distance_m),layout:r.Layout,railVariant:r.RailVariant},
  geometry:{direction:g.Direction||null,lapLengthM:num(g.LapLength_m),finishStraightM:straight,elevationDiffM:num(g.ElevationDiff_m),widthM:g.Width_m||null,curveType:g.CurveType||null,spiralCurve:g.SpiralCurve||null,slopeProfile:g.SlopeProfile||null,tags:g.GeometryTags||null,dataQuality:g.DataQuality||null},
  distanceProfile:{startLocation:resolved(r.StartLocation)?r.StartLocation:null,firstTurnDistanceM:num(r.FirstTurnDistance_m),turnCount:num(r.TurnCount),startToFirstCornerClass:resolved(first)?first:null,startMapStatus:r.StartMapStatus,profileStatus:r.ProfileStatus,dataQuality:r.DataQuality||null},
  paceHandoff:{frontPressureGeometryCue:front,leadSettlementEaseState:String(first).startsWith('LONG')?'DO_NOT_ASSUME_SETTLEMENT':'REQUIRES_HORSE_JOCKEY_INTENT',closingAccessState:straight===null?'UNKNOWN':straight>=450?'LONG_STRAIGHT_ACCESS':straight<=250?'SHORT_STRAIGHT_POSITION_SENSITIVE':'STANDARD_STRAIGHT',longSprintDemandState:straight!==null&&straight>=450?'POTENTIAL_LONG_SPRINT_DEMAND':'CONTEXT_REQUIRED',routeCostState:'REQUIRES_DRAW_POSITION_PACE_BRANCH'},
  historicalSupport:{mode:'SHADOW_GUARDED',coefficientsPromoted:false,summary:assets.coverageSummary,rawHistoricalRunnerDataBundled:false,validationOnlyAssetsBundled:false},
  lineage:{geometrySourceVersion:g.SourceVersion,geometrySourceUrl:g.OfficialSourceURL,profileSourceVersion:r.SourceVersion,profileSourceUrl:r.OfficialSourceURL,archiveSpreadsheetId:assets.manifest.source.spreadsheetId,sourceTabs:assets.manifest.source.tabs,snapshotGeneratedAt:assets.manifest.generatedAt},...flags()};
}
