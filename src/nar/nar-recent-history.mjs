const NAR_BASE='https://www.keiba.go.jp';
const DEFAULT_LIMIT=10;
const DEFAULT_MAX_AGE_MS=24*60*60*1000;
const HISTORY_SCHEMA_READY=new WeakSet();
const TRACK_NAMES={3:'帯広',10:'盛岡',11:'水沢',18:'浦和',19:'船橋',20:'大井',21:'川崎',22:'笠松',23:'金沢',24:'名古屋',27:'園田',28:'姫路',31:'高知',32:'佐賀',36:'門別'};

function decodeHtml(value=''){
  return String(value)
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
}
function text(value=''){
  return decodeHtml(String(value)
    .replace(/<br\s*\/?>/gi,' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' '))
    .replace(/\s+/g,' ')
    .trim();
}
function numberOrNull(value){const n=Number(String(value??'').replace(/,/g,''));return Number.isFinite(n)?n:null}
function normalizeDate(value=''){
  const m=String(value).match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if(!m)return null;
  return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
}
function cleanTrack(value=''){return text(value).replace(/^Ｊ/,'J')}
function normalizeDistance(raw=''){
  const s=text(raw);const m=s.match(/(\d{3,4})/);return {distance:m?Number(m[1]):null,surface:/芝/.test(s)?'芝':/ダ|Dirt/i.test(s)?'ダ':'ダ'};
}
function raceTimeToSeconds(value=''){
  const s=text(value);if(!s)return null;
  let m=s.match(/^(\d+):(\d{2})\.(\d)$/);if(m)return Number(m[1])*60+Number(m[2])+Number(m[3])/10;
  m=s.match(/^(\d+):(\d{2})\.(\d{2})$/);if(m)return Number(m[1])*60+Number(m[2])+Number(m[3])/100;
  return null;
}
function stddev(values){const a=values.filter(Number.isFinite);if(a.length<2)return 0;const m=a.reduce((s,x)=>s+x,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length)}
function mean(values){const a=values.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null}
function round(n,d=2){if(!Number.isFinite(n))return null;const p=10**d;return Math.round(n*p)/p}
function pct(n,d){return d?round(100*n/d,1):null}

export function extractHorseRefsFromRaceHtml(html=''){
  const out=[];const seen=new Set();
  // NAR race pages do not always link horses through HorseMarkInfo.
  // Treat any horse link carrying k_lineageLoginCode as authoritative.
  const re=/<a\b[^>]*href=["']([^"']*k_lineageLoginCode=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(String(html)))){
    const lineageCode=m[2],horseName=text(m[3]);
    if(!lineageCode||!horseName||seen.has(lineageCode))continue;
    seen.add(lineageCode);
    const href=decodeHtml(m[1]);
    out.push({lineageCode,horseName,url:new URL(href,NAR_BASE).toString()});
  }
  return out;
}

export function parseNarHorseMarkInfo(html,{limit=DEFAULT_LIMIT,lineageCode=null}={}){
  const source=String(html||'');
  const titleMatch=source.match(/<h\d[^>]*>[\s\S]*?<\/h\d>/i);
  const horseName=titleMatch?text(titleMatch[0]):'';
  const rows=[];
  const rowRe=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while((rowMatch=rowRe.exec(source))&&rows.length<Math.max(1,limit)){
    const cells=[];const cellRe=/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;let cm;
    while((cm=cellRe.exec(rowMatch[1])))cells.push(text(cm[1]));
    if(cells.length<16)continue;
    const date=normalizeDate(cells[0]);
    if(!date)continue;
    const {distance,surface}=normalizeDistance(cells[5]);
    const courseMarker=cells[8]||'';
    const run={
      date,
      track:cleanTrack(cells[1]),
      raceNo:numberOrNull(cells[2]),
      raceName:cells[3]||'',
      className:cells[4]||'',
      surface,
      distance,
      weather:cells[6]||'',
      going:cells[7]||'',
      courseMarker,
      fieldSize:numberOrNull(cells[9]),
      frameNo:numberOrNull(cells[10]),
      horseNo:numberOrNull(cells[11]),
      popularity:numberOrNull(cells[12]),
      finish:numberOrNull(String(cells[13]).replace(/[^0-9]/g,'')),
      finishText:cells[13]||'',
      time:cells[14]||'',
      timeSec:raceTimeToSeconds(cells[14]),
      margin:numberOrNull(cells[15]),
      last3f:numberOrNull(cells[16]),
      bodyWeight:numberOrNull(cells[17]),
      jockey:cells[18]||'',
      weightCarried:numberOrNull(cells[19]),
      trainer:cells[20]||'',
      prize:cells[21]||'',
      opponent:cells[22]||''
    };
    rows.push(run);
  }
  return {lineageCode:lineageCode?String(lineageCode):null,horseName,runs:rows.slice(0,limit),runCount:Math.min(rows.length,limit)};
}

export function summarizeRecentHistory(runs,{targetDistance=null,targetTrack=null}={}){
  const a=Array.isArray(runs)?runs.filter(Boolean):[];
  const completed=a.filter(r=>Number.isFinite(r.finish)&&r.finish>0);
  const recent3=completed.slice(0,3),recent5=completed.slice(0,5),prior3=completed.slice(3,6);
  const avgFinish=mean(completed.map(r=>r.finish)),recent3Avg=mean(recent3.map(r=>r.finish)),recent5Avg=mean(recent5.map(r=>r.finish));
  const avgMargin=mean(completed.map(r=>r.margin)),recent3Margin=mean(recent3.map(r=>r.margin)),prior3Avg=mean(prior3.map(r=>r.finish)),prior3Margin=mean(prior3.map(r=>r.margin));
  const finishSd=stddev(completed.slice(0,6).map(r=>r.finish));
  let recentFormShape='flat';
  if(finishSd>=4)recentFormShape='volatile';
  else if(recent3Avg!=null&&prior3Avg!=null&&(recent3Avg<=prior3Avg-1||(recent3Margin!=null&&prior3Margin!=null&&recent3Margin<=prior3Margin-.5)))recentFormShape='rising';
  else if(recent3Avg!=null&&prior3Avg!=null&&(recent3Avg>=prior3Avg+1||(recent3Margin!=null&&prior3Margin!=null&&recent3Margin>=prior3Margin+.5)))recentFormShape='falling';
  let currentLevel='unknown';
  if(recent3.length){
    const top3=recent3.filter(r=>r.finish<=3).length;
    if(top3>=2 || (recent3Avg!=null&&recent3Avg<=3.5&&(recent3Margin??9)<=1))currentLevel='high';
    else if(recent3Avg!=null&&recent3Avg<=6&&(recent3Margin==null||recent3Margin<=1.8))currentLevel='competitive';
    else currentLevel='low';
  }
  const wins=completed.filter(r=>r.finish===1).length,top3s=completed.filter(r=>r.finish<=3).length;
  const sameDistance=targetDistance?completed.filter(r=>r.distance===Number(targetDistance)):[];
  const sameTrack=targetTrack?completed.filter(r=>r.track===targetTrack):[];
  const peak=[...completed].sort((x,y)=>(x.finish-y.finish)||((x.margin??99)-(y.margin??99)))[0]||null;
  const bestTime=[...completed].filter(r=>Number.isFinite(r.timeSec)).sort((x,y)=>x.timeSec-y.timeSec)[0]||null;
  const bestLast3f=[...completed].filter(r=>Number.isFinite(r.last3f)).sort((x,y)=>x.last3f-y.last3f)[0]||null;
  const triggers=[];
  if(sameDistance.length){const t=sameDistance.filter(r=>r.finish<=3).length;if(t)triggers.push(`same_distance_top3:${t}/${sameDistance.length}`)}
  if(sameTrack.length){const t=sameTrack.filter(r=>r.finish<=3).length;if(t)triggers.push(`same_track_top3:${t}/${sameTrack.length}`)}
  return {
    runCount:a.length,completedCount:completed.length,currentLevel,recentFormShape,
    recent3AvgFinish:round(recent3Avg),recent5AvgFinish:round(recent5Avg),avgFinish:round(avgFinish),
    recent3AvgMargin:round(recent3Margin),avgMargin:round(avgMargin),winRate:pct(wins,completed.length),top3Rate:pct(top3s,completed.length),
    targetDistance:targetDistance?Number(targetDistance):null,sameDistanceRuns:sameDistance.length,sameDistanceWinRate:pct(sameDistance.filter(r=>r.finish===1).length,sameDistance.length),sameDistanceTop3Rate:pct(sameDistance.filter(r=>r.finish<=3).length,sameDistance.length),
    targetTrack:targetTrack||null,sameTrackRuns:sameTrack.length,sameTrackWinRate:pct(sameTrack.filter(r=>r.finish===1).length,sameTrack.length),sameTrackTop3Rate:pct(sameTrack.filter(r=>r.finish<=3).length,sameTrack.length),
    peakAbility:peak?{date:peak.date,track:peak.track,distance:peak.distance,className:peak.className,finish:peak.finish,margin:peak.margin,time:peak.time,last3f:peak.last3f}:null,
    bestTime:bestTime?{time:bestTime.time,date:bestTime.date,track:bestTime.track,distance:bestTime.distance}:null,
    bestLast3f:bestLast3f?{last3f:bestLast3f.last3f,date:bestLast3f.date,track:bestLast3f.track,distance:bestLast3f.distance}:null,
    conditionTriggers:triggers
  };
}

async function fetchText(url,{timeoutMs=12000,fetcher=fetch}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetcher(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; CHASS-NAR-History/1.0)','accept':'text/html,application/xhtml+xml','accept-language':'ja'},redirect:'follow',signal:controller.signal});
    if(!r.ok)throw Object.assign(new Error(`NAR HTTP ${r.status}`),{status:r.status});
    return await r.text();
  }finally{clearTimeout(timer)}
}

function fingerprint(value){const s=JSON.stringify(value);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return `fnv1a32:${(h>>>0).toString(16).padStart(8,'0')}`}
async function ensureHistorySchema(DB){
  if(!DB||HISTORY_SCHEMA_READY.has(DB))return;
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS nar_horse_history_cache (lineage_code TEXT PRIMARY KEY, horse_name TEXT, latest_run_date TEXT, run_count INTEGER NOT NULL DEFAULT 0, history_json TEXT NOT NULL, summary_json TEXT NOT NULL, source_url TEXT NOT NULL, fingerprint TEXT NOT NULL, fetched_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_nar_horse_history_fetched_at ON nar_horse_history_cache(fetched_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS nar_race_history_manifest (race_key TEXT NOT NULL, horse_no INTEGER NOT NULL, lineage_code TEXT NOT NULL, horse_name TEXT, attached_at TEXT NOT NULL, PRIMARY KEY (race_key,horse_no))`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_nar_race_history_lineage ON nar_race_history_manifest(lineage_code)`)
  ]);
  HISTORY_SCHEMA_READY.add(DB);
}
async function readCache(DB,lineageCode,{maxAgeMs=DEFAULT_MAX_AGE_MS,now=Date.now()}={}){
  if(!DB)return null;await ensureHistorySchema(DB);
  const row=await DB.prepare(`SELECT lineage_code,horse_name,latest_run_date,run_count,history_json,summary_json,source_url,fingerprint,fetched_at FROM nar_horse_history_cache WHERE lineage_code=?`).bind(String(lineageCode)).first();
  if(!row)return null;
  const fresh=now-Date.parse(row.fetched_at)<=maxAgeMs;
  let runs=[],summary={};try{runs=JSON.parse(row.history_json||'[]')}catch{}try{summary=JSON.parse(row.summary_json||'{}')}catch{}
  return {lineageCode:row.lineage_code,horseName:row.horse_name||'',latestRunDate:row.latest_run_date||null,runCount:Number(row.run_count)||runs.length,runs,summary,sourceUrl:row.source_url,fingerprint:row.fingerprint,fetchedAt:row.fetched_at,fresh};
}
async function writeCache(DB,item){
  if(!DB)return;await ensureHistorySchema(DB);const now=new Date().toISOString();
  await DB.prepare(`INSERT INTO nar_horse_history_cache (lineage_code,horse_name,latest_run_date,run_count,history_json,summary_json,source_url,fingerprint,fetched_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(lineage_code) DO UPDATE SET horse_name=excluded.horse_name,latest_run_date=excluded.latest_run_date,run_count=excluded.run_count,history_json=excluded.history_json,summary_json=excluded.summary_json,source_url=excluded.source_url,fingerprint=excluded.fingerprint,fetched_at=excluded.fetched_at,updated_at=excluded.updated_at`).bind(String(item.lineageCode),item.horseName||'',item.runs?.[0]?.date||null,item.runs?.length||0,JSON.stringify(item.runs||[]),JSON.stringify(item.summary||{}),item.sourceUrl,item.fingerprint,now,now).run();
  item.fetchedAt=now;
}

export async function getNarHorseHistory({lineageCode,horseName='',targetDistance=null,targetTrack=null,refresh=false,DB=null,fetcher=fetch,limit=DEFAULT_LIMIT,maxAgeMs=DEFAULT_MAX_AGE_MS}={}){
  if(!/^\d{8,20}$/.test(String(lineageCode||'')))throw Object.assign(new Error('invalid_lineage_code'),{status:400});
  if(DB&&!refresh){const cached=await readCache(DB,lineageCode,{maxAgeMs});if(cached?.fresh){cached.cacheHit=true;cached.summary=summarizeRecentHistory(cached.runs,{targetDistance,targetTrack});return cached}}
  const sourceUrl=`${NAR_BASE}/KeibaWeb/DataRoom/HorseMarkInfo?k_lineageLoginCode=${encodeURIComponent(lineageCode)}`;
  const html=await fetchText(sourceUrl,{fetcher});
  const parsed=parseNarHorseMarkInfo(html,{limit,lineageCode});
  const summary=summarizeRecentHistory(parsed.runs,{targetDistance,targetTrack});
  const item={lineageCode:String(lineageCode),horseName:horseName||parsed.horseName||'',runs:parsed.runs,runCount:parsed.runs.length,summary,sourceUrl,fingerprint:fingerprint(parsed.runs),cacheHit:false};
  if(DB)await writeCache(DB,item);
  return item;
}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},worker));return out;
}
function fmtDate(value=''){const m=String(value).match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);if(!m)return value;return `${m[1]}/${String(m[2]).padStart(2,'0')}/${String(m[3]).padStart(2,'0')}`}

export async function getNarRaceHistory({code,date,race,refresh=false,DB=null,fetcher=fetch,concurrency=4,limit=DEFAULT_LIMIT,maxAgeMs=DEFAULT_MAX_AGE_MS,raceCardParser=null}={}){
  if(!code||!date||!race)throw Object.assign(new Error('code,date,race are required'),{status:400});
  const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;
  const detailUrl=`${NAR_BASE}/KeibaWeb/TodayRaceInfo/DebaTableSmall?${q}`;
  const markUrl=`${NAR_BASE}/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`;
  const detailHtml=await fetchText(detailUrl,{fetcher});
  let markHtml='';
  try{markHtml=await fetchText(markUrl,{fetcher})}catch{}
  const refs=[...extractHorseRefsFromRaceHtml(detailHtml),...extractHorseRefsFromRaceHtml(markHtml)]
    .filter((x,i,a)=>a.findIndex(y=>y.lineageCode===x.lineageCode)===i);
  const refByName=new Map(refs.map(x=>[x.horseName.replace(/\s/g,''),x]));
  const parsedCard=typeof raceCardParser==='function'?raceCardParser(detailHtml):[],hasParsedCard=Array.isArray(parsedCard)&&parsedCard.length>0;
  const targets=(hasParsedCard?parsedCard:refs.map((x,i)=>({horseNo:i+1,horseName:x.horseName}))).map((h,i)=>{
    const horseName=String(h.horseName||'').trim(),ref=refByName.get(horseName.replace(/\s/g,''))||(!hasParsedCard?refs[i]:null)||null;
    return {horseNo:Number(h.horseNo)||i+1,horseName,lineageCode:ref?.lineageCode||null,url:ref?.url||null};
  });
  const resolvable=targets.filter(x=>x.lineageCode);
  if(!resolvable.length)throw Object.assign(new Error('horse_lineage_refs_not_found'),{status:502});
  const metaText=text(detailHtml),distanceMatch=metaText.match(/(?:ダート|芝)\s*(\d{3,4})ｍ/),targetDistance=distanceMatch?Number(distanceMatch[1]):null,targetTrack=TRACK_NAMES[Number(code)]||null;
  const fetched=await mapLimit(resolvable,Number(concurrency)||4,async target=>({target,history:await getNarHorseHistory({...target,targetDistance,targetTrack,refresh,DB,fetcher,limit,maxAgeMs})}));
  const horses=fetched.map(({target,history})=>({horseNo:target.horseNo,horseName:history.horseName||target.horseName,lineageCode:history.lineageCode,runCount:history.runCount,runs:history.runs,summary:history.summary,sourceUrl:history.sourceUrl,fetchedAt:history.fetchedAt,cacheHit:history.cacheHit,fingerprint:history.fingerprint}));
  const unresolved=targets.filter(x=>!x.lineageCode).map(x=>({horseNo:x.horseNo,horseName:x.horseName,error:'lineage_code_not_found'}));
  const raceKey=`${String(date).replace(/\//g,'-')}|${code}|${Number(race)}`;
  if(DB){await ensureHistorySchema(DB);const now=new Date().toISOString();const stmts=horses.map(h=>DB.prepare(`INSERT INTO nar_race_history_manifest (race_key,horse_no,lineage_code,horse_name,attached_at) VALUES (?,?,?,?,?) ON CONFLICT(race_key,horse_no) DO UPDATE SET lineage_code=excluded.lineage_code,horse_name=excluded.horse_name,attached_at=excluded.attached_at`).bind(raceKey,h.horseNo,h.lineageCode,h.horseName||'',now));if(stmts.length)await DB.batch(stmts)}
  return {ok:true,status:unresolved.length?'partial':'complete',source:'NAR公式 HorseMarkInfo',raceKey,code:String(code),date:String(date),race:Number(race),targetDistance,targetTrack,horseCount:targets.length,resolvedHorseCount:horses.length,unresolvedHorseCount:unresolved.length,cacheHits:horses.filter(h=>h.cacheHit).length,cacheMisses:horses.filter(h=>!h.cacheHit).length,concurrency:Number(concurrency)||4,horses,unresolved,generatedAt:new Date().toISOString()};
}

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
export async function handleNarRecentHistoryRequest(request,env,{raceCardParser=null}={}){
  const u=new URL(request.url),DB=env?.DB||null,refresh=u.searchParams.get('refresh')==='1',maxAgeHours=Math.max(0.1,Number(u.searchParams.get('maxAgeHours')||24)),maxAgeMs=maxAgeHours*60*60*1000;
  try{
    if(u.pathname==='/api/nar/history/horse'){
      const item=await getNarHorseHistory({lineageCode:u.searchParams.get('lineage')||u.searchParams.get('lineageCode'),horseName:u.searchParams.get('horseName')||'',targetDistance:numberOrNull(u.searchParams.get('distance')),targetTrack:u.searchParams.get('track')||null,refresh,DB,maxAgeMs});return json({ok:true,...item});
    }
    if(u.pathname==='/api/nar/history/race'){
      const payload=await getNarRaceHistory({code:u.searchParams.get('code'),date:u.searchParams.get('date'),race:u.searchParams.get('race'),refresh,DB,concurrency:Math.min(6,Math.max(1,Number(u.searchParams.get('concurrency')||4))),maxAgeMs,raceCardParser});return json(payload);
    }
    return null;
  }catch(error){return json({ok:false,error:error?.message||String(error),status:error?.status||500},error?.status||500)}
}
