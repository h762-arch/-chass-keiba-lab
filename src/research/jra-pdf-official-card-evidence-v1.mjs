// Offline research adapter for explicitly supplied JRA card HTML, never a live fetcher.
import {createHash} from 'node:crypto';
import {parseJraRaceCard} from '../../jra-race-fetch.mjs';
import {adaptJraPdfEvidence,describeJraPdfMissingHistory} from './jra-pdf-evidence-adapter-v1.mjs';
const fail=r=>{throw new TypeError(r);};
const guard=(ok,r)=>{if(!ok)fail(r);};
const table=objects=>{const h=[...new Set(objects.flatMap(Object.keys))];return [h,...objects.map(o=>h.map(k=>o[k]??null))];};
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const str=v=>typeof v==='string'?v.trim():'';
const strip=v=>String(v).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
const numeric=v=>(typeof v==='number'||typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v.trim()))?Number(v):null;
export function buildJraPdfOfficialCardEvidence({pdfInput,html,sourceUrl,capturedAt,nowAt,maxAgeMs}={}) {
 guard(typeof html==='string'&&Buffer.byteLength(html)<=1000000&&html.length>0,'OFFICIAL_CARD_HTML_REQUIRED');
 const url=new URL(sourceUrl);
 guard(url.origin==='https://www.jra.go.jp'&&url.pathname==='/JRADB/accessD.html'&&!url.username&&!url.password,'OFFICIAL_CARD_URL_REQUIRED');
 guard(iso(capturedAt)&&iso(nowAt)&&Number.isInteger(maxAgeMs)&&maxAgeMs>=1&&maxAgeMs<=3600000&&Date.parse(nowAt)>=Date.parse(capturedAt),'OFFICIAL_CARD_CLOCK_REQUIRED');
 guard(Date.parse(nowAt)-Date.parse(capturedAt)<=maxAgeMs,'OFFICIAL_CARD_CAPTURE_STALE');
 const input=structuredClone(pdfInput);
 const missing=describeJraPdfMissingHistory(input);
 if(missing.length) input.missingHistoryDeclarations=missing;
 const base=adaptJraPdfEvidence({...input,associations:[],statuses:[]});
 // Card identity is read from its header, not adopted from URL tokens alone.
 const card=parseJraRaceCard(html,{date:base.context.date,track:base.context.course,race:base.context.raceNo});
 guard(card.race.surface===base.context.surface&&card.race.distance===base.context.distance,'OFFICIAL_PDF_RACE_CONTEXT_CONFLICT');
 const ids=[];
 for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells=[...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
  const by=cls=>cells.find(x=>new RegExp(`class=["'][^"']*\\b${cls}\\b`,'i').test(x[1]))?.[2];
  const noText=strip(by('num')||'');if(!/^\d+$/.test(noText))continue;
  const cell=by('horse')||'',nameBlock=cell.match(/<div\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'';
  const links=[];
  for(const a of nameBlock.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
   let u;try{u=new URL(a[1].replaceAll('&amp;','&'),url.origin);}catch{continue;}
   const token=u.searchParams.get('CNAME'),match=token?.match(/^pw01dud00(\d{10})\/[A-F0-9]{2}$/i);
   if(u.origin===url.origin&&u.pathname==='/JRADB/accessU.html'&&match)links.push({id:match[1],name:strip(a[2]),url:u.href});
  }
  ids.push({horseNo:Number(noText),links});
 }
 const rh=input.runnerTable[0],hh=input.historyTable[0],v=(r,h,k)=>r[h.indexOf(k)];
 const selected=input.runnerTable.slice(1).filter(r=>v(r,rh,'Race_ID')===input.sourceRaceId);
 guard(card.horses.length===selected.length,'OFFICIAL_PDF_FIELD_CONFLICT');
 const htmlHash=createHash('sha256').update(html).digest('hex'),ref=`${url.href}#research-html-sha256=${htmlHash}`;
 const post=card.race.postTime,offAt=/^\d{2}:\d{2}$/.test(post)?`${card.race.date}T${post}:00+09:00`:null;
 const preOff=!!offAt&&Date.parse(capturedAt)<Date.parse(offAt)&&Date.parse(nowAt)<Date.parse(offAt);
 const horseMaps=[],statuses=[],historyDateEvidence=[],audit=[];
 for(const row of selected) {
  const no=Number(v(row,rh,'馬番')),name=v(row,rh,'馬名'),key=v(row,rh,'Horse_Key'),horses=card.horses.filter(h=>h.horseNo===no&&h.horseName===name);
  guard(horses.length===1,'OFFICIAL_PDF_RUNNER_CONFLICT');const horse=horses[0];
  const rows=ids.filter(h=>h.horseNo===no),links=rows.length===1?rows[0].links.filter(l=>l.name===name):[];
  if(links.length!==1){audit.push({horseNo:no,reason:'OFFICIAL_HORSE_ID_MISSING_OR_AMBIGUOUS'});continue;}
  const identity=links[0],canonicalHorseKey=`JRA_OFFICIAL|${identity.id}`;
  horseMaps.push({SourceSystem:'SHEET',SourceSheet:'JRA_RACE_RUNNER',SourceHorse_Key:key,CanonicalHorse_Key:canonicalHorseKey,HorseName:name,OfficialHorse_ID:identity.id,IdentityStatus:'CONFIRMED'});
  if(preOff&&['active','scratched','excluded'].includes(horse.runningStatus))statuses.push({sourceRaceId:input.sourceRaceId,horseNo:no,horseName:name,status:horse.runningStatus.toUpperCase(),evidenceRef:ref});
  else audit.push({horseNo:no,reason:'OFFICIAL_STARTER_STATE_NOT_PRE_OFF'});
  for(const h of input.historyTable.slice(1).filter(r=>v(r,hh,'Race_ID')===input.sourceRaceId&&v(r,hh,'Horse_Key')===key)) {
   const rawDate=v(h,hh,'過去走日付'),runNo=Number(v(h,hh,'Run_No'));if(!/^\d{2}\/\d{2}$/.test(rawDate))continue;
   const features=Object.fromEntries(['競馬場','芝ダ','距離','着順','走破TIME'].map(k=>[k,v(h,hh,k)]));
   const matches=horse.pastRuns.filter(p=>date(p.date)&&p.date<base.context.date&&p.date.slice(5).replace('-','/')===rawDate&&p.racecourse===features['競馬場']&&p.surface===features['芝ダ']&&p.distance===numeric(features['距離'])&&p.finish===numeric(features['着順'])&&p.time===features['走破TIME']);
   if(matches.length!==1){audit.push({horseNo:no,runNo,reason:'OFFICIAL_HISTORY_MATCH_MISSING_OR_AMBIGUOUS',matchCount:matches.length});continue;}
   historyDateEvidence.push({sourceRaceId:input.sourceRaceId,sourceHorseKey:key,canonicalHorseKey,horseNo:no,horseName:name,runNo,rawDate,fullDate:matches[0].date,status:'PASS',evidenceRef:ref,pdfFeatures:features});
  }
 }
 guard(new Set(horseMaps.map(h=>h.OfficialHorse_ID)).size===horseMaps.length,'OFFICIAL_HORSE_ID_REUSED');
 const raceMap={SourceSystem:'SHEET',SourceSheet:'JRA_RACE_RUNNER',SourceRace_ID:input.sourceRaceId,CanonicalRace_ID:input.canonicalRaceId,Org:'JRA',RaceDate:base.context.date,CourseRaw:base.context.course,R:base.context.raceNo,MatchStatus:'CONFIRMED'};
 const headers=['SourceSystem','SourceSheet','SourceHorse_Key','CanonicalHorse_Key','HorseName','OfficialHorse_ID','IdentityStatus'];
 return {schemaVersion:'JRA_PDF_OFFICIAL_CARD_EVIDENCE_V1',resolutionInput:{pdfInput:{...input,associations:[],statuses},mapSpreadsheetId:`OFFICIAL_CARD_SHA256:${htmlHash}`,raceMapTable:table([raceMap]),horseMapTable:horseMaps.length?table(horseMaps):[headers],historyDateEvidence},
  source:{sourceUrl:url.href,htmlSha256:htmlHash,capturedAt,nowAt,offAt,preOffDeclared:preOff,ref},audit,matchedHorseIds:horseMaps.length,matchedHistoryDates:historyDateEvidence.length,
  identityProof:'OFFICIAL_HTML_ASSOCIATION_UNAUTHENTICATED',sourceAuthentication:'UNVERIFIED',trustedTiming:'UNVERIFIED',researchOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'};
}
