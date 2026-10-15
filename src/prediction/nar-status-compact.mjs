// Response projection only. No DATA mutation, diagnostics, IO or changed counts.
const needsDetail = h => h?.time?.status !== 'AVAILABLE' || h?.history?.status !== 'OBSERVED' || h.history.heldReferenceCount !== 0;
export function compactNarPrecomputeStatus(value, {raceNo = null} = {}) {
 const selected = value.races.filter(r => raceNo === null || r.raceNo === raceNo);
 const ids = new Set(selected.map(r => r.raceId));
 const races = selected.map(r => {
  if (!r.quality || !Array.isArray(r.quality.horses)) return {...r};
  const {horses, ...quality} = r.quality;
  return {...r, quality};
 });
 const sidecar = value.qualityDiagnostics;
 const qualityDiagnostics = sidecar && Array.isArray(sidecar.races) ? {...sidecar, detailScope:'AFFECTED_HORSES', races:sidecar.races.filter(r => ids.has(r.raceId)).map(r => {
  const d = r.diagnostics;
  if (!Array.isArray(d?.horses)) return {...r};
  const horses = d.horses.filter(needsDetail);
  return {...r, diagnostics:{...d, detailScope:'AFFECTED_HORSES', displayedHorseCount:horses.length, omittedUnaffectedHorseCount:d.horses.length-horses.length, horses}};
 })} : sidecar;
 return {...value, format:'compact', countScope:'DATE', raceDetailScope:raceNo === null ? 'ALL_RESTORED_RACES' : 'SELECTED_RACE', selectedRaceNo:raceNo,
  races, ...(sidecar === undefined ? {} : {qualityDiagnostics})};
}
