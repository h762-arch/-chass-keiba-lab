import { auditFrozenSignalRules } from './signal-rule-audit.mjs';

const text=v=>typeof v==='string'&&v.trim().length>0;
const stamp=v=>text(v)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const scopeKeys=['runId','raceId','freezeId','sourceSnapshotId'];
const sameScope=(a,b)=>scopeKeys.every(k=>a?.[k]===b?.[k]);

// Research-only join of supplied receipts. This checks shape, scope, time and
// independence, not authenticity or the predictive quality of a scenario.
// Never assigns marks, rewrites snapshots, or grants production/KPI eligibility.
export function auditSignalEvidenceLedger({scope,snapshot,evidence,survivalReviews}={}){
 const base=auditFrozenSignalRules(snapshot);
 const result=(status,reason,rows=[])=>freeze({status,reason,mode:'research',
  authority:'CHASS-v2.15.5/V5-05/V5-06',authenticity:'NOT_VERIFIED',
  scenarioQuality:'NOT_EVALUATED',adopted:false,formalKpiEligible:false,
  productionActivationReady:false,rows});
 if(base.status!=='READY')return result('REJECTED',base.reason);
 if(!scopeKeys.every(k=>text(scope?.[k])))return result('REJECTED','SCOPE_REQUIRED');
 if(!stamp(snapshot.frozenAt))return result('REJECTED','FREEZE_TIMEZONE_REQUIRED');
 if(!Array.isArray(evidence)||!Array.isArray(survivalReviews))
  return result('UNVERIFIED','EVIDENCE_LEDGER_OR_SURVIVAL_REVIEWS_UNAVAILABLE');
 if(evidence.length>8000||survivalReviews.length>99)return result('REJECTED','INPUT_LIMIT');
 const horseNos=new Set(snapshot.horses.map(h=>h.horseNo)),ids=new Set();
 for(const e of evidence){
  if(!text(e?.evidenceId)||ids.has(e.evidenceId)||!sameScope(e,scope)||
   !horseNos.has(e.horseNo)||!text(e.independenceGroup)||!text(e.family)||
   !text(e.sourceRef)||!text(e.description)||!['POSITIVE','NEGATIVE','UNKNOWN'].includes(e.direction)||
   !['RESOLVED','SOURCE_MISSING','READ_FAILED','NOT_APPLICABLE'].includes(e.resolution)||
   !['ELIGIBLE','INELIGIBLE'].includes(e.eligibility)||!['NORMAL','STRONG'].includes(e.strength)||
   typeof e.conflict!=='boolean'||e.stage!=='EARLY'||!stamp(e.capturedAt)||
   Date.parse(e.capturedAt)>Date.parse(snapshot.frozenAt))
   return result('REJECTED','INVALID_EVIDENCE_RECEIPT');
  ids.add(e.evidenceId);
 }
 const reviews=new Map();
 for(const r of survivalReviews){
  if(!sameScope(r,scope)||!horseNos.has(r?.horseNo)||reviews.has(r.horseNo)||
   !stamp(r.reviewedAt)||Date.parse(r.reviewedAt)>Date.parse(snapshot.frozenAt)||
   !['CLEAR','VETO','UNKNOWN'].includes(r.decision)||!text(r.reason)||
   !Array.isArray(r.evidenceIds)||r.evidenceIds.length===0||new Set(r.evidenceIds).size!==r.evidenceIds.length||
   r.evidenceIds.some(id=>!evidence.some(e=>e.evidenceId===id&&e.horseNo===r.horseNo&&
    Date.parse(e.capturedAt)<=Date.parse(r.reviewedAt))))
   return result('REJECTED','INVALID_SURVIVAL_REVIEW');
  reviews.set(r.horseNo,r);
 }
 const rows=base.audit.rows.map(b=>{
  if(b.status==='NOT_APPLICABLE')return {...b,positiveGroupCount:0,negativeGroupCount:0};
  const h=snapshot.horses.find(h=>h.horseNo===b.horseNo),errors=b.status==='VIOLATION'?[...b.reasons]:[],
   unknown=b.status==='UNVERIFIED'?[...b.reasons]:[];
  const receipts=evidence.filter(e=>e.horseNo===h.horseNo),known=receipts.filter(e=>
   e.eligibility==='ELIGIBLE'&&e.resolution==='RESOLVED'&&!e.conflict&&e.direction!=='UNKNOWN');
  // Market popularity/gap and index-cluster agreement never become ability support.
  const ability=known.filter(e=>!['MARKET','INDEX_CLUSTER'].includes(e.family));
  const positives=new Set(ability.filter(e=>e.direction==='POSITIVE').map(e=>e.independenceGroup)),
   negatives=new Set(ability.filter(e=>e.direction==='NEGATIVE').map(e=>e.independenceGroup));
  if(receipts.length===0)unknown.push('HORSE_EVIDENCE_UNAVAILABLE');
  if(receipts.some(e=>e.conflict))unknown.push('EVIDENCE_CONFLICT_UNRESOLVED');
  if([...positives].some(group=>negatives.has(group)))unknown.push('GROUP_DIRECTION_CONFLICT');
  if(h.valueMark){
   const strong=new Set(ability.filter(e=>e.direction==='POSITIVE'&&e.strength==='STRONG').map(e=>e.independenceGroup));
   if(positives.size===0)unknown.push('INDEPENDENT_ABILITY_SUPPORT_UNPROVEN');
   if(h.valueMark==='💎💎💎'&&strong.size<2)unknown.push('MULTIPLE_STRONG_GROUPS_UNPROVEN');
  }
  if(h.warningMark){
   if(negatives.size<2)unknown.push('TWO_INDEPENDENT_NEGATIVE_GROUPS_UNPROVEN');
   const review=reviews.get(h.horseNo);
   if(!review||review.decision==='UNKNOWN')unknown.push('POPULAR_SURVIVAL_REVIEW_UNAVAILABLE');
   else if(review.decision==='VETO')errors.push('POPULAR_SURVIVAL_VETO');
   else if(review.evidenceIds.some(id=>!known.some(e=>e.evidenceId===id)))
    unknown.push('SURVIVAL_REVIEW_USES_UNRESOLVED_EVIDENCE');
  }
  return {horseNo:h.horseNo,status:errors.length?'VIOLATION':unknown.length?'UNVERIFIED':'STRUCTURAL_PASS',
   reasons:[...new Set([...errors,...unknown])],positiveGroupCount:positives.size,negativeGroupCount:negatives.size};
 });
 return result('READY',null,rows);
}
