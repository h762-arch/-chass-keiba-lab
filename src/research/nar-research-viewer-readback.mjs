import {isDeepStrictEqual} from 'node:util';
import {auditNarResearchMirror} from './nar-research-mirror-audit.mjs';
import {fetchNarResearchChatMirror} from './nar-research-chat-mirror.mjs';

const flags={scope:'CURRENT_VIEWER_READBACK_AGAINST_DECLARED_MIRROR_BUNDLE',sourceReferenceBasis:'DECLARED_LOCAL_COMMIT_BUNDLE',originAuthenticated:false,researchOnly:true,formalKpiEligible:false,acquisitionCertified:false,readiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',earlyFreezeVerification:'NOT_VERIFIED',historicalCaptureVerification:'NOT_ESTABLISHED'};
const readErrors=['RESEARCH_CONFIGURATION_INVALID','RESEARCH_FETCH_TIMEOUT','RESEARCH_HTTP_UNAVAILABLE','RESEARCH_CONTENT_TYPE_INVALID','RESEARCH_BODY_INVALID','RESEARCH_BODY_TOO_LARGE','RESEARCH_JSON_INVALID','RESEARCH_VIEWER_INVALID','RESEARCH_RACE_INVALID','RESEARCH_HORSE_INVALID','RESEARCH_ABILITY_INVALID','RESEARCH_TIME_INVALID','RESEARCH_SIGNAL_INVALID','RESEARCH_CAPTURE_TIME_INVALID'];
const clock=now=>{const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))throw Error('CLOCK_INVALID');return d;};
const mirrorSummary=r=>({status:r.status,reasonCodes:r.reasonCodes,currentStatusEligible:r.currentStatusEligible,consistencyStatus:r.consistencyStatus,sourceReference:r.sourceReference??null,totals:r.totals});

// One read of the current saved viewer. No collector, D1 writer or snapshot repair.
// The original publication time and actual readback time remain separate.
export async function readAndAuditNarResearchViewer(bundle,{expectedDate,slug,fetchImpl=globalThis.fetch,now=()=>new Date(),timeoutMs=15000}={}){
 let mirror=null,attemptedAt=null,viewerReadAt=null,observedPayloadSha256=null;
 const hold=(reasonCode,detail=null)=>({...flags,status:'HOLD',currentStatusEligible:false,reasonCodes:[reasonCode],readFailureCode:detail,mirror,attemptedAt,viewerReadAt,observedPayloadSha256,viewerHashVerification:'NOT_VERIFIED',projectionVerification:'NOT_VERIFIED'});
 try{
  if(typeof now!=='function'||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return hold('READBACK_CONFIGURATION_INVALID');
  const b=structuredClone(bundle),started=clock(now);attemptedAt=started.toISOString();
  const initial=auditNarResearchMirror(b,{expectedDate,slug,now:started.getTime()});mirror=mirrorSummary(initial);
  if(initial.status!=='VERIFIED')return hold('MIRROR_AUDIT_HOLD');
  const viewer=await fetchNarResearchChatMirror({date:expectedDate,slug,fetchImpl,now:()=>clock(now),timeoutMs});
  if(!viewer)return hold('VIEWER_READ_UNAVAILABLE','VIEWER_NOT_FOUND');
  viewerReadAt=viewer.capturedAt;observedPayloadSha256=viewer.sourcePayloadSha256;
  const finished=clock(now);
  if(Date.parse(viewerReadAt)<started.getTime()||finished.getTime()<Date.parse(viewerReadAt))return hold('READBACK_CLOCK_REVERSED');
  // Freshness is rechecked after the GET, never replaced with its newer timestamp.
  const latest=auditNarResearchMirror(b,{expectedDate,slug,now:finished.getTime()});mirror=mirrorSummary(latest);
  if(latest.status!=='VERIFIED')return hold('MIRROR_EXPIRED_DURING_READBACK');
  if(observedPayloadSha256!==b.day.sourcePayloadSha256)return hold('VIEWER_PAYLOAD_CHANGED');
  // Only the capture time differs: do not manufacture a historical read time.
  const {capturedAt:publishedAt,...published}=b.day,{capturedAt:readAt,...observed}=viewer;
  if(!isDeepStrictEqual(observed,published))return hold('MIRROR_PROJECTION_MISMATCH');
  return {...flags,status:'VERIFIED',currentStatusEligible:true,reasonCodes:[],readFailureCode:null,mirror,attemptedAt,viewerReadAt,finishedAt:finished.toISOString(),publishedCapturedAt:publishedAt,observedPayloadSha256,hashBasis:'UTF8_JSON_STRINGIFY_VIEWER_PAYLOAD',viewerHashVerification:'MATCHED_CURRENT_VIEWER_PAYLOAD',projectionVerification:'MATCHED_EXCEPT_SEPARATE_CAPTURE_TIMES',raceCount:latest.raceCount,totals:latest.totals};
 }catch(e){if(e?.message==='CLOCK_INVALID')return hold('READBACK_CLOCK_INVALID');return hold('VIEWER_READ_UNAVAILABLE',readErrors.includes(e?.message)?e.message:'READ_UNAVAILABLE');}
}
