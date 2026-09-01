export const SIMILARITY_VERSION='similarity_v1';
export const SIMILARITY_WEIGHTS=Object.freeze({
  track:15,distance:10,classLevel:10,fieldSize:5,trackCondition:5,
  abilityDistribution:10,winDistribution:10,placeDistribution:10,timeDistribution:5,
  paceStructure:5,marketStructure:5,marketGap:5,volatility:5
});

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0));
const number=value=>{const n=Number(value);return Number.isFinite(n)?n:null};
const mean=values=>{const xs=values.filter(x=>number(x)!=null).map(Number);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null};
const predictionAt=record=>Date.parse(record?.predictionCreatedAt||record?.predictionSnapshot?.createdAt||record?.predictionSnapshot?.generatedAt||'')||0;
const resultAt=record=>Date.parse(record?.resultAcquiredAt||record?.resultSnapshot?.fetchedAt||'')||0;
const timeSeconds=value=>{const m=String(value||'').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);if(!m)return null;const n=Number(m[1]||0)*60+Number(m[2]);return n>0?n:null};
const surface=value=>/芝|turf/i.test(String(value||''))?'turf':/ダ|dirt/i.test(String(value||''))?'dirt':null;
const conditionRank=value=>({良:0,稍重:1,重:2,不良:3}[String(value||'').trim()]??null);
const paceName=value=>/ハイ|high/i.test(String(value||''))?'high':/スロー|slow/i.test(String(value||''))?'slow':/平均|標準|average|normal/i.test(String(value||''))?'average':null;
const styleName=value=>/逃/.test(String(value||''))?'escape':/先/.test(String(value||''))?'front':/差/.test(String(value||''))?'stalker':/追/.test(String(value||''))?'closer':null;
const inTop3=(record,no)=>new Set((record?.resultSnapshot?.finishOrder||[]).slice(0,3).map(Number)).has(Number(no));
const isWin=(record,no)=>Number(record?.resultSnapshot?.finishOrder?.[0])===Number(no);
const rankBand=value=>{const n=number(value);return n==null?null:n<=3?'top':n<=6?'middle':n<=9?'long':'deep'};
const pctSimilarity=(a,b,scale)=>a==null||b==null?null:clamp(1-Math.abs(a-b)/scale);
const vectorSimilarity=(a,b,scale=1)=>{if(!Array.isArray(a)||!Array.isArray(b)||!a.length||!b.length)return null;const n=Math.min(a.length,b.length),diff=Array.from({length:n},(_,i)=>Math.abs(a[i]-b[i])).reduce((s,x)=>s+x,0)/n;return clamp(1-diff/scale)};
const safeRate=(numerator,denominator)=>denominator?Number((numerator/denominator).toFixed(4)):null;

function originalHorses(record){
  const prediction=record?.predictionSnapshot?.horses||[],created=predictionAt(record),marketAt=Date.parse(record?.marketSnapshot?.acquiredAt||'')||0;
  const safeMarket=!marketAt||!created||marketAt<=created;
  const market=new Map((safeMarket?record?.marketSnapshot?.horses||[]:[]).map(h=>[Number(h.horseNo),h]));
  return prediction.map(h=>({...h,...(market.get(Number(h.horseNo))||{})}));
}
function liveLayer(record){return record?.liveAdjustedPrediction||record?.race?.liveAdjustedPrediction||null}
function liveHorses(record){return (liveLayer(record)?.horses||[]).filter(h=>!['scratched','excluded','withdrawn'].includes(h.horseStatus||h.status))}
function layerHorses(record,mode='original'){return mode==='live_adjusted'?liveHorses(record):originalHorses(record)}
function layerTime(record,mode='original'){const live=liveLayer(record);return mode==='live_adjusted'?(Date.parse(live?.createdAt||live?.updatedAt||'')||0):predictionAt(record)}

function horseRows(record,mode='original'){
  const horses=layerHorses(record,mode),sorted=(key,asc=false)=>[...horses].filter(h=>number(key(h))!=null).sort((a,b)=>(asc?1:-1)*(Number(key(a))-Number(key(b)))),ability=sorted(h=>h.abilityScore??h.raw?.highest??h.overall),wins=sorted(h=>h.win),places=sorted(h=>h.place),times=sorted(h=>timeSeconds(h.predictedTime),true);
  const rankMap=list=>new Map(list.map((h,i)=>[Number(h.horseNo),i+1]));
  return {horses,ability,wins,places,times,abilityRank:rankMap(ability),winRank:rankMap(wins),placeRank:rankMap(places),timeRank:rankMap(times)};
}

function normalizedTop(list,getter,count=3){const values=list.slice(0,count).map(getter).map(number).filter(x=>x!=null);if(!values.length)return [];const max=Math.max(...values.map(Math.abs),1);return values.map(x=>x/max)}
function classLevel(value){const text=String(value||'').toUpperCase().replace(/\s+/g,'');if(!text)return null;const group=text.match(/(?:^|[^A-Z])(A|B|C)(\d)?/)||text.match(/(重賞|JPN|OP|オープン|準重賞|新馬|未勝利)/);if(!group)return {group:text,level:null};if(group[1]==='A'||group[1]==='B'||group[1]==='C')return {group:group[1],level:Number(group[2]||1)};return {group:/重賞|JPN/.test(group[1])?'graded':/OP|オープン|準重賞/.test(group[1])?'open':group[1],level:null}}
function featureCoverage(features){const keys=['track','distance','surface','trackCondition','classInfo','fieldSize','abilityVector','winVector','placeVector','timeVector','pace','market','marketGap','volatility'];return keys.filter(k=>features[k]!=null&&(!Array.isArray(features[k])||features[k].length)).length/keys.length}

export function extractSimilarityFeatures(item,{mode='original'}={}){
  const record=item?.record||item||{},race=record.race||record.predictionSnapshot?.race||{},rows=horseRows(record,mode),horses=rows.horses,styles={escape:0,front:0,stalker:0,closer:0};
  for(const h of horses){const style=styleName(h.runningStyle||h.style);if(style)styles[style]++}
  const live=liveLayer(record),abilityValues=rows.ability.map(h=>number(h.abilityScore??h.raw?.highest??h.overall)).filter(x=>x!=null),winValues=rows.wins.map(h=>number(h.win)).filter(x=>x!=null),placeValues=rows.places.map(h=>number(h.place)).filter(x=>x!=null),timeValues=rows.times.map(h=>timeSeconds(h.predictedTime)).filter(x=>x!=null),popular=[...horses].filter(h=>number(h.popularity)!=null).sort((a,b)=>Number(a.popularity)-Number(b.popularity)),odds=popular.map(h=>number(h.odds)).filter(x=>x!=null),marketGaps=horses.map(h=>number(h.marketGapScore)).filter(x=>x!=null),axis=mode==='live_adjusted'?live:record.predictionSnapshot?.axisModel,volatility=mode==='live_adjusted'?live?.volatility:record.predictionSnapshot?.volatility;
  const features={raceId:item?.raceId||race.raceId||'',mode,at:layerTime(record,mode),track:race.track||null,distance:number(race.distance),surface:surface(race.surface),trackCondition:race.trackCondition||race.condition||null,classInfo:classLevel(race.raceClass||race.class),fieldSize:horses.length||number(race.fieldSize),ageCondition:race.ageCondition||null,sexCondition:race.sexCondition||null,abilityVector:normalizedTop(rows.ability,h=>number(h.abilityScore??h.raw?.highest??h.overall),5),abilityGap1_2:abilityValues.length>1?abilityValues[0]-abilityValues[1]:null,abilityGap1_3:abilityValues.length>2?abilityValues[0]-abilityValues[2]:null,winVector:winValues.slice(0,5).map(x=>x/100),winTop3Total:winValues.length>=3?winValues.slice(0,3).reduce((a,b)=>a+b,0)/100:null,placeVector:placeValues.slice(0,5).map(x=>x/100),placeConcentration:placeValues.length>=3?placeValues.slice(0,3).reduce((a,b)=>a+b,0)/300:null,timeVector:timeValues.length?timeValues.slice(0,5).map(x=>x-timeValues[0]):[],timeGap1_2:timeValues.length>1?timeValues[1]-timeValues[0]:null,timeTop5Range:timeValues.length>1?timeValues[Math.min(4,timeValues.length-1)]-timeValues[0]:null,pace:{label:paceName(race.pace),...styles},market:popular.length?{favoriteOdds:odds[0]??null,secondOdds:odds[1]??null,topConcentration:odds.length>=3?mean(odds.slice(0,3).map(x=>1/Math.max(.1,x))):null}:null,marketGap:marketGaps.length?mean(marketGaps):null,longshotCount:horses.filter(h=>h.valueMark||['相手穴','勝ち穴','大穴'].includes(h.valueType)).length,dangerCount:horses.filter(h=>h.warningMark).length,volatility:number(volatility?.volatilityIndex??race.volatilityIndex),raceConfidence:number(axis?.raceConfidence??race.raceConfidence),predictionConsensus:mean(horses.map(h=>number(h.predictionAxes?.predictionConsensus))),placeStabilityTop:mean(rows.places.slice(0,3).map(h=>number(h.predictionAxes?.placeStabilityScore))),paceFitTop:mean(rows.places.slice(0,3).map(h=>number(h.predictionAxes?.paceFitScore??h.paceFitScore)))};
  features.coverage=featureCoverage(features);features.rows=rows;return features;
}

const TRACK_GROUPS=[new Set(['大井','船橋','川崎','浦和']),new Set(['園田','姫路']),new Set(['盛岡','水沢'])];
function trackSimilarity(a,b){if(!a||!b)return null;if(a===b)return 1;return TRACK_GROUPS.some(g=>g.has(a)&&g.has(b)) ? .75 : .25}
function distanceSimilarity(a,b){if(a==null||b==null)return null;const d=Math.abs(a-b);return d===0?1:d<=100?.95:d<=200?.85:d<=400?.6:0}
function classSimilarity(a,b){if(!a||!b)return null;if(a.group===b.group){if(a.level==null||b.level==null)return 1;return clamp(1-Math.abs(a.level-b.level)*.2)}return .35}
function categoricalSimilarity(a,b){if(!a||!b)return null;return String(a)===String(b)?1:.35}
function paceSimilarity(a,b,fieldA,fieldB){if(!a||!b)return null;const label=a.label&&b.label?(a.label===b.label?1:.55):null,denom=Math.max(fieldA||1,fieldB||1),style=1-(Math.abs(a.escape-b.escape)*2+Math.abs(a.front-b.front)+Math.abs(a.stalker-b.stalker)+Math.abs(a.closer-b.closer))/(denom*5);return label==null?clamp(style):clamp(label*.4+style*.6)}
function marketSimilarity(a,b){if(!a||!b)return null;const values=[pctSimilarity(a.favoriteOdds,b.favoriteOdds,15),pctSimilarity(a.secondOdds,b.secondOdds,20),pctSimilarity(a.topConcentration,b.topConcentration,.3)].filter(x=>x!=null);return mean(values)}

export function similarityScore(target,candidate,{weights=SIMILARITY_WEIGHTS}={}){
  if(target.surface&&candidate.surface&&target.surface!==candidate.surface)return {score:0,hardExcluded:'surface_mismatch',components:{}};
  if(target.distance!=null&&candidate.distance!=null&&Math.abs(target.distance-candidate.distance)>400)return {score:0,hardExcluded:'distance_out_of_range',components:{}};
  const ca=conditionRank(target.trackCondition),cb=conditionRank(candidate.trackCondition),components={track:trackSimilarity(target.track,candidate.track),distance:distanceSimilarity(target.distance,candidate.distance),classLevel:mean([classSimilarity(target.classInfo,candidate.classInfo),categoricalSimilarity(target.ageCondition,candidate.ageCondition),categoricalSimilarity(target.sexCondition,candidate.sexCondition)]),fieldSize:pctSimilarity(target.fieldSize,candidate.fieldSize,8),trackCondition:ca==null||cb==null?null:clamp(1-Math.abs(ca-cb)*.25),abilityDistribution:vectorSimilarity(target.abilityVector,candidate.abilityVector,.5),winDistribution:vectorSimilarity(target.winVector,candidate.winVector,.25),placeDistribution:vectorSimilarity(target.placeVector,candidate.placeVector,.3),timeDistribution:vectorSimilarity(target.timeVector,candidate.timeVector,3),paceStructure:paceSimilarity(target.pace,candidate.pace,target.fieldSize,candidate.fieldSize),marketStructure:marketSimilarity(target.market,candidate.market),marketGap:pctSimilarity(target.marketGap,candidate.marketGap,70),volatility:mean([pctSimilarity(target.volatility,candidate.volatility,70),pctSimilarity(target.raceConfidence,candidate.raceConfidence,70)])};
  let weighted=0,used=0;for(const [key,weight] of Object.entries(weights)){const value=components[key];if(value==null)continue;weighted+=value*weight;used+=weight}
  return {score:used?Number((weighted/used).toFixed(4)):0,components,weightCoverage:Number((used/100).toFixed(3)),hardExcluded:null};
}

function candidateEligible(targetItem,candidateItem,targetMode='original',candidateMode='original'){
  const targetRecord=targetItem?.record||targetItem||{},candidateRecord=candidateItem?.record||candidateItem||{},targetTime=layerTime(targetRecord,targetMode),candidateTime=layerTime(candidateRecord,candidateMode),settledAt=resultAt(candidateRecord);
  const retrospective=candidateRecord?.predictionSnapshot?.historicalResearch===true||candidateRecord?.predictionSnapshot?.predictionKind==='backtest_prediction'||candidateRecord?.race?.predictionKind==='backtest_prediction';
  return !retrospective&&!!targetTime&&!!candidateTime&&candidateTime<targetTime&&!!settledAt&&settledAt<targetTime&&candidateRecord?.resultSnapshot?.finishOrder?.length>=3&&layerHorses(candidateRecord,candidateMode).length>=2&&(targetItem?.raceId||'')!==(candidateItem?.raceId||'');
}
function weightedBoolean(rows,predicate){let denominator=0,numerator=0,sampleCount=0,hitCount=0;for(const row of rows){const result=predicate(row);if(result==null)continue;const w=row.similarityScore;denominator+=w;sampleCount++;if(result){numerator+=w;hitCount++}}return {rate:denominator?Number((numerator/denominator).toFixed(4)):null,numerator:hitCount,denominator:sampleCount}}
function leader(record,sorter,mode='original'){const rows=horseRows(record,mode);return sorter(rows)?.[0]||null}
function actualTopHorses(record,mode='original'){const top=new Set((record.resultSnapshot?.finishOrder||[]).slice(0,3).map(Number));return layerHorses(record,mode).filter(h=>top.has(Number(h.horseNo)))}
function popularityHorse(record,popularity,mode='original'){return layerHorses(record,mode).find(h=>Number(h.popularity)===popularity)||null}

function raceMetrics(rows,mode='original'){
  const metric=predicate=>weightedBoolean(rows,({item})=>predicate(item.record));
  return {
    abilityLeaderTop3Rate:metric(r=>{const h=leader(r,x=>x.ability,mode);return h?inTop3(r,h.horseNo):null}),
    winLeaderWinRate:metric(r=>{const h=leader(r,x=>x.wins,mode);return h?isWin(r,h.horseNo):null}),
    placeLeaderTop3Rate:metric(r=>{const h=leader(r,x=>x.places,mode);return h?inTop3(r,h.horseNo):null}),
    timeLeaderTop3Rate:metric(r=>{const h=leader(r,x=>x.times,mode);return h?inTop3(r,h.horseNo):null}),
    favoriteWinRate:metric(r=>{const h=popularityHorse(r,1,mode);return h?isWin(r,h.horseNo):null}),
    favoriteTop3Rate:metric(r=>{const h=popularityHorse(r,1,mode);return h?inTop3(r,h.horseNo):null}),
    favoriteCollapseRate:metric(r=>{const h=popularityHorse(r,1,mode);return h?!inTop3(r,h.horseNo):null}),
    secondFavoriteTop3Rate:metric(r=>{const h=popularityHorse(r,2,mode);return h?inTop3(r,h.horseNo):null}),
    sevenPlusTop3Rate:metric(r=>{const top=actualTopHorses(r,mode),known=top.map(h=>number(h.popularity)).filter(x=>x!=null);return known.length?known.some(x=>x>=7):null}),
    tenPlusTop3Rate:metric(r=>{const top=actualTopHorses(r,mode),known=top.map(h=>number(h.popularity)).filter(x=>x!=null);return known.length?known.some(x=>x>=10):null}),
    similarUpsetRate:metric(r=>{const top=actualTopHorses(r,mode),known=top.map(h=>number(h.popularity)).filter(x=>x!=null);return known.length?known.some(x=>x>=7):null})
  };
}
function horsePool(rows,mode='original'){
  const pool=[];for(const row of rows){const record=row.item.record,top=new Set((record.resultSnapshot?.finishOrder||[]).slice(0,3).map(Number)),ranks=horseRows(record,mode);for(const h of ranks.horses)pool.push({h,record,weight:row.similarityScore,top3:top.has(Number(h.horseNo)),win:isWin(record,h.horseNo),abilityRank:ranks.abilityRank.get(Number(h.horseNo))||null,winRank:ranks.winRank.get(Number(h.horseNo))||null,placeRank:ranks.placeRank.get(Number(h.horseNo))||null,timeRank:ranks.timeRank.get(Number(h.horseNo))||null})}return pool
}
function poolRate(pool,filter,outcome='top3'){const rows=pool.filter(filter),den=rows.reduce((s,x)=>s+x.weight,0),num=rows.filter(x=>x[outcome]).reduce((s,x)=>s+x.weight,0);return {rate:den?Number((num/den).toFixed(4)):null,numerator:rows.filter(x=>x[outcome]).length,denominator:rows.length}}
function patternRows(pool){
  const baseline=poolRate(pool,()=>true),definitions=[
    ['high_place_low_market','AI3着内率30%以上＋7人気以下',x=>number(x.h.place)>=30&&number(x.h.popularity)>=7,'success'],
    ['place_longshot_pace_fit','相手穴＋展開適性60以上',x=>x.h.valueType==='相手穴'&&number(x.h.predictionAxes?.paceFitScore??x.h.paceFitScore)>=60,'success'],
    ['ai_market_gap','AI上位3頭＋7人気以下',x=>x.winRank<=3&&number(x.h.popularity)>=7,'success'],
    ['top_ability_pace_mismatch','能力1位＋上位人気＋展開不適合',x=>x.abilityRank===1&&number(x.h.popularity)<=3&&number(x.h.predictionAxes?.paceFitScore??x.h.paceFitScore)<50,'failure'],
    ['favorite_low_consensus','1人気＋モデル一致度50未満',x=>number(x.h.popularity)===1&&number(x.h.predictionAxes?.predictionConsensus)<50,'failure'],
    ['time_leader_pace_mismatch','TIME1位＋展開不適合',x=>x.timeRank===1&&number(x.h.predictionAxes?.paceFitScore??x.h.paceFitScore)<50,'failure']
  ];
  const successPatterns=[],failurePatterns=[];for(const [pattern,label,filter,type] of definitions){const rate=poolRate(pool,filter),enough=rate.denominator>=10;if(!enough)continue;if(type==='success'){successPatterns.push({pattern,label,sampleCount:rate.denominator,top3Rate:rate.rate,baselineTop3Rate:baseline.rate,lift:rate.rate!=null&&baseline.rate?Number((rate.rate/baseline.rate).toFixed(2)):null})}else failurePatterns.push({pattern,label,sampleCount:rate.denominator,failureRate:rate.rate==null?null:Number((1-rate.rate).toFixed(4))})}
  successPatterns.sort((a,b)=>(b.lift||0)-(a.lift||0));failurePatterns.sort((a,b)=>(b.failureRate||0)-(a.failureRate||0));return {successPatterns:successPatterns.slice(0,3),failurePatterns:failurePatterns.slice(0,3),baselineTop3Rate:baseline}
}
function styleMetrics(pool){const result={};for(const style of ['escape','front','stalker','closer'])result[style+'Top3Rate']=poolRate(pool,x=>styleName(x.h.runningStyle||x.h.style)===style);return result}
function targetHorseSimilarity(target,history){
  const values=[];const add=(value,weight)=>{if(value==null)return;values.push([value,weight])};add(pctSimilarity(number(target.place),number(history.h.place),50),.25);add(pctSimilarity(number(target.win),number(history.h.win),30),.1);add(target.abilityRank&&history.abilityRank?pctSimilarity(target.abilityRank,history.abilityRank,6):null,.15);add(target.timeRank&&history.timeRank?pctSimilarity(target.timeRank,history.timeRank,6):null,.1);const a=rankBand(target.popularity),b=rankBand(history.h.popularity);add(a&&b?(a===b?1:.3):null,.15);add(pctSimilarity(number(target.predictionAxes?.paceFitScore??target.paceFitScore),number(history.h.predictionAxes?.paceFitScore??history.h.paceFitScore),50),.15);add(styleName(target.runningStyle||target.style)&&styleName(history.h.runningStyle||history.h.style)?(styleName(target.runningStyle||target.style)===styleName(history.h.runningStyle||history.h.style)?1:.35):null,.1);const used=values.reduce((s,x)=>s+x[1],0);return used?values.reduce((s,x)=>s+x[0]*x[1],0)/used:0
}
function horseSupport(targetItem,pool,mode,baseline){const record=targetItem.record||targetItem,rows=horseRows(record,mode),out=[];for(const h of rows.horses){const target={...h,abilityRank:rows.abilityRank.get(Number(h.horseNo)),timeRank:rows.timeRank.get(Number(h.horseNo))},matches=pool.map(x=>({...x,typeSimilarity:targetHorseSimilarity(target,x)})).filter(x=>x.typeSimilarity>=.5).sort((a,b)=>b.typeSimilarity-a.typeSimilarity).slice(0,25),den=matches.reduce((s,x)=>s+x.typeSimilarity*x.weight,0),num=matches.filter(x=>x.top3).reduce((s,x)=>s+x.typeSimilarity*x.weight,0),raw=den?num/den:null,prior=12,shrunk=raw==null?baseline:(raw*matches.length+baseline*prior)/(matches.length+prior),lift=baseline&&shrunk!=null?shrunk/baseline:null,classification=matches.length<10?'neutral':lift>=1.25?'support':lift<=.75?'conflict':'neutral';out.push({horseNo:Number(h.horseNo),horseName:h.horseName||'',historicalSimilaritySupport:shrunk==null?null:Math.round(clamp(50+(shrunk-baseline)*140,0,100)),classification,sampleCount:matches.length,top3Rate:raw==null?null:Number(raw.toFixed(4)),shrunkTop3Rate:shrunk==null?null:Number(shrunk.toFixed(4)),baselineTop3Rate:Number(baseline.toFixed(4)),lift:lift==null?null:Number(lift.toFixed(2)),reason:matches.length<10?`類似タイプ${matches.length}頭のため参考度低`:classification==='support'?`同タイプの補正TOP3率${Math.round(shrunk*100)}%（全体${Math.round(baseline*100)}%）`:classification==='conflict'?`同タイプの補正TOP3率${Math.round(shrunk*100)}%で全体平均未満`:`同タイプは全体平均と同程度`})}return out}

function confidenceValue(rows,target){const countScore=clamp(rows.length/50),average=mean(rows.map(x=>x.similarityScore))||0,coverage=mean([target.coverage,...rows.map(x=>x.features.coverage)])||0,raw=Math.round(clamp(countScore*.4+average*.4+coverage*.2)*100);return rows.length<10?Math.min(raw,39):rows.length<20?Math.min(raw,49):rows.length<50?Math.min(raw,74):raw}
function compactSimilarRace(row,mode){const race=row.item.record?.race||row.item.record?.predictionSnapshot?.race||{};return {raceId:row.item.raceId||race.raceId||'',similarityScore:row.similarityScore,track:race.track||null,distance:number(race.distance),fieldSize:layerHorses(row.item.record,mode).length,result:(row.item.record.resultSnapshot?.finishOrder||[]).slice(0,3).map(Number)}}

export function analyzeHistoricalSimilarity(targetItem,allItems,{mode='original',limit=50,weights=SIMILARITY_WEIGHTS,includeDebug=false}={}){
  const targetRecord=targetItem?.record||targetItem||{},target=extractSimilarityFeatures(targetItem,{mode});if(!target.at)return {available:false,error:'prediction_snapshot_time_missing',similarityVersion:SIMILARITY_VERSION,mode:'shadow',adopted:false};
  const scored=[];for(const item of allItems||[]){if(!candidateEligible(targetItem,item,mode,mode))continue;const features=extractSimilarityFeatures(item,{mode}),similarity=similarityScore(target,features,{weights});if(similarity.hardExcluded||similarity.score<.35)continue;scored.push({item,features,similarityScore:similarity.score,components:similarity.components,weightCoverage:similarity.weightCoverage})}
  scored.sort((a,b)=>b.similarityScore-a.similarityScore);const strict=scored.filter(x=>x.similarityScore>=.5),selected=(strict.length>=20?strict:scored).slice(0,Math.max(20,Math.min(50,Number(limit)||50))),confidence=confidenceValue(selected,target),pool=horsePool(selected,mode),metrics=raceMetrics(selected,mode),patterns=patternRows(pool),baseline=patterns.baselineTop3Rate.rate??(target.fieldSize?Math.min(1,3/target.fieldSize):.25),supports=horseSupport(targetItem,pool,mode,baseline),style=styleMetrics(pool),leader=target.rows.ability[0],leaderSupport=supports.find(x=>x.horseNo===Number(leader?.horseNo)),favoriteCollapse=metrics.favoriteCollapseRate.rate,historicalConflict=!!(favoriteCollapse!=null&&favoriteCollapse>=.4&&leader&&number(leader.popularity)<=3&&(number(leader.predictionAxes?.paceFitScore??leader.paceFitScore)??100)<55),historicalConsensus=historicalConflict?'low':leaderSupport?.classification==='support'?'high':'neutral';
  const output={available:selected.length>0,similarityVersion:SIMILARITY_VERSION,mode:'shadow',adopted:false,predictionMode:mode,similarRaceCount:selected.length,candidateRaceCount:scored.length,similarityConfidence:confidence,confidenceLabel:confidence>=75?'高':confidence>=50?'中':'低',averageSimilarityScore:selected.length?Number(mean(selected.map(x=>x.similarityScore)).toFixed(4)):null,dataCoverage:Number(target.coverage.toFixed(3)),relaxationLevel:strict.length>=20?'strict_0.50':'relaxed_0.35',minimumPatternSample:10,weights:{...weights},metrics:{...metrics,...style,baselineHorseTop3Rate:patterns.baselineTop3Rate},successPatterns:patterns.successPatterns,failurePatterns:patterns.failurePatterns,horseSupport:supports,historicalConsensus,historicalConflict,topSimilarRaces:selected.slice(0,5).map(x=>compactSimilarRace(x,mode)),note:'Similarity Intelligenceは補助情報です。AI確率・TIME・印・穴馬判定を変更しません。'};
  if(includeDebug)output.debug=selected.slice(0,10).map(x=>({raceId:x.item.raceId,similarityScore:x.similarityScore,weightCoverage:x.weightCoverage,components:x.components}));return output
}

function metricCounts(items,predicate){let denominator=0,numerator=0;for(const item of items){const value=predicate(item);if(value==null)continue;denominator++;if(value)numerator++}return {rate:safeRate(numerator,denominator),numerator,denominator}}
export function walkForwardSimilarity(allItems,{maxTargets=200}={}){
  const settled=(allItems||[]).filter(item=>item?.record?.resultSnapshot?.finishOrder?.length>=3&&item?.record?.predictionSnapshot?.horses?.length&&item.record.predictionSnapshot?.historicalResearch!==true&&item.record.predictionSnapshot?.predictionKind!=='backtest_prediction'&&item.record.race?.predictionKind!=='backtest_prediction').sort((a,b)=>predictionAt(a.record)-predictionAt(b.record)).slice(-Math.max(1,Math.min(500,Number(maxTargets)||200))),evaluated=[];
  for(const item of settled){const analysis=analyzeHistoricalSimilarity(item,allItems,{mode:'original',limit:50});if(!analysis.available)continue;const record=item.record,actual=new Set(record.resultSnapshot.finishOrder.slice(0,3).map(Number)),official=(record.finalSnapshot?.top3||[]).map(x=>Number(x.horseNo)),horses=originalHorses(record),supportNos=new Set(analysis.horseSupport.filter(x=>x.classification==='support').map(x=>x.horseNo)),conflictNos=new Set(analysis.horseSupport.filter(x=>x.classification==='conflict').map(x=>x.horseNo)),actualLong=horses.filter(h=>actual.has(Number(h.horseNo))&&number(h.popularity)>=7),actualDeep=horses.filter(h=>actual.has(Number(h.horseNo))&&number(h.popularity)>=10),diamonds=horses.filter(h=>h.valueMark),warnings=horses.filter(h=>h.warningMark);evaluated.push({officialCapture:official.some(no=>actual.has(no)),supportCapture:[...supportNos].some(no=>actual.has(no)),target7:actualLong.length>0,official7:actualLong.some(h=>diamonds.some(d=>Number(d.horseNo)===Number(h.horseNo))),support7:actualLong.some(h=>supportNos.has(Number(h.horseNo))),target10:actualDeep.length>0,official10:actualDeep.some(h=>diamonds.some(d=>Number(d.horseNo)===Number(h.horseNo))),support10:actualDeep.some(h=>supportNos.has(Number(h.horseNo))),diamondHit:diamonds.length?diamonds.some(h=>actual.has(Number(h.horseNo))):null,warningCorrect:warnings.length?warnings.some(h=>!actual.has(Number(h.horseNo))):null,conflictCorrect:conflictNos.size?[...conflictNos].some(no=>!actual.has(no)):null})}
  const officialTop3=metricCounts(evaluated,x=>x.officialCapture),supportTop3=metricCounts(evaluated,x=>x.supportCapture),official7=metricCounts(evaluated.filter(x=>x.target7),x=>x.official7),support7=metricCounts(evaluated.filter(x=>x.target7),x=>x.support7),official10=metricCounts(evaluated.filter(x=>x.target10),x=>x.official10),support10=metricCounts(evaluated.filter(x=>x.target10),x=>x.support10);return {similarityVersion:SIMILARITY_VERSION,mode:'walk_forward_shadow',adopted:false,targetCount:settled.length,evaluatedCount:evaluated.length,baseline:{top3CaptureRate:officialTop3,sevenPlusCaptureRate:official7,tenPlusCaptureRate:official10,diamondTop3Rate:metricCounts(evaluated,x=>x.diamondHit),warningAccuracy:metricCounts(evaluated,x=>x.warningCorrect)},similarityEvidence:{supportTop3Rate:supportTop3,sevenPlusSupportCaptureRate:support7,tenPlusSupportCaptureRate:support10,conflictWarningAccuracy:metricCounts(evaluated,x=>x.conflictCorrect)},officialPredictionDelta:{top3CaptureRate:0,brierScore:0,timeMae:0,reason:'shadow補助のため既存確率・TIME・印は未変更'}}
}
