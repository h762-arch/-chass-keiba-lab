// Pure read/serialization contracts. No I/O, model evaluation, sealing or repair.
export function readFiniteNumber(value){
 if(!['number','string'].includes(typeof value)||String(value).trim()==='')return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
}
const organization=value=>value==null||value===''?null:String(value).toUpperCase();
const canonicalRace=r=>r?.raceId||(r?.raceDate&&r?.track&&Number(r?.raceNo)>0?`${r.raceDate}|${r.track}|${Number(r.raceNo)}`:null);
const canonicalId=value=>/^\d{4}-\d{2}-\d{2}\|[^|]+\|[1-9]\d*$/.test(String(value||''));
export function inspectRecordBinding(record={},outerRaceId=''){
 const p=record.predictionSnapshot||{},race=record.race||p.race||{},model=p.modelVersion??record.modelVersion;
 const raceId=p.raceId||outerRaceId||canonicalRace(race),org=organization(p.organization||race.organization||race.raceType);
 const reasons=[],excludedLayers=[];
 if(p.raceId&&outerRaceId&&p.raceId!==outerRaceId)reasons.push('PREDICTION_RACE_MISMATCH');
 if(canonicalId(outerRaceId)&&canonicalRace(race)&&canonicalRace(race)!==outerRaceId)reasons.push('PREDICTION_RACE_MISMATCH');
 if(p.raceId&&canonicalRace(race)&&p.raceId!==canonicalRace(race))reasons.push('PREDICTION_RACE_MISMATCH');
 if(p.modelVersion!=null&&record.modelVersion!=null&&String(p.modelVersion)!==String(record.modelVersion))reasons.push('PREDICTION_MODEL_MISMATCH');
 const declaredOrg=organization(race.organization||race.raceType);
 if(org&&!['JRA','NAR'].includes(org)||org&&declaredOrg&&org!==declaredOrg)reasons.push('PREDICTION_ORGANIZATION_MISMATCH');
 if(p.race&&canonicalRace(p.race)&&canonicalRace(race)&&canonicalRace(p.race)!==canonicalRace(race))reasons.push('PREDICTION_RACE_MISMATCH');
 for(const key of ['marketSnapshot','finalSnapshot','resultSnapshot','validationSnapshot']){
  const layer=record[key],layerOrg=organization(layer?.organization);
  if(layer&&(layer.raceId&&raceId&&layer.raceId!==raceId||layer.modelVersion!=null&&model!=null&&String(layer.modelVersion)!==String(model)||layerOrg&&(!['JRA','NAR'].includes(layerOrg)||org&&layerOrg!==org)))excludedLayers.push(key);
 }
 const live=record.liveAdjustedPrediction||race.liveAdjustedPrediction;
 if(live&&(live.raceId&&raceId&&live.raceId!==raceId||live.adjustedFromModelVersion!=null&&model!=null&&String(live.adjustedFromModelVersion)!==String(model)||live.organization&&org&&organization(live.organization)!==org))excludedLayers.push('liveAdjustedPrediction');
 return {status:reasons.length||excludedLayers.length?'HOLD':'READABLE',predictionConflict:reasons.length>0,reasons:[...new Set(reasons)],excludedLayers};
}
export function readBoundRecord(record={},outerRaceId=''){
 const integrity=inspectRecordBinding(record,outerRaceId),copy={...record};
 for(const key of integrity.excludedLayers)copy[key]=null;
 if(integrity.excludedLayers.includes('liveAdjustedPrediction'))copy.race={...(record.race||{}),liveAdjustedPrediction:null};
 if(integrity.predictionConflict){
  copy.predictionSnapshot=record.predictionSnapshot?{...record.predictionSnapshot,horses:[]}:null;
  for(const key of ['marketSnapshot','finalSnapshot','resultSnapshot','validationSnapshot','liveAdjustedPrediction'])copy[key]=null;
  copy.race={...(record.race||{}),liveAdjustedPrediction:null};
 }
 if(integrity.predictionConflict||record.resultSnapshot&&!copy.resultSnapshot){copy.validationSnapshot=null;copy.validated=false;copy.validationCompleted=false;}
 if(record.validationSnapshot&&!copy.validationSnapshot){copy.validated=false;copy.validationCompleted=false;}
 copy.readIntegrity=integrity;return copy;
}
export function hasCompleteReadResult(record={}){
 const r=readBoundRecord(record),order=r.resultSnapshot?.finishOrder;
 if(!Array.isArray(order)||order.length<3)return false;
 const nos=order.map(readFiniteNumber),known=new Set((r.predictionSnapshot?.horses||[]).map(h=>Number(h.horseNo)));
 return nos.every(n=>Number.isInteger(n)&&n>0&&(!known.size||known.has(n)))&&new Set(nos).size===nos.length;
}
const marketFields=['odds','popularity','ev','valueMark','valueType','winValueMark','placeValueMark','winValueFlag','placeValueFlag','warningMark','warningScenario','marketHeat','abilityRisk','longshotScore','marketGapScore','timeValueScore','courseValueScore','paceFitScore','reboundScore','popularityPercentile','timeValueFlag','longshotReasons','longshotScenario'];
export function readOriginalHorses(record,{marketAtOrBefore=null}={}){
 record=readBoundRecord(record);
 const prediction=record?.predictionSnapshot?.horses||[],marketTime=record.marketSnapshot?.acquiredAt;
 const parsed=marketTime?Date.parse(marketTime):null,safeMarket=marketAtOrBefore==null||!marketTime||Number.isFinite(parsed)&&parsed<=marketAtOrBefore;
 const snapshot=safeMarket?record.marketSnapshot:null,market=new Map((snapshot?.horses||[]).map(h=>[Number(h.horseNo),h]));
 const final=new Map((record.finalSnapshot?.ranking||record.finalSnapshot?.top3||[]).map(h=>[Number(h.horseNo),h]));
 const signal=snapshot?.signalSnapshot,signals=new Map((signal?.horses||[]).map(h=>[Number(h.horseNo),h]));
 return prediction.map(p=>{
  const row=structuredClone(p),m=market.get(Number(p.horseNo)),f=final.get(Number(p.horseNo)),saved=signals.get(Number(p.horseNo));
  for(const key of marketFields)if(m&&Object.hasOwn(m,key))row[key]=structuredClone(m[key]);
  row.final={};for(const key of ['mark','rank','finalScore','score'])if(f&&Object.hasOwn(f,key))row.final[key]=structuredClone(f[key]);
  if(saved&&signal?.status==='frozen'){
   for(const key of ['valueMark','valueType','winValueMark','placeValueMark','warningMark'])row[key]=saved[key]||'';
   for(const key of ['warningScenario','longshotScenario'])row[key]=saved[key]?structuredClone(saved[key]):null;
   for(const key of ['marketHeat','abilityRisk','longshotReasons'])row[key]=Array.isArray(saved[key])?structuredClone(saved[key]):[];
   row.longshotReason=null;row.valueReason=null;row.warningReason=null;
  }else if(saved?.warningMark&&signal?.warningFrozenAt){
   row.warningMark=saved.warningMark;row.warningScenario=saved.warningScenario?structuredClone(saved.warningScenario):null;
   row.abilityRisk=Array.isArray(saved.abilityRisk)?structuredClone(saved.abilityRisk):[];row.warningReason=null;
  }
  if(row.warningMark){for(const key of ['mark','finalMark','abilityMark','valueMark','valueType','winValueMark','placeValueMark'])row[key]='';row.final.mark='';}
  row.horseNo=Number(p.horseNo);row.paceFitScore=p.paceFitScore;
  return row;
 });
}
