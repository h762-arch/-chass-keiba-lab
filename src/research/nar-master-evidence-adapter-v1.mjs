// Offline, read-only normalization. No implicit name aliases or starter status.
const text=v=>typeof v==='string'?v.trim():'';
const numeric=v=>(typeof v==='number'||typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v.trim()))&&Number.isFinite(Number(v))?Number(v):null;
const integer=v=>Number.isInteger(numeric(v))&&numeric(v)>0;
const table=items=>{const keys=[...new Set(items.flatMap(Object.keys))];return [keys,...items.map(o=>keys.map(k=>o[k]??null))];};
function records(values,required,startRow=2){
 if(!Array.isArray(values)||!Array.isArray(values[0])||new Set(values[0]).size!==values[0].length||required.some(k=>!values[0].includes(k)))throw TypeError('MASTER_HEADER_INVALID');
 return values.slice(1).map((row,i)=>({row:startRow+i,data:Object.fromEntries(values[0].map((k,j)=>[k,row[j]??null]))}));
}
function date(v){
 if(typeof v==='number'&&Number.isInteger(v)&&v>0)return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);
 return /^\d{4}-\d{2}-\d{2}$/.test(text(v))&&Number.isFinite(Date.parse(v))?v:null;
}
export function adaptNarMasterEvidence({sourceRaceId,canonicalRaceId,indexTable,historyTable,indexStartRow=2,historyStartRow=2,associations=[],statuses=[]}={}){
 if(!text(sourceRaceId)||!text(canonicalRaceId)||!Array.isArray(associations)||!Array.isArray(statuses))throw TypeError('EXPLICIT_RACE_ASSOCIATION_REQUIRED');
 const index=records(indexTable,['レースID','開催日','主催','競馬場','R','芝/ダ','距離m','馬番','馬名'],indexStartRow).filter(r=>r.data['レースID']===sourceRaceId);
 const history=records(historyTable,['レースID','馬番','馬ID','馬名','走順','過去開催日'],historyStartRow).filter(r=>r.data['レースID']===sourceRaceId);
 if(index.length<2||index.length>99)throw TypeError('INDEX_FIELD_REQUIRED');
 const first=index[0].data,context={date:date(first['開催日']),course:text(first['競馬場']),raceNo:numeric(first.R),surface:text(first['芝/ダ']),distance:numeric(first['距離m'])};
 if(first['主催']!=='NAR'||!context.date||!context.course||!integer(first.R)||!context.surface||!(context.distance>0))throw TypeError('RACE_CONTEXT_INVALID');
 if(index.some(({data:r})=>r['主催']!=='NAR'||date(r['開催日'])!==context.date||r['競馬場']!==context.course||numeric(r.R)!==context.raceNo||r['芝/ダ']!==context.surface||numeric(r['距離m'])!==context.distance))throw TypeError('RACE_CONTEXT_CONFLICT');
 if(new Set(index.map(r=>numeric(r.data['馬番']))).size!==index.length||index.some(r=>!integer(r.data['馬番'])))throw TypeError('RUNNER_DUPLICATE_OR_INVALID');
 const race=table([{CanonicalRace_ID:canonicalRaceId,Org:'NAR',RaceDate:context.date,Course:context.course,R:context.raceNo,Surface:context.surface,DistanceM:context.distance,TrackCondition_EARLY:'UNKNOWN'}]);
 const runner=[],past=[],identityMap=[],audit=[],failures=[];
 for(const item of index){
  const r=item.data,no=numeric(r['馬番']),name=text(r['馬名']);
  const hs=history.filter(h=>numeric(h.data['馬番'])===no),ids=[...new Set(hs.map(h=>text(h.data['馬ID'])))],names=[...new Set(hs.map(h=>text(h.data['馬名'])))];
  if(hs.length>10||new Set(hs.map(h=>numeric(h.data['走順']))).size!==hs.length)throw TypeError('HISTORY_DUPLICATE_OR_OVERSIZE');
  if(hs.some(h=>!integer(h.data['走順'])||!date(h.data['過去開催日'])||date(h.data['過去開催日'])>=context.date))throw TypeError('HISTORY_CURRENT_OR_FUTURE');
  const proofs=associations.filter(a=>a.sourceRaceId===sourceRaceId&&a.canonicalRaceId===canonicalRaceId&&a.horseNo===no&&a.indexName===name);
  const approved=proofs.length===1&&proofs[0].status==='PASS'&&text(proofs[0].evidenceRef)&&ids.length===1&&ids[0]&&names.length===1&&proofs[0].sourceHorseId===ids[0]&&proofs[0].historyName===names[0];
  const exact=ids.length===1&&ids[0]&&names.length===1&&names[0]===name;
  const resolved=!!(exact||approved),key=resolved?`NAR_ARCHIVE|${ids[0]}`:`UNRESOLVED|${sourceRaceId}|${no}`;
  const states=statuses.filter(s=>s.sourceRaceId===sourceRaceId&&s.horseNo===no&&s.horseName===name&&text(s.evidenceRef));
  const status=states.length===1&&['ACTIVE','SCRATCHED','EXCLUDED'].includes(states[0].status)?states[0].status:'UNKNOWN';
  const reason=resolved?null:!hs.length?'HISTORY_IDENTITY_MISSING':ids.length!==1||!ids[0]?'HISTORY_IDENTITY_AMBIGUOUS':'JOIN_NAME_CONFLICT';
  if(reason)failures.push({horseNo:no,reason});if(status==='UNKNOWN')failures.push({horseNo:no,reason:'RUNNER_STATUS_UNCONFIRMED'});
  const values=Object.fromEntries(Object.entries({PeakIndex:'最高指数',Avg5Index:'5走平均',DistanceIndex:'距離指数',CourseIndex:'コース指数',Prev1Index:'前走指数',Prev2Index:'2走前指数',Prev3Index:'3走前指数'}).map(([k,col])=>[k,numeric(r[col])]));
  runner.push({CanonicalRace_ID:canonicalRaceId,CanonicalHorse_Key:key,HorseNo:no,HorseName:name,CancelStatus:status,WeightCarried:numeric(r['斤量']),...values});
  const refs=[{sheet:'NAR_指数マスター',row:item.row},...hs.map(h=>({sheet:'NAR_近10走マスター',row:h.row}))];
  audit.push({horseNo:no,indexName:name,historyNames:names,sourceHorseIds:ids,association:approved?'CALLER_DECLARED_ALIAS':exact?'EXACT_ARCHIVE_ROWS':'HOLD',resolved,reason,status,historyCount:hs.length,refs,
    missingIndexFields:Object.keys(values).filter(k=>values[k]===null)});
  if(!resolved)continue;
  identityMap.push({raceId:canonicalRaceId,horseKey:key,horseNo:no,horseName:name,status:'PASS',evidenceRef:approved?proofs[0].evidenceRef:`ARCHIVE_DECLARATION:${sourceRaceId}:${no}:${ids[0]}`});
  for(const h of hs){const v=h.data;past.push({CanonicalRace_ID:canonicalRaceId,CanonicalHorse_Key:key,Run_No:numeric(v['走順']),PastRaceDate:date(v['過去開催日']),PastCourse:v['過去競馬場'],Class:v['クラス'],FieldSize:numeric(v['頭数']),Finish:numeric(v['着順']),Surface:v['芝/ダ'],DistanceM:numeric(v['距離m']),Going:v['馬場'],RunTime:v['走破TIME'],Margin:numeric(v['着差']),Last3F:numeric(v['上がり3F']),WeightCarried:numeric(v['斤量']),Passage:['1角','2角','3角','4角'].map(k=>numeric(v[k])).filter(v=>v!==null).join(' ')});}
 }
 if(new Set(identityMap.map(h=>h.horseKey)).size!==identityMap.length)throw TypeError('HORSE_ID_REUSED_ACROSS_RUNNERS');
 const orphan=history.filter(h=>!index.some(i=>numeric(i.data['馬番'])===numeric(h.data['馬番'])));
 if(orphan.length)failures.push({reason:'HISTORY_RUNNER_OUTSIDE_INDEX_FIELD',count:orphan.length});
 return {adapterVersion:'NAR_MASTER_EVIDENCE_ADAPTER_V1',sourceRaceId,canonicalRaceId,context,races:race,runners:table(runner),history:past.length?table(past):[['CanonicalRace_ID','CanonicalHorse_Key','Run_No','PastRaceDate','Finish','DistanceM']],identityMap,audit,failures,
  status:failures.length?'HOLD':'READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT',indexCount:index.length,historyCount:history.length,joinedCount:identityMap.length,
  researchOnly:true,formalKpiEligible:false,productionActivationReady:false,identityProof:'ARCHIVE_ASSOCIATION_UNAUTHENTICATED',freezeMutation:'NONE'};
}
