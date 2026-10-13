import {createSnapshotHash} from './precomputed-snapshot.mjs';
import {NAR_ABILITY_VERSION} from './nar-ability-precompute.mjs';
export const NAR_RESEARCH_PROBABILITY_VERSION='NAR_RESEARCH_PL_V1';
const temperature=7; // Existing ability scale; uncalibrated research parameter.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const flags={researchOnly:true,formalKpiEligible:false,calibrated:false,productionActivationReady:false};

// Offline only. It neither reads D1 nor saves, fetches, or updates a snapshot.
export async function materializeNarResearchProbability(snapshot){
 const base={modelVersion:NAR_RESEARCH_PROBABILITY_VERSION,temperature,...flags};
 const hold=reasonCode=>({...base,status:'MODEL_HOLD',reasonCode,horses:[]});
 const d=snapshot?.layers?.DATA;
 if(snapshot?.organization!=='NAR'||snapshot.calculationVersion!==NAR_ABILITY_VERSION||snapshot.modelVersion!==NAR_ABILITY_VERSION||d?.formalKpiEligible!==false||snapshot.layers.MARKET||snapshot.layers.FINAL||snapshot.layers.RESULT)return hold('SNAPSHOT_CONTRACT');
 try{if(await createSnapshotHash(snapshot)!==snapshot.snapshotHash)return hold('SNAPSHOT_HASH');}catch{return hold('SNAPSHOT_HASH');}
 const source=snapshot.layers.SOURCE;
 const date=d.race?.date,post=Date.parse(`${date}T${d.race?.postTime}:00+09:00`),acquired=Date.parse(snapshot.sourceAcquiredAt);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.race?.postTime||'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!Number.isInteger(d.race?.raceNo)||d.race.raceNo<1||d.race.raceNo>99||!Number.isFinite(post)||!Number.isFinite(acquired)||acquired>=post||!new RegExp(`^${date.replaceAll('-','')}-NAR-\\d{2}-${String(d.race?.raceNo).padStart(2,'0')}$`).test(snapshot.raceId))return hold('PRE_RACE_IDENTITY');
 if(source?.organization!=='NAR'||source.raceId!==snapshot.raceId||source.date!==date||source.track!==d.race.track||source.raceNo!==d.race.raceNo||source.acquiredAt!==snapshot.sourceAcquiredAt||Date.parse(snapshot.dataCalculatedAt)<acquired||!Number.isFinite(Date.parse(snapshot.dataCalculatedAt))||Date.parse(snapshot.dataCalculatedAt)>=post)return hold('PRE_RACE_IDENTITY');
 const horses=d.horses;
 if(!Array.isArray(horses)||horses.length<2||horses.length>30||horses.some(h=>!Number.isInteger(h.horseNo)||h.horseNo<1||h.horseNo>30)||new Set(horses.map(h=>h.horseNo)).size!==horses.length)return hold('FIELD_INVALID');
 if(horses.some(h=>!['active','scratched','excluded','withdrawn'].includes(h.runnerStatus)))return hold('RUNNER_STATUS_UNKNOWN');
 const active=horses.filter(h=>h.runnerStatus==='active');
 if(active.length<2)return hold('ACTIVE_FIELD_INSUFFICIENT');
 if(active.some(h=>!finite(h.abilityScore)))return hold('ABILITY_COVERAGE_INCOMPLETE');
 if(active.some(h=>h.evidence?.schemaVersion!==1))return hold('EVIDENCE_NOT_RETAINED');
 if(active.some(h=>!Number.isInteger(h.evidence.runCount)||h.evidence.runCount<1||!['timeIndex','fiveRaceAvgIndex','distanceIndex','courseIndex'].some(k=>finite(h.evidence.components?.[k]))))return hold('ABILITY_EVIDENCE_INSUFFICIENT');
 const max=Math.max(...active.map(h=>h.abilityScore)),weights=active.map(h=>Math.exp((h.abilityScore-max)/temperature));
 // Reject extreme numerical ranges; do not clip or invent a probability floor.
 if(weights.some(w=>!Number.isFinite(w)||w<1e-12))return hold('NUMERICAL_RANGE');
 const total=weights.reduce((a,b)=>a+b,0),win=weights.map(w=>w/total),top3=active.length<=3?weights.map(()=>1):win.slice();
 if(active.length>3){
  for(let i=0;i<weights.length;i++){
   const afterFirst=weights.reduce((s,w,j)=>s+(j===i?0:w),0);
   for(let j=0;j<weights.length;j++)if(j!==i){
    const pair=win[i]*weights[j]/afterFirst;
    top3[j]+=pair;
    const afterSecond=weights.reduce((s,w,k)=>s+(k===i||k===j?0:w),0);
    for(let k=0;k<weights.length;k++)if(k!==i&&k!==j)top3[k]+=pair*weights[k]/afterSecond;
   }
  }
 }
 const sum=a=>a.reduce((s,p)=>s+p,0),epsilon=1e-10;
 if(Math.abs(sum(win)-1)>epsilon||Math.abs(sum(top3)-Math.min(3,active.length))>epsilon||top3.some((p,i)=>p<win[i]-epsilon||p>1+epsilon||!Number.isFinite(p)))return hold('PROBABILITY_INVARIANT');
 const results=new Map(active.map((h,i)=>[h.horseNo,{win:win[i],top3:Math.min(1,top3[i])}]));
 return {...base,status:'RESEARCH_READY',reasonCode:null,raceId:snapshot.raceId,inputSnapshotHash:snapshot.snapshotHash,
  metric:'WIN_AND_TOP3',method:'PLACKETT_LUCE_EXACT_TOP3',winTotal:sum(win),top3Total:sum(top3),
  horses:horses.map(h=>({horseNo:h.horseNo,runnerStatus:h.runnerStatus,status:results.has(h.horseNo)?'RESEARCH_READY':'NOT_APPLICABLE',...(results.get(h.horseNo)||{win:null,top3:null})}))};
}
