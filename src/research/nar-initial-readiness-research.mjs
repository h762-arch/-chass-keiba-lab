import {readNarInitialAdmissionResearch} from './nar-commit-admission.mjs';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
const unresolved=[
 'SOURCE_AUTHENTICATION_UNVERIFIED',
 'TRUSTED_DURABLE_TIME_UNVERIFIED',
 'TRUSTED_TRANSACTION_IDENTITY_UNVERIFIED',
 'SCENARIO_POLICY_UNAPPROVED',
 'MARKET_POLICY_UNAPPROVED',
 'STRONG_SUPPORT_POLICY_UNAPPROVED',
];

// Diagnostic reader only. It cannot accept certification, acquire fresh data,
// save content, change admission, or promote a research Signal into formal EARLY.
export async function inspectNarInitialReadinessResearch({store,receiptStore,raceId}={}){
 const admission=await readNarInitialAdmissionResearch({store,receiptStore,raceId});
 const base={schemaVersion:'NAR-INITIAL-READINESS-RESEARCH-1',raceId,
  scope:'initial diamond research; warning policy and prediction performance not evaluated',
  status:admission.status,reason:admission.reason,researchOnly:true,
  formalKpiEligible:false,adopted:false,productionActivationReady:false};
 // Never derive positive evidence from a missing or rejected source.
 if(admission.status!=='HOLD')return freeze({...base,checks:null,blockers:[admission.reason||'INITIAL_SOURCE_MISSING']});
 const snapshot=admission.snapshot;
 if(snapshot.kind!=='initial_research')return freeze({...base,
  checks:{sourceKind:'LEGACY_EARLY',bundleIntegrity:'NOT_EVALUATED',commitTiming:'UNKNOWN'},
  blockers:['LEGACY_INITIAL_BUNDLE_UNCONFIRMED',...unresolved]});
 const evidencePresent=admission.receipt!==null;
 return freeze({...base,sourceBundleSha256:snapshot.contentSha256,
  checks:{sourceKind:'INITIAL_RESEARCH',bundleIntegrity:'VERIFIED_LOCAL',
   commitEvidence:evidencePresent?'VERIFIED_LOCAL':'UNAVAILABLE',commitTiming:admission.timing,
   frozenMarketCoverage:'VERIFIED_LOCAL',assessedHorseNos:snapshot.assessments.map(a=>a.horseNo),
   insufficientAssessmentCount:snapshot.assessments.filter(a=>a.status==='INSUFFICIENT').length,
   candidateSignalStatus:snapshot.candidateSignal.status,
   sourceAuthentication:'UNVERIFIED',trustedDurableTime:'UNVERIFIED',
   trustedTransactionIdentity:'UNVERIFIED',scenarioPolicy:'UNAPPROVED',
   marketPolicy:'UNAPPROVED',strongSupportPolicy:'UNAPPROVED'},
  blockers:[...(['COMMIT_EVIDENCE_UNAVAILABLE','COMMIT_EVIDENCE_MISSING','COMMIT_OBSERVED_LATE','COMMIT_TIMING_UNCONFIRMED'].includes(admission.reason)?[admission.reason]:[]),...unresolved]});
}
