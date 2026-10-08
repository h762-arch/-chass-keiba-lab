import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {stableHash,assertMarketIndependentData} from '../prediction/precomputed-snapshot.mjs';
import {BRIDGE_VERSION,RETROSPECTIVE_BRIDGE_VERSION} from './prediction-evidence-bridge-v1.mjs';
import {buildNarTimeTheory} from '../nar/nar-time-theory.mjs';

const copy = value => structuredClone(value);
const integer = value => Number.isInteger(value) && value > 0;
const fail = reason => {throw new TypeError(reason);};
const INDEX_FIELDS = {PeakIndex:'timeIndex',Avg5Index:'fiveRaceAvgIndex',DistanceIndex:'distanceIndex',CourseIndex:'courseIndex'};
const TRACKS = new Set(['門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀']);
function timeSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const m = typeof value === 'string' && value.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
  return m && Number(m[2]) < 60 ? Number(m[1])*60+Number(m[2]) : null;
}
function modelInput(data) {
  // Only explicit ability fields reach the existing app model. No market/marks/probability overrides.
  return {race:{raceType:'NAR',category:'地方競馬',raceDate:data.race.date,track:data.race.racecourse,
    surface:data.race.surface,distance:data.race.distance,trackCondition:data.race.trackCondition},
    horses:data.horses.map(h => ({horseNo:h.horseNo,horseName:h.horseName,
      ...Object.fromEntries(Object.values(INDEX_FIELDS).map(field=>[field,h[field]??null])),
      assignedWeight:h.weightCarried??null}))};
}
function historyTime(horse,race) {
  const surface = value => /ダ/.test(value || '') ? 'dirt' : /芝/.test(value || '') ? 'turf' : '';
  const runs = (horse.pastRuns || []).filter(r => surface(r.surface) && surface(r.surface) === surface(race.surface)).map(r => ({
    date:r.date,track:r.racecourse,distance:r.distance,timeSec:timeSeconds(r.timeSeconds??r.time),
    finish:r.finish,margin:r.margin,last3f:r.last3F,surface:r.surface}));
  return buildNarTimeTheory({runs,targetDistance:race.distance,targetTrack:race.racecourse});
}
export async function compareNarPredictionEvidence(snapshot,baseline,options={}) {
  return compare(snapshot,baseline,options,false);
}
export async function compareNarRetrospectiveEvidence(snapshot,baseline,options={}) {
  return compare(snapshot,baseline,options,true);
}
async function compare(snapshot,baseline,{indexPolicy}={},retrospective) {
  if (snapshot?.schemaVersion !== (retrospective ? RETROSPECTIVE_BRIDGE_VERSION : BRIDGE_VERSION) || snapshot.organization !== 'NAR') fail('NAR_SNAPSHOT_REQUIRED');
  const {snapshotHash,...payload} = snapshot;
  if (await stableHash(payload) !== snapshotHash) fail('SNAPSHOT_HASH_MISMATCH');
  if (retrospective) {
    const valid = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
    const r=snapshot.replayEvidence;
    if (snapshot.replayMode!=='RETROSPECTIVE_ONLY' || snapshot.earlyEligible!==false || snapshot.researchOnly!==true
      || snapshot.formalKpiEligible!==false || snapshot.productionActivationReady!==false
      || snapshot.cutoffMeaning!=='HISTORICAL_REFERENCE_NOT_AVAILABILITY_PROOF'
      || snapshot.featureAvailability!=='UNVERIFIED_AT_HISTORICAL_CUTOFF'
      || ![snapshot.cutoffAt,snapshot.offAt,snapshot.source?.availableAt,snapshot.source?.exportedAt,r?.observedAt].every(valid)
      || Date.parse(snapshot.cutoffAt)>=Date.parse(snapshot.offAt)
      || Date.parse(snapshot.source.availableAt)<Date.parse(snapshot.offAt)
      || Date.parse(r.observedAt)<Date.parse(snapshot.source.availableAt) || Date.parse(r.observedAt)>Date.parse(snapshot.source.exportedAt)
      || r.basis!=='POST_RACE_IDENTITY_ONLY' || !Array.isArray(r.refs) || !r.refs.length
      || r.refs.some(ref=>typeof ref!=='string'||!/^https:\/\//.test(ref))) fail('RETROSPECTIVE_PROVENANCE_REQUIRED');
  } else if (snapshot.replayMode !== undefined || snapshot.earlyEligible === false) fail('RETROSPECTIVE_CANNOT_USE_PRE_OFF_CONSUMER');
  if (baseline?.raceId !== snapshot.raceId || baseline?.runId !== snapshot.runId || baseline?.modelVersion !== snapshot.modelVersion) fail('BASELINE_IDENTITY_VERSION_MISMATCH');
  if (await stableHash(baseline.data?.race) !== await stableHash(snapshot.data.race)) fail('BASELINE_RACE_CONTEXT_MISMATCH');
  if (!TRACKS.has(snapshot.data.race.racecourse) || !/ダ/.test(snapshot.data.race.surface || '')) fail('NAR_TRACK_OR_SURFACE_UNSUPPORTED');
  const active = snapshot.data.horses.filter(h=>h.runningStatus==='active');
  const input = copy(baseline.data);
  if (active.length < 2 || input.horses.length !== active.length || active.some(h=>input.horses.filter(b=>b.horseKey===h.horseKey && b.horseNo===h.horseNo && b.horseName===h.horseName && b.runningStatus==='active').length!==1)) fail('BASELINE_RUNNER_IDENTITY_MISMATCH');
  if (input.horses.some(h=>!integer(h.horseNo)||!Array.isArray(h.pastRuns))) fail('BASELINE_INPUT_INVALID');
  if (input.horses.some(h=>h.pastRuns.some(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'') || !Number.isFinite(Date.parse(r.date)) || r.date>=input.race.date))) fail('BASELINE_HISTORY_CURRENT_OR_FUTURE');
  const useIndex = indexPolicy?.status==='APPROVED_RESEARCH' && indexPolicy?.scale==='NAR_APP_RAW_INDEX'
    && indexPolicy?.runId===snapshot.runId && indexPolicy?.modelVersion===snapshot.modelVersion && indexPolicy?.snapshotHash===snapshotHash
    && typeof indexPolicy?.evidenceRef==='string' && indexPolicy.evidenceRef.trim();
  const candidate = copy(input), mapping = new Map();
  for (const h of candidate.horses) {
    const supplied = active.find(row=>row.horseKey===h.horseKey);
    if (supplied.pastRuns.length) {h.pastRuns=copy(supplied.pastRuns);mapping.set(`${h.horseKey}:HISTORY`,'pastRuns');}
    if (supplied.weightCarried != null) {h.weightCarried=supplied.weightCarried;mapping.set(`${h.horseKey}:CONDITION`,'weightCarried');}
    const index = snapshot.evidence.find(e=>e.horseKey===h.horseKey && e.family==='INDEX');
    if (useIndex && index && Object.values(index.values).some(Number.isFinite)) {
      for (const [source,field] of Object.entries(INDEX_FIELDS)) if (Number.isFinite(index.values[source])) h[field]=index.values[source];
      // Chronological recent order: prior 3 -> prior 2 -> prior 1. Never reverse recency accidentally.
      if (['Prev3Index','Prev2Index','Prev1Index'].every(key=>Number.isFinite(index.values[key]))) h.recentIndex=['Prev3Index','Prev2Index','Prev1Index'].map(key=>index.values[key]);
      mapping.set(`${h.horseKey}:INDEX`,'INDEX');
    }
  }
  // Loading the existing app test entrypoint is an offline Node-only research composition.
  const source = await readFile(new URL('../../app.js',import.meta.url),'utf8');
  const window = {__CHASS_TEST__:true};
  const context = vm.createContext({window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,
    localStorage:{getItem:()=>null,setItem:()=>{throw Error('RESEARCH_STORAGE_WRITE_FORBIDDEN');}}});
  vm.runInContext(source,context,{filename:'app.js',timeout:2000});
  const app = window.CHASS_TEST;
  const calculate = data => {
    const projected = modelInput(data);
    projected.horses.forEach((h,i)=>{h.recentIndex=copy(data.horses[i].recentIndex||[]);});
    assertMarketIndependentData(projected);
    const ready=projected.horses.every(h=>Object.values(INDEX_FIELDS).filter(key=>Number.isFinite(h[key])).length>=2);
    context.__bridgeInput=projected;
    const result=ready?vm.runInContext('window.CHASS_TEST.transform(__bridgeInput)',context,{timeout:2000}):null;
    return {horses:result?JSON.parse(JSON.stringify(result.horses.map(h=>({horseNo:h.horseNo,horseName:h.horseName,
      win:h.win,place:h.place,overall:h.overall,abilityMark:h.abilityMark})))):projected.horses.map(h=>({horseNo:h.horseNo,horseName:h.horseName,win:null,place:null,overall:null,abilityMark:'',reason:'ABILITY_INDEX_INSUFFICIENT'})),
      time:data.horses.map(h=>({horseNo:h.horseNo,theory:historyTime(h,data.race)}))};
  };
  const before=calculate(input),after=calculate(candidate),outputHash=await stableHash(after);
  const trace=[];
  for (const feature of snapshot.evidence) {
    const item=copy(feature),field=mapping.get(`${item.horseKey}:${item.family}`);
    item.stages=item.stage==='MISSING'?[]:['AVAILABLE','INSPECTED'];item.decisionUsed=false;
    if (!field) {item.unusedReason=item.family==='INDEX'?'INDEX_SCALE_POLICY_UNAPPROVED_OR_MISSING':'CONSUMER_MAPPING_UNSUPPORTED_OR_MISSING';trace.push(item);continue;}
    const ablated=copy(candidate),horse=ablated.horses.find(h=>h.horseKey===item.horseKey),original=input.horses.find(h=>h.horseKey===item.horseKey);
    if (field==='INDEX') for(const key of [...Object.values(INDEX_FIELDS),'recentIndex']) horse[key]=copy(original[key]);
    else horse[field]=copy(original[field]);
    const without=calculate(ablated);item.ablatedOutputHash=await stableHash(without);
    item.affectedOutputs=[];
    if (await stableHash(without.horses)!==await stableHash(after.horses)) item.affectedOutputs.push('PROBABILITY_OR_ABILITY_MARK');
    if (await stableHash(without.time)!==await stableHash(after.time)) item.affectedOutputs.push('TIME_RESEARCH');
    item.stages.push('INTERPRETED','PROPAGATED','COMPARED');item.decisionUsed=item.affectedOutputs.length>0;
    if(item.decisionUsed)item.stages.push('DECISION_USED');
    item.stage=item.stages.at(-1);item.unusedReason=item.decisionUsed?null:'NO_OBSERVED_MODEL_OUTPUT_CHANGE';trace.push(item);
  }
  return {status:'COMPARED_SHADOW_ONLY',consumerVersion:'NAR_APP_EVIDENCE_CONSUMER_V1',appVersion:app.APP_VERSION,
    ...(retrospective ? {replayMode:'RETROSPECTIVE_ONLY',earlyEligible:false,performanceClaim:'NONE',baselineMeaning:'CALLER_SUPPLIED_RESEARCH_BASELINE'} : {}),
    appSourceHash:await stableHash(source),snapshotHash,runId:snapshot.runId,modelVersion:snapshot.modelVersion,
    indexPolicyStatus:useIndex?'CALLER_DECLARED_RESEARCH_APPROVAL':'UNAPPROVED',before,after,outputHash,trace,
    changed:await stableHash(before)!==outputHash,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,
    probabilityStatus:'EXISTING_MODEL_UNCALIBRATED',markStatus:'EXISTING_ABILITY_MARK_SHADOW_ONLY',
    signalStatus:'NOT_GENERATED',freezeMutation:'NONE',signalMutation:'NONE'};
}
