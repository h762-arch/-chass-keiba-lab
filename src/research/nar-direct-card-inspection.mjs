import {createHash} from 'node:crypto';
import {buildNarRacePayloadStable} from '../../worker.js';
import {fetchNarPrecomputeHtml,assertNarAbilityCardIdentity} from '../prediction/nar-ability-precompute.mjs';
import {validMirrorDate} from './nar-status-mirror-audit.mjs';

const flags={scope:'DIRECT_CARD_INSPECTION_ONLY',researchOnly:true,formalKpiEligible:false,
  acquisitionCertified:false,currentStatusEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',
  executionBasis:'STANDALONE_FETCH_NOT_WORKER_REPLAY',productionSourceChanged:false,snapshotCreated:false,
  meetingVerified:false,meetingToCardStatus:'NOT_PERFORMED',collectionStatus:'NOT_EVALUATED',mirrorFreshness:'NOT_EVALUATED',
  diagnosisStatus:'NOT_ESTABLISHED',production404Cause:'NOT_ESTABLISHED',savedDataVerification:'NOT_PERFORMED'};
const tracks={'10':'盛岡','11':'水沢','18':'浦和','19':'船橋','20':'大井','21':'川崎','22':'金沢','23':'笠松','24':'名古屋','27':'園田','28':'姫路','31':'高知','32':'佐賀','36':'門別'};
const jstDate=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
const fail=reason=>{throw Error(reason);};
const runnerNo=h=>typeof h.horseNo==='number'?h.horseNo:typeof h.horseNo==='string'&&/^([1-9]|[12]\d|30)$/.test(h.horseNo)?Number(h.horseNo):NaN;

// Independent inspection: no meeting gate is satisfied, synthesized or replayed.
// Only a fixed card GET is permitted; no DB, collector, env or writer port.
export async function inspectNarDirectCard({date,code,race,fetchImpl=globalThis.fetch,wallNow=Date.now,timeoutMs=5000}={}){
  const requests=[];let card=null,previous;
  const result=(status,reasonCodes)=>({...flags,status,reasonCodes,requestCount:requests.length,requests,card});
  const clock=()=>{const n=wallNow();if(!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime())||(previous!==undefined&&n<previous))fail('INSPECTION_CLOCK_INVALID');previous=n;return n;};
  try{
    if(!validMirrorDate(date)||typeof code!=='string'||!tracks[code]||!Number.isInteger(race)||race<1||race>20||typeof fetchImpl!=='function'||typeof wallNow!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)return result('HOLD',['INSPECTION_CONFIGURATION_INVALID']);
    const started=clock();if(jstDate(started)!==date)return result('HOLD',['CURRENT_JST_DATE_REQUIRED']);
    const track=tracks[code],url=`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=${code}&k_raceDate=${date.replaceAll('-','/')}&k_raceNo=${race}`;
    const attempted=clock();if(jstDate(attempted)!==date)fail('REQUEST_DATE_CHANGED');
    const record={route:'DebaTableSmall_raw_slash_direct',sourceUrl:url,attemptedAt:new Date(attempted).toISOString(),timeoutMs,maxResponseBytes:1000000,status:'STARTED'};requests.push(record);
    let html;
    try{
      html=await fetchNarPrecomputeHtml(url,{timeoutMs,fetchImpl:async(input,init)=>{
        if(input!==url)fail('UNEXPECTED_FETCH');
        const response=await fetchImpl(input,{...init,method:'GET',credentials:'omit'});
        if(init.signal.aborted){void response?.body?.cancel().catch(()=>{});fail('SOURCE_DEADLINE');}
        record.httpStatus=Number.isInteger(response?.status)?response.status:null;
        if(response?.status===200&&!response.redirected&&!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){
          void response.body?.cancel().catch(()=>{});fail('SOURCE_CONTENT_TYPE');
        }
        return response;
      }});
    }catch(e){record.status='FAILED';throw e;}
    let captured;try{captured=clock();}catch(e){record.status='FAILED';throw e;}
    Object.assign(record,{status:'CAPTURED',finishedAt:new Date(captured).toISOString(),fingerprintBasis:'DECODED_HTML_UTF8_REENCODED',
      decodedUtf8Bytes:Buffer.byteLength(html,'utf8'),decodedHtmlSha256:createHash('sha256').update(html,'utf8').digest('hex')});
    if(jstDate(captured)!==date)fail('REQUEST_DATE_CHANGED');
    try{assertNarAbilityCardIdentity(html,{date,track,race});}catch{fail('CARD_IDENTITY_INVALID');}
    const p=await buildNarRacePayloadStable({code,date,race,urls:{detail:url,card:'OPTIONAL_DISABLED',odds:'OPTIONAL_DISABLED'},fetcher:async input=>{
      if(input!==url)fail('OPTIONAL_FETCH_DISABLED');return html;
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
    return {...result('DIRECT_CARD_PARSE_OBSERVED',[]),inspectedAt:new Date(finished).toISOString()};
  }catch(e){
    const known=['INSPECTION_CLOCK_INVALID','REQUEST_DATE_CHANGED','SOURCE_URL','SOURCE_DEADLINE','SOURCE_HTTP','SOURCE_SIZE','SOURCE_DECODE','SOURCE_CONTENT_TYPE','UNEXPECTED_FETCH','CARD_IDENTITY_INVALID','PARSED_CARD_IDENTITY_INVALID','CARD_CONTEXT_INVALID','FIELD_INVALID','UNEXPECTED_MARKET_DATA','POST_TIME_REACHED','ABILITY_INSUFFICIENT'];
    return result('HOLD',[known.includes(e?.message)?e.message:'CARD_READ_UNAVAILABLE']);
  }
}
