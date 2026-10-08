import {stableHash} from '../prediction/precomputed-snapshot.mjs';
import {adaptNarMasterEvidence} from './nar-master-evidence-adapter-v1.mjs';
import {createNarRetrospectiveEvidenceSnapshot} from './prediction-evidence-bridge-v1.mjs';
import {compareNarRetrospectiveEvidence} from './nar-prediction-evidence-consumer-v1.mjs';

const fail=reason=>{throw new TypeError(reason);};
// Official records are caller-reviewed metadata, NOT authenticated pre-off proof.
// This function performs no IO and never changes a master, Freeze, or model weight.
export async function replayNarMasterEvidence({masters,review,source,runId,modelVersion,cutoffAt,offAt}={}) {
  if (review?.basis!=='POST_RACE_IDENTITY_ONLY' || !Array.isArray(review.participants)
    || !review.participants.length || !Array.isArray(review.refs) || !review.refs.length
    || review.refs.some(ref=>typeof ref!=='string'||!/^https:\/\//.test(ref))
    || review.sourceRaceId!==masters?.sourceRaceId || review.canonicalRaceId!==masters?.canonicalRaceId) fail('RETROSPECTIVE_REVIEW_REQUIRED');
  if (new Set(review.participants.map(p=>p.horseNo)).size!==review.participants.length
    || review.participants.some(p=>!Number.isInteger(p.horseNo)||p.horseNo<1||typeof p.officialName!=='string'||!p.officialName.trim()||p.status!=='ACTIVE')) fail('PARTICIPANT_REVIEW_INVALID');
  const unreviewed=adaptNarMasterEvidence({...masters,associations:[],statuses:[]});
  if (await stableHash(review.context)!==await stableHash(unreviewed.context)) fail('OFFICIAL_RACE_CONTEXT_MISMATCH');
  if (review.participants.length!==unreviewed.indexCount) fail('COMPLETE_PARTICIPANT_REVIEW_REQUIRED');
  const associations=[],statuses=[];
  for (const row of unreviewed.audit) {
    const p=review.participants.find(p=>p.horseNo===row.horseNo);
    if (!p || row.historyNames.length!==1 || row.sourceHorseIds.length!==1
      || row.historyNames[0]!==p.officialName) fail('OFFICIAL_HISTORY_IDENTITY_MISMATCH');
    if (row.indexName!==p.officialName) {
      if (p.approvedIndexAlias!==row.indexName) fail('EXPLICIT_INDEX_ALIAS_REQUIRED');
      associations.push({sourceRaceId:masters.sourceRaceId,canonicalRaceId:masters.canonicalRaceId,
        horseNo:row.horseNo,indexName:row.indexName,historyName:p.officialName,
        sourceHorseId:row.sourceHorseIds[0],status:'PASS',evidenceRef:review.refs.join(' | ')});
    }
    statuses.push({sourceRaceId:masters.sourceRaceId,horseNo:row.horseNo,horseName:row.indexName,
      status:'ACTIVE',evidenceRef:review.refs.join(' | ')});
  }
  const adapter=adaptNarMasterEvidence({...masters,associations,statuses});
  if (adapter.status!=='READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT') fail('MASTER_REPLAY_HOLD');
  const snapshot=await createNarRetrospectiveEvidenceSnapshot({raceId:masters.canonicalRaceId,
    runId,modelVersion,cutoffAt,offAt,source,races:adapter.races,runners:adapter.runners,
    history:adapter.history,identityMap:adapter.identityMap,
    replayEvidence:{observedAt:review.observedAt,basis:review.basis,refs:review.refs}});
  // A feature-reduced baseline, NOT a recovered historical prediction. No fake uniform scores.
  const baseline={raceId:snapshot.raceId,runId,modelVersion,data:{race:structuredClone(snapshot.data.race),
    horses:snapshot.data.horses.map(h=>{
      const index=snapshot.evidence.find(e=>e.horseKey===h.horseKey&&e.family==='INDEX').values;
      return {...structuredClone(h),pastRuns:[],timeIndex:index.PeakIndex,courseIndex:index.CourseIndex};
    })}};
  const comparison=await compareNarRetrospectiveEvidence(snapshot,baseline,{indexPolicy:{status:'APPROVED_RESEARCH',
    scale:'NAR_APP_RAW_INDEX',runId,modelVersion,snapshotHash:snapshot.snapshotHash,
    evidenceRef:'RESEARCH_ONLY: preserve archive raw scale in existing NAR app fields; not calibration certification'}});
  return {replayVersion:'NAR_RETROSPECTIVE_REPLAY_V1',review:structuredClone(review),adapter,snapshot,comparison,
    baselineMeaning:'PEAK_COURSE_WEIGHT_ONLY_NOT_SAVED_EARLY',rawSourceHash:await stableHash(masters),
    metadataUse:'IDENTITY_STATUS_ONLY',researchOnly:true,earlyEligible:false,formalKpiEligible:false,
    productionActivationReady:false,performanceClaim:'NONE',freezeMutation:'NONE',driveMutation:'NONE'};
}
