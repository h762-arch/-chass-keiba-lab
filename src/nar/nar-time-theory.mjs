export const NAR_TIME_THEORY_VERSION='nar-time-theory-v1';

function finite(value){
  if(value==null||value===''||typeof value==='boolean')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function round(value,digits=3){
  if(!Number.isFinite(value))return null;
  const p=10**digits;
  return Math.round(value*p)/p;
}
function mean(values=[]){
  const a=values.filter(Number.isFinite);
  return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
}
function weightedMean(values=[],weights=[]){
  let num=0,den=0;
  for(let i=0;i<values.length;i++){
    if(!Number.isFinite(values[i]))continue;
    const w=Number.isFinite(weights[i])?weights[i]:1;
    num+=values[i]*w;den+=w;
  }
  return den?num/den:null;
}
function stddev(values=[]){
  const a=values.filter(Number.isFinite);
  if(a.length<2)return 0;
  const m=mean(a);
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length);
}
function quantile(values=[],q=.5){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  if(a.length===1)return a[0];
  const pos=(a.length-1)*Math.max(0,Math.min(1,q));
  const lo=Math.floor(pos),hi=Math.ceil(pos);
  if(lo===hi)return a[lo];
  const t=pos-lo;
  return a[lo]*(1-t)+a[hi]*t;
}
function formatTime(sec){
  if(!Number.isFinite(sec)||sec<=0)return null;
  const min=Math.floor(sec/60);
  const remain=sec-min*60;
  return `${min}:${remain.toFixed(1).padStart(4,'0')}`;
}
function nearDistanceLimit(targetDistance){
  const d=finite(targetDistance);
  if(d==null||d<=400)return 0;
  if(d<=1400)return 200;
  if(d<=2200)return 400;
  return 600;
}
function surfaceSet(rows=[]){
  return [...new Set(rows.map(x=>String(x.run?.surface||'').trim()).filter(Boolean))];
}

export function normalizeNarTimeRun(run,{targetDistance,targetTrack}={}){
  const distance=finite(run?.distance),timeSec=finite(run?.timeSec),target=finite(targetDistance);
  if(distance==null||timeSec==null||target==null||distance<=0||timeSec<=0||target<=0)return null;
  const diff=Math.abs(distance-target),limit=nearDistanceLimit(target);
  const exact=diff===0;
  if(!exact&&(limit<=0||diff>limit))return null;
  const targetEquivalentSec=exact?timeSec:timeSec*(target/distance);
  return {
    run,
    exactDistance:exact,
    sameTrack:targetTrack?String(run?.track||'')===String(targetTrack):false,
    distanceAdjusted:!exact,
    targetEquivalentSec,
    originalDistance:distance,
    originalTimeSec:timeSec
  };
}

function selectEvidence(runs,{targetDistance,targetTrack}={}){
  const prepared=(Array.isArray(runs)?runs:[])
    .map((run,index)=>{
      const normalized=normalizeNarTimeRun(run,{targetDistance,targetTrack});
      return normalized?{...normalized,index}:null;
    })
    .filter(Boolean);

  const exact=prepared.filter(x=>x.exactDistance);
  const exactSameTrack=exact.filter(x=>x.sameTrack);
  const near=prepared.filter(x=>!x.exactDistance);
  const nearSameTrack=near.filter(x=>x.sameTrack);

  const candidates=[
    ['exact_same_track',exactSameTrack,2],
    ['exact_distance',exact,2],
    ['near_same_track',nearSameTrack,3],
    ['near_distance',near,3],
    ['exact_same_track',exactSameTrack,1],
    ['exact_distance',exact,1],
    ['near_same_track',nearSameTrack,1],
    ['near_distance',near,1]
  ];
  const picked=candidates.find(([,rows,min])=>rows.length>=min);
  return {
    prepared,
    exact,
    exactSameTrack,
    near,
    nearSameTrack,
    evidenceType:picked?.[0]||'none',
    selected:picked?.[1]||[]
  };
}

function trendSummary(rows,key,{minimum=.3}={}){
  const values=rows.map(x=>finite(key(x))).filter(Number.isFinite);
  if(values.length<4)return {direction:'unknown',delta:null,recentAvg:null,priorAvg:null};
  const recent=values.slice(0,Math.min(3,values.length));
  const prior=values.slice(3,Math.min(6,values.length));
  if(!prior.length)return {direction:'unknown',delta:null,recentAvg:round(mean(recent)),priorAvg:null};
  const recentAvg=mean(recent),priorAvg=mean(prior),delta=priorAvg-recentAvg;
  const threshold=Math.max(minimum,stddev(values.slice(0,6))*.25);
  return {
    direction:delta>threshold?'improving':delta<-threshold?'declining':'stable',
    delta:round(delta),
    recentAvg:round(recentAvg),
    priorAvg:round(priorAvg)
  };
}

function confidenceFor(type,count,mixedSurface){
  let level='low';
  if(type==='exact_same_track'&&count>=3)level='high';
  else if((type==='exact_same_track'&&count>=2)||(type==='exact_distance'&&count>=3)||(type==='near_same_track'&&count>=4))level='medium';
  if(mixedSurface){
    if(level==='high')level='medium';
    else if(level==='medium')level='low';
  }
  return level;
}

export function buildNarTimeTheory({
  runs=[],
  targetDistance=null,
  targetTrack=null,
  abilityPredictedTimeSec=null
}={}){
  const target=finite(targetDistance);
  const selection=selectEvidence(runs,{targetDistance:target,targetTrack});
  const counts={
    usable:selection.prepared.length,
    exactDistance:selection.exact.length,
    exactSameTrack:selection.exactSameTrack.length,
    nearDistance:selection.near.length,
    nearSameTrack:selection.nearSameTrack.length
  };

  if(target==null){
    return {
      version:NAR_TIME_THEORY_VERSION,
      researchOnly:true,
      affectsProbability:false,
      available:false,
      missingReason:'target_distance_missing',
      evidence:{...counts,type:'none',sampleCount:0},
      pendingAdjustments:['surface','going','pace','position','current_weight']
    };
  }
  if(!selection.selected.length){
    return {
      version:NAR_TIME_THEORY_VERSION,
      researchOnly:true,
      affectsProbability:false,
      available:false,
      missingReason:'comparable_time_history_missing',
      targetDistance:target,
      targetTrack:targetTrack||null,
      evidence:{...counts,type:'none',sampleCount:0},
      pendingAdjustments:['surface','going','pace','position','current_weight']
    };
  }

  const selected=selection.selected;
  const recent=selected.slice(0,5);
  const recentSecs=recent.map(x=>x.targetEquivalentSec);
  const allSecs=selected.map(x=>x.targetEquivalentSec);
  const recencyWeights=[5,4,3,2,1].slice(0,recentSecs.length);
  const current=weightedMean(recentSecs,recencyWeights);
  const targetTime=quantile(recentSecs,.5);
  const peak=Math.min(...allSecs);
  const bestScenario=quantile(recentSecs,.25);
  const slowScenario=quantile(recentSecs,.75);
  const stability=stddev(recentSecs);
  const stabilityPct=targetTime?100*stability/targetTime:null;
  const surfaces=surfaceSet(selected);
  const mixedSurface=surfaces.length>1;
  const timeTrend=trendSummary(selected,x=>x.targetEquivalentSec,{minimum:.3});
  const last3fRows=selected.filter(x=>finite(x.run?.last3f)!=null);
  const last3fTrend=trendSummary(last3fRows,x=>x.run?.last3f,{minimum:.15});
  const last3fBest=last3fRows.length?Math.min(...last3fRows.map(x=>finite(x.run.last3f))):null;
  const latest=selected[0]||null;
  const latestFinish=finite(latest?.run?.finish);
  const poorFinishButTimeHeld=Boolean(
    latest&&latestFinish!=null&&latestFinish>=7&&
    latest.targetEquivalentSec<=targetTime+Math.max(.4,stability*.5)
  );
  const abilityTime=finite(abilityPredictedTimeSec);
  const abilityGap=abilityTime!=null?abilityTime-targetTime:null;
  const alignmentThreshold=Math.max(.5,stability*.5);
  const abilityAlignment=abilityGap==null?'unavailable':
    Math.abs(abilityGap)<=alignmentThreshold?'aligned':
    abilityGap>0?'recent10_faster_than_ability':'ability_faster_than_recent10';

  const pendingAdjustments=['going','pace','position','current_weight'];
  if(mixedSurface||!surfaces.length)pendingAdjustments.unshift('surface');

  return {
    version:NAR_TIME_THEORY_VERSION,
    researchOnly:true,
    affectsProbability:false,
    available:true,
    targetDistance:target,
    targetTrack:targetTrack||null,
    evidence:{
      ...counts,
      type:selection.evidenceType,
      sampleCount:selected.length,
      recentSampleCount:recent.length,
      surfaces,
      mixedSurface,
      distanceAdjusted:selected.some(x=>x.distanceAdjusted)
    },
    confidence:confidenceFor(selection.evidenceType,selected.length,mixedSurface),
    times:{
      peakTimeSec:round(peak),
      peakTime:formatTime(peak),
      currentTimeSec:round(current),
      currentTime:formatTime(current),
      targetTimeSec:round(targetTime),
      targetTime:formatTime(targetTime),
      bestScenarioTimeSec:round(bestScenario),
      bestScenarioTime:formatTime(bestScenario),
      slowScenarioTimeSec:round(slowScenario),
      slowScenarioTime:formatTime(slowScenario),
      stabilitySec:round(stability),
      stabilityPct:round(stabilityPct),
      peakReserveSec:round(current-peak)
    },
    trend:{
      time:timeTrend,
      last3f:{
        ...last3fTrend,
        best:round(last3fBest)
      }
    },
    comparison:{
      abilityPredictedTimeSec:abilityTime,
      abilityVsTargetGapSec:round(abilityGap),
      abilityAlignment
    },
    signals:{
      poorFinishButTimeHeld
    },
    pendingAdjustments
  };
}

export function rankNarTimeTheoryHorses(horses=[]){
  const source=Array.isArray(horses)?horses:[];
  const available=source
    .filter(h=>Number.isFinite(h?.timeTheory?.times?.targetTimeSec))
    .sort((a,b)=>a.timeTheory.times.targetTimeSec-b.timeTheory.times.targetTimeSec||Number(a.horseNumber)-Number(b.horseNumber));
  const rankByNo=new Map(available.map((h,i)=>[Number(h.horseNumber),i+1]));
  return source.map(h=>{
    const timeRank=rankByNo.get(Number(h.horseNumber))??null;
    const abilityRank=finite(h?.ability?.abilityRank);
    const gap=timeRank!=null&&abilityRank!=null?abilityRank-timeRank:null;
    const rankSignal=gap==null?'unavailable':gap>=3?'time_theory_upside':gap<=-3?'time_theory_risk':'aligned';
    return {
      ...h,
      timeTheory:{
        ...(h.timeTheory||{}),
        timeRank,
        abilityRankGap:gap,
        rankSignal
      }
    };
  });
}

export function summarizeNarTimeTheoryRace(horses=[]){
  const source=Array.isArray(horses)?horses:[];
  const available=source.filter(h=>h?.timeTheory?.available);
  const ranked=available.filter(h=>Number.isFinite(h?.timeTheory?.timeRank)).sort((a,b)=>a.timeTheory.timeRank-b.timeTheory.timeRank);
  return {
    version:NAR_TIME_THEORY_VERSION,
    researchOnly:true,
    affectsProbability:false,
    availableHorseCount:available.length,
    highConfidenceCount:available.filter(h=>h.timeTheory.confidence==='high').length,
    mediumConfidenceCount:available.filter(h=>h.timeTheory.confidence==='medium').length,
    fastestTargetHorse:ranked[0]?{
      horseNumber:ranked[0].horseNumber,
      horseName:ranked[0].horseName,
      targetTimeSec:ranked[0].timeTheory.times.targetTimeSec
    }:null,
    upsideHorseNumbers:available.filter(h=>h.timeTheory.rankSignal==='time_theory_upside').map(h=>h.horseNumber),
    riskHorseNumbers:available.filter(h=>h.timeTheory.rankSignal==='time_theory_risk').map(h=>h.horseNumber)
  };
}
