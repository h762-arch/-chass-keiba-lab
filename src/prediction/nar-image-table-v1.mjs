/** Strict geometry adapter for saved netkeiba NAR standard phone tables. */
import {meetingText} from '../../meeting-discovery.mjs';
export const IMAGE_LAYOUT='NETKEIBA_NAR_STANDARD_PHONE_V1';
const fail=code=>{throw Object.assign(Error(code),{code});};
const norm=x=>String(x).normalize('NFKC').replace(/\s/g,'');
const spans=[[.013,.065],[.136,.333],[.333,.378],[.378,.435],[.435,.484],[.484,.531],[.531,.579],[.579,.626],[.626,.672],[.886,.947],[.947,1]];
const keys=['peak','baseline5','distance','course','previous3','previous2','prev'];
export function officialRosterForOcr(html){
 const starts=[...html.matchAll(/<tr\b[^>]*class=["'][^"']*\btBorder\b[^"']*["'][^>]*>/gi)].map(m=>m.index),out=[];
 for(let i=0;i<starts.length;i++){
  const block=html.slice(starts[i],starts[i+1]??html.length),horseNo=Number(meetingText(block.match(/<td\b[^>]*class=["'][^"']*\bhorseNum\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]||''));
  const links=[...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(a=>/class=["'][^"']*\bhorseName\b/.test(a[1]));
  if(!Number.isInteger(horseNo)||horseNo<1||horseNo>18||links.length!==1)fail('IMAGE_OFFICIAL_ROSTER_INVALID');
  out.push({horseNo,horseName:meetingText(links[0][2])});
 }
 if(out.length<2||out.length>18||new Set(out.map(h=>h.horseNo)).size!==out.length)fail('IMAGE_OFFICIAL_ROSTER_INVALID');
 return out.sort((a,b)=>a.horseNo-b.horseNo);
}
export function compactVisionWords(data){
 if(data?.responses?.length!==1||data.responses[0].error)fail('IMAGE_OCR_PROVIDER_REJECTED');
 const pages=data.responses[0].fullTextAnnotation?.pages;if(pages?.length!==1)fail('IMAGE_OCR_PAGE_INVALID');
 const p=pages[0];if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<600||p.width>2500||p.height/p.width<2||p.height/p.width>2.3)fail('IMAGE_LAYOUT_UNSUPPORTED');
 const words=[];
 for(const b of p.blocks||[])for(const para of b.paragraphs||[])for(const w of para.words||[]){
  const text=(w.symbols||[]).map(s=>s.text).join(''),v=w.boundingBox?.vertices;
  if(!text||text.length>100||v?.length!==4||v.some(q=>!Number.isFinite(q.x??0)||!Number.isFinite(q.y??0))||!Number.isFinite(w.confidence)||w.confidence<0||w.confidence>1)fail('IMAGE_OCR_WORD_INVALID');
  const xs=v.map(q=>(q.x??0)/p.width),ys=v.map(q=>(q.y??0)/p.height);
  if(xs.some(x=>x<0||x>1)||ys.some(y=>y<0||y>1))fail('IMAGE_OCR_WORD_INVALID');
  words.push({text,x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,confidence:w.confidence});
 }
 if(words.length<30||words.length>5000)fail('IMAGE_OCR_WORD_LIMIT');
 return {layout:IMAGE_LAYOUT,width:p.width,height:p.height,words};
}
export function parseNarIndexImage(ocr,{race,expectedHorses}){
 if(ocr?.layout!==IMAGE_LAYOUT||!Array.isArray(ocr.words)||ocr.words.length>5000||!Array.isArray(expectedHorses)||expectedHorses.length<2||expectedHorses.length>18)fail('IMAGE_LAYOUT_UNSUPPORTED');
 const words=ocr.words;
 if(words.some(w=>typeof w.text!=='string'||!Number.isFinite(w.x)||!Number.isFinite(w.y)||w.x<0||w.x>1||w.y<0||w.y>1||!Number.isFinite(w.confidence)||w.confidence<0||w.confidence>1))fail('IMAGE_OCR_WORD_INVALID');
 const inCol=(w,i)=>w.x>=spans[i][0]&&w.x<spans[i][1];
 const anchors=words.filter(w=>inCol(w,0)&&w.y>.45&&/^\d{1,2}$/.test(norm(w.text))).sort((a,b)=>a.y-b.y);
 if(anchors.length!==expectedHorses.length||anchors.some((w,i)=>Number(norm(w.text))!==expectedHorses[i].horseNo||w.confidence<.98||(i&&w.y-anchors[i-1].y<.008)))fail('IMAGE_RUNNER_COVERAGE_OR_CONFIDENCE');
 const first=anchors[0].y,header=words.filter(w=>w.y<first-.004&&w.y>first-.09);
 for(const [col,label] of [[2,'最高'],[3,'5走平均'],[4,'距離'],[5,'コース'],[6,'3走'],[7,'2走'],[8,'前走']]){
  if(!header.filter(w=>inCol(w,col)).sort((a,b)=>a.y-b.y||a.x-b.x).map(w=>norm(w.text)).join('').includes(label))fail('IMAGE_COLUMN_HEADER_MISMATCH');
 }
 const top=words.filter(w=>w.y<.25).sort((a,b)=>a.y-b.y||a.x-b.x).map(w=>norm(w.text)).join('');
 const [y,m,d]=race.raceDate.split('-').map(Number);
 if(!top.includes(`${m}/${d}`)||!top.includes(race.track)||!new RegExp(`(?:^|[^0-9])${race.raceNo}R`).test(top))fail('IMAGE_RACE_LABEL_MISMATCH');
 const horses=[],market=[],rawRows=[];
 for(let i=0;i<anchors.length;i++){
  const a=anchors[i],gap=Math.min(i?a.y-anchors[i-1].y:1,i+1<anchors.length?anchors[i+1].y-a.y:1),half=Math.min(.013,gap*.42);
  const row=words.filter(w=>Math.abs(w.y-a.y)<half),read=(col,confidence=.98)=>{const cells=row.filter(w=>inCol(w,col)).sort((a,b)=>a.x-b.x);if(!cells.length||cells.some(w=>w.confidence<confidence))fail('IMAGE_CELL_MISSING_OR_LOW_CONFIDENCE');return norm(cells.map(w=>w.text).join(''));};
  const expected=expectedHorses[i],name=read(1,.9);if(name!==norm(expected.horseName))fail('IMAGE_HORSE_NAME_MISMATCH');
  const raw={},values={};
  for(let c=0;c<keys.length;c++){
   const key=keys[c],s=read(c+2);raw[key]=s;
   if(['-','未'].includes(s))values[key]=null;
   else if(key==='baseline5'&&/^-?\d{1,3}\*$/.test(s))values[key]=null;
   else if(/^-?\d{1,3}$/.test(s))values[key]=Number(s);
   else fail('IMAGE_INDEX_SYMBOL_UNRESOLVED');
  }
  horses.push({horseNo:expected.horseNo,horseName:expected.horseName,peak:values.peak,baseline5:values.baseline5,distance:values.distance,course:values.course,prev:values.prev,current:null});
  const odds=read(9),pop=read(10);
  if(!/^\d{1,3}(?:\.\d)?$/.test(odds)||Number(odds)<1||!/^\d{1,2}$/.test(pop))fail('IMAGE_PREDICTED_MARKET_INVALID');
  market.push({horseNo:expected.horseNo,odds:Number(odds),popularity:Number(pop)});rawRows.push({horseNo:expected.horseNo,horseName:expected.horseName,indices:raw,odds,popularity:pop});
 }
 market.sort((a,b)=>a.popularity-b.popularity);
 if(market.some((h,i)=>h.popularity!==i+1||(i&&h.odds<market[i-1].odds)))fail('IMAGE_PREDICTED_MARKET_INVALID');
 return {observation:{format:'CHASS_CPSI_INDEX_OBSERVATION_V1',race:{organization:'NAR',...race,surface:'ダート'},horses},predictedMarket:market,rawRows,layout:IMAGE_LAYOUT,starPolicy:'PRESERVE_RAW_BASELINE5_NOT_ADOPTED',currentPolicy:'MISSING_NOT_OBSERVED',sourceOriginAuthenticated:false};
}
