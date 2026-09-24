// Shared, market-independent presentation of the pure Ability Core result.
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const round=(v,d=1)=>v==null?null:Number(v.toFixed(d));
const marks=['◎','○','▲','△'];

export function projectJraAbilityResult(core){
 const {rows,speedRaw,recentRaw,distanceRaw,courseRaw,speed,recent,distance,course,finish,pace,totals,distanceUncertainty,wins,places,seconds,abilityRank,individualTimes,timeTiers,raceBaseline}=core;
 const horses=rows.map((row,i)=>{
  const h=row.horse,rawTime=individualTimes[i],timeTier=timeTiers[i];
  const predTime=rawTime==null?null:raceBaseline==null?rawTime:raceBaseline*.62+rawTime*.38;
  const predictedTime=predTime==null?'':`${Math.floor(predTime/60)}:${(predTime%60).toFixed(1).padStart(4,'0')}`;
  const evidence=[speed[i],recent[i],distance[i],course[i],finish[i],pace[i]].filter(x=>x!=null).length;
  const confidence=Math.round(clamp(100*evidence/6-distanceUncertainty[i]*42,10,95));
  const front=row.style.frontRate;
  const remaining=front==null?null:clamp((places[i]/100)*(front>=.6?1.12:.92),0,.9);
  const closing=front==null?null:clamp((places[i]/100)*(/差し|追込/.test(row.style.style)?1.15:.8),0,.9);
  return {
   horseNo:h.horseNo,horseName:h.horseName,runningStyle:row.style.style,
   win:round(wins[i],2),second:round(seconds[i],2),place:round(Math.max(wins[i],places[i]),2),overall:totals[i],
   abilityRank:abilityRank.get(i),abilityMark:marks[abilityRank.get(i)-1]||'',
   predictedTime,predictedTimeType:predTime==null?'':timeTier==='fallback'?'距離補正・低信頼':'レース基準補正',
   predictedTimeConfidence:predTime==null?null:timeTier==='fallback'?Math.min(confidence,45):confidence,
   predictedTimeMissingReason:predTime==null?(h.pastRuns?.length?'no_same_surface_time_evidence':'debut_no_time_evidence'):null,
   predictedTimeScenarios:predTime==null?null:{standard:predictedTime,paceFavored:null,paceAdverse:null,positionFailure:null},
   probabilityUncertainty:round(distanceUncertainty[i],2),
   jraIndices:{speed:speed[i],recent:recent[i],distance:distance[i],course:course[i],finish:finish[i],pace:pace[i],total:totals[i]},
   features:{distanceFit:distance[i],courseFit:course[i],recentFormScore:recent[i],last3fAbility:finish[i],paceFit:pace[i],frontRealizationRate:front,remainingRate:remaining,closingRate:closing,distanceUncertainty:round(distanceUncertainty[i],2),weightChangeFromPrevious:h.pastRuns[0]?.weightCarried==null||h.weightCarried==null?null:round(h.weightCarried-h.pastRuns[0].weightCarried,1)},
   raw:{highest:speedRaw[i]==null?null:round(speedRaw[i],4),avg5:recentRaw[i]==null?null:round(recentRaw[i],1),distance:distanceRaw[i]==null?null:round(distanceRaw[i],1),course:courseRaw[i]==null?null:round(courseRaw[i],1),recent:row.runs.slice(0,5).map(x=>round(x.quality,1)).filter(x=>x!=null),kg:h.weightCarried},
   scores:{timeIndex:totals[i],distanceFit:distance[i],courseFit:course[i],weight:null},
   dataConfidence:confidence,dataMode:'JRA手動データ・CHASS独自指数',
   reason:`CHASS SPEED ${speed[i]??'—'} / RECENT ${recent[i]??'—'} / DISTANCE ${distance[i]??'—'} / COURSE ${course[i]??'—'} / FINISH ${finish[i]??'—'} / PACE ${pace[i]??'—'}`
  };
 });
 const byTime=[...horses].filter(h=>h.predictedTime).sort((a,b)=>{
  const sec=x=>{const m=String(x).match(/^(\d+):(\d+(?:\.\d+)?)$/);return m?Number(m[1])*60+Number(m[2]):Infinity};
  return sec(a.predictedTime)-sec(b.predictedTime);
 });
 const timeRank=new Map(byTime.map((h,i)=>[Number(h.horseNo),i+1]));
 horses.forEach((h,i)=>{
  const tr=timeRank.get(Number(h.horseNo))??null,ar=abilityRank.get(i)??null,gap=tr==null||ar==null?null:Math.abs(tr-ar);
  h.features.timeRank=tr;h.features.abilityRank=ar;h.features.timeAbilityConflict=gap!=null&&gap>=5;
  if(h.features.timeAbilityConflict)h.reason+=` / TIME${tr}位と能力${ar}位の乖離を要確認`;
 });
 return horses;
}
