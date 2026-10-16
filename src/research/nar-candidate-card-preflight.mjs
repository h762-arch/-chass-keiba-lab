import {createHash} from 'node:crypto';
import {parseNarRaceList} from '../../meeting-discovery.mjs';
import {buildNarRacePayloadStable} from '../../worker.js';
import {fetchNarPrecomputeHtml,assertNarAbilityCardIdentity} from '../prediction/nar-ability-precompute.mjs';
import {validMirrorDate} from './nar-status-mirror-audit.mjs';
import {auditNarMeetingLinks} from './nar-meeting-link-audit.mjs';

const flags={scope:'CANDIDATE_MEETING_TO_CARD_READ_ONLY',researchOnly:true,formalKpiEligible:false,
  acquisitionCertified:false,currentStatusEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',
  executionBasis:'STANDALONE_FETCH_NOT_WORKER_REPLAY',productionSourceChanged:false,snapshotCreated:false,
  collectionStatus:'NOT_EVALUATED',mirrorFreshness:'NOT_EVALUATED',diagnosisStatus:'NOT_ESTABLISHED'};
const tracks={'10':'盛岡','11':'水沢','18':'浦和','19':'船橋','20':'大井','21':'川崎','22':'金沢','23':'笠松','24':'名古屋','27':'園田','28':'姫路','31':'高知','32':'佐賀','36':'門別'};
const jstDate=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
const fail=reason=>{throw Error(reason);};
const fingerprint=text=>({fingerprintBasis:'DECODED_HTML_UTF8_REENCODED',decodedUtf8Bytes:Buffer.byteLength(text,'utf8'),decodedHtmlSha256:createHash('sha256').update(text,'utf8').digest('hex')});
const runnerNo=h=>typeof h.horseNo==='number'?h.horseNo:typeof h.horseNo==='string'&&/^([1-9]|[12]\d|30)$/.test(h.horseNo)?Number(h.horseNo):NaN;

// A new direct public-page inspection, never a refresh of an existing mirror.
// Uses the unchanged bounded HTTP reader and parser. No DB or env port exists.
export async function preflightNarCandidateCard({date,code,race,fetchImpl=globalThis.fetch,wallNow=Date.now,perRequestTimeoutMs=5000}={}){
  const requests=[];let meeting=null,card=null,previous;
  const hold=reason=>({...flags,status:'HOLD',reasonCodes:[reason],requestCount:requests.length,requests,meeting,card});
  const clock=()=>{const n=wallNow();if(!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime())||(previous!==undefined&&n<previous))fail('PREFLIGHT_CLOCK_INVALID');previous=n;return n;};
  try{
    if(!validMirrorDate(date)||typeof code!=='string'||!tracks[code]||!Number.isInteger(race)||race<1||race>20||typeof fetchImpl!=='function'||typeof wallNow!=='function'||!Number.isInteger(perRequestTimeoutMs)||perRequestTimeoutMs<1||perRequestTimeoutMs>5000)return hold('PREFLIGHT_CONFIGURATION_INVALID');
    const started=clock();if(jstDate(started)!==date)return hold('CURRENT_JST_DATE_REQUIRED');
    const track=tracks[code],query=`k_babaCode=${code}&k_raceDate=${date.replaceAll('-','/')}`;
    const meetingUrl=`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?${query}`;
    const cardUrl=`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?${query}&k_raceNo=${race}`;
    const read=async(url,route)=>{
      const attempted=clock();if(jstDate(attempted)!==date)fail('REQUEST_DATE_CHANGED');
      const record={route,sourceUrl:url,attemptedAt:new Date(attempted).toISOString(),timeoutMs:perRequestTimeoutMs,maxResponseBytes:1000000,status:'STARTED'};requests.push(record);
      let text;
      try{
        text=await fetchNarPrecomputeHtml(url,{timeoutMs:perRequestTimeoutMs,fetchImpl:async(input,init)=>{
          if(input!==url)fail('UNEXPECTED_FETCH');
          const r=await fetchImpl(input,{...init,method:'GET',credentials:'omit'});
          if(init.signal.aborted){void r?.body?.cancel().catch(()=>{});fail('SOURCE_DEADLINE');}
          record.httpStatus=Number.isInteger(r?.status)?r.status:null;
          if(r?.status===200&&!r.redirected&&!/^text\/html(?:\s*;|$)/i.test(r.headers.get('content-type')||'')){
            void r.body?.cancel().catch(()=>{});fail('SOURCE_CONTENT_TYPE');
          }
          return r;
        }});
      }catch(e){record.status='FAILED';throw e;}
      let finished;try{finished=clock();}catch(e){record.status='FAILED';throw e;}
      Object.assign(record,{status:'CAPTURED',finishedAt:new Date(finished).toISOString(),...fingerprint(text)});
      if(jstDate(finished)!==date)fail('REQUEST_DATE_CHANGED');
      return text;
    };
    const meetingHtml=await read(meetingUrl,'RaceList_raw_slash_candidate');
    const parsed=parseNarRaceList(meetingHtml,{track,date});
    if(parsed.status!=='meeting'||parsed.track!==track||parsed.date!==date||!Array.isArray(parsed.raceNumbers)||!parsed.raceNumbers.length||parsed.raceNumbers.length>20||parsed.raceNumbers.some(n=>!Number.isInteger(n)||n<1||n>20)||new Set(parsed.raceNumbers).size!==parsed.raceNumbers.length)fail('MEETING_NOT_CONFIRMED');
    meeting={date,code,track,raceNumbers:[...parsed.raceNumbers]};
    if(!parsed.raceNumbers.includes(race))fail('RACE_NOT_IN_MEETING');
    meeting.selectedRaceLinkAudit=auditNarMeetingLinks({html:meetingHtml,date,code,race});
    if(!meeting.selectedRaceLinkAudit.matched)fail('RACE_LINK_IDENTITY_INVALID');
    meeting.selectedRaceLinkMatched=true;
    const cardHtml=await read(cardUrl,'DebaTableSmall_raw_slash_candidate');
    try{assertNarAbilityCardIdentity(cardHtml,{date,track,race});}catch{fail('CARD_IDENTITY_INVALID');}
    const p=await buildNarRacePayloadStable({code,date,race,urls:{detail:cardUrl,card:'OPTIONAL_DISABLED',odds:'OPTIONAL_DISABLED'},fetcher:async url=>{
      if(url!==cardUrl)fail('OPTIONAL_FETCH_DISABLED');return cardHtml;
    }});
    if(p.ok!==true||p.organization!=='NAR'||p.date!==date||p.track!==track||p.code!==code||p.race!==race||p.historicalResearch||p.resultSnapshot||p.finishOrder?.length)fail('PARSED_CARD_IDENTITY_INVALID');
    if(!['ダート','芝'].includes(p.surface)||!Number.isInteger(p.distance)||p.distance<800||p.distance>3600||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.postTime||''))fail('CARD_CONTEXT_INVALID');
    if(!Array.isArray(p.horses)||p.horses.length<2||p.horses.length>30||new Set(p.horses.map(runnerNo)).size!==p.horses.length||p.horses.some(h=>!Number.isInteger(runnerNo(h))||runnerNo(h)<1||runnerNo(h)>30||typeof h.horseName!=='string'||!h.horseName.trim()||h.horseName.length>80)||p.quality?.invalidHorseNames!==0)fail('FIELD_INVALID');
    if(!Array.isArray(p.odds)||p.odds.length||p.horses.some(h=>h.odds!=null))fail('UNEXPECTED_MARKET_DATA');
    const active=p.horses.filter(h=>!['scratched','excluded','withdrawn'].includes(h.horseStatus||h.runnerStatus));
    const finished=clock();if(jstDate(finished)!==date)fail('REQUEST_DATE_CHANGED');
    card={date,code,track,race,postTime:p.postTime,surface:p.surface,distance:p.distance,horseCount:p.horses.length,activeHorseCount:active.length,
      activeFiniteAbilityCount:active.filter(h=>Number.isFinite(h.abilityScore)).length,activeTimePresentCount:active.filter(h=>!!h.predictedTime).length,
      optionalNetworkReads:'NOT_PERFORMED',identityStatus:'MATCHED',parserBasis:'EXISTING_BUILD_NAR_RACE_PAYLOAD_STABLE'};
    if(finished>=Date.parse(`${date}T${p.postTime}:00+09:00`))fail('POST_TIME_REACHED');
    if(card.activeFiniteAbilityCount<2)fail('ABILITY_INSUFFICIENT');
    return {...flags,status:'CANDIDATE_CARD_OBSERVED',reasonCodes:[],requestCount:requests.length,requests,meeting,card,
      inspectedAt:new Date(finished).toISOString(),production404Cause:'NOT_ESTABLISHED',savedDataVerification:'NOT_PERFORMED'};
  }catch(e){
    const known=['PREFLIGHT_CLOCK_INVALID','CURRENT_JST_DATE_REQUIRED','REQUEST_DATE_CHANGED','SOURCE_URL','SOURCE_DEADLINE','SOURCE_HTTP','SOURCE_SIZE','SOURCE_DECODE','SOURCE_CONTENT_TYPE','UNEXPECTED_FETCH','MEETING_NOT_CONFIRMED','RACE_NOT_IN_MEETING','RACE_LINK_IDENTITY_INVALID','CARD_IDENTITY_INVALID','PARSED_CARD_IDENTITY_INVALID','CARD_CONTEXT_INVALID','FIELD_INVALID','UNEXPECTED_MARKET_DATA','POST_TIME_REACHED','ABILITY_INSUFFICIENT'];
    return hold(known.includes(e?.message)?e.message:'CANDIDATE_READ_UNAVAILABLE');
  }
}
