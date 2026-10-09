import {stableHash} from '../prediction/precomputed-snapshot.mjs';
import {buildNarMultiAngleComparison} from './nar-multi-angle-comparison-v1.mjs';
import {buildNarHistoryInterpretation} from './nar-history-interpretation-v1.mjs';

export const NAR_CLASS_CONTEXT_REVIEW_VERSION='NAR_CLASS_CONTEXT_REVIEW_V1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const label=v=>typeof v==='string'&&v.trim()&&!/^(unknown|unk|n\/a|null|missing|-|不明)$/i.test(v.trim())?v.trim():null;
const direction=(a,b)=>a===b?'TIE':a<b?'A_LOWER':'B_LOWER';
function observation(race,horse,refs,axis,classLabel){
  const indices=refs.map(r=>r.historyIndex).filter(i=>label(horse.pastRuns[i].raceClass)===classLabel);
  const view=buildNarHistoryInterpretation({race,horse:{...horse,pastRuns:indices.map(i=>horse.pastRuns[i])}});
  const group=axis==='CLOCK_SECONDS'?view.clock.groups[0]:axis==='LAST3F_SECONDS'?view.closingSpeed.groups[0]:null;
  const used=group?.refs??view.exactCourseDistance.refs;
  return {value:group?.median??(axis==='FINISH_FRACTION'?view.exactCourseDistance.medianFinishFraction:null),
    sampleCount:group?.sampleCount??view.exactCourseDistance.validResultCount,
    refs:used.map(ref=>({...ref,historyIndex:indices[ref.historyIndex],classLabel}))};
}

// Class-label strata are descriptive controls, never race-class equivalence or pace evidence.
export async function buildNarClassContextReview(snapshot,comparison,dossier){
  const canonical=await buildNarMultiAngleComparison(snapshot,comparison);
  if(await stableHash(dossier)!==await stableHash(canonical))throw new TypeError('CLASS_REVIEW_DOSSIER_BINDING_INVALID');
  const horses=new Map(snapshot.data.horses.map(h=>[h.horseKey,h])),questions=[];
  for(const [questionIndex,q] of canonical.reviewQuestions.entries()){
    const a=horses.get(q.pair[0]),b=horses.get(q.pair[1]);
    const labels=(horse,refs)=>[...new Set(refs.map(r=>label(horse.pastRuns[r.historyIndex].raceClass)).filter(Boolean))].sort();
    const aLabels=labels(a,q.refs.a),bLabels=labels(b,q.refs.b),shared=aLabels.filter(l=>bLabels.includes(l));
    const strata=shared.map(classLabel=>{
      const x=observation(snapshot.data.race,a,q.refs.a,q.axis,classLabel),y=observation(snapshot.data.race,b,q.refs.b,q.axis,classLabel);
      if(!finite(x.value)||!finite(y.value))throw new TypeError('CLASS_REVIEW_AXIS_OBSERVATION_INVALID');
      const d=direction(x.value,y.value),lower=d==='TIE'?null:d==='A_LOWER'?a.horseKey:b.horseKey;
      return {classLabel,a:x,b:y,direction:d,deltaAminusB:Math.round((x.value-y.value)*1000)/1000,
        relationToOriginalQuestion:lower===null?'RAW_TIE':lower===q.smallerObservationHorse?'RAW_DIVERGENCE_PERSISTS':'RAW_DIRECTION_REVERSES',
        singleObservation:x.sampleCount===1||y.sampleCount===1,classEquivalence:'NOT_AUTHENTICATED',paceContext:'UNAVAILABLE'};
    });
    const relations=[...new Set(strata.map(s=>s.relationToOriginalQuestion))];
    const missing=(horse,refs)=>refs.filter(r=>label(horse.pastRuns[r.historyIndex].raceClass)===null).map(r=>({...r,rawClassLabel:horse.pastRuns[r.historyIndex].raceClass??null}));
    questions.push({questionIndex,pair:[...q.pair],axis:q.axis,going:q.going,modelLeader:q.modelLeader,
      smallerObservationHorse:q.smallerObservationHorse,sourceQuestionCode:q.code,
      scope:{course:snapshot.data.race.racecourse,distance:snapshot.data.race.distance,surface:'dirt',going:q.going,
        meaning:'EXACT_HISTORICAL_CLASS_LABEL_NOT_CURRENT_RACE_EQUIVALENCE'},
      classLabels:{a:aLabels,b:bLabels,shared,aOnly:aLabels.filter(l=>!shared.includes(l)),bOnly:bLabels.filter(l=>!shared.includes(l))},
      missingClassRefs:{a:missing(a,q.refs.a),b:missing(b,q.refs.b)},strata,
      status:!strata.length?'NO_SHARED_USABLE_CLASS_LABEL':relations.length>1?'MIXED_RAW_DIRECTIONS':relations[0],
      answer:'UNRESOLVED_PACE_CLASS_EQUIVALENCE_AND_FORWARD_VALIDATION',predictionChangeAllowed:false});
  }
  const result={version:NAR_CLASS_CONTEXT_REVIEW_VERSION,raceId:snapshot.raceId,runId:snapshot.runId,modelVersion:snapshot.modelVersion,
    snapshotHash:snapshot.snapshotHash,comparisonOutputHash:comparison.outputHash,parentReviewHash:canonical.reviewHash,
    questions,coverage:{questions:questions.length,withSharedLabel:questions.filter(q=>q.strata.length).length,
      withoutSharedLabel:questions.filter(q=>!q.strata.length).length,strata:questions.reduce((n,q)=>n+q.strata.length,0)},
    classMatching:'TRIMMED_LITERAL_ONLY_NO_CLASS_HIERARCHY_INFERENCE',paceContext:'UNAVAILABLE',
    limitations:['CLASS_LABEL_NOT_CLASS_EQUIVALENCE','RACE_NAMES_NOT_NORMALIZED','PACE_NOT_OBSERVED','PERIOD_AND_OPPONENTS_NOT_MATCHED',
      'SMALL_SELECTED_SAMPLES','CORRELATED_AXES_NOT_INDEPENDENT','NO_FORWARD_ACCURACY_VALIDATION'],
    reviewStatus:'DESCRIPTIVE_COUNTER_REVIEW_NOT_FINAL_DECISION',authentication:'HASH_CONSISTENCY_NOT_SOURCE_AUTHENTICATION',
    replayMode:canonical.replayMode,currentGoing:canonical.currentGoing,currentRaceClass:'NOT_ASSESSED',
    researchOnly:true,earlyEligible:false,formalKpiEligible:false,productionActivationReady:false,
    roleDecision:'NOT_GENERATED',signalStatus:'NOT_GENERATED',predictionMutation:'NONE',freezeMutation:'NONE',signalMutation:'NONE'};
  return freeze({...result,reviewHash:await stableHash(result)});
}
