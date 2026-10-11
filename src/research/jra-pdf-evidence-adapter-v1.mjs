// Offline connector-export adapter. No Drive, network, DB or Freeze writes.
const str = v => typeof v === 'string' ? v.trim() : '';
const num = v => (typeof v === 'number' || typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) && Number.isFinite(Number(v)) ? Number(v) : null;
const positive = v => Number.isInteger(num(v)) && num(v) > 0;
const date = v => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v ? v : null;
const table = objects => { const keys = [...new Set(objects.flatMap(Object.keys))]; return [keys, ...objects.map(o => keys.map(k => o[k] ?? null))]; };
const fail = reason => { throw new TypeError(reason); };
function rows(values, required, startRow) {
  if (!Array.isArray(values) || values.length > 5001 || !Array.isArray(values[0]) || values[0].length > 50
    || values[0].some(k => !str(k)) || new Set(values[0]).size !== values[0].length
    || required.some(k => !values[0].includes(k)) || !positive(startRow)
    || values.slice(1).some(r => !Array.isArray(r) || r.length > values[0].length || r.some(v => v != null && !['string','number','boolean'].includes(typeof v)))) fail('PDF_TABLE_INVALID');
  return values.slice(1).map((r,i) => ({row:startRow+i, data:Object.fromEntries(values[0].map((k,j) => [k,r[j] ?? null]))}));
}
export function adaptJraPdfEvidence({sourceRaceId, canonicalRaceId, sourceSpreadsheetId, manifestTable, runnerTable, historyTable,
  manifestStartRow=2, runnerStartRow=2, historyStartRow=2, associations=[], statuses=[]} = {}) {
  if (![sourceRaceId, canonicalRaceId, sourceSpreadsheetId].every(str) || !Array.isArray(associations) || !Array.isArray(statuses)) fail('EXPLICIT_PDF_SOURCE_REQUIRED');
  const manifests = rows(manifestTable, ['Race_ID','開催日','競馬場','レース番号','芝ダ障','距離','出走頭数'], manifestStartRow).filter(r => r.data.Race_ID === sourceRaceId);
  if (manifests.length !== 1) fail('PDF_MANIFEST_AMBIGUOUS_OR_MISSING');
  const m = manifests[0].data, context = {date:date(m['開催日']), course:str(m['競馬場']), raceNo:num(m['レース番号']), surface:str(m['芝ダ障']), distance:num(m['距離'])};
  if (!context.date || !context.course || !positive(m['レース番号']) || !['芝','ダート','障害'].includes(context.surface) || !positive(m['距離']) || !positive(m['出走頭数']) || num(m['出走頭数']) > 99) fail('PDF_RACE_CONTEXT_INVALID');
  const runners = rows(runnerTable,['Race_ID','開催日','競馬場','R','馬番','馬名','Horse_Key','取消状態'],runnerStartRow).filter(r => r.data.Race_ID === sourceRaceId);
  const histories = rows(historyTable,['Race_ID','Horse_Key','馬番','馬名','Run_No','過去走日付'],historyStartRow).filter(r => r.data.Race_ID === sourceRaceId);
  if (runners.length !== num(m['出走頭数'])) fail('PDF_FIELD_INCOMPLETE');
  if (runners.some(({data:r}) => date(r['開催日']) !== context.date || r['競馬場'] !== context.course || num(r.R) !== context.raceNo)) fail('PDF_RACE_CONTEXT_CONFLICT');
  if (runners.some(({data:r}) => !positive(r['馬番']) || !str(r['馬名']) || !str(r.Horse_Key))
    || new Set(runners.map(r => num(r.data['馬番']))).size !== runners.length || new Set(runners.map(r => r.data.Horse_Key)).size !== runners.length) fail('PDF_RUNNER_DUPLICATE_OR_INVALID');
  if (histories.some(({data:h}) => !runners.some(({data:r}) => num(h['馬番']) === num(r['馬番']) && h.Horse_Key === r.Horse_Key && h['馬名'] === r['馬名']))) fail('PDF_HISTORY_IDENTITY_CONFLICT');
  const output=[], past=[], identityMap=[], audit=[], failures=[];
  for (const item of runners) {
    const r=item.data, no=num(r['馬番']), hs=histories.filter(h => h.data.Horse_Key === r.Horse_Key);
    if (hs.length !== 5 || hs.some(h => !positive(h.data.Run_No) || num(h.data.Run_No)>5) || new Set(hs.map(h => num(h.data.Run_No))).size !== hs.length) fail('PDF_HISTORY_SLOT_INVALID');
    const proofs=associations.filter(a => a.sourceRaceId===sourceRaceId && a.canonicalRaceId===canonicalRaceId && a.sourceHorseKey===r.Horse_Key && a.horseNo===no && a.horseName===r['馬名']);
    const resolved=proofs.length===1 && proofs[0].status==='PASS' && str(proofs[0].canonicalHorseKey) && !/^(TEMP|UNKNOWN|UNRESOLVED)(\||$)/.test(proofs[0].canonicalHorseKey) && str(proofs[0].evidenceRef);
    const key=resolved ? proofs[0].canonicalHorseKey : `UNRESOLVED|${sourceRaceId}|${no}`;
    const states=statuses.filter(s => s.sourceRaceId===sourceRaceId && s.horseNo===no && s.horseName===r['馬名'] && str(s.evidenceRef));
    const status=states.length===1 && ['ACTIVE','SCRATCHED','EXCLUDED'].includes(states[0].status) ? states[0].status : 'UNKNOWN';
    if (!resolved) failures.push({horseNo:no,reason:'PDF_CANONICAL_IDENTITY_UNCONFIRMED'});
    if (status==='UNKNOWN') failures.push({horseNo:no,reason:'PDF_RUNNER_STATUS_UNCONFIRMED'});
    output.push({CanonicalRace_ID:canonicalRaceId,CanonicalHorse_Key:key,HorseNo:no,HorseName:r['馬名'],CancelStatus:status,WeightCarried:num(r['斤量'])});
    if (resolved) identityMap.push({raceId:canonicalRaceId,horseKey:key,horseNo:no,horseName:r['馬名'],status:'PASS',evidenceRef:proofs[0].evidenceRef});
    for (const h of hs) {
      const v=h.data, rawDate=str(v['過去走日付']), fullDate=date(rawDate), reason=fullDate ? null : /^\d{2}\/\d{2}$/.test(rawDate) ? 'PDF_HISTORY_YEAR_UNCONFIRMED' : 'PDF_HISTORY_DATE_MISSING';
      if (fullDate && fullDate >= context.date) fail('PDF_HISTORY_CURRENT_OR_FUTURE');
      audit.push({horseNo:no,runNo:num(v.Run_No),rawDate,pastRaceDate:fullDate,reason,refs:[{spreadsheetId:sourceSpreadsheetId,sheet:'JRA_HISTORY',row:h.row}]});
      if (reason) { failures.push({horseNo:no,runNo:num(v.Run_No),reason}); continue; }
      if (!resolved) continue;
      past.push({CanonicalRace_ID:canonicalRaceId,CanonicalHorse_Key:key,Run_No:num(v.Run_No),PastRaceDate:fullDate,PastCourse:v['競馬場'],Class:v['クラス'],FieldSize:num(v['頭数']),Finish:num(v['着順']),Surface:v['芝ダ'],DistanceM:num(v['距離']),Going:v['馬場状態'],RunTime:str(v['走破TIME'])==='UNKNOWN' ? null : v['走破TIME'],Margin:num(v['着差']),Last3F:num(v['上がり3F']),WeightCarried:num(v['斤量']),Passage:str(v['通過順位'])==='UNKNOWN' ? null : v['通過順位']});
    }
  }
  if (new Set(identityMap.map(h => h.horseKey)).size !== identityMap.length) fail('PDF_CANONICAL_KEY_REUSED');
  return {adapterVersion:'JRA_PDF_EVIDENCE_ADAPTER_V1',sourceRaceId,canonicalRaceId,sourceSpreadsheetId,context,
    races:table([{CanonicalRace_ID:canonicalRaceId,Org:'JRA',RaceDate:context.date,Course:context.course,R:context.raceNo,Surface:context.surface,DistanceM:context.distance,TrackCondition_EARLY:'UNKNOWN'}]),
    runners:table(output),history:past.length ? table(past) : [['CanonicalRace_ID','CanonicalHorse_Key','Run_No','PastRaceDate','Finish','DistanceM']],identityMap,audit,failures,
    refs:[{spreadsheetId:sourceSpreadsheetId,sheet:'JRA_PDF_MANIFEST',row:manifests[0].row},...runners.map(r => ({spreadsheetId:sourceSpreadsheetId,sheet:'JRA_RACE_RUNNER',row:r.row}))],
    runnerCount:runners.length,historySlotCount:histories.length,joinedCount:identityMap.length,status:failures.length ? 'HOLD' : 'READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT',
    identityProof:'CALLER_DECLARED_ASSOCIATION_UNAUTHENTICATED',researchOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'};
}
