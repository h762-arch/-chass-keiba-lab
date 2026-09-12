import {JRA_TRACKS,validDate} from './jra-meeting-discovery.mjs';
import {readJraOfficialRaceCache} from './jra-official-cache.mjs';

export const JRA_RACE_PARSER_VERSION='jra-official-card-v1';
export const JRA_NAVIGATION_VERSION='jra-doaction-v1';

const TRACK_CODES={札幌:'01',函館:'02',福島:'03',新潟:'04',東京:'05',中山:'06',中京:'07',京都:'08',阪神:'09',小倉:'10'};
const JRA_DB_ORIGIN='https://www.jra.go.jp';
const ACCESS_D_PATH='/JRADB/accessD.html';
const ENTRY_CNAME='pw01dli00/F3';
const MAX_NAV_DEPTH=3;
const MAX_NAV_PAGES=6;

const strip=s=>String(s||'')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
  .replace(/<[^>]*>/g,' ')
  .replace(/&nbsp;|&#160;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/\s+/g,' ')
  .trim();

const pick=(html,cls)=>{
  const m=String(html||'').match(new RegExp(`<([a-z][a-z0-9]*)[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,'i'));
  return m?.[2]||'';
};

const altNumber=html=>number(String(html||'').match(/alt=["'][^"']*?(\d+)(?:レース|白|黒|赤|青|黄|緑|橙|桃)[^"']*["']/i)?.[1]);
const number=s=>{const n=Number(String(s||'').replace(/,/g,'').match(/[+-]?\d+(?:\.\d+)?/)?.[0]);return Number.isFinite(n)?n:null};
const jpDate=s=>{const m=strip(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:''};

function normalizeCname(value){
  const cname=String(value||'').replaceAll('&amp;','&').trim();
  if(!/^pw01d[a-z0-9]+[^'"<>\s]*\/[0-9A-F]{2}$/i.test(cname))return '';
  return cname;
}

function directRaceTokenPattern({date,track,race}){
  const compact=date.replaceAll('-','');
  const year=date.slice(0,4);
  const code=TRACK_CODES[track];
  const rr=String(race).padStart(2,'0');
  return new RegExp(`^pw01dde\\d{2}${code}${year}\\d{4}${rr}${compact}\\/[0-9A-F]{2}$`,'i');
}

export function extractJraAccessDTokens(html){
  const source=String(html||'');
  const values=[];
  const seen=new Set();
  const add=value=>{
    const token=normalizeCname(value);
    if(token&&!seen.has(token)){seen.add(token);values.push(token);}
  };

  for(const m of source.matchAll(/doAction\(\s*["']\/JRADB\/accessD\.html["']\s*,\s*["']([^"']+)["']/gi))add(m[1]);
  for(const m of source.matchAll(/(?:href|action)=["'][^"']*accessD\.html\?CNAME=([^"'&#\s]+)[^"']*["']/gi))add(decodeURIComponent(m[1]));
  for(const m of source.matchAll(/[?&]CNAME=([^"'&<>\s]+)/gi))add(decodeURIComponent(m[1]));

  return values;
}

export function resolveRaceCardUrl(listHtml,{date,track,race}){
  if(!validDate(date)||!TRACK_CODES[track]||!Number.isInteger(race)||race<1||race>12)throw Error('JRA_RACE_INVALID_INPUT');
  const token=extractJraAccessDTokens(listHtml).find(x=>directRaceTokenPattern({date,track,race}).test(x));
  if(!token)throw Error('JRA_RACE_NOT_FOUND');
  return `${JRA_DB_ORIGIN}${ACCESS_D_PATH}?CNAME=${token}`;
}

function tokenScore(token,{date,track,race}){
  const compact=date.replaceAll('-','');
  const year=date.slice(0,4);
  const code=TRACK_CODES[track];
  let score=0;
  if(token.includes(compact))score+=20;
  if(token.includes(`${code}${year}`))score+=10;
  if(token.includes(year))score+=4;
  if(token.startsWith('pw01dde'))score+=50;
  if(new RegExp(`${String(race).padStart(2,'0')}${compact}`,'i').test(token))score+=25;
  return score;
}

function candidateNavigationTokens(html,context,visited){
  return extractJraAccessDTokens(html)
    .filter(token=>token!==ENTRY_CNAME&&!visited.has(token))
    .map(token=>({token,score:tokenScore(token,context)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score||a.token.localeCompare(b.token))
    .slice(0,3)
    .map(x=>x.token);
}

function parsePast(cell){
  if(!strip(cell))return null;
  const distanceText=strip(pick(cell,'dist')),surface=/芝/.test(distanceText)?'芝':/ダ/.test(distanceText)?'ダート':'';
  const place=strip(pick(cell,'place')),finish=number(place),max=number(pick(cell,'max')),time=strip(pick(cell,'time'));
  return {
    date:jpDate(pick(cell,'date')),
    racecourse:strip(pick(cell,'rc')),
    raceName:strip(pick(cell,'name')),
    raceClass:strip(pick(cell,'r_class')),
    finish:/着/.test(place)?finish:null,
    fieldSize:max,
    jockey:strip(pick(cell,'jockey')),
    weightCarried:number(pick(cell,'weight')),
    distance:number(distanceText),
    surface,
    time:/^\d+:\d{2}\.\d$/.test(time)?time:'',
    trackCondition:strip(pick(cell,'condition'))||'不明',
    bodyWeight:number(pick(cell,'h_weight')),
    cornerPositions:strip(pick(cell,'corner_list')).split(/[-→\s]+/).map(Number).filter(Number.isFinite),
    last3F:number(pick(cell,'f3')),
    historicalStatus:/除外/.test(place)?'excluded':/取消/.test(place)?'scratched':/中止/.test(place)?'dnf':'finished'
  };
}

export function parseJraRaceCard(html,expected={}){
  html=String(html||'');
  if(!/<\/html\s*>/i.test(html)||/このレースの出馬表の掲載は終了/.test(strip(html)))throw Error('JRA_PARSER_STRUCTURE_CHANGED');

  const header=html.match(/<div\b[^>]*class=["'][^"']*\brace_header\b[^"']*["'][^>]*>([\s\S]*?)<table\b/i)?.[1]||html;
  const dateText=strip(pick(header,'date'));
  const date=jpDate(dateText);
  const track=JRA_TRACKS.find(x=>dateText.includes(x))||'';
  const raceNo=number(strip(pick(header,'race_number')))||altNumber(pick(header,'race_number'));
  const course=strip(pick(header,'course'));
  const raceName=strip(pick(header,'race_name'));
  const timeMatch=strip(pick(header,'time')).match(/(\d{1,2})時(\d{2})分/);
  const postTime=timeMatch?`${timeMatch[1].padStart(2,'0')}:${timeMatch[2]}`:'';

  const surface=/ダ/.test(course)?'ダート':/芝/.test(course)?'芝':'';
  const distance=number(course);
  const direction=/左/.test(course)?'左':/右/.test(course)?'右':'';
  const courseType=/外/.test(course)?'外回り':/内/.test(course)?'内回り':'';

  if(!date||!track||!raceNo||!surface||!distance||!raceName)throw Error('JRA_PARSER_INCOMPLETE');
  if((expected.date&&date!==expected.date)||(expected.track&&track!==expected.track)||(expected.race&&raceNo!==Number(expected.race)))throw Error('JRA_RACE_MISMATCH');

  const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(x=>x[1]);
  const table=tables.find(x=>/前走/.test(strip(x))&&/馬番/.test(strip(x)));
  if(!table)throw Error('JRA_PARSER_STRUCTURE_CHANGED');

  const tbody=table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if(!tbody)throw Error('JRA_PARSER_STRUCTURE_CHANGED');

  const horses=[];
  for(const row of tbody.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)){
    const cells=[...row[2].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(x=>({attr:x[1],html:x[2]}));
    const by=cls=>cells.find(x=>new RegExp(`class=["'][^"']*\\b${cls}\\b`,'i').test(x.attr))?.html||'';
    const no=number(by('num'));
    if(!no)continue;

    const horseCell=by('horse'),jockeyCell=by('jockey');
    const horseName=strip(pick(horseCell,'name'));
    const frameNo=number(strip(by('waku')))||altNumber(by('waku'));
    const sexAge=strip(pick(jockeyCell,'age'));
    const weightCarried=number(pick(jockeyCell,'weight'));
    const jockey=strip(pick(jockeyCell,'jockey')).replace(/^[△▲☆]/,'').trim();
    const trainer=strip(pick(horseCell,'trainer')).replace(/\((美浦|栗東)\)$/,'').trim();

    const weightText=strip(pick(horseCell,'weight'));
    const bodyWeight=number(weightText);
    const transition=strip(pick(horseCell,'transition'));
    const bodyWeightChange=/初出走/.test(transition)?null:number(transition);

    const currentText=strip(row[2].replace(/<td\b[^>]*class=["'][^"']*\bpast\b[^"']*["'][^>]*>[\s\S]*?<\/td>/gi,''));
    const runningStatus=/出走取消|取消/.test(currentText)?'scratched':/競走除外|除外/.test(currentText)?'excluded':'active';
    const pastRuns=cells.filter(x=>/class=["'][^"']*\bpast\b/i.test(x.attr)).map(x=>parsePast(x.html)).filter(Boolean);

    horses.push({horseNo:no,frameNo,horseName,sexAge,weightCarried,jockey,trainer,bodyWeight,bodyWeightChange,runningStatus,pastRuns,odds:null,popularity:null});
  }

  const seen=new Set(),active=horses.filter(x=>x.runningStatus==='active');
  if(horses.length<2||horses.some(h=>!h.horseName||!h.weightCarried||!h.jockey||seen.has(h.horseNo)||(seen.add(h.horseNo),false)))throw Error('JRA_PARSER_INCOMPLETE');
  if(active.length<2)throw Error('JRA_PARSER_INCOMPLETE');

  const rate=key=>horses.filter(x=>x[key]!=null&&x[key]!=='').length/horses.length;
  const quality={
    raceParsed:true,
    horseCount:horses.length,
    activeHorseCount:active.length,
    horseNameRate:rate('horseName'),
    weightRate:rate('weightCarried'),
    jockeyRate:rate('jockey'),
    pastRunRate:horses.filter(x=>x.pastRuns.length).length/horses.length
  };

  return {
    race:{date,racecourse:track,raceNo,raceName,postTime,surface,distance,direction,courseType,raceClass:strip(pick(header,'class')),trackCondition:'不明',weather:'',pace:'標準'},
    horses,quality,source:'JRA_OFFICIAL',
    parserVersion:JRA_RACE_PARSER_VERSION,
    dataConfidence:quality.horseNameRate===1&&quality.weightRate===1&&quality.jockeyRate===1?'high':'low'
  };
}

async function readText(response,max=2097152){
  if(!response.ok)throw Error(response.status===404?'JRA_RACE_NOT_FOUND':'JRA_HTTP_ERROR');
  const reader=response.body.getReader(),parts=[];
  let size=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.length;
    if(size>max){reader.cancel();throw Error('JRA_PARSER_STRUCTURE_CHANGED');}
    parts.push(value);
  }
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  const hint=new TextDecoder().decode(bytes.slice(0,4096));
  return new TextDecoder(/shift[_-]?jis|sjis/i.test(response.headers.get('content-type')+' '+hint)?'shift-jis':'utf-8').decode(bytes);
}

function officialHeaders({form=false}={}){
  const headers={
    'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':'ja,en-US;q=0.7,en;q=0.5',
    'Cache-Control':'no-cache',
    'Referer':'https://www.jra.go.jp/'
  };
  if(form)headers['Content-Type']='application/x-www-form-urlencoded;charset=UTF-8';
  return headers;
}

async function fetchActionPage(fetchImpl,cname,signal){
  const response=await fetchImpl(`${JRA_DB_ORIGIN}${ACCESS_D_PATH}?CNAME=${cname}`,{
    method:'POST',
    headers:officialHeaders({form:true}),
    body:new URLSearchParams({cname}).toString(),
    signal,
    redirect:'error'
  });
  return readText(response);
}

async function fetchDirectCard(fetchImpl,sourceUrl,signal){
  const response=await fetchImpl(sourceUrl,{
    method:'GET',
    headers:officialHeaders(),
    signal,
    redirect:'error'
  });
  return readText(response);
}

export async function discoverRaceCardUrl(fetchImpl,context,signal){
  if(!validDate(context.date)||!TRACK_CODES[context.track]||!Number.isInteger(context.race)||context.race<1||context.race>12)throw Error('JRA_RACE_INVALID_INPUT');

  const queue=[{token:ENTRY_CNAME,depth:0}];
  const visited=new Set();
  let pages=0;

  while(queue.length&&pages<MAX_NAV_PAGES){
    const current=queue.shift();
    if(visited.has(current.token))continue;
    visited.add(current.token);

    const html=await fetchActionPage(fetchImpl,current.token,signal);
    pages++;

    try{
      return {
        sourceUrl:resolveRaceCardUrl(html,context),
        navigation:{version:JRA_NAVIGATION_VERSION,pagesVisited:pages,entry:'POST_FORM',resolvedAtDepth:current.depth}
      };
    }catch(error){
      if(error.message!=='JRA_RACE_NOT_FOUND')throw error;
    }

    if(current.depth>=MAX_NAV_DEPTH)continue;
    for(const token of candidateNavigationTokens(html,context,visited)){
      queue.push({token,depth:current.depth+1});
    }
  }

  throw Error('JRA_RACE_NOT_FOUND');
}

export function createJraRaceService({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=15000}={}){
  const cache=new Map(),pending=new Map();

  return async function handle(request,env={}){
    const u=new URL(request.url);
    const date=u.searchParams.get('date')||'';
    const track=u.searchParams.get('track')||'';
    const race=Number(u.searchParams.get('race'));

    const send=(body,status=200,cacheState='BYPASS')=>new Response(
      request.method==='HEAD'?null:JSON.stringify(body),
      {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-CHASS-JRA-Race-Cache':cacheState}}
    );

    if(!['GET','HEAD'].includes(request.method))return send({ok:false,error:'METHOD_NOT_ALLOWED'},405);
    if(!validDate(date)||!TRACK_CODES[track]||!Number.isInteger(race)||race<1||race>12)return send({ok:false,error:'JRA_RACE_INVALID_INPUT'},400);

  if(env?.DB){
    try{
      const cached=await readJraOfficialRaceCache(env,{date,track,race,nowMs:now()});
      if(cached)return send(cached.body,200,'D1-HIT');
    }catch(error){
      return send({ok:false,organization:'JRA',date,track,race,error:error?.code||'JRA_CACHE_READ_FAILED'},503,'D1-ERROR');
    }

    const allowDirect=env.ENABLE_JRA_DIRECT_FETCH===true||env.ENABLE_JRA_DIRECT_FETCH==='true';
    if(!allowDirect){
      return send({
        ok:false,
        organization:'JRA',
        date,track,race,
        status:'unknown',
        error:'JRA_CACHE_MISS',
        cacheProvider:'github_actions_d1',
        hint:'Run CHASS JRA Official Cache Refresh'
      },503,'D1-MISS');
    }
  }



    const key=`JRA:${date}:${track}:${race}`;
    const saved=cache.get(key);
    if(saved?.expires>now())return send(saved.body,saved.status,'HIT');

    const joined=pending.has(key);
    if(!joined){
      pending.set(key,(async()=>{
        const controller=new AbortController();
        let timer;
        try{
          const result=await Promise.race([
            (async()=>{
              const {sourceUrl,navigation}=await discoverRaceCardUrl(fetchImpl,{date,track,race},controller.signal);
              const html=await fetchDirectCard(fetchImpl,sourceUrl,controller.signal);
              const parsed=parseJraRaceCard(html,{date,track,race});
              return {
                body:{
                  ok:true,
                  organization:'JRA',
                  ...parsed,
                  sourceUrl,
                  fetchedAt:new Date(now()).toISOString(),
                  autoFetchEnabled:env.ENABLE_JRA_AUTO_FETCH===true||env.ENABLE_JRA_AUTO_FETCH==='true',
                  navigation
                },
                status:200
              };
            })(),
            new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('JRA_FETCH_TIMEOUT'));},timeoutMs);})
          ]);
          return result;
        }catch(error){
          const code=/^JRA_/.test(error.message)?error.message:'JRA_OFFICIAL_UNAVAILABLE';
          return {
            body:{
              ok:false,organization:'JRA',date,track,race,status:'unknown',error:code,
              parserVersion:JRA_RACE_PARSER_VERSION,navigationVersion:JRA_NAVIGATION_VERSION
            },
            status:code==='JRA_RACE_NOT_FOUND'?404:503
          };
        }finally{
          clearTimeout(timer);
        }
      })());
    }

    try{
      const result=await pending.get(key);
      const ttl=result.body.ok?(date<new Date(now()).toISOString().slice(0,10)?86400000:300000):60000;
      if(cache.size>=128)cache.delete(cache.keys().next().value);
      cache.set(key,{...result,expires:now()+ttl});
      return send(result.body,result.status,joined?'COALESCED':'MISS');
    }finally{
      pending.delete(key);
    }
  };
}

export const handleJraRaceRequest=createJraRaceService();
