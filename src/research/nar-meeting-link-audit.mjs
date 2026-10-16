import {validMirrorDate} from './nar-status-mirror-audit.mjs';

const routes={'/KeibaWeb/TodayRaceInfo/DebaTableSmall':'DEBA_TABLE_SMALL','/KeibaWeb/TodayRaceInfo/DebaTable':'DEBA_TABLE','/KeibaWeb/TodayRaceInfo/RaceMarkTable':'RACE_MARK_TABLE'};
const keys=['k_babaCode','k_raceDate','k_raceNo'];
const decode=value=>value.replaceAll('&amp;','&').replaceAll('&#38;','&');
const kind=value=>/^https:/i.test(value)?'HTTPS_ABSOLUTE':/^http:/i.test(value)?'HTTP_ABSOLUTE':/^javascript:/i.test(value)?'JAVASCRIPT':value.startsWith('//')?'PROTOCOL_RELATIVE':value.startsWith('/')?'ROOT_RELATIVE':/^[a-z][a-z0-9+.-]*:/i.test(value)?'OTHER_SCHEME':'PATH_RELATIVE';
function inspect(value,base,{date,code,race}){
  try{
    const u=new URL(decode(value),base),counts=Object.fromEntries(keys.map(k=>[k,u.searchParams.getAll(k).length]));
    const actualDate=u.searchParams.get('k_raceDate'),actualRace=u.searchParams.get('k_raceNo'),raceFormat=/^(0?[1-9]|1\d|20)$/.test(actualRace||'');
    const sample={hrefKind:kind(value),https:u.protocol==='https:',officialOrigin:u.origin==='https://www.keiba.go.jp',credentialsPresent:!!(u.username||u.password),
      route:routes[u.pathname]??'OTHER',pathShape:u.pathname.includes('/TodayRaceInfo/TodayRaceInfo/')?'DUPLICATED_TODAY_RACE_INFO':u.pathname.includes('%')?'PERCENT_ENCODED_PATH':'OTHER',identityParameterCounts:counts,
      codeMatched:u.searchParams.get('k_babaCode')===code,dateMatched:actualDate===date.replaceAll('-','/'),raceFormatValid:raceFormat,raceMatched:raceFormat&&Number(actualRace)===race,
      dateShape:actualDate===null?'MISSING':/^\d{4}\/\d{2}\/\d{2}$/.test(actualDate)?'PADDED_SLASH':/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(actualDate)?'NONPADDED_SLASH':/^\d{4}-\d{2}-\d{2}$/.test(actualDate)?'HYPHENS':/%2f/i.test(actualDate)?'STILL_PERCENT_ENCODED':'OTHER'};
    // Exact original Phase140.24 predicate; diagnostic hints never affect this.
    const reason=!sample.officialOrigin?'ORIGIN_NOT_ALLOWED':sample.credentialsPresent?'CREDENTIALS_PRESENT':sample.route==='OTHER'?'PATH_NOT_ALLOWED':
      keys.some(k=>counts[k]!==1)?'IDENTITY_PARAMETER_COUNT':!sample.codeMatched?'CODE_MISMATCH':!sample.dateMatched?'DATE_MISMATCH':!raceFormat?'RACE_FORMAT_INVALID':!sample.raceMatched?'RACE_MISMATCH':'MATCHED';
    return {...sample,reason};
  }catch{return {hrefKind:kind(value),reason:'URL_PARSE_FAILED',raceMatched:false,route:'OTHER'};}
}
const attribute=tag=>tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);

// Syntactic evidence, not a browser DOM parser and never a link follower.
export function auditNarMeetingLinks({html,date,code,race}={}){
  const flags={scope:'MEETING_LINK_SYNTAX_ONLY',acceptancePolicy:'UNCHANGED_PHASE14024',networkReads:0,productionSourceChanged:false,acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
  if(typeof html!=='string'||Buffer.byteLength(html,'utf8')>1000000||!validMirrorDate(date)||typeof code!=='string'||!/^\d{2}$/.test(code)||!Number.isInteger(race)||race<1||race>20)return {...flags,status:'HOLD',reasonCodes:['LINK_AUDIT_CONFIGURATION_INVALID'],matched:false};
  const base=`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=${code}&k_raceDate=${date.replaceAll('-','/')}`;
  const baseTags=[...html.matchAll(/<base\b[^>]*>/gi)],firstBase=baseTags[0]?attribute(baseTags[0][0]):null;
  let hintedBase=null;try{if(firstBase)hintedBase=new URL(decode(firstBase[1]??firstBase[2]??firstBase[3]),base).href;}catch{}
  const syntax={anchorTagCount:0,quotedAnchorHrefCount:0,unquotedAnchorHrefCount:0,anchorOnclickCount:0,hrefValueContainsOtherQuoteCount:0,baseTagCount:baseTags.length,firstBaseHintPresent:hintedBase!==null};
  for(const m of html.matchAll(/<a\b[^>]*>/gi)){
    syntax.anchorTagCount++;if(/\bonclick\s*=/i.test(m[0]))syntax.anchorOnclickCount++;
    const a=attribute(m[0]);if(!a)continue;if(a[3]!==undefined)syntax.unquotedAnchorHrefCount++;else syntax.quotedAnchorHrefCount++;
    if(/["']/.test(a[1]??a[2]??a[3]))syntax.hrefValueContainsOtherQuoteCount++;
  }
  const rejectionCounts={},hrefKindCounts={},selectedRaceSamples=[],otherCardSamples=[];let quotedHrefCount=0,matchedCount=0,firstBaseHintMatchCount=0;
  for(const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){
    quotedHrefCount++;const s=inspect(m[1],base,{date,code,race});
    hrefKindCounts[s.hrefKind]=(hrefKindCounts[s.hrefKind]||0)+1;rejectionCounts[s.reason]=(rejectionCounts[s.reason]||0)+1;
    if(s.reason==='MATCHED')matchedCount++;
    if(hintedBase&&inspect(m[1],hintedBase,{date,code,race}).reason==='MATCHED')firstBaseHintMatchCount++;
    if(s.raceMatched&&selectedRaceSamples.length<8)selectedRaceSamples.push(s);
    else if((s.route!=='OTHER'||/DebaTable|RaceMarkTable/.test(m[1]))&&otherCardSamples.length<4)otherCardSamples.push(s);
  }
  const matched=matchedCount>0;
  return {...flags,status:matched?'MATCHED':'HOLD',reasonCodes:matched?[]:['RACE_LINK_IDENTITY_INVALID'],matched,
    quotedHrefCount,matchedCount,rejectionCounts,hrefKindCounts,syntax,firstBaseHintMatchCount,
    hintBasis:'SYNTACTIC_FIRST_BASE_ONLY_NOT_USED_FOR_ACCEPTANCE',selectedRaceSamples,otherCardSamples,
    sampleLimit:12,samplesComplete:quotedHrefCount===selectedRaceSamples.length+otherCardSamples.length};
}
