import {stableHash} from '../prediction/precomputed-snapshot.mjs';
import {RETROSPECTIVE_BRIDGE_VERSION} from './prediction-evidence-bridge-v1.mjs';
import {compareNarPredictionEvidence,compareNarRetrospectiveEvidence} from './nar-prediction-evidence-consumer-v1.mjs';
import {buildNarMultiAngleComparison} from './nar-multi-angle-comparison-v1.mjs';
import {buildNarClassContextReview} from './nar-class-context-review-v1.mjs';

export const NAR_PREDICTION_REVIEW_VERSION='NAR_PREDICTION_REVIEW_V1';
const copy=v=>structuredClone(v);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function usage(item){
  const affected=item.affectedOutputs??[];
  const available=item.stages.includes('AVAILABLE'),probability=affected.includes('PROBABILITY_OR_ABILITY_MARK');
  const time=affected.includes('TIME_RESEARCH'),explanation=affected.includes('HISTORY_INTERPRETATION');
  return {family:item.family,sourceAvailable:available,sourceValues:copy(item.values),sourceRefs:copy(item.refs),
    consumerStage:item.stage,consumerStages:copy(item.stages),
    observedProbabilityOrMarkEffect:probability,observedTimeEffect:time,observedExplanationEffect:explanation,
    effectScope:'FIELD_WIDE_ABLATION_NOT_HORSE_LOCAL_CAUSAL_EFFECT',
    status:!available?'MISSING':probability||time?'OBSERVED_MODEL_OUTPUT_CHANGE':explanation?'EXPLANATION_ONLY':'PRESENT_NO_OBSERVED_MODEL_CHANGE',
    reason:item.unusedReason??null,unavailableReason:item.unavailableReason??null};
}

// End-to-end offline research entrypoint: derives its own consumer trace and reviews.
// Never accepts caller-authored claims about what the prediction model used.
export async function reviewNarPredictionEvidence(snapshot,baseline,options={}){
  const retrospective=snapshot?.schemaVersion===RETROSPECTIVE_BRIDGE_VERSION;
  const comparison=await (retrospective?compareNarRetrospectiveEvidence:compareNarPredictionEvidence)(snapshot,baseline,options);
  const dossier=await buildNarMultiAngleComparison(snapshot,comparison);
  const classReview=await buildNarClassContextReview(snapshot,comparison,dossier);
  const rows=snapshot.data.horses.filter(h=>h.runningStatus==='active').slice().sort((a,b)=>a.horseNo-b.horseNo).map(h=>{
    const features=comparison.trace.filter(t=>t.horseKey===h.horseKey).map(usage);
    const before=comparison.before.horses.find(o=>o.horseNo===h.horseNo),after=comparison.after.horses.find(o=>o.horseNo===h.horseNo);
    const history=comparison.after.historyInterpretation.find(o=>o.horseKey===h.horseKey);
    const pairs=dossier.pairs.filter(p=>p.a.horseKey===h.horseKey||p.b.horseKey===h.horseKey);
    const questions=classReview.questions.filter(q=>q.pair.includes(h.horseKey));
    const gaps=[];
    for(const f of features){
      if(!f.sourceAvailable)gaps.push({code:'SOURCE_FACTOR_MISSING',family:f.family,refs:copy(f.sourceRefs)});
      else if(f.reason==='CONSUMER_MAPPING_UNSUPPORTED_OR_MISSING')gaps.push({code:'SOURCE_FACTOR_NOT_MAPPED',family:f.family,refs:copy(f.sourceRefs)});
      else if(f.family==='INDEX'&&f.reason==='INDEX_SCALE_POLICY_UNAPPROVED_OR_MISSING')gaps.push({code:'INDEX_RESEARCH_POLICY_NOT_APPROVED',family:f.family,refs:copy(f.sourceRefs)});
    }
    if(history.counterEvidence.some(e=>e.code==='CURRENT_GOING_UNCONFIRMED'))gaps.push({code:'CURRENT_GOING_UNCONFIRMED'});
    gaps.push({code:'PACE_CLASS_EQUIVALENCE_NOT_VALIDATED'},{code:'PROBABILITY_CALIBRATION_AND_FORWARD_VALIDATION_REQUIRED'});
    return {horseKey:h.horseKey,horseNo:h.horseNo,horseName:h.horseName,
      existingModel:{before:copy(before),after:copy(after),probabilityStatus:comparison.probabilityStatus,
        markStatus:comparison.markStatus,meaning:'EXISTING_MODEL_SHADOW_OUTPUT_NOT_REVISED_FINAL_PREDICTION'},
      features,historyInterpretation:copy(history),timeResearch:copy(comparison.after.time.find(o=>o.horseNo===h.horseNo)),
      pairCoverage:{total:pairs.length,withSharedHistoricalContext:pairs.filter(p=>p.contexts.length).length},
      counterReview:{questionIndices:questions.map(q=>q.questionIndex),questions:copy(questions),
        missingSharedClassLabel:questions.filter(q=>!q.strata.length).length,
        meaning:'QUESTIONS_NOT_INDEPENDENT_SUPPORTS_OR_VALIDATED_REVERSALS'},
      gaps,reviewDecision:'HOLD',revisedFinalPrediction:'NOT_GENERATED',predictionChangeAllowed:false,
      signalStatus:'NOT_GENERATED',signalMutation:'NONE'};
  });
  const result={version:NAR_PREDICTION_REVIEW_VERSION,raceId:snapshot.raceId,runId:snapshot.runId,modelVersion:snapshot.modelVersion,
    snapshotHash:snapshot.snapshotHash,consumerOutputHash:comparison.outputHash,parentReviewHash:dossier.reviewHash,
    classReviewHash:classReview.reviewHash,rows,
    coverage:{activeRunners:rows.length,pairs:dossier.coverage.pairs,uniqueQuestions:classReview.coverage.questions,
      // A pair question belongs to two horse rows. Never call summed row counts unique evidence.
      rowQuestionReferences:rows.reduce((n,r)=>n+r.counterReview.questionIndices.length,0)},
    usageAuthority:'RECOMPUTED_CONSUMER_TRACE_NOT_SOURCE_OR_TIMING_AUTHENTICATION',
    reviewDecision:'HOLD',revisedFinalPrediction:'NOT_GENERATED',reviewStatus:'INTEGRATED_RESEARCH_REVIEW_NOT_FORMAL_PREDICTION',
    replayMode:retrospective?'RETROSPECTIVE_ONLY':'PRE_OFF_DECLARED_RESEARCH_ONLY',
    formalBlockers:['SOURCE_AND_TIMING_UNAUTHENTICATED','PACE_CLASS_EQUIVALENCE_UNVALIDATED','UNCALIBRATED_PROBABILITIES','NO_FORWARD_VALIDATION'],
    researchOnly:true,earlyEligible:false,formalKpiEligible:false,productionActivationReady:false,
    predictionMutation:'NONE',freezeMutation:'NONE',signalMutation:'NONE',signalStatus:'NOT_GENERATED'};
  const review=freeze({...result,reviewHash:await stableHash(result)});
  // Keep canonical parents available for replay/audit; none is promoted or rewritten.
  return freeze({comparison,dossier,classReview,review});
}
