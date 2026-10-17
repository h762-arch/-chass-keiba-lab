import {assessEarlyPredictionAvailabilityV2} from './early-prefreeze-availability-v2.mjs';

export const VERSION='CHASS_EARLY_SNAPSHOT_MAPPING_V1';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=2048&&x===x.trim();
function parse(raw){
  if(typeof raw!=='string'||raw.length>1_000_000)throw Error('INVALID_JSON_INPUT');
  const x=JSON.parse(raw);
  if(!object(x))throw Error('INVALID_JSON_INPUT');
  return x;
}
function timestamp(x){
  if(typeof x!=='string')return NaN;
  const m=x.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if(!m)return NaN;
  const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number);
  if(y<1000||mo<1||mo>12||d<1||d>new Date(Date.UTC(y,mo,0)).getUTCDate()||h>23||mi>59||s>59)return NaN;
  if(m[7]!=='Z'&&(Number(m[7].slice(1,3))>23||Number(m[7].slice(4,6))>59))return NaN;
  return Date.parse(x);
}
const no=x=>typeof x==='string'&&/^\d{1,2}$/.test(x)?Number(x):typeof x==='number'&&Number.isFinite(x)?x:null;
const validNo=x=>Number.isSafeInteger(no(x))&&no(x)>=1&&no(x)<=30;
function sameRoster(a,b){
  return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every(validNo)&&b.every(validNo)
    &&new Set(a.map(no)).size===a.length&&new Set(b.map(no)).size===b.length
    &&a.every(n=>b.map(no).includes(no(n)));
}
function pick(x,keys){
  return Object.fromEntries(keys.filter(k=>Object.hasOwn(x||{},k)&&(x[k]===null||['string','number','boolean'].includes(typeof x[k]))).map(k=>[k,x[k]]));
}
const runnerKeys=['canonicalId','identitySource','identityVerified','identityAmbiguous','identityStatus','nameConflict',
  'evidenceId','evidenceSource','evidenceSavedAt','evidenceReadback'];
const cpsiKeys=['coverageVerified','modelReady','compatStatus','status','notApplicable','mainCompatScore','MainCompatScore','coreUsableCount','CoreUsableCount'];
const present=x=>x!==null&&x!==undefined&&x!==false;
function hasResult(x){
  return object(x)&&(['RESULT','result','resultSnapshot','finishOrder','validationSnapshot','resultAt','resultAcquiredAt'].some(k=>present(x[k]))
    ||['resultPresent','validationCompleted','validated','resultLeakDetected','postResultLeakDetected'].some(k=>x[k]===true));
}
function historical(x){
  return object(x)&&(x.historicalResearch===true||x.backgroundCollector===true||x.researchMode==='historical_research'||x.predictionKind==='backtest_prediction');
}
function outcome(input,reasons,format=null){
  // The projection deliberately contains no RESULT payload. A presence bit only
  // rejects post-result input; removing RESULT must never launder it into EARLY.
  const availability=assessEarlyPredictionAvailabilityV2(input||null);
  if(reasons.length){
    availability.predictionReadiness='PREDICTION_HOLD';
    availability.predictionQuality='HOLD';
    availability.predictionCanFreeze=false;
    availability.holdReasons=[...new Set([...availability.holdReasons,...reasons])];
  }
  return {version:VERSION,status:reasons.length?'HOLD':'MAPPED',format,input:input||null,
    mappingReasons:reasons,availability,researchOnly:true,formalKpiEligible:false,
    freezeExecutionAuthorized:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
}

// Both arguments are bounded JSON text: no callbacks/getters are evaluated.
// context: {freezeAt, expectedRunnerCount, sourceReceipt?}. No clock fallback.
// A receipt is a caller declaration, not authenticated acquisition evidence.
export function buildEarlyPrefreezeAvailabilityInput(snapshotJson,contextJson){
  try{
    const s=parse(snapshotJson),c=parse(contextJson),reasons=[];
    const layered=object(s.layers);
    if(layered&&s.predictionSnapshot!=null)return outcome(null,['AMBIGUOUS_SNAPSHOT_FORMAT']);
    const source=layered?s.layers.SOURCE:null;
    const data=layered?s.layers.DATA:s.predictionSnapshot;
    const market=layered?s.layers.MARKET:s.marketSnapshot;
    const final=layered?s.layers.FINAL:s.finalSnapshot;
    const race=layered?source?.race:s.race;
    if(!object(race)||!object(data)||!Array.isArray(data.horses)||data.horses.length<2||data.horses.length>30)return outcome(null,['SNAPSHOT_MAPPING_INCOMPLETE']);
    const raceId=layered?s.raceId:data.raceId;
    const venue=race.track??race.racecourse;
    const raceDate=race.raceDate??race.date;
    const raceNo=no(race.raceNo);
    if(!text(raceId)||!text(venue)||!['JRA','NAR'].includes(s.organization??data.organization))reasons.push('RACE_METADATA_MISSING');
    if(!layered&&raceId!==`${raceDate}|${venue}|${raceNo}`)reasons.push('RECORD_RACE_IDENTITY_CONFLICT');
    for(const layer of [source,data,market,final]){
      if(!object(layer))continue;
      if(layer.raceId!=null&&layer.raceId!==raceId)reasons.push('LAYER_RACE_IDENTITY_CONFLICT');
      if(layer.organization!=null&&layer.organization!==(s.organization??data.organization))reasons.push('LAYER_ORGANIZATION_CONFLICT');
      if(layer.race!=null){
        const r=layer.race;
        if((r.raceDate??r.date)!==raceDate||(r.track??r.racecourse)!==venue||no(r.raceNo)!==raceNo||(r.postTime!=null&&r.postTime!==race.postTime))reasons.push('LAYER_RACE_METADATA_CONFLICT');
      }
    }
    const freeze=timestamp(c.freezeAt);
    if(!Number.isFinite(freeze))reasons.push('EXPLICIT_CUTOFF_REQUIRED');
    // Plain local HH:mm is accepted only as the existing race's JST post time.
    const startAt=typeof raceDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raceDate)&&typeof race.postTime==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(race.postTime)
      ?`${raceDate}T${race.postTime}:00+09:00`:null;
    const predictionTimes=layered?[s.dataCalculatedAt]:[data.createdAt,data.generatedAt];
    const finalTimes=object(final)?[final.createdAt,final.generatedAt].filter(x=>x!=null):[];
    if(!predictionTimes.length||predictionTimes.some(t=>!Number.isFinite(timestamp(t))||timestamp(t)>freeze))reasons.push('PREDICTION_NOT_AT_CUTOFF');
    if(!finalTimes.length||finalTimes.some(t=>!Number.isFinite(timestamp(t))||timestamp(t)>freeze))reasons.push('FINAL_NOT_AT_CUTOFF');
    if(object(market)){
      const times=[market.acquiredAt,market.createdAt].filter(x=>x!=null);
      if(!times.length||times.some(t=>!Number.isFinite(timestamp(t))||timestamp(t)>freeze))reasons.push('MARKET_NOT_AT_CUTOFF');
    }
    const sourceHorses=layered?source?.horses:data.horses;
    if(!Array.isArray(sourceHorses)||sourceHorses.length>30||!sameRoster(sourceHorses.map(h=>h?.horseNo),data.horses.map(h=>h?.horseNo)))return outcome(null,['SOURCE_DATA_ROSTER_CONFLICT']);
    const receipt=c.sourceReceipt;
    const bulk=object(receipt)&&receipt.scope==='ALL_RUNNERS'&&receipt.raceId===raceId
      &&sameRoster(receipt.horseNos,sourceHorses.map(h=>h.horseNo))
      &&Number.isFinite(timestamp(receipt.capturedAt))&&text(receipt.sourceRef);
    if(receipt!=null&&!bulk)reasons.push('COMMON_SOURCE_RECEIPT_INVALID');
    const sourceAt=layered?source?.acquiredAt:race.narSourceAcquiredAt;
    if(bulk&&sourceAt!=null&&timestamp(sourceAt)!==timestamp(receipt.capturedAt))reasons.push('SOURCE_RECEIPT_TIME_CONFLICT');
    const byNo=new Map(data.horses.map(h=>[no(h.horseNo),h]));
    const runners=sourceHorses.map(h=>{
      const d=byNo.get(no(h.horseNo));
      if(h.horseName!=null&&d.horseName!=null&&h.horseName!==d.horseName)reasons.push('SOURCE_DATA_NAME_CONFLICT');
      const horseName=h.horseName??h.name??d.horseName;
      const capturedAt=Object.hasOwn(h,'capturedAt')?h.capturedAt:bulk?receipt.capturedAt:null;
      const sourceRef=Object.hasOwn(h,'sourceRef')?h.sourceRef:bulk?receipt.sourceRef:null;
      return {horseNo:no(h.horseNo),horseName:typeof horseName==='string'?horseName:null,
        ...pick(h,runnerKeys),
        capturedAt:typeof capturedAt==='string'?capturedAt:null,
        sourceRef:typeof sourceRef==='string'?sourceRef:null};
    });
    if(runners.some(h=>Number.isFinite(timestamp(h.capturedAt))&&predictionTimes.some(t=>timestamp(h.capturedAt)>timestamp(t))))reasons.push('SOURCE_AFTER_PREDICTION');
    if(finalTimes.some(t=>predictionTimes.some(p=>timestamp(p)>timestamp(t))))reasons.push('FINAL_BEFORE_PREDICTION');
    let final5=[];
    if(Array.isArray(final?.final5))final5=final.final5.map(x=>no(object(x)?x.horseNo:x));
    else if(Array.isArray(final?.ranking)&&final.ranking.length>=5){
      const selected=final.ranking.slice(0,5);
      if(selected.every((h,i)=>object(h)&&h.rank===i+1))final5=selected.map(h=>no(h.horseNo));
      else reasons.push('FINAL5_ORDER_UNVERIFIED');
    }
    if(Array.isArray(final?.final5)&&Array.isArray(final?.ranking)){
      const selected=final.ranking.slice(0,5);
      if(selected.length!==5||selected.some((h,i)=>!object(h)||h.rank!==i+1||no(h.horseNo)!==final5[i]))reasons.push('FINAL5_RANKING_CONFLICT');
    }
    const containers=[s,source,data,market,final,race,data.race];
    const resultPresent=containers.some(hasResult)||present(layered?s.layers.RESULT:null);
    if(containers.some(historical))reasons.push('HISTORICAL_REFERENCE_ONLY');
    const input={raceId,venue,raceDate,raceNo,startAt,freezeAt:c.freezeAt,
      expectedRunnerCount:no(c.expectedRunnerCount),runners,final5,resultPresent,
      cpsi:pick(data.cpsi,cpsiKeys),cpsiCompat:pick(data.cpsiCompat,cpsiKeys)};
    // Explicit pre-existing evidence declarations only; no saved/readback receipt
    // is synthesized from a snapshot hash, a calculated timestamp or an ID.
    if(object(c.persistenceDeclarations)){
      input.snapshot=pick(c.persistenceDeclarations.snapshot,['id','hash','savedAt','readback']);
      input.early=pick(c.persistenceDeclarations.early,['freezeId','signalHash','freezeAt','immutable','readback']);
      input.readback=pick(c.persistenceDeclarations.readback,['snapshot','evidence','early']);
    }
    return outcome(input,[...new Set(reasons)],layered?'PRECOMPUTED_LAYERS':'APP_RECORD');
  }catch{return outcome(null,['INVALID_MAPPING_INPUT']);}
}

// Runtime boundary also requires the declared cutoff to have been reached.
// observation time is injected by capture's existing clock, never a savedAt.
export function assessEarlySnapshotBeforeSave(snapshotJson,contextJson,observedAt){
  const mapped=buildEarlyPrefreezeAvailabilityInput(snapshotJson,contextJson);
  if(!Number.isFinite(observedAt)||!Number.isFinite(timestamp(mapped.input?.freezeAt))||timestamp(mapped.input.freezeAt)>observedAt){
    return outcome(mapped.input,[...mapped.mappingReasons,'CUTOFF_NOT_REACHED'],mapped.format);
  }
  return mapped;
}
