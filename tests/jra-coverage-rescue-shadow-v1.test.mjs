import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewJraFinal5Exclusions,auditExclusionOutcome} from '../src/research/jra-coverage-rescue-shadow-v1.mjs';

function fixture(){
 const final5={2:'◎',12:'○',9:'▲',3:'△',6:'☆'};
 const names={2:'スタームーンナイト',3:'レピュニット',5:'ベアアッコチャン',6:'ゴディアンフィンチ',9:'ヘインズポイント',12:'ムテキシャチョウ',14:'ガラク',15:'シュペルリング'};
 const cpsis={2:69.7,3:40,5:58.7,6:57.3,9:63.6,12:59.2,14:64.8,15:null};
 const peak={2:89,3:76,5:96,6:85,9:92,12:88,14:86,15:null};
 const recent={2:88,3:71,5:96,6:85,9:73,12:76,14:88,15:86};
 const horses=Array.from({length:16},(_,i)=>{
  const horseNo=i+1,value=cpsis[horseNo]===undefined?30+i:cpsis[horseNo];
  return {horseNo,horseName:names[horseNo]??`その他${horseNo}`,mark:final5[horseNo]??null,
   cpsi:{value,coreUsableCount:value==null?1:3,neutralizedWeightPct:value==null?80:40,
    status:value==null?'INSUFFICIENT':'NUMERIC_SHADOW'},
   peak:peak[horseNo]===undefined?55+i:peak[horseNo],recent:recent[horseNo]===undefined?50+i:recent[horseNo],
   distance:horseNo===15?null:75,course:horseNo===15?null:75,
   recentSurfaces:horseNo===14||horseNo===15?['芝','芝','芝','ダ','ダ']:['ダ','ダ','ダ'],
   preEvidenceGroups:['PRE_INDEX'],marketPopularity:horseNo===5?3:horseNo===14?2:horseNo===15?4:10};
 });
 const input={organization:'JRA',raceId:'2026-10-18|東京|8',
  race:{raceDate:'2026-10-18',postAt:'2026-10-18T13:35:00+09:00',surface:'ダ',population:'JRA_STANDARD_FLAT',declaredRunners:16},
  snapshot:{snapshotId:'PRE-20261017-2040',freezeId:'UNVERIFIED',capturedAt:'2026-10-17T20:40:00+09:00',kind:'EARLY',isPreResult:true,sourceRef:'USER_PROVIDED_INDEX',freezeVerified:false},
  wave:{score:56,status:'PARTIAL_NUMERIC_SHADOW',coveragePct:66.7},horses};
 bind(input);return input;
}
function bind(f){
 f.context={cutoffAt:'2026-10-18T13:00:00+09:00',runId:'SYNTHETIC_RUN',inputFreezeId:'SYNTHETIC_INPUT_FREEZE',mode:'RETROSPECTIVE_REFERENCE'};
 const source={raceId:f.raceId,organization:'JRA',runId:f.context.runId,inputFreezeId:f.context.inputFreezeId,snapshotId:f.snapshot.snapshotId,
  capturedAt:f.snapshot.capturedAt,kind:'EARLY',sourceRef:'SYNTHETIC_PRE_RECEIPT'};
 Object.assign(f.snapshot,Object.fromEntries(['raceId','organization','runId','inputFreezeId'].map(k=>[k,source[k]])));
 f.market={...source};f.wave.source={...source};f.horses.forEach(h=>{h.source={...source,horseNo:h.horseNo};});
 return f;
}
const review = () => reviewJraFinal5Exclusions(fixture());

test('PRE Tokyo 8R independently flags three distinct exclusion mechanisms without marks changes',()=>{
 const input=fixture(),copy=structuredClone(input),r=reviewJraFinal5Exclusions(input);
 assert.equal(r.status,'SHADOW_REVIEW');
 assert.deepEqual(r.marketSanityReview.excludedMarketTop4,[5,14,15]);
 assert.equal(r.marketSanityReview.needsIndependentExplanation,true);
 assert.deepEqual(input,copy);
 assert.deepEqual(r.final5.map(x=>x.horseNo).sort((a,b)=>a-b),[2,3,6,9,12]);
 const byNo=new Map(r.reviewQueue.map(x=>[x.horseNo,x]));
 assert.ok(byNo.has(5),'recent+peak leader missing');
 assert.ok(byNo.get(5).flags.includes('PEAK_FIELD_TOP_QUARTER'));
 assert.ok(byNo.get(5).flags.includes('RECENT_FIELD_TOP_QUARTER'));
 assert.ok(byNo.has(14),'CPSI leader excluded');
 assert.ok(byNo.get(14).flags.includes('CPSI_FIELD_TOP3_EXCLUDED'));
 assert.ok(byNo.get(14).flags.includes('SURFACE_SWITCH_REVIEW'));
 assert.ok(byNo.has(15),'unscored but recent+surface evidence excluded');
 assert.ok(byNo.get(15).flags.includes('CPSI_CORE_INSUFFICIENT'));
 assert.ok(byNo.get(15).flags.includes('SURFACE_SWITCH_REVIEW'));
 assert.equal(r.formalKpiEligible,false);
 assert.equal(r.originalEarlyMutation,false);
 assert.equal(r.productionActivation,'NO-GO');
 assert.ok(r.rows.every(x=>x.decision==='PRESERVE_FINAL5_NO_AUTOPROMOTION'));
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.reviewQueue[0]));
});

test('POST audit is strictly separate and identifies misses, never retroactively improves KPI',()=>{
 const pre=review();const post=auditExclusionOutcome(pre,{raceId:pre.raceId,organization:'JRA',snapshotId:pre.snapshotId,inputFreezeId:pre.inputFreezeId,sourceRef:'SYNTHETIC_RESULT',acquiredAt:'2026-10-18T14:15:00+09:00',postAt:'2026-10-18T13:35:00+09:00',top3:[5,14,15]});
 assert.equal(post.status,'POST_AUDIT_ONLY');
 assert.equal(post.top3InsideFinal5,0);
 assert.equal(post.anchorWin,false);assert.equal(post.anchorTop3,false);assert.equal(post.completeTop3Capture,false);
 assert.deepEqual(post.missingTop3,[5,14,15]);
 assert.deepEqual(post.missingTop3FlaggedForReview,[5,14,15]);
 assert.equal(post.notAProspectiveImprovementEstimate,true);
 assert.equal(post.formalKpiEligible,false);
});

test('review queue does not use popularity or outcome, and does not create predictions or tickets',()=>{
 const f=fixture();const first=reviewJraFinal5Exclusions(f);
 f.horses.forEach(h=>h.marketPopularity=16);
 const next=reviewJraFinal5Exclusions(f);
 assert.deepEqual(first.reviewQueue,next.reviewQueue);
 assert.equal(next.marketSanityReview.needsIndependentExplanation,false);
 assert.equal(own(first,'bets'),false);
 assert.equal(own(first,'suggestedMark'),false);
});
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

test('multiple fail-closed guards prevent PRE/POST mixing, wrong source, fake CPSI and mixed populations',()=>{
 const cases=[
  f=>f.result={winnerNo:5},
  f=>f.horses[0].result=1,
  f=>f.horses[0].cpsi.result=1,
  f=>f.horses[0].cpsi.value=101,
  f=>f.horses[0].cpsi.coreUsableCount=1,
  f=>f.snapshot.kind='FINAL',
  f=>f.snapshot.capturedAt='2026-10-18T13:35:01+09:00',
  f=>f.race.population='JUMP',
  f=>f.race.surface='芝', // still valid and can be assessed; test separately
  f=>f.organization='NAR',
  f=>f.race.declaredRunners=15,
  f=>f.horses[5].horseNo=f.horses[0].horseNo,
  f=>f.horses[5].mark='◎',
  f=>f.horses[0].preEvidenceGroups=['A',{result:true}],
 ];
 for(const mutate of cases){
  const f=fixture();mutate(f);
  const r=reviewJraFinal5Exclusions(f);
  if(f.race.surface==='芝')assert.equal(r.status,'SHADOW_REVIEW');
  else assert.equal(r.status,'HOLD',JSON.stringify(f.race));
 }
});

test('missing or fake result data cannot enter the post verifier',()=>{
 const pre=review();
 for(const result of [
  {raceId:pre.raceId,top3:[5,14,15],acquiredAt:'2026-10-18T13:00:00+09:00',postAt:'2026-10-18T13:35:00+09:00'},
  {raceId:pre.raceId,top3:[5,5,15],acquiredAt:'2026-10-18T14:00:00+09:00',postAt:'2026-10-18T13:35:00+09:00'},
  {raceId:'OTHER',top3:[5,14,15],acquiredAt:'2026-10-18T14:00:00+09:00',postAt:'2026-10-18T13:35:00+09:00'},
  {raceId:pre.raceId,top3:[5,14,15],actualWinProb:0.9,acquiredAt:'2026-10-18T14:00:00+09:00',postAt:'2026-10-18T13:35:00+09:00'},
 ])assert.equal(auditExclusionOutcome(pre,result).status,'HOLD');
});


test('strong 12R Final5 is preserved and cannot be altered by the exclusion gate',()=>{
 const f=fixture();f.raceId='2026-10-18|東京|12';
 f.race.postAt='2026-10-18T16:10:00+09:00';f.race.surface='芝';
 const wanted={14:'◎',13:'○',7:'▲',10:'△',15:'☆'};
 f.horses.forEach(h=>{
  h.mark=wanted[h.horseNo]??null;
  if(h.horseNo===14)h.cpsi={value:69.2,coreUsableCount:3,neutralizedWeightPct:40,status:'NUMERIC_SHADOW'};
  if(h.horseNo===15)h.cpsi={value:66.8,coreUsableCount:3,neutralizedWeightPct:40,status:'NUMERIC_SHADOW'};
  if(h.horseNo===10)h.cpsi={value:65.1,coreUsableCount:3,neutralizedWeightPct:40,status:'NUMERIC_SHADOW'};
 });
 bind(f);const out=reviewJraFinal5Exclusions(f);
 assert.equal(out.status,'SHADOW_REVIEW');
 assert.deepEqual(out.final5.map(x=>x.horseNo).sort((a,b)=>a-b),[7,10,13,14,15]);
 assert.equal(out.rows.find(h=>h.horseNo===15).reviewRequired,false);
 assert.equal(out.rows.find(h=>h.horseNo===14).reviewRequired,false);
 assert.equal(out.originalEarlyMutation,false);
});
