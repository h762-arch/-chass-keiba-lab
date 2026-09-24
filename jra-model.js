(function(root){
'use strict';
const {calculateJraAbility,courseSimilarity,getCourseProfiles}=root.CHASS_JRA_ABILITY_CORE||{};
const {projectJraAbilityResult}=root.CHASS_JRA_ABILITY_RESULT_PROJECTOR||{};
if(typeof calculateJraAbility!=='function'||typeof projectJraAbilityResult!=='function')throw new Error('JRA Ability Core and Result Projector must load before jra-model.js');
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(v,d=1)=>v==null?null:Number(v.toFixed(d));
function calculate(data){
 const core=calculateJraAbility(data),ability=projectJraAbilityResult(core);
 const {rows,speed,recent,distance,course,finish,pace,totals,distanceUncertainty,wins,places,abilityRank}=core;
 const horses=ability.map((a,i)=>{
  const h=data.horses[i],pop=h.popularity,marketGap=pop==null?null:pop-(abilityRank.get(i)||pop);
  const ev=h.odds==null?null:h.odds*wins[i];
  const longshotScore=pop==null?null:clamp(totals[i]*.35+places[i]*.55+Math.max(0,marketGap)*5,0,100);
  let valueMark='',valueType='',longshotClass='';
  if(pop>=6&&longshotScore>=58&&places[i]>=15){
   const marketWin=h.odds?100/h.odds:null;
   const winScenario=(abilityRank.get(i)||99)<=4&&wins[i]>=10&&marketWin!=null&&wins[i]>=marketWin*1.5&&pace[i]>=55;
   valueType=winScenario?'勝ち穴':'相手穴';
   if(pop>=10&&places[i]>=18&&[pace[i],distance[i],course[i],finish[i]].filter(x=>x>=65).length>=2)valueMark='💎💎💎';
   else valueMark=longshotScore>=72?'💎💎':'💎';
   longshotClass=totals[i]>=70?'能力穴':/逃げ|先行/.test(rows[i].style.style)&&pace[i]>=65?'残り穴':/差し|追込/.test(rows[i].style.style)&&finish[i]>=65?'差し穴':'展開穴';
  }
  let warningMark='',warningReasons=[],abilityRisk=[],marketHeat=[];
  if(pop!=null&&pop<=3){
   if((abilityRank.get(i)||99)>5)abilityRisk.push('能力順位との乖離');
   if(distance[i]!=null&&distance[i]<40)abilityRisk.push('距離不安');
   if(course[i]!=null&&course[i]<40)abilityRisk.push('コース不安');
   if(pace[i]!=null&&pace[i]<40)abilityRisk.push('脚質・展開不利');
   if(h.weightCarried!=null&&h.pastRuns[0]?.weightCarried!=null&&h.weightCarried-h.pastRuns[0].weightCarried>=2)abilityRisk.push('斤量増');
   if(h.odds&&wins[i]*h.odds<75)marketHeat.push('単勝市場過熱');
   warningReasons=[...abilityRisk,...marketHeat];
   warningMark=abilityRisk.length>=2?'⚠️⚠️':abilityRisk.length===1?'⚠️':marketHeat.length?'市場過熱':'';
  }
  const {horseNo,horseName,abilityRank:rank,...abilityFields}=a;
  return {
   ...h,...abilityFields,
   ev:round(ev,1),evConfidence:a.dataConfidence<40?'低':a.dataConfidence<70?'中':'高',
   fair:wins[i]>0?round(100/wins[i],2):null,
   finalMark:a.abilityMark,valueMark,valueType,warningMark,abilityRisk,marketHeat,
   longshotScore:round(longshotScore,1),marketGapScore:marketGap==null?null:round(clamp(marketGap*10,0,100),1),
   longshotReasons:valueMark?[{code:'JRA_MARKET_GAP',strength:marketGap>=4?2:1,label:`能力${abilityRank.get(i)}位 / ${pop}人気`},{code:'JRA_LONGSHOT_TYPE',strength:1,label:longshotClass}]:[],
   features:{...a.features,favoriteCollapseRate:null,longshotClass},warningReasons
  };
 });
 const winTotal=horses.reduce((s,h)=>s+h.win,0),placeTotal=horses.reduce((s,h)=>s+h.place,0);
 const favoriteRows=horses.filter(h=>h.popularity!=null&&h.popularity<=3);
 const collapse=favoriteRows.length?round(mean(favoriteRows.map(h=>clamp((100-h.place)/100,0,1))),3):null;
 const predictionConfidence=Math.round(mean(horses.map(h=>h.dataConfidence))||0),confidenceReasons=[];
 if(mean(distanceUncertainty)>.45)confidenceReasons.push('距離実績の不確実性');
 if(horses.some(h=>h.features.timeAbilityConflict))confidenceReasons.push('TIMEと能力順位の乖離');
 if(horses.filter(h=>h.predictedTime).length<horses.length)confidenceReasons.push('TIMEデータ不足');
 if(predictionConfidence<50)confidenceReasons.push('JRAモデル初期較正中');
 horses.forEach(h=>h.features.favoriteCollapseRate=collapse);
 return {schemaVersion:'JRA-MODEL-1.1',modelVersion:'10.0.1-jra-drive1',raceType:'JRA',
  race:{...data.race,pace:data.race.pace||'標準',favoriteCollapseRate:collapse,predictionConfidence,predictionConfidenceReasons:confidenceReasons},
  horses,quality:{horseCount:horses.length,winProbabilityTotal:round(winTotal,4),placeProbabilityTotal:round(placeTotal,4),probabilityInvariant:horses.every(h=>h.place+1e-9>=h.win),simulationIterations:12000,withTime:horses.filter(h=>h.predictedTime).length,withMarket:horses.filter(h=>h.odds!=null&&h.popularity!=null).length}};
}
root.CHASS_JRA_MODEL={calculate,courseSimilarity,get courseProfiles(){return getCourseProfiles()}};
})(typeof window!=='undefined'?window:globalThis);
