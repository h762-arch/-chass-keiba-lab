export const MEETING_DISCOVERY_VERSION='meeting_v1';

const TRACK_ALIASES={帯広ば:'帯広'};

function decodeEntities(value=''){
 return String(value)
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'");
}

export function meetingText(html=''){
 return decodeEntities(String(html))
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<br\s*\/?>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/[\s\u3000]+/g,' ')
  .trim();
}

export function normalizeMeetingTrack(value=''){
 const text=String(value).trim().replace(/競馬(?:場)?$/,'');
 return TRACK_ALIASES[text]||text;
}

export function normalizeMeetingDate(value=''){
 const match=String(value).match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?/);
 return match?`${match[1]}-${String(Number(match[2])).padStart(2,'0')}-${String(Number(match[3])).padStart(2,'0')}`:'';
}

function raceNumbersFromHtml(html,text){
 const values=[];
 for(const match of String(html).matchAll(/(?:[?&]|&amp;)k_raceNo=(\d{1,2})(?:&|&amp;|["'])/gi))values.push(Number(match[1]));
 for(const match of String(html).matchAll(/(?:^|[>\s\u3000])(\d{1,2})\s*R(?:[<\s\u3000]|$)/gi))values.push(Number(match[1]));
 for(const match of String(text).matchAll(/(?:^|\s)(\d{1,2})\s*R(?:\s|$)/gi))values.push(Number(match[1]));
 return [...new Set(values.filter(n=>Number.isInteger(n)&&n>=1&&n<=20))].sort((a,b)=>a-b);
}

function pageMeetingMeta(text){
 const match=text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日[\s\S]{0,80}?([一-龠々ヶァ-ヶー]+)競馬\s*当日メニュー/);
 return match?{date:`${match[1]}-${String(Number(match[2])).padStart(2,'0')}-${String(Number(match[3])).padStart(2,'0')}`,track:normalizeMeetingTrack(match[4])}:null;
}

function changeType(value=''){
 const text=meetingText(value);
 if(/出走取消|取消/.test(text))return {type:'出走取消',horseStatus:'scratched'};
 if(/競走除外|発走除外|除外/.test(text))return {type:'競走除外',horseStatus:'excluded'};
 if(/出走取止|取止|取止め|取り止め/.test(text))return {type:'出走取止',horseStatus:'withdrawn'};
 return null;
}

function raceChangesFromHtml(html,{track,date}={}){
 const changes=[],seen=new Set(),add=(raceNo,horseNo,horseName,statusText,reason='')=>{const race=Number(raceNo),horse=Number(horseNo),status=changeType(statusText);if(!status||!Number.isInteger(race)||race<1||race>20||!Number.isInteger(horse)||horse<1||horse>18)return;const key=`${race}|${horse}|${status.horseStatus}`;if(seen.has(key))return;seen.add(key);changes.push({date:normalizeMeetingDate(date),track:normalizeMeetingTrack(track),raceNo:race,horseNo:horse,horseName:meetingText(horseName)||null,type:status.type,horseStatus:status.horseStatus,reason:meetingText(reason)||null,statusSource:'NAR_CHANGE_INFO'})};
 for(const table of String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const rows=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match=>({raw:match[1],cells:[...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell=>meetingText(cell[1]))}));
  const header=rows.find(row=>row.cells.some(cell=>/馬番/.test(cell))&&row.cells.some(cell=>/変更|取消|除外|状態/.test(cell))),index=pattern=>header?header.cells.findIndex(cell=>pattern.test(cell.replace(/\s+/g,''))):-1,indexes={race:index(/^(?:レース|競走|R)$/),horse:index(/^馬番$/),name:index(/^馬名$/),change:index(/^(?:変更情報|変更区分|変更|状態)$/),reason:index(/^理由$/)};
  if(indexes.horse<0||indexes.change<0)continue;
  for(const row of rows){const statusText=row.cells[indexes.change]||'',raceText=indexes.race>=0?row.cells[indexes.race]:meetingText(row.raw),raceNo=raceText.match(/(\d{1,2})\s*R/i)?.[1]||String(row.raw).match(/(?:[?&]|&amp;)k_raceNo=(\d{1,2})/i)?.[1],horseNo=String(row.cells[indexes.horse]||'').match(/(\d{1,2})/)?.[1];add(raceNo,horseNo,indexes.name>=0?row.cells[indexes.name]:'',statusText,indexes.reason>=0?row.cells[indexes.reason]:'')}
 }
 return changes.sort((a,b)=>a.raceNo-b.raceNo||a.horseNo-b.horseNo);
}

export function parseNarRaceList(html,{track='',date=''}={}){
 const text=meetingText(html),requestedTrack=normalizeMeetingTrack(track),requestedDate=normalizeMeetingDate(date),meta=pageMeetingMeta(text),raceNumbers=raceNumbersFromHtml(html,text),changes=raceChangesFromHtml(html,{track:requestedTrack,date:requestedDate}),explicitNonMeeting=/(?:開催はありません|開催情報はありません|レース情報がありません|該当するレースはありません)/.test(text);
 if(meta&&meta.date===requestedDate&&meta.track===requestedTrack&&raceNumbers.length){
  return {status:'meeting',meeting:true,track:requestedTrack,date:requestedDate,raceNumbers,changes,source:'NAR公式 RaceList',discoveryVersion:MEETING_DISCOVERY_VERSION};
 }
 if(explicitNonMeeting&&(!meta||meta.date===requestedDate)){
  return {status:'non_meeting',meeting:false,track:requestedTrack,date:requestedDate,raceNumbers:[],changes:[],source:'NAR公式 RaceList',discoveryVersion:MEETING_DISCOVERY_VERSION};
 }
 // RaceList can redirect to another active venue. Only an explicit, same-date
 // venue mismatch is safe to classify as a non-meeting for the requested venue.
 if(meta&&meta.date===requestedDate&&meta.track&&meta.track!==requestedTrack){
  return {status:'non_meeting',meeting:false,track:requestedTrack,date:requestedDate,raceNumbers:[],changes:[],source:'NAR公式 RaceList',activeTrack:meta.track,discoveryVersion:MEETING_DISCOVERY_VERSION};
 }
 return {status:'meeting_unknown',meeting:false,track:requestedTrack,date:requestedDate,raceNumbers:[],changes:[],source:'NAR公式 RaceList',reason:meta?.date&&meta.date!==requestedDate?'date_mismatch':meta&&meta.track===requestedTrack?'race_numbers_missing':'ambiguous_response',discoveryVersion:MEETING_DISCOVERY_VERSION};
}

export function meetingCacheKey(date,track){return `${normalizeMeetingDate(date)}_${normalizeMeetingTrack(track)}`}

export function collectorRequestMetrics({dateCount=0,trackCount=0,meetingRequests=0,raceRequests=0,resultRequests=0,discoveredRaceCount=0}={}){
 const legacyCandidateCount=Math.max(0,Number(dateCount)||0)*Math.max(0,Number(trackCount)||0)*12;
 const estimatedLegacyRequests=legacyCandidateCount+Math.max(0,Number(discoveredRaceCount)||0);
 const actualRequests=Math.max(0,Number(meetingRequests)||0)+Math.max(0,Number(raceRequests)||0)+Math.max(0,Number(resultRequests)||0);
 const reductionRate=estimatedLegacyRequests?Math.max(0,100*(1-actualRequests/estimatedLegacyRequests)):0;
 return {legacyCandidateCount,estimatedLegacyRequests,actualRequests,reductionRate:Number(reductionRate.toFixed(1))};
}
