import {meetingText} from '../../meeting-discovery.mjs';
import {stableHash} from './precomputed-snapshot.mjs';
const fail=reason=>{throw Error(reason);};
const norm=s=>meetingText(s).normalize('NFKC').replace(/\s+/g,'');
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const link=v=>v.replace(/&amp;|&#38;/g,'&');
function one(url,key){const a=url.searchParams.getAll(key);if(a.length!==1)fail('LINK_PARAMETER');return a[0];}
function officialUrl(href,base,path){const u=new URL(link(href),base);if(u.origin!=='https://www.keiba.go.jp'||u.pathname!==path||u.username||u.password||u.hash)fail('LINK_SOURCE');return u;}
// Offline parser only: follows no HorseMarkInfo or RaceMarkTable links.
export async function extractNarOfficialHistoryLinks(html,{sourceUrl,date,track,code,raceNo,observedAt,expectedHorses}){
 if(typeof html!=='string'||new TextEncoder().encode(html).byteLength>1000000||!validDate(date)||!Number.isInteger(raceNo)||raceNo<1||raceNo>99||!/^\d{2}$/.test(String(code))||!Array.isArray(expectedHorses)||expectedHorses.length<2||expectedHorses.length>30)fail('INPUT_INVALID');
 const source=officialUrl(sourceUrl,sourceUrl,'/KeibaWeb/TodayRaceInfo/DebaTable');
 if(one(source,'k_raceDate')!==date.replaceAll('-','/')||one(source,'k_babaCode')!==String(code)||one(source,'k_raceNo')!==String(raceNo))fail('CARD_IDENTITY');
 const header=html.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1]||'',text=norm(header),[y,m,d]=date.split('-').map(Number);
 if(!text.includes(`${y}年${m}月${d}日`)||!text.includes(`${norm(track)}第${raceNo}競走`))fail('CARD_IDENTITY');
 const time=text.match(/([01]\d|2[0-3]):([0-5]\d)発走/)?.[0]?.slice(0,5),post=Date.parse(`${date}T${time}:00+09:00`),at=Date.parse(observedAt);
 if(!Number.isFinite(at)||!Number.isFinite(post)||at>=post)fail('PRE_RACE_TIME');
 const starts=[...html.matchAll(/<tr\b[^>]*class=["'][^"']*\btBorder\b[^"']*["'][^>]*>/gi)].map(m=>m.index),rows=[];
 for(let i=0;i<starts.length;i++){
  const block=html.slice(starts[i],starts[i+1]??html.length),no=Number(norm(block.match(/<td\b[^>]*class=["'][^"']*\bhorseNum\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]||''));
  if(!Number.isInteger(no)||no<1||no>30)fail('RUNNER_IDENTITY');
  const horses=[...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(a=>/class=["'][^"']*\bhorseName\b/.test(a[1]));if(horses.length!==1)fail('HORSE_LINK_AMBIGUOUS');
  const href=horses[0][1].match(/href=["']([^"']*)["']/i)?.[1];if(!href)fail('HORSE_LINK_MISSING');
  const u=officialUrl(href,source.href,'/KeibaWeb/DataRoom/HorseMarkInfo'),horseId=one(u,'k_lineageLoginCode');if(!/^\d{11}$/.test(horseId))fail('HORSE_ID_INVALID');
  const expected=expectedHorses.filter(h=>/^\d{1,2}$/.test(String(h.horseNo))&&Number(h.horseNo)===no);if(expected.length!==1||norm(expected[0].horseName)!==norm(horses[0][2]))fail('RUNNER_IDENTITY');
  const refs=[];
  for(const a of block.matchAll(/<a\b[^>]*href=["']([^"']*)["'][^>]*>/gi)){
   if(!a[1].includes('RaceMarkTable?'))continue;
   const r=officialUrl(a[1],source.href,'/KeibaWeb/TodayRaceInfo/RaceMarkTable'),pastDate=one(r,'k_raceDate').replaceAll('/','-'),pastCode=one(r,'k_babaCode'),pastNo=Number(one(r,'k_raceNo'));
   if(!validDate(pastDate)||pastDate>=date||!/^\d{1,2}$/.test(pastCode)||!Number.isInteger(pastNo)||pastNo<1||pastNo>99)fail('PAST_RACE_IDENTITY');
   refs.push({date:pastDate,code:pastCode.padStart(2,'0'),raceNo:pastNo,raceId:`${pastDate.replaceAll('-','')}-NAR-${pastCode.padStart(2,'0')}-${String(pastNo).padStart(2,'0')}`,sourceUrl:r.href});
  }
  if(refs.length>5||new Set(refs.map(r=>r.raceId)).size!==refs.length)fail('PAST_LINK_AMBIGUOUS');
  rows.push({horseNo:no,horseName:expected[0].horseName,providerHorseId:horseId,providerHorseKey:`NAR_LINEAGE:${horseId}`,pastRaceReferences:refs});
 }
 if(rows.length!==expectedHorses.length||new Set(rows.map(r=>r.horseNo)).size!==rows.length||new Set(rows.map(r=>r.providerHorseId)).size!==rows.length)fail('RUNNER_COVERAGE');
 const body={schemaVersion:1,status:'IDENTITY_LINKS_RESOLVED',sourceUrl:source.href,observedAt,date,track,code:String(code),raceNo,
  scope:'OFFICIAL_FULL_CARD_LINKS_ONLY',researchOnly:true,formalKpiEligible:false,resultPageFetchCount:0,historyFactJoinStatus:'NOT_PERFORMED',rows};
 return {body,linksHash:await stableHash(body)};
}
