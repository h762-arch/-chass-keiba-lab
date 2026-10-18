import {MARKS,text,integer,score,nullableScore,schema,copyInput,timestamp,jstDate,raceParts,seal,authority,sourceValid,percentage} from './jra-shadow-contract-v1.mjs';
export const JRA_COVERAGE_RESCUE_SHADOW_VERSION='JRA_COVERAGE_RESCUE_SHADOW_V1_1';
const issued=new WeakMap();
const failure=reason=>seal({version:JRA_COVERAGE_RESCUE_SHADOW_VERSION,status:'HOLD',reason,rows:[],reviewQueue:[],...authority()});
const groups=new Map([['PRE_INDEX','ABILITY'],['RECENT_RUNS','ABILITY'],['DISTANCE_RUNS','CONDITION'],['COURSE_RUNS','CONDITION'],['PACE','RACE_SHAPE'],['TACTICAL','RACE_SHAPE']]);
function ranks(horses,key){
 const observed=horses.filter(h=>typeof h[key]==='number');
 return {map:new Map(observed.map(h=>[h.horseNo,1+observed.filter(x=>x[key]>h[key]).length])),count:observed.length};
}
const top=(rank,count)=>rank!==null&&count>0&&rank<=Math.ceil(count/4);

export function reviewJraFinal5Exclusions(supplied,options={}){
 try{return review(copyInput(supplied),options);}catch{return failure('UNSAFE_OR_INVALID_INPUT');}
}
function review(x,options){
 const now=options.now??Date.now(),testClock=options.now!==undefined;
 if(!Number.isSafeInteger(now)||!Number.isFinite(new Date(now).getTime()))return failure('OBSERVATION_CLOCK_INVALID');
 if(!schema(x,['organization','raceId','race','snapshot','horses','wave','context','market']))return failure('INPUT_OR_POST_FIELD_FORBIDDEN');
 const {organization,raceId,race,snapshot,horses,wave,context,market}=x,parts=raceParts(raceId);
 if(organization!=='JRA'||!parts)return failure('RACE_IDENTITY_INVALID');
 if(!schema(race,['raceDate','postAt','surface','population','declaredRunners'])||race.raceDate!==parts.date
  ||!['芝','ダ'].includes(race.surface)||race.population!=='JRA_STANDARD_FLAT')return failure('POPULATION_OR_RACE_INVALID');
 if(!schema(context,['cutoffAt','runId','inputFreezeId','mode'])||!text(context.runId)||!text(context.inputFreezeId)
  ||!['PROSPECTIVE','RETROSPECTIVE_REFERENCE'].includes(context.mode))return failure('AUDIT_CONTEXT_REQUIRED');
 const cutoff=timestamp(context.cutoffAt),post=timestamp(race.postAt);
 if(!Number.isFinite(post)||!Number.isFinite(cutoff)||cutoff>=post||jstDate(post)!==parts.date)return failure('PRESTART_TIME_OR_RACE_MISMATCH');
 if(context.mode==='PROSPECTIVE'&&(now>cutoff||jstDate(now)!==parts.date))return failure('PROSPECTIVE_WINDOW_CLOSED');
 if(!schema(snapshot,['snapshotId','freezeId','capturedAt','kind','isPreResult','sourceRef','freezeVerified','raceId','organization','runId','inputFreezeId'])
  ||!text(snapshot.snapshotId)||!text(snapshot.freezeId)||snapshot.isPreResult!==true||typeof snapshot.freezeVerified!=='boolean')return failure('PRE_SOURCE_REQUIRED');
 const binding={raceId,organization,runId:context.runId,inputFreezeId:context.inputFreezeId,snapshotId:snapshot.snapshotId};
 // Project only the provenance contract, not the freeze claim.
 const snapSource=Object.fromEntries(['raceId','organization','runId','inputFreezeId','snapshotId','capturedAt','kind','sourceRef'].map(k=>[k,snapshot[k]]));
 if(!sourceValid(snapSource,binding,cutoff,now))return failure('SNAPSHOT_IDENTITY_OR_TIME_CONFLICT');
 const sourceCeiling=timestamp(snapshot.capturedAt);
 if(wave!=null&&(!schema(wave,['score','status','coveragePct','source'])||!nullableScore(wave.score)
  ||!nullableScore(wave.coveragePct)||!['HOLD','PARTIAL_NUMERIC_SHADOW','NUMERIC_SHADOW'].includes(wave.status)
  ||(wave.status==='HOLD')!==(wave.score===null)||!sourceValid(wave.source,binding,sourceCeiling,now)))return failure('WAVE_SOURCE_INVALID');
 if(!Array.isArray(horses)||!integer(horses.length,5,18)||race.declaredRunners!==horses.length)return failure('HORSE_COUNT_OR_ROSTER_INVALID');
 const seen=new Set(),marks=new Set(),all=[];
 for(const h of horses){
  if(!schema(h,['horseNo','horseName','mark','cpsi','peak','recent','distance','course','recentSurfaces','preEvidenceGroups','marketPopularity','source']))return failure('HORSE_SCHEMA_OR_POST_FIELD_FORBIDDEN');
  if(!integer(h.horseNo,1,18)||seen.has(h.horseNo)||!text(h.horseName,100))return failure('HORSE_IDENTITY_INVALID');
  if(!sourceValid(h.source,binding,sourceCeiling,now,{horseNo:h.horseNo}))return failure('HORSE_SOURCE_IDENTITY_OR_TIME_CONFLICT');
  seen.add(h.horseNo);
  if(h.mark!==null){if(!MARKS.includes(h.mark)||marks.has(h.mark))return failure('FINAL5_DUPLICATE_OR_INVALID_MARK');marks.add(h.mark);}
  if(!schema(h.cpsi,['value','coreUsableCount','neutralizedWeightPct','status'])||!nullableScore(h.cpsi.value)
   ||!(h.cpsi.coreUsableCount===null||integer(h.cpsi.coreUsableCount,0,7))||!nullableScore(h.cpsi.neutralizedWeightPct)
   ||!['NUMERIC_SHADOW','INSUFFICIENT','HOLD'].includes(h.cpsi.status))return failure('CPSI_SCHEMA_INVALID');
  if((h.cpsi.status==='NUMERIC_SHADOW')!==(h.cpsi.value!==null)
   ||(h.cpsi.value!==null&&(!integer(h.cpsi.coreUsableCount,2,7)||!score(h.cpsi.neutralizedWeightPct))))return failure('CPSI_READINESS_MISMATCH');
  if(![h.peak,h.recent,h.distance,h.course].every(v=>nullableScore(v,200))
   ||!Array.isArray(h.recentSurfaces)||h.recentSurfaces.length>5||h.recentSurfaces.some(s=>!['芝','ダ','UNKNOWN'].includes(s))
   ||!Array.isArray(h.preEvidenceGroups)||h.preEvidenceGroups.length>8||h.preEvidenceGroups.some(g=>!groups.has(g))
   ||!(h.marketPopularity===null||integer(h.marketPopularity,1,horses.length)))return failure('PRE_FEATURE_INVALID');
  all.push({...h,cpsiScore:h.cpsi.value});
 }
 if(marks.size!==5)return failure('FROZEN_FINAL5_UNVERIFIED');
 const hasMarket=all.some(h=>h.marketPopularity!==null);
 if(market!=null&&!sourceValid(market,binding,sourceCeiling,now))return failure('MARKET_SOURCE_IDENTITY_OR_TIME_CONFLICT');
 if(hasMarket&&market==null)return failure('EARLY_MARKET_RECEIPT_REQUIRED');
 const cr=ranks(all,'cpsiScore'),pr=ranks(all,'peak'),rr=ranks(all,'recent'),dr=ranks(all,'distance'),tr=ranks(all,'course');
 const rows=all.map(h=>{
  const inFinal5=h.mark!==null,cRank=cr.map.get(h.horseNo)??null,pRank=pr.map.get(h.horseNo)??null,rRank=rr.map.get(h.horseNo)??null;
  const dRank=dr.map.get(h.horseNo)??null,tRank=tr.map.get(h.horseNo)??null,flags=[];
  if(!inFinal5){
   if(h.cpsi.value!==null&&h.cpsi.neutralizedWeightPct>=50)flags.push('CPSI_RANK_BASIS_LIMITED');
   if(cRank!==null&&cRank<=3)flags.push('CPSI_FIELD_TOP3_EXCLUDED');
   if(top(pRank,pr.count))flags.push('PEAK_FIELD_TOP_QUARTER');
   if(top(rRank,rr.count))flags.push('RECENT_FIELD_TOP_QUARTER');
   if(h.cpsi.value===null)flags.push('CPSI_CORE_INSUFFICIENT');
   if(h.recentSurfaces.length>=3&&h.recentSurfaces.slice(0,3).every(s=>s!==race.surface&&s!=='UNKNOWN'))flags.push('SURFACE_SWITCH_REVIEW');
   if(h.distance===null&&h.course===null)flags.push('NEEDS_DISTANCE_COURSE_EVIDENCE');
   if(top(rRank,rr.count)&&((dRank!==null&&dRank>Math.ceil(dr.count/2))||(tRank!==null&&tRank>Math.ceil(tr.count/2))))flags.push('RECENT_CONDITION_RANK_CONFLICT');
   if((pr.count<horses.length/2||rr.count<horses.length/2)&&(top(pRank,pr.count)||top(rRank,rr.count)))flags.push('ABILITY_RANK_BASIS_LIMITED');
  }
  // Peak and recent scores are correlated: use max, never count them as two independent families.
  const priority=(flags.includes('CPSI_FIELD_TOP3_EXCLUDED')?3:0)
   +Math.max(flags.includes('RECENT_FIELD_TOP_QUARTER')?2:0,flags.includes('PEAK_FIELD_TOP_QUARTER')?1:0)
   +(flags.includes('RECENT_CONDITION_RANK_CONFLICT')?1:0);
  const urgent=flags.includes('CPSI_FIELD_TOP3_EXCLUDED')
   ||(flags.includes('RECENT_FIELD_TOP_QUARTER')&&flags.includes('PEAK_FIELD_TOP_QUARTER'))
   ||flags.includes('RECENT_CONDITION_RANK_CONFLICT')
   ||(flags.includes('CPSI_CORE_INSUFFICIENT')&&(flags.includes('RECENT_FIELD_TOP_QUARTER')||flags.includes('SURFACE_SWITCH_REVIEW')));
  return {horseNo:h.horseNo,horseName:h.horseName,originalMark:h.mark,cpsiValue:h.cpsi.value,cpsiRank:cRank,
   cpsiCoreUsableCount:h.cpsi.coreUsableCount,cpsiNeutralizedWeightPct:h.cpsi.neutralizedWeightPct,fieldPeakRank:pRank,fieldRecentRank:rRank,
   flags,reviewPriority:priority,reviewRequired:!inFinal5&&urgent,
   unknownReviewRequired:!inFinal5&&(h.cpsi.value===null||(h.distance===null&&h.course===null)),
   evidenceFamilyCount:new Set(h.preEvidenceGroups.map(g=>groups.get(g))).size,
   decision:'PRESERVE_FINAL5_NO_AUTOPROMOTION',preEvidenceGroups:[...new Set(h.preEvidenceGroups)],sourceAuthenticity:'CALLER_SUPPLIED_UNVERIFIED'};
 });
 const queue=rows.filter(r=>r.reviewRequired).sort((a,b)=>b.reviewPriority-a.reviewPriority||a.horseNo-b.horseNo);
 const excludedMarketTop4=all.filter(h=>h.mark===null&&h.marketPopularity!==null&&h.marketPopularity<=4).map(h=>h.horseNo).sort((a,b)=>a-b);
 const output=seal({version:JRA_COVERAGE_RESCUE_SHADOW_VERSION,status:'SHADOW_REVIEW',raceId,snapshotId:snapshot.snapshotId,
  inputFreezeId:context.inputFreezeId,runId:context.runId,pinnedPostAt:race.postAt,cutoffAt:context.cutoffAt,
  auditObservedAt:new Date(now).toISOString(),clockAuthority:testClock?'CALLER_INJECTED_TEST_CLOCK':'LOCAL_PROCESS_CLOCK',
  researchBasis:context.mode,prospectiveEligible:context.mode==='PROSPECTIVE'&&!testClock,
  snapshotClaimedFreezeVerified:snapshot.freezeVerified,sourceAuthenticity:'NOT_INDEPENDENTLY_VERIFIED',
  wave:{score:wave?.score??null,status:wave?.status??'HOLD',coveragePct:wave?.coveragePct??null},
  rankCoverage:{cpsiPct:percentage(cr.count,horses.length),peakPct:percentage(pr.count,horses.length),recentPct:percentage(rr.count,horses.length)},
  marketSanityReview:{status:hasMarket?'EARLY_MARKET_REVIEW':'MARKET_UNAVAILABLE',excludedMarketTop4,needsIndependentExplanation:excludedMarketTop4.length>=2,meaning:'MARKET_ONLY_NOT_ABILITY_EVIDENCE_NO_AUTOPROMOTION'},
  final5:rows.filter(r=>r.originalMark!==null).map(r=>({horseNo:r.horseNo,mark:r.originalMark})),rows,
  reviewQueue:queue.map(r=>({horseNo:r.horseNo,horseName:r.horseName,flags:[...r.flags],priority:r.reviewPriority})),
  unknownReviewQueue:rows.filter(r=>r.unknownReviewRequired).map(r=>({horseNo:r.horseNo,flags:[...r.flags]})),
  ...authority()});
 issued.set(output,{raceId,snapshotId:snapshot.snapshotId,inputFreezeId:context.inputFreezeId,post,mode:context.mode});
 return output;
}

export function auditExclusionOutcome(preAudit,supplied,options={}){
 try{
  const pinned=issued.get(preAudit),r=copyInput(supplied),now=options.now??Date.now();
  if(!pinned)return failure('PRE_AUDIT_INSTANCE_REQUIRED');
  if(!schema(r,['raceId','organization','snapshotId','inputFreezeId','sourceRef','acquiredAt','postAt','top3'])
   ||r.raceId!==pinned.raceId||r.organization!=='JRA'||r.snapshotId!==pinned.snapshotId||r.inputFreezeId!==pinned.inputFreezeId
   ||!text(r.sourceRef,512)||timestamp(r.postAt)!==pinned.post||!Number.isFinite(timestamp(r.acquiredAt))
   ||timestamp(r.acquiredAt)<=pinned.post||timestamp(r.acquiredAt)>now)return failure('POST_RESULT_SOURCE_INVALID');
  if(!Array.isArray(r.top3)||r.top3.length!==3||new Set(r.top3).size!==3||r.top3.some(n=>!integer(n,1,18)||!preAudit.rows.some(h=>h.horseNo===n)))return failure('POST_ROSTER_INVALID');
  const selected=new Set(preAudit.final5.map(h=>h.horseNo)),reviewed=new Set(preAudit.reviewQueue.map(h=>h.horseNo));
  const anchorNo=preAudit.final5.find(h=>h.mark==='◎').horseNo;
  return seal({version:JRA_COVERAGE_RESCUE_SHADOW_VERSION,status:'POST_AUDIT_ONLY',raceId:r.raceId,researchBasis:pinned.mode,top3:[...r.top3],
   anchorNo,anchorWin:anchorNo===r.top3[0],anchorTop3:r.top3.includes(anchorNo),winnerInsideFinal5:selected.has(r.top3[0]),
   completeTop3Capture:r.top3.every(n=>selected.has(n)),top3InsideFinal5:r.top3.filter(n=>selected.has(n)).length,
   missingTop3:r.top3.filter(n=>!selected.has(n)),missingTop3FlaggedForReview:r.top3.filter(n=>!selected.has(n)&&reviewed.has(n)),
   queueSize:preAudit.reviewQueue.length,notAProspectiveImprovementEstimate:true,...authority()});
 }catch{return failure('UNSAFE_OR_INVALID_POST_INPUT');}
}
