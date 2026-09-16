const JRA_VENUES=new Set(['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉']);
const NAR_JURISDICTIONS=new Set(['帯広','門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','愛知','園田','姫路','高知','佐賀']);

export function classifyHorseOrigin(trainerCell=''){
  const raw=String(trainerCell||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim();
  const affiliation=(raw.normalize('NFKC').match(/[（(]\s*([^()（）]+?)\s*[）)]/)?.[1]||'').trim();
  if(affiliation.toUpperCase()==='JRA')return {originOrganization:'JRA',originJurisdiction:'JRA',originSource:'trainer_affiliation',originConfidence:'confirmed'};
  const local=[...NAR_JURISDICTIONS].find(x=>affiliation===x);
  if(local)return {originOrganization:'NAR',originJurisdiction:local,originSource:'trainer_affiliation',originConfidence:'confirmed'};
  return {originOrganization:'UNKNOWN',originJurisdiction:'UNKNOWN',originSource:'unknown',originConfidence:'unknown'};
}

export function classifyRunVenue(value=''){
  const rawVenue=String(value||'').trim(),normalized=rawVenue.normalize('NFKC'),prefixed=/^J(?=[一-龠々ヶァ-ヶー])/i.test(normalized);
  const venue=(normalized.replace(/^J(?=[一-龠々ヶァ-ヶー])/i,'').match(/[一-龠々ヶァ-ヶー]+/)||[])[0]||'';
  return {rawVenue,venue,runOrganization:(prefixed||JRA_VENUES.has(venue))?'JRA':NAR_JURISDICTIONS.has(venue)?'NAR':'UNKNOWN'};
}

export function mergeCardIdentities(detail=[],fallback=[],odds=[]){
  const maps=[detail,fallback,odds].map(rows=>new Map((rows||[]).map(row=>[String(row.horseNo),row]))),numbers=[...new Set(maps.flatMap(map=>[...map.keys()]))].sort((a,b)=>Number(a)-Number(b));
  return numbers.map(horseNo=>{const d=maps[0].get(horseNo),f=maps[1].get(horseNo),o=maps[2].get(horseNo),base={...(f||{}),...(d||{})};return {...base,horseNo,horseName:String(base.horseName||o?.horseName||`馬番${horseNo}`).trim(),nameSource:d?'DebaTableSmall':f?'RaceMarkTable':o?'OddsTanFuku':'fallback',identityRecovered:!d&&!!(f||o),originOrganization:base.originOrganization||'UNKNOWN',originJurisdiction:base.originJurisdiction||'UNKNOWN',originSource:base.originSource||'unknown',originConfidence:base.originConfidence||'unknown'};});
}

export function summarizeHorseOrigins(horses=[]){const originCounts={JRA:0,NAR:0,UNKNOWN:0};for(const h of horses)originCounts[['JRA','NAR'].includes(h.originOrganization)?h.originOrganization:'UNKNOWN']++;return {raceHost:'NAR',mixedOrigin:originCounts.JRA>0,originCounts};}
