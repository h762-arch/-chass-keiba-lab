import {stableHash} from '../prediction/precomputed-snapshot.mjs';
import {BRIDGE_VERSION,RETROSPECTIVE_BRIDGE_VERSION} from './prediction-evidence-bridge-v1.mjs';
import {buildNarHistoryInterpretation} from './nar-history-interpretation-v1.mjs';

const GOINGS=['良','稍重','重','不良'];
const fail=reason=>{throw new TypeError(reason);};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const round=value=>Math.round(value*1000)/1000;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function restoreRefs(value,indices){
  if(Array.isArray(value))return value.map(v=>restoreRefs(v,indices));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    key==='historyIndex'?indices[item]:restoreRefs(item,indices)]));
  return value;
}
function profile(race,horse,going){
  const indices=horse.pastRuns.map((run,i)=>run.trackCondition===going?i:-1).filter(i=>i>=0);
  const scoped=buildNarHistoryInterpretation({race,horse:{...horse,pastRuns:indices.map(i=>horse.pastRuns[i])}});
  const view=restoreRefs(scoped,indices),clock=view.clock.groups.find(g=>g.going===going),closing=view.closingSpeed.groups.find(g=>g.going===going);
  return {
    CLOCK_SECONDS:{value:clock?.median??null,sampleCount:clock?.sampleCount??0,refs:clock?.refs??[],unit:'SECONDS'},
    LAST3F_SECONDS:{value:closing?.median??null,sampleCount:closing?.sampleCount??0,refs:closing?.refs??[],unit:'SECONDS'},
    FINISH_FRACTION:{value:view.exactCourseDistance.medianFinishFraction,sampleCount:view.exactCourseDistance.validResultCount,
      refs:view.exactCourseDistance.refs.filter(ref=>{const r=horse.pastRuns[ref.historyIndex];return Number.isInteger(r.fieldSize)&&r.fieldSize>1&&Number.isInteger(r.finish)&&r.finish>0&&r.finish<=r.fieldSize;}),unit:'ORDINAL_FRACTION'},
    RECORDED_LATE_POSITION_GAIN:{value:view.position.medianLastToFinishGain,sampleCount:view.position.sampleCount,
      refs:view.position.observations.map(o=>o.ref),unit:'POSITIONS'}
  };
}

// A comparison dossier for human/model research review, not a new prediction model.
export async function buildNarMultiAngleComparison(snapshot,comparison){
  if(![BRIDGE_VERSION,RETROSPECTIVE_BRIDGE_VERSION].includes(snapshot?.schemaVersion)||snapshot.organization!=='NAR'
    ||snapshot.researchOnly!==true||snapshot.formalKpiEligible!==false||snapshot.productionActivationReady!==false)fail('RESEARCH_NAR_SNAPSHOT_REQUIRED');
  const {snapshotHash,...payload}=snapshot;
  if(await stableHash(payload)!==snapshotHash)fail('SNAPSHOT_HASH_MISMATCH');
  if(snapshot.schemaVersion===RETROSPECTIVE_BRIDGE_VERSION&&(snapshot.replayMode!=='RETROSPECTIVE_ONLY'||snapshot.earlyEligible!==false))fail('RETROSPECTIVE_AUTHORITY_INVALID');
  if(comparison?.status!=='COMPARED_SHADOW_ONLY'||comparison.snapshotHash!==snapshotHash
    ||comparison.runId!==snapshot.runId||comparison.modelVersion!==snapshot.modelVersion
    ||comparison.researchOnly!==true||comparison.formalKpiEligible!==false||comparison.productionActivationReady!==false
    ||comparison.freezeMutation!=='NONE'||comparison.signalMutation!=='NONE')fail('COMPARISON_BINDING_INVALID');
  if(await stableHash(comparison.after)!==comparison.outputHash)fail('COMPARISON_HASH_MISMATCH');
  const horses=snapshot.data.horses.filter(h=>h.runningStatus==='active').slice().sort((a,b)=>a.horseNo-b.horseNo);
  const outputs=comparison.after?.horses;
  if(horses.length<2||horses.length>99||!Array.isArray(outputs)||outputs.length!==horses.length
    ||new Set(horses.map(h=>h.horseKey)).size!==horses.length
    ||new Set(horses.map(h=>h.horseNo)).size!==horses.length
    ||horses.some(h=>outputs.filter(o=>o.horseNo===h.horseNo&&o.horseName===h.horseName).length!==1))fail('COMPARISON_RUNNER_IDENTITY_MISMATCH');
  // Validate all history dates/surfaces, even if no shared condition is found.
  horses.forEach(h=>buildNarHistoryInterpretation({race:snapshot.data.race,horse:h}));
  const profiles=new Map(horses.map(h=>[h.horseKey,new Map(GOINGS.map(g=>[g,profile(snapshot.data.race,h,g)]))]));
  const pairs=[],reviewQuestions=[];
  for(let i=0;i<horses.length;i++)for(let j=i+1;j<horses.length;j++){
    const a=horses[i],b=horses[j],aModel=outputs.find(h=>h.horseNo===a.horseNo),bModel=outputs.find(h=>h.horseNo===b.horseNo);
    const modelLeader=finite(aModel.overall)&&finite(bModel.overall)&&aModel.overall!==bModel.overall
      ?aModel.overall>bModel.overall?a.horseKey:b.horseKey:null;
    const contexts=[];
    for(const going of GOINGS){
      const left=profiles.get(a.horseKey).get(going),right=profiles.get(b.horseKey).get(going),axes=[];
      for(const axis of Object.keys(left)){
        const x=left[axis],y=right[axis];
        if(!finite(x.value)||!finite(y.value))continue;
        const direction=x.value===y.value?'TIE':x.value<y.value?'A_LOWER':'B_LOWER';
        axes.push({axis,a:structuredClone(x),b:structuredClone(y),direction,
          deltaAminusB:round(x.value-y.value),meaning:axis==='RECORDED_LATE_POSITION_GAIN'
            ?'POSITION_CHANGE_ONLY_NOT_ABILITY_OR_FINISH_ADVANTAGE':'RAW_HISTORICAL_OBSERVATION_NOT_ADJUSTED_ABILITY',
          singleObservation:x.sampleCount===1||y.sampleCount===1});
        if(modelLeader&&direction!=='TIE'&&axis!=='RECORDED_LATE_POSITION_GAIN'){
          const lowerHorse=direction==='A_LOWER'?a.horseKey:b.horseKey;
          if(lowerHorse!==modelLeader)reviewQuestions.push({pair:[a.horseKey,b.horseKey],going,axis,modelLeader,
            code:'REVIEW_INDEX_LED_RAW_HISTORY_DIVERGENCE',smallerObservationHorse:lowerHorse,
            refs:{a:structuredClone(x.refs),b:structuredClone(y.refs)},
            answer:'UNRESOLVED_CLASS_PACE_CONTEXT',predictionChangeAllowed:false});
        }
      }
      if(axes.length)contexts.push({course:snapshot.data.race.racecourse,distance:snapshot.data.race.distance,surface:'dirt',going,
        scope:'SHARED_HISTORICAL_CONTEXT_NOT_CURRENT_FORECAST',matchesDeclaredCurrentGoing:snapshot.data.race.trackCondition===going,
        axes,independentEvidenceVotes:'NOT_COMPUTED',winner:'NOT_ASSIGNED'});
    }
    pairs.push({a:{horseKey:a.horseKey,horseNo:a.horseNo,horseName:a.horseName},b:{horseKey:b.horseKey,horseNo:b.horseNo,horseName:b.horseName},
      modelLeader,modelOrderMeaning:'EXISTING_INDEX_LED_OVERALL_NOT_CERTIFIED_MULTIANGLE_ORDER',contexts,
      status:contexts.length?'DESCRIPTIVE_COMPARISON':'NO_SHARED_USABLE_KNOWN_GOING_CONTEXT'});
  }
  const result={version:'NAR_MULTI_ANGLE_COMPARISON_V1',raceId:snapshot.raceId,runId:snapshot.runId,modelVersion:snapshot.modelVersion,
    snapshotHash,comparisonOutputHash:comparison.outputHash,pairs,reviewQuestions,
    coverage:{runners:horses.length,pairs:pairs.length,comparedPairs:pairs.filter(p=>p.contexts.length).length,
      sharedContexts:pairs.reduce((sum,p)=>sum+p.contexts.length,0)},
    currentGoing:snapshot.data.race.trackCondition??'UNKNOWN',currentGoingProof:'SOURCE_DECLARATION_UNVERIFIED',
    limitations:['CLASS_NOT_MATCHED','PACE_NOT_MATCHED','HISTORICAL_SAMPLE_SELECTION','CORRELATED_AXES_NOT_INDEPENDENT',
      'POSITION_GAIN_NOT_ABILITY','PROBABILITY_UNCALIBRATED','NO_FORWARD_ACCURACY_VALIDATION'],
    reviewStatus:'COMPARISON_RESEARCH_ONLY_NOT_FINAL_DECISION',researchOnly:true,earlyEligible:false,
    formalKpiEligible:false,productionActivationReady:false,roleDecision:'NOT_GENERATED',signalStatus:'NOT_GENERATED',
    predictionMutation:'NONE',freezeMutation:'NONE',signalMutation:'NONE',authentication:'HASH_CONSISTENCY_NOT_SOURCE_AUTHENTICATION',
    replayMode:snapshot.schemaVersion===RETROSPECTIVE_BRIDGE_VERSION?'RETROSPECTIVE_ONLY':'PRE_OFF_DECLARED_RESEARCH_ONLY'};
  return freeze({...result,reviewHash:await stableHash(result)});
}
