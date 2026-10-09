import {stableHash} from '../prediction/precomputed-snapshot.mjs';
import {RETROSPECTIVE_BRIDGE_VERSION} from './prediction-evidence-bridge-v1.mjs';

export const NAR_SUMMARY_EVIDENCE_VERSION='NAR_SUMMARY_EVIDENCE_BRIDGE_V1';
const fail=r=>{throw new TypeError(r);};
const text=v=>typeof v==='string'?v.trim():'';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const FIELDS=['保存走数','CurrentLevel','PeakAbility','RecentFormShape','ConditionTrigger','先行率','4角平均位置',
  '近10走ベストTIME','近10走ベスト上がり','トレンド根拠','分析メモ','更新日時','HistoryCoverage','DataConfidence','HistoryStatus','DEEP_SCAN','SampleStatus',
  '直近3走平均着順','直近5走平均着順','近10走平均着順','直近3走平均着差','近10走平均着差','近10走勝率','近10走複勝率',
  '同距離走数','同距離勝率','同距離複勝率','同場走数','同場勝率','同場複勝率'];
const REQUIRED=['レースID','対象開催日','主催','競馬場','馬番','馬ID','馬名',...FIELDS.slice(0,12)];
const available=v=>v!==null&&v!==undefined&&v!==''&&!/^(unknown|missing|hold|n\/a|不明)$/i.test(String(v).trim());
const raceDate=v=>Number.isInteger(v)&&v>0&&v<100000?new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10)
  :typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;

// Retrospective attachment only: a newly read summary is never backdated into EARLY.
export async function attachNarSummaryEvidence(snapshot,{table,source,raceAssociation,identities}={}){
  if(snapshot?.schemaVersion!==RETROSPECTIVE_BRIDGE_VERSION||snapshot.organization!=='NAR'
    ||snapshot.replayMode!=='RETROSPECTIVE_ONLY'||snapshot.earlyEligible!==false||snapshot.researchOnly!==true
    ||snapshot.formalKpiEligible!==false||snapshot.productionActivationReady!==false)fail('RETROSPECTIVE_RESEARCH_SNAPSHOT_REQUIRED');
  const {snapshotHash,...parent}=snapshot;
  if(await stableHash(parent)!==snapshotHash)fail('SNAPSHOT_HASH_MISMATCH');
  if(![snapshot.offAt,snapshot.source?.exportedAt].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))))fail('PARENT_TIMING_INVALID');
  if(snapshot.supplementalResearch||snapshot.evidence.some(e=>e.family==='FORM_RESEARCH'))fail('SUMMARY_ALREADY_ATTACHED');
  if(!text(source?.spreadsheetId)||source.spreadsheetId!==snapshot.source.spreadsheetId||!text(source.revision)
    ||source.sheet!=='NAR_近10走サマリー'||!Number.isInteger(source.firstDataRow)||source.firstDataRow<2
    ||typeof source.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(source.capturedAt)
    ||!Number.isFinite(Date.parse(source.capturedAt))||Date.parse(source.capturedAt)<Date.parse(snapshot.offAt)
    ||Date.parse(source.capturedAt)<Date.parse(snapshot.source.exportedAt))fail('SUMMARY_CAPTURE_PROVENANCE_REQUIRED');
  if(raceAssociation?.status!=='PASS'||raceAssociation.canonicalRaceId!==snapshot.raceId
    ||!text(raceAssociation.sourceRaceId)||!text(raceAssociation.evidenceRef))fail('SUMMARY_RACE_ASSOCIATION_REQUIRED');
  const headers=table?.[0];
  if(!Array.isArray(headers)||new Set(headers).size!==headers.length||REQUIRED.some(k=>!headers.includes(k))
    ||table.length>100||table.slice(1).some(r=>!Array.isArray(r)))fail('SUMMARY_BOUNDED_TABLE_REQUIRED');
  if(!Array.isArray(identities)||identities.length>99)fail('SUMMARY_IDENTITY_REQUIRED');
  const horses=snapshot.data.horses.filter(h=>h.runningStatus==='active'),seen=new Set(),audit=[],evidence=[];
  for(const [i,cells] of table.slice(1).entries()){
    if(!cells.some(available))continue;
    const row=Object.fromEntries(headers.map((k,j)=>[k,cells[j]??null]));
    if(row['レースID']!==raceAssociation.sourceRaceId||row['主催']!=='NAR'||raceDate(row['対象開催日'])!==snapshot.data.race.date
      ||row['競馬場']!==snapshot.data.race.racecourse)fail('SUMMARY_RACE_CONTEXT_MISMATCH');
    const no=row['馬番'],id=typeof row['馬ID']==='number'?String(row['馬ID']):text(row['馬ID']);
    const horse=horses.find(h=>h.horseNo===no),matches=identities.filter(m=>m.horseNo===no&&m.sourceHorseId===id&&m.sourceName===row['馬名']);
    if(!Number.isInteger(no)||!horse||!id||seen.has(no)||matches.length!==1)fail('SUMMARY_RUNNER_AMBIGUOUS_OR_MISSING');
    const identity=matches[0];
    if(identity.status!=='PASS'||identity.horseKey!==horse.horseKey||identity.snapshotName!==horse.horseName
      ||horse.horseKey!==`NAR_ARCHIVE|${id}`||!text(identity.evidenceRef))fail('SUMMARY_IDENTITY_UNRESOLVED');
    // Alias association is explicit even when names differ; no official-ID namespace conversion.
    if(row['馬名']!==horse.horseName&&identity.approvedAlias!==horse.horseName)fail('SUMMARY_EXPLICIT_ALIAS_REQUIRED');
    if(!Number.isInteger(row['保存走数'])||row['保存走数']!==horse.pastRuns.length||row['保存走数']>10)fail('SUMMARY_HISTORY_COUNT_MISMATCH');
    seen.add(no);
    const refs=[{sheet:source.sheet,row:source.firstDataRow+i,revision:source.revision,capturedAt:source.capturedAt}];
    const values=Object.fromEntries(FIELDS.map(k=>[k,available(row[k])?structuredClone(row[k]):null]));
    const present=Object.values(values).some(available);
    evidence.push({horseKey:horse.horseKey,family:'FORM_RESEARCH',values,refs,stage:present?'INSPECTED':'MISSING',
      unavailableReason:present?null:'SOURCE_VALUE_MISSING',decisionUsed:false});
    audit.push({horseKey:horse.horseKey,horseNo:no,sourceHorseId:id,sourceName:row['馬名'],snapshotName:horse.horseName,
      identityRef:identity.evidenceRef,refs,claims:'SOURCE_DECLARED_RESEARCH_NOT_RECALCULATED'});
  }
  const payload={...structuredClone(parent),evidence:[...structuredClone(snapshot.evidence),...evidence],
    supplementalResearch:{version:NAR_SUMMARY_EVIDENCE_VERSION,parentSnapshotHash:snapshotHash,source:structuredClone(source),
      raceAssociation:structuredClone(raceAssociation),audit,missingHorseKeys:horses.filter(h=>!seen.has(h.horseNo)).map(h=>h.horseKey),
      timing:'CAPTURED_AFTER_OFF_NOT_PRE_OFF_PROOF',identityAuthority:'CALLER_REVIEWED_NOT_INDEPENDENT_AUTHENTICATION',
      metricAuthority:'SOURCE_NATIVE_NO_DENOMINATOR_OR_PACE_VERIFICATION',modelDriver:false}};
  return freeze({...payload,snapshotHash:await stableHash(payload)});
}
