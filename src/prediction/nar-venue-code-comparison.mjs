// Diagnostic comparison only; never used to resolve identities or validate hashes.
// Primary NAR pages confirm code 22=金沢 and 23=笠松 (see Phase140.5 docs).
const verifiedOverrides = Object.freeze({'22':'金沢','23':'笠松'});
const unavailable = reasonCode => ({status:'UNAVAILABLE', reasonCode});
export function compareNarVenueCodes(fact, official, baselineVenues) {
 try {
  if (fact?.originCircuit !== 'NAR') return unavailable('NON_NAR_SCOPE');
  if (!Array.isArray(official) || official.length > 5) return unavailable('REFERENCE_LIMIT_OR_SHAPE');
  const allowedVenues = Object.values(baselineVenues), factVenue = allowedVenues.includes(fact.venue) ? fact.venue : null;
  const factMonthDay = typeof fact.dateText === 'string' && /^(?:0[1-9]|1[0-2])\.(?:0[1-9]|[12]\d|3[01])$/.test(fact.dateText) ? fact.dateText : null;
  const references = official.map((ref,i) => {
   if (typeof ref?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ref.date) || !/^\d{1,2}$/.test(String(ref.code))) throw Error();
   const code = String(ref.code).padStart(2,'0'), checked = Object.hasOwn(verifiedOverrides,code);
   const baselineVenue = allowedVenues.includes(baselineVenues[Number(code)]) ? baselineVenues[Number(code)] : null;
   const comparisonVenue = checked ? verifiedOverrides[code] : baselineVenue;
   const monthDayMatches = factMonthDay !== null && factMonthDay === ref.date.slice(5).replace('-','.');
   return {referenceIndex:i+1, date:ref.date, code, baselineVenue, comparisonVenue,
    mappingBasis:checked?'PRIMARY_SOURCE_VERIFIED_22_23':'LEGACY_UNCHECKED', codeMapDisagrees:checked&&baselineVenue!==comparisonVenue,
    monthDayMatches, baselineVenueMatches:factVenue!==null&&factVenue===baselineVenue,
    comparisonVenueMatches:factVenue!==null&&factVenue===comparisonVenue};
  });
  const baselineDateVenueCandidateCount = references.filter(r=>r.monthDayMatches&&r.baselineVenueMatches).length;
  const comparisonDateVenueCandidateCount = references.filter(r=>r.monthDayMatches&&r.comparisonVenueMatches).length;
  const verifiedDateVenueCandidateCount = references.filter(r=>r.mappingBasis==='PRIMARY_SOURCE_VERIFIED_22_23'&&r.monthDayMatches&&r.comparisonVenueMatches).length;
  const observation = verifiedDateVenueCandidateCount>0&&baselineDateVenueCandidateCount===0?'VERIFIED_CODE_MAPPING_CHANGES_CANDIDATES':comparisonDateVenueCandidateCount>0?'COMPARISON_CANDIDATE_PRESENT':'NO_COMPARISON_CANDIDATE';
  return {schemaVersion:1,status:'OBSERVED',scope:'READ_ONLY_CODE_22_23_COMPARISON',factMonthDay,factVenue,
   baselineDateVenueCandidateCount,comparisonDateVenueCandidateCount,verifiedDateVenueCandidateCount,
   codeMapDisagreementCount:references.filter(r=>r.codeMapDisagrees).length,observation,references};
 } catch { return unavailable('VENUE_COMPARISON_UNAVAILABLE'); }
}
