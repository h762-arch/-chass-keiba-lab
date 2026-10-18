import {MARKS,text,integer,score,schema,copyInput,timestamp,jstDate,raceParts,seal,authority,sourceValid,percentage,safeSum} from './jra-shadow-contract-v1.mjs';
export const JRA_POST_ROBUSTNESS_VERSION='JRA_POST_ROBUSTNESS_SHADOW_V1_1';
const rejected=reason=>seal({version:JRA_POST_ROBUSTNESS_VERSION,status:'HOLD',reason,productionMutation:false,...authority()});
function moneyStats(rows){
 const paid=rows.filter(r=>r.ticket!==null);
 const stake=safeSum(paid.map(r=>r.ticket.stakeYen)),payout=safeSum(paid.map(r=>r.ticket.payoutYen));
 const ranked=[...paid].sort((a,b)=>b.ticket.payoutYen-a.ticket.payoutYen||a.raceId.localeCompare(b.raceId));
 const leave=k=>{
  const removed=Math.min(k,ranked.length),rest=ranked.slice(removed),investmentYen=safeSum(rest.map(r=>r.ticket.stakeYen)),payoutYen=safeSum(rest.map(r=>r.ticket.payoutYen));
  return {requestedRemoval:k,removed,raceIds:ranked.slice(0,removed).map(r=>r.raceId),remainingRaces:rest.length,
   investmentYen,payoutYen,netYen:payoutYen-investmentYen,roiPct:percentage(payoutYen,investmentYen)};
 };
 let balance=0,peak=0,maxDrawdown=0;
 for(const row of paid){balance+=row.ticket.payoutYen-row.ticket.stakeYen;peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak-balance);}
 const amounts=paid.map(r=>r.ticket.payoutYen).sort((a,b)=>a-b),mid=Math.floor(amounts.length/2);
 const median=amounts.length?(amounts.length%2?amounts[mid]:amounts[mid-1]/2+amounts[mid]/2):null;
 const days=[...new Set(paid.map(r=>r.raceDate))].sort();
 const daily=days.map(date=>{const rs=paid.filter(r=>r.raceDate===date),s=safeSum(rs.map(r=>r.ticket.stakeYen)),p=safeSum(rs.map(r=>r.ticket.payoutYen));return {date,races:rs.length,investmentYen:s,payoutYen:p,netYen:p-s,roiPct:percentage(p,s)};});
 return {status:paid.length?'SUPPLIED_AMOUNTS_UNAUTHENTICATED':'NO_TICKET_DATA',racesWithSuppliedAmounts:paid.length,
  racesWithVerifiedAmounts:0,missingTicketRaces:rows.length-paid.length,investmentYen:stake,payoutYen:payout,netYen:payout-stake,
  roiPct:percentage(payout,stake),medianPayoutYen:median,maxDrawdownYen:maxDrawdown,independentDayCount:days.length,
  topOneSharePct:percentage(ranked[0]?.ticket.payoutYen??0,payout),topTwoSharePct:percentage(safeSum(ranked.slice(0,2).map(r=>r.ticket.payoutYen)),payout),
  leaveTopOne:leave(1),leaveTopTwo:leave(2),daily,
  leaveOneDayOut:days.length<2?[]:days.map(date=>{const rest=paid.filter(r=>r.raceDate!==date),s=safeSum(rest.map(r=>r.ticket.stakeYen)),p=safeSum(rest.map(r=>r.ticket.payoutYen));return {removedDate:date,remainingRaces:rest.length,roiPct:percentage(p,s)};})};
}

export function auditJraPostRobustness(supplied,options={}){
 try{return audit(copyInput(supplied),options);}catch{return rejected('UNSAFE_INPUT_OR_AGGREGATE_RANGE_INVALID');}
}
function audit(input,options){
 const now=options.now??Date.now();
 if(!Number.isSafeInteger(now)||!Number.isFinite(new Date(now).getTime()))return rejected('OBSERVATION_CLOCK_INVALID');
 if(!schema(input,['predictionLayer','races','cohort'])||!['ORIGINAL_EARLY','PUBLISHED_NOTE'].includes(input.predictionLayer)
  ||!Array.isArray(input.races)||!integer(input.races.length,1,3000))return rejected('COHORT_SCHEMA_INVALID');
 const c=input.cohort;
 if(!schema(c,['cohortId','declaredRaceIds','selectionRule','registeredAt','evaluationMode'])
  ||!text(c.cohortId)||!text(c.selectionRule,512)||!Array.isArray(c.declaredRaceIds)||c.declaredRaceIds.length!==input.races.length
  ||new Set(c.declaredRaceIds).size!==c.declaredRaceIds.length||c.declaredRaceIds.some(id=>!raceParts(id))
  ||!Number.isFinite(timestamp(c.registeredAt))||timestamp(c.registeredAt)>now
  ||!['RETROSPECTIVE_REFERENCE','PROSPECTIVE_HOLDOUT'].includes(c.evaluationMode))return rejected('COHORT_MANIFEST_REQUIRED');
 const seen=new Set(),rows=[];
 for(const r of input.races){
  if(!schema(r,['raceId','organization','snapshotId','inputFreezeId','runId','roster','signalSource','resultSource','preCapturedAt','postAt','resultCapturedAt','freezeVerified','marks','top3','cpsiRankOneNo','wave','ticket'])
   ||!raceParts(r.raceId)||seen.has(r.raceId)||!c.declaredRaceIds.includes(r.raceId)||r.organization!=='JRA'
   ||![r.snapshotId,r.inputFreezeId,r.runId].every(v=>text(v)))return rejected('RACE_ID_INVALID');
  seen.add(r.raceId);const parts=raceParts(r.raceId),pre=timestamp(r.preCapturedAt),post=timestamp(r.postAt),result=timestamp(r.resultCapturedAt);
  if(!Number.isFinite(pre)||!Number.isFinite(post)||!Number.isFinite(result)||pre>=post||result<=post||result>now
   ||jstDate(post)!==parts.date||typeof r.freezeVerified!=='boolean')return rejected('PRE_POST_TEMPORAL_OR_FREEZE_INVALID');
  if(c.evaluationMode==='PROSPECTIVE_HOLDOUT'&&timestamp(c.registeredAt)>pre)return rejected('COHORT_NOT_PREREGISTERED');
  if(!Array.isArray(r.roster)||!integer(r.roster.length,5,18)||new Set(r.roster).size!==r.roster.length||r.roster.some(n=>!integer(n,1,18)))return rejected('ROSTER_INVALID');
  const binding={raceId:r.raceId,organization:'JRA',snapshotId:r.snapshotId,inputFreezeId:r.inputFreezeId,runId:r.runId};
  if(!sourceValid(r.signalSource,binding,pre,now))return rejected('SIGNAL_SOURCE_INVALID');
  if(!schema(r.resultSource,['raceId','organization','capturedAt','sourceRef'])||r.resultSource.raceId!==r.raceId||r.resultSource.organization!=='JRA'
   ||timestamp(r.resultSource.capturedAt)!==result||!text(r.resultSource.sourceRef,512))return rejected('RESULT_SOURCE_INVALID');
  if(!Array.isArray(r.marks)||r.marks.length!==5||r.marks.some(h=>!schema(h,['horseNo','mark'])||!r.roster.includes(h.horseNo)||!MARKS.includes(h.mark))
   ||new Set(r.marks.map(h=>h.mark)).size!==5||new Set(r.marks.map(h=>h.horseNo)).size!==5)return rejected('FINAL5_INVALID');
  if(!Array.isArray(r.top3)||r.top3.length!==3||new Set(r.top3).size!==3||r.top3.some(n=>!r.roster.includes(n)))return rejected('RESULT_TOP3_INVALID');
  if(!(r.cpsiRankOneNo===null||r.roster.includes(r.cpsiRankOneNo))||!(r.wave===null||score(r.wave)))return rejected('CPSI_WAVE_INVALID');
  let ticket=null;
  if(r.ticket!==null){
   const t=r.ticket;
   if(!schema(t,['stakeYen','payoutYen','basis','sourceRef','raceId','snapshotId','predictionLayer','preCommittedAt','settledAt'])
    ||!integer(t.stakeYen,1,Number.MAX_SAFE_INTEGER)||!integer(t.payoutYen,0,Number.MAX_SAFE_INTEGER)
    ||!['ACTUAL_SETTLED','REFERENCE_SIMULATION'].includes(t.basis)||!text(t.sourceRef,512)
    ||t.raceId!==r.raceId||t.snapshotId!==r.snapshotId||t.predictionLayer!==input.predictionLayer
    ||!Number.isFinite(timestamp(t.preCommittedAt))||timestamp(t.preCommittedAt)<pre||timestamp(t.preCommittedAt)>=post
    ||!Number.isFinite(timestamp(t.settledAt))||timestamp(t.settledAt)<result||timestamp(t.settledAt)>now)return rejected('TICKET_AMOUNT_OR_PROVENANCE_INVALID');
   ticket={stakeYen:t.stakeYen,payoutYen:t.payoutYen,basis:t.basis};
  }
  const finalists=new Set(r.marks.map(h=>h.horseNo)),anchor=r.marks.find(h=>h.mark==='◎').horseNo;
  const hits=r.top3.filter(n=>finalists.has(n)).length,winHit=finalists.has(r.top3[0]);
  rows.push({raceId:r.raceId,raceDate:parts.date,postAt:r.postAt,anchorWin:anchor===r.top3[0],anchorTop3:r.top3.includes(anchor),
   winnerCaptured:winHit,top3Captured:hits,completeTop3:hits===3,
   missType:hits===0?'TOTAL_TOP3_MISS':!winHit?'WINNER_MISSED_WITH_PLACE_COVERAGE':hits===3?'FULL_TOP3_COVERAGE':'PARTIAL_TOP3_COVERAGE',
   missedHorses:r.top3.filter(n=>!finalists.has(n)),cpsiOneTop3:r.cpsiRankOneNo===null?null:r.top3.includes(r.cpsiRankOneNo),
   cpsiOneWin:r.cpsiRankOneNo===null?null:r.top3[0]===r.cpsiRankOneNo,wave:r.wave,freezeVerified:r.freezeVerified,ticket});
 }
 rows.sort((a,b)=>timestamp(a.postAt)-timestamp(b.postAt)||a.raceId.localeCompare(b.raceId));
 const paid=rows.filter(r=>r.ticket!==null),bases=[...new Set(paid.map(r=>r.ticket.basis))].sort();
 // Reject unsafe total cohort amounts even when segregating simulation/actual groups.
 safeSum(paid.map(r=>r.ticket.stakeYen));safeSum(paid.map(r=>r.ticket.payoutYen));
 const byBasis=Object.fromEntries(bases.map(basis=>[basis,moneyStats(rows.filter(r=>r.ticket?.basis===basis))]));
 const ticketStress=bases.length<=1?{...moneyStats(rows),basis:bases[0]??null,byBasis}
  :{status:'SEGREGATED_BASES_NO_COMBINED_ROI',roiPct:null,investmentYen:null,payoutYen:null,netYen:null,racesWithVerifiedAmounts:0,racesWithSuppliedAmounts:paid.length,missingTicketRaces:rows.length-paid.length,byBasis};
 const count=rows.length,one=rows.filter(r=>r.cpsiOneWin!==null),wins=rows.filter(r=>r.anchorWin).length,top3=rows.filter(r=>r.anchorTop3).length,captured=rows.filter(r=>r.winnerCaptured).length;
 return seal({version:JRA_POST_ROBUSTNESS_VERSION,status:'POST_RESEARCH_ONLY',predictionLayer:input.predictionLayer,
  researchBasis:c.evaluationMode,cohortId:c.cohortId,cohortCompleteness:'CALLER_DECLARED_MATCH_ONLY',raceCount:count,
  preregistrationAuthenticity:'CALLER_CLAIMED_UNAUTHENTICATED',clockAuthority:options.now===undefined?'LOCAL_PROCESS_CLOCK':'CALLER_INJECTED_TEST_CLOCK',
  scopeStatus:input.predictionLayer==='ORIGINAL_EARLY'&&rows.every(r=>r.freezeVerified)?'CALLER_CLAIMED_FREEZE_UNAUTHENTICATED':'REFERENCE_NOT_FORMAL_ORIGINAL_EARLY',
  summary:{anchorWins:wins,anchorTop3:top3,anchorTop3NotWin:top3-wins,anchorWinRatePct:percentage(wins,count),anchorTop3RatePct:percentage(top3,count),
   capturedWinners:captured,capturedWinnerRatePct:percentage(captured,count),top3SeatsCovered:rows.reduce((s,r)=>s+r.top3Captured,0),
   completeTop3Races:rows.filter(r=>r.completeTop3).length,totalTop3MissRaces:rows.filter(r=>r.missType==='TOTAL_TOP3_MISS').length,
   cpsiOneEligible:one.length,cpsiOneWins:one.filter(r=>r.cpsiOneWin).length,cpsiOneTop3:one.filter(r=>r.cpsiOneTop3).length},
  waveOutcomeGroups:['LOW','MID','HIGH','UNKNOWN'].map(band=>{const rs=rows.filter(r=>(r.wave===null?'UNKNOWN':r.wave<40?'LOW':r.wave<60?'MID':'HIGH')===band);return {band,races:rs.length,winnersCaptured:rs.filter(r=>r.winnerCaptured).length,bandPolicy:'DIAGNOSTIC_FIXED_NOT_PAYOUT_OR_EV_PREDICTION'};}),
  ticketStress,rows,estimatedFutureProfitability:false,productionMutation:false,...authority()});
}
