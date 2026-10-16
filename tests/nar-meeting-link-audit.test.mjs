import test from 'node:test';
import assert from 'node:assert/strict';
import {auditNarMeetingLinks as audit} from '../src/research/nar-meeting-link-audit.mjs';
import {preflightNarCandidateCard as preflight} from '../src/research/nar-candidate-card-preflight.mjs';
import {runNarReadOnlySourceProbe as run} from '../scripts/run-nar-readonly-source-probe.mjs';
import {versionedSaveFixture} from './fixtures/nar/phase1409-versioned-save-fixtures.mjs';
import {extractNarUnquotedAnchorHrefs as extract} from '../src/research/nar-unquoted-anchor-hrefs.mjs';
const date='2026-10-16',code='21',race=1,now=Date.parse('2026-10-15T22:00:00.000Z');
const query='k_babaCode=21&k_raceDate=2026/10/16&k_raceNo=1';
const link=`/KeibaWeb/TodayRaceInfo/DebaTable?${query}`;
const anchor=value=>`<a href="${value}">1R</a>`;
const check=html=>audit({html,date,code,race});
const page=url=>{const u=new URL(url);u.searchParams.set('k_babaCode','22');return versionedSaveFixture(u.toString()).replaceAll('金沢','川崎').replaceAll('k_babaCode=22','k_babaCode=21');};
const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
const options=()=>({date,code,race,wallNow:()=>now,fetchImpl:async url=>html(page(url))});

test('existing allowed official routes and absolute, root, sibling or protocol-relative hrefs still match',()=>{
 for(const path of ['DebaTable','DebaTableSmall','RaceMarkTable'])for(const prefix of ['https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/','//www.keiba.go.jp/KeibaWeb/TodayRaceInfo/','/KeibaWeb/TodayRaceInfo/','']){
  const r=check(anchor(prefix+path+'?'+query));assert.equal(r.matched,true);assert.equal(r.matchedCount,1);assert.equal(r.selectedRaceSamples[0].reason,'MATCHED');
 }
});
test('ampersand entity variants and encoded slashes retain the exact old acceptance',()=>{
 for(const value of [query.replaceAll('&','&amp;'),query.replaceAll('&','&#38;'),query.replaceAll('/','%2F')])assert.equal(check(anchor('/KeibaWeb/TodayRaceInfo/DebaTable?'+value)).matched,true);
});
test('duplicate or missing identity parameters stay rejected with bounded count evidence',()=>{
 for(const value of [link+'&k_babaCode=21',link+'&k_raceDate=2026/10/16',link+'&k_raceNo=1',link.replace('&k_raceNo=1','')]){
  const r=check(anchor(value));assert.equal(r.matched,false);assert.equal(r.rejectionCounts.IDENTITY_PARAMETER_COUNT,1);
 }
});
test('wrong date, code and race show distinct decisions without emitting actual values',()=>{
 for(const [value,reason] of [[link.replace('2026/10/16','2026/10/15'),'DATE_MISMATCH'],[link.replace('k_babaCode=21','k_babaCode=23'),'CODE_MISMATCH'],[link.replace('k_raceNo=1','k_raceNo=2'),'RACE_MISMATCH']]){
  const r=check(anchor(value));assert.equal(r.matched,false);assert.equal(r.rejectionCounts[reason],1);assert.equal(JSON.stringify(r).includes('2026/10/15'),false);
 }
});
test('HTTP, foreign origin, credentials and unsupported paths remain rejected',()=>{
 for(const [value,reason] of [['http://www.keiba.go.jp'+link,'ORIGIN_NOT_ALLOWED'],['https://example.invalid'+link,'ORIGIN_NOT_ALLOWED'],['https://PRIVATE_SECRET:PRIVATE_SECRET@www.keiba.go.jp'+link,'CREDENTIALS_PRESENT'],[link.replace('/DebaTable?','/PRIVATE_SECRET?'),'PATH_NOT_ALLOWED']]){
  const r=check(anchor(value));assert.equal(r.matched,false);assert.equal(r.rejectionCounts[reason],1);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('synthetic base-context mismatch is visible but cannot silently change the acceptance base',()=>{
 const r=check('<base href="/KeibaWeb/">'+anchor('TodayRaceInfo/DebaTable?'+query));
 assert.equal(r.matched,false);assert.equal(r.firstBaseHintMatchCount,1);assert.equal(r.syntax.baseTagCount,1);
 assert.equal(r.selectedRaceSamples[0].pathShape,'DUPLICATED_TODAY_RACE_INFO');assert.equal(r.selectedRaceSamples[0].reason,'PATH_NOT_ALLOWED');assert.equal(r.hintBasis,'SYNTACTIC_FIRST_BASE_ONLY_NOT_USED_FOR_ACCEPTANCE');
});
test('foreign base hints never override an otherwise valid original link',()=>{
 const r=check('<base href="https://example.invalid/PRIVATE_SECRET/">'+anchor(link));assert.equal(r.matched,true);assert.equal(r.firstBaseHintMatchCount,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('first-base hints are explicitly syntactic when multiple or malformed tags exist',()=>{
 const r=check('<base href="https://[PRIVATE_SECRET"><base href="/KeibaWeb/">'+anchor(link));assert.equal(r.matched,true);assert.equal(r.syntax.baseTagCount,2);assert.equal(r.syntax.firstBaseHintPresent,false);
});
test('unquoted anchors are validated separately while the legacy quoted scanner stays unchanged',()=>{
 const r=check(`<a href=${link}>1R</a>`);assert.equal(r.syntax.unquotedAnchorHrefCount,1);assert.equal(r.quotedHrefCount,0);assert.equal(r.matched,true);assert.equal(r.unquotedMatchedCount,1);assert.equal(r.quotedMatchedCount,0);
});
test('JavaScript and onclick structure is classified without execution or text leakage',()=>{
 const r=check(`<a href="javascript:open('PRIVATE_SECRET')" onclick="PRIVATE_SECRET()">1R</a>`);
 assert.equal(r.matched,false);assert.equal(r.hrefKindCounts.JAVASCRIPT,1);assert.equal(r.syntax.anchorOnclickCount,1);assert.equal(r.syntax.hrefValueContainsOtherQuoteCount,1);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('encoded-twice or nonpadded and hyphenated dates do not bypass exact identity',()=>{
 for(const [value,shape] of [['2026%252F10%252F16','STILL_PERCENT_ENCODED'],['2026/1/16','NONPADDED_SLASH'],['2026-10-16','HYPHENS']]){
  const r=check(anchor(link.replace('2026/10/16',value)));assert.equal(r.matched,false);assert.equal(r.selectedRaceSamples[0].dateShape,shape);assert.equal(r.rejectionCounts.DATE_MISMATCH,1);
 }
});
test('canonical race 1 and 01 remain valid while other normalizations are rejected',()=>{
 assert.equal(check(anchor(link.replace('k_raceNo=1','k_raceNo=01'))).matched,true);
 for(const value of ['001','1.0','+1','1x','21'])assert.equal(check(anchor(link.replace('k_raceNo=1','k_raceNo='+value))).matched,false);
});
test('single quotes and case-insensitive HREF spelling retain previous behavior',()=>{
 const r=check(`<A HREF='${link}'>1R</A>`);assert.equal(r.matched,true);assert.equal(r.syntax.quotedAnchorHrefCount,1);
});
test('missing and unparseable links retain meaningful count-only evidence',()=>{
 const empty=check('<h1>PRIVATE_SECRET</h1>');assert.equal(empty.matched,false);assert.equal(empty.quotedHrefCount,0);
 const bad=check(anchor('https://[PRIVATE_SECRET'));assert.equal(bad.rejectionCounts.URL_PARSE_FAILED,1);assert.equal(JSON.stringify(bad).includes('PRIVATE_SECRET'),false);
});
test('the original uppercase amp entity mismatch is observable without newly decoding it',()=>{
 const r=check(anchor(link.replaceAll('&','&AMP;')));assert.equal(r.matched,false);assert.equal(r.rejectionCounts.IDENTITY_PARAMETER_COUNT,1);
});
test('samples are capped while acceptance and aggregate counts scan all links',()=>{
 const r=check(Array.from({length:100},()=>anchor(link.replace('k_raceNo=1','k_raceNo=2'))).join('')+anchor(link));
 assert.equal(r.matched,true);assert.equal(r.quotedHrefCount,101);assert.equal(r.rejectionCounts.RACE_MISMATCH,100);assert.equal(r.matchedCount,1);
 assert.ok(r.selectedRaceSamples.length+r.otherCardSamples.length<=12);assert.equal(r.samplesComplete,false);
});
test('pure audit performs no network and retains all governance flags',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('FETCH_FORBIDDEN');});const r=check(anchor(link));assert.equal(r.networkReads,0);assert.equal(r.productionSourceChanged,false);assert.equal(r.acquisitionCertified,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.identityPolicy,'UNCHANGED_PHASE14024');
});
test('invalid config and oversized HTML are rejected without normalization or secret output',()=>{
 for(const patch of [{html:null},{html:' '.repeat(1000001)},{date:'2026-02-30'},{code:21},{code:Symbol('PRIVATE_SECRET')},{race:0},{race:'1'}]){
  const r=audit({html:anchor(link),date,code,race,...patch});assert.equal(r.matched,false);assert.deepEqual(r.reasonCodes,['LINK_AUDIT_CONFIGURATION_INVALID']);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('preflight retains the new link evidence on HOLD without making a card GET',async()=>{
 let calls=0;const r=await preflight({...options(),fetchImpl:async url=>{calls++;return html(page(url).replaceAll('k_babaCode=21','k_babaCode=23'));}});
 assert.deepEqual(r.reasonCodes,['RACE_LINK_IDENTITY_INVALID']);assert.equal(calls,1);assert.equal(r.meeting.selectedRaceLinkAudit.matched,false);assert.equal(r.meeting.selectedRaceLinkAudit.rejectionCounts.CODE_MISMATCH,1);assert.equal(r.card,null);
});
test('unchanged successful preflight still derives its own card URL and performs two GETs',async()=>{
 const calls=[];const r=await preflight({...options(),fetchImpl:async url=>{calls.push(url);return html(page(url));}});
 assert.equal(r.status,'CANDIDATE_CARD_OBSERVED');assert.equal(r.meeting.selectedRaceLinkMatched,true);assert.equal(r.meeting.selectedRaceLinkAudit.matched,true);assert.equal(calls.length,2);assert.ok(calls[1].includes('/DebaTableSmall?'));
});
test('registered runner exposes link evidence without changing its direct-only outcome or GET budget',async()=>{
 let calls=0;const r=await run(['--date',date,'--code',code,'--race','1'],{wallNow:()=>now,fetchImpl:async url=>{calls++;return html(url.includes('/RaceList?')?page(url).replaceAll('k_babaCode=21','k_babaCode=23'):page(url));}});
 assert.equal(r.status,'DIRECT_CARD_ONLY_OBSERVED');assert.equal(r.preflight.meeting.selectedRaceLinkAudit.rejectionCounts.CODE_MISMATCH,1);assert.equal(calls,2);assert.equal(r.requestCount,2);assert.equal(r.directCard.status,'DIRECT_CARD_PARSE_OBSERVED');
});
test('wrong meeting identity and transport failures do not fabricate link diagnostics',async()=>{
 for(const fetchImpl of [async()=>new Response('',{status:404}),async url=>html(page(url).replaceAll('川崎','名古屋'))]){
  const r=await preflight({...options(),fetchImpl});assert.equal(r.status,'HOLD');assert.equal(r.meeting,null);assert.equal(r.requestCount,1);
 }
});

test('unquoted query equals signs are preserved through every identity parameter',()=>{
 assert.deepEqual(extract(`<a href=${link}>1R</a>`).hrefs,[link]);const r=check(`<a href=${link}>1R</a>`);
 assert.equal(r.unquotedHrefCount,1);assert.equal(r.unquotedMatchedCount,1);assert.equal(r.selectedRaceSamples[0].attributeForm,'UNQUOTED_ANCHOR');assert.equal(r.identityPolicy,'UNCHANGED_PHASE14024');
});
test('other attributes and href-looking quoted title text cannot masquerade as the href attribute',()=>{
 const s=`<a class=card title="href=${link}" data-href=${link} href=${link} target=_blank>1R</a>`;
 assert.deepEqual(extract(s).hrefs,[link]);assert.deepEqual(extract(`<a title="href=${link}" data-href=${link}>1R</a>`).hrefs,[]);
});
test('ASCII whitespace and uppercase anchor attributes are accepted without trimming a different identity',()=>{
 for(const ws of [' ','\n','\t','\r\n','\f'])assert.equal(check(`<A${ws}HREF${ws}=${ws}${link}${ws}target=_blank>1R</A>`).unquotedMatchedCount,1);
});
test('ambiguous quote, backtick, control or less-than unquoted values are rejected',()=>{
 for(const char of ['"',"'",'`','\u0000','\u0001','<'])assert.deepEqual(extract(`<a href=${link}${char}PRIVATE_SECRET>1R</a>`).hrefs,[]);
});
test('duplicate href attributes reject the new extension even if one value is otherwise valid',()=>{
 for(const s of [`<a href=${link} href=${link}>1R</a>`,`<a HREF=${link} href=PRIVATE_SECRET>1R</a>`,`<a href=PRIVATE_SECRET HREF='${link}'>1R</a>`]){
  assert.deepEqual(extract(s).hrefs,[]);assert.equal(extract(s).rejectedAnchorCount,1);
 }
});
test('unquoted anchor text inside comments and raw-text elements is never added to acceptance',()=>{
 const a=`<a href=${link}>1R</a>`;assert.equal(check(`<!--${a}-->`).matched,false);
 for(const tag of ['script','style','textarea','title','xmp','iframe','noembed','noframes','noscript'])assert.equal(check(`<${tag}>${a}</${tag}>`).matched,false);
});
test('nested templates and foreign namespaces are excluded from the narrow unquoted extension',()=>{
 const a=`<a href=${link}>1R</a>`;
 for(const s of [`<template><template>${a}</template>${a}</template>`,`<svg>${a}</svg>`,`<math>${a}</math>`])assert.equal(check(s).matched,false);
});
test('non-anchor href and data-href attributes cannot create unquoted matches',()=>{
 for(const s of [`<link href=${link}>`,`<div href=${link}>`,`<a data-href=${link}>1R</a>`,`<area href=${link}>`])assert.equal(check(s).unquotedMatchedCount,0);
});
test('self-closing foreign containers do not consume later independent HTML anchors',()=>{
 for(const tag of ['svg','math'])assert.equal(check(`<${tag} />`+`<a href=${link}>1R</a>`).unquotedMatchedCount,1);
});
test('unterminated anchors, comments, raw-text and plaintext contexts fail closed',()=>{
 for(const s of [`<a href=${link}`,`<!--<a href=${link}>`,`<script><a href=${link}>`,`<plaintext><a href=${link}>`])assert.equal(check(s).unquotedMatchedCount,0);
});
test('the same scheme, origin, credentials, route and identity gates reject unquoted bad URLs',()=>{
 for(const value of ['http://www.keiba.go.jp'+link,'https://example.invalid'+link,'https://PRIVATE_SECRET@www.keiba.go.jp'+link,link.replace('/DebaTable?','/Other?'),link.replace('k_babaCode=21','k_babaCode=23'),link.replace('2026/10/16','2026/10/15'),link.replace('k_raceNo=1','k_raceNo=2')]){
  const r=check(`<a href=${value}>1R</a>`);assert.equal(r.matched,false);assert.equal(r.unquotedMatchedCount,0);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
 }
});
test('duplicate and missing unquoted query identities cannot pass the extension',()=>{
 for(const value of [link+'&k_babaCode=21',link+'&k_raceDate=2026/10/16',link+'&k_raceNo=1',link.replace('&k_raceNo=1','')]){
  const r=check(`<a href=${value}>1R</a>`);assert.equal(r.matched,false);assert.equal(r.unquotedRejectionCounts.IDENTITY_PARAMETER_COUNT,1);
 }
});
test('unquoted date and race spellings do not get new identity normalization',()=>{
 assert.equal(check(`<a href=${link.replace('k_raceNo=1','k_raceNo=01')}>1R</a>`).matched,true);
 for(const value of [link.replace('k_raceNo=1','k_raceNo=001'),link.replace('k_raceNo=1','k_raceNo=1.0'),link.replace('2026/10/16','2026-10-16'),link.replace('2026/10/16','2026%252F10%252F16')])assert.equal(check(`<a href=${value}>1R</a>`).matched,false);
});
test('old supported ampersand entities and percent-decoded slash dates also work unquoted',()=>{
 for(const value of [link.replaceAll('&','&amp;'),link.replaceAll('&','&#38;'),link.replaceAll('/','%2F').replace('%2FKeibaWeb%2FTodayRaceInfo%2FDebaTable','/KeibaWeb/TodayRaceInfo/DebaTable')])assert.equal(check(`<a href=${value}>1R</a>`).matched,true);
});
test('base hints still cannot authorize the new unquoted form with a wrong resolved path',()=>{
 const r=check('<base href="/KeibaWeb/"><a href=TodayRaceInfo/DebaTable?'+query+'>1R</a>');assert.equal(r.matched,false);assert.equal(r.unquotedRejectionCounts.PATH_NOT_ALLOWED,1);
});
test('unquoted acceptance scans beyond sample limits and reports quote forms separately',()=>{
 const r=check(Array.from({length:100},()=>`<a href=${link.replace('k_raceNo=1','k_raceNo=2')}>2R</a>`).join('')+`<a href=${link}>1R</a>`);
 assert.equal(r.matched,true);assert.equal(r.quotedHrefCount,0);assert.equal(r.unquotedHrefCount,101);assert.equal(r.unquotedMatchedCount,1);assert.equal(r.unquotedRejectionCounts.RACE_MISMATCH,100);assert.ok(r.selectedRaceSamples.length+r.otherCardSamples.length<=12);
});
test('extracting unquoted hrefs and auditing them adds zero external requests',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('FETCH_FORBIDDEN');});assert.deepEqual(extract(`<a href=${link}>1R</a>`).hrefs,[link]);assert.equal(check(`<a href=${link}>1R</a>`).networkReads,0);
});
test('an actual-parser preflight with an unquoted meeting link now reaches its fixed card GET',async()=>{
 const calls=[];const r=await preflight({...options(),fetchImpl:async url=>{calls.push(url);return html(url.includes('/RaceList?')?page(url).replace(/href="([^"]+)"/g,'href=$1'):page(url));}});
 assert.equal(r.status,'CANDIDATE_CARD_OBSERVED');assert.equal(r.meeting.selectedRaceLinkAudit.unquotedMatchedCount,1);assert.equal(r.meeting.selectedRaceLinkAudit.quotedMatchedCount,0);assert.equal(calls.length,2);
 assert.equal(calls[1],'https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=21&k_raceDate=2026/10/16&k_raceNo=1');
});
test('unquoted wrong identity stops before the card GET and retains sanitized evidence',async()=>{
 let calls=0;const r=await preflight({...options(),fetchImpl:async url=>{calls++;return html(page(url).replace(/href="([^"]+)"/g,'href=$1').replaceAll('k_babaCode=21','k_babaCode=23'));}});
 assert.deepEqual(r.reasonCodes,['RACE_LINK_IDENTITY_INVALID']);assert.equal(calls,1);assert.equal(r.meeting.selectedRaceLinkAudit.unquotedRejectionCounts.CODE_MISMATCH,1);
});
test('registered runner stops at successful unquoted meeting-to-card without a redundant direct GET',async()=>{
 let calls=0;const r=await run(['--date',date,'--code',code,'--race','1'],{wallNow:()=>now,fetchImpl:async url=>{calls++;return html(url.includes('/RaceList?')?page(url).replace(/href="([^"]+)"/g,'href=$1'):page(url));}});
 assert.equal(r.status,'MEETING_TO_CARD_OBSERVED');assert.equal(r.requestCount,2);assert.equal(calls,2);assert.equal(r.directCard,null);assert.equal(r.acquisitionCertified,false);assert.equal(r.productionActivationDecision,'NO-GO');
});
test('registered runner preserves independent direct-only diagnosis for bad unquoted identities',async()=>{
 let calls=0;const r=await run(['--date',date,'--code',code,'--race','1'],{wallNow:()=>now,fetchImpl:async url=>{calls++;return html(url.includes('/RaceList?')?page(url).replace(/href="([^"]+)"/g,'href=$1').replaceAll('k_babaCode=21','k_babaCode=23'):page(url));}});
 assert.equal(r.status,'DIRECT_CARD_ONLY_OBSERVED');assert.equal(calls,2);assert.equal(r.preflight.meeting.selectedRaceLinkAudit.unquotedMatchedCount,0);assert.equal(r.directCard.status,'DIRECT_CARD_PARSE_OBSERVED');
});
test('unquoted evidence emits no raw links, arbitrary query data or prediction text',()=>{
 const r=check(`<a title=PRIVATE_SECRET href=${link}&extra=PRIVATE_SECRET>PRIVATE_SECRET</a>`);assert.equal(r.matched,true);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);assert.equal(JSON.stringify(r).includes(link),false);
});
test('extractor rejects invalid input and oversized bodies without network or normalization',()=>{
 for(const value of [null,123,' '.repeat(1000001)])assert.deepEqual(extract(value),{hrefs:[],anchorCount:0,rejectedAnchorCount:0});
});
test('declarations and malformed attribute boundaries cannot inject new unquoted anchors',()=>{
 const a=`<a href=${link}>1R</a>`;
 assert.equal(check(`<!DOCTYPE html PUBLIC '${a}'>`).unquotedMatchedCount,0);
 assert.equal(check(`<?xml data='${a}'>`).unquotedMatchedCount,0);
 assert.equal(check(`<a title="x"href=${link}>1R</a>`).unquotedMatchedCount,0);
});
