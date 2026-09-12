import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverRaceCardUrl,
  extractJraAccessDTokens,
  resolveRaceCardUrl,
  JRA_NAVIGATION_VERSION
} from '../jra-race-fetch.mjs';

const context={date:'2026-09-12',track:'中山',race:1};
const meetingToken='pw01drl10062026040320260912/AA';
const raceToken='pw01dde0106202604030120260912/4B';

test('JRA accessD tokens are extracted from doAction and direct CNAME links',()=>{
  const html=`<a href="#" onclick="return doAction('/JRADB/accessD.html', '${meetingToken}');">中山</a>
              <a href="/JRADB/accessD.html?CNAME=${raceToken}">1R</a>`;
  assert.deepEqual(extractJraAccessDTokens(html),[meetingToken,raceToken]);
  assert.equal(
    resolveRaceCardUrl(html,context),
    `https://www.jra.go.jp/JRADB/accessD.html?CNAME=${raceToken}`
  );
});

test('JRA navigation starts with official-style POST form and follows a bounded meeting page',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,method:options.method,body:options.body});
    if(calls.length===1){
      assert.equal(options.method,'POST');
      assert.equal(options.body,'cname=pw01dli00%2FF3');
      return new Response(`<html><body>
        <a href="#" onclick="return doAction('/JRADB/accessD.html','pw01drl10092026040320260912/BB');">阪神</a>
        <a href="#" onclick="return doAction('/JRADB/accessD.html','${meetingToken}');">中山</a>
      </body></html>`);
    }
    assert.equal(options.method,'POST');
    assert.equal(options.body,`cname=${encodeURIComponent(meetingToken)}`);
    return new Response(`<html><body>
      <a href="#" onclick="return doAction('/JRADB/accessD.html','${raceToken}');">1R</a>
    </body></html>`);
  };

  const result=await discoverRaceCardUrl(fetchImpl,context,new AbortController().signal);
  assert.equal(result.navigation.version,JRA_NAVIGATION_VERSION);
  assert.equal(result.navigation.pagesVisited,2);
  assert.equal(result.navigation.resolvedAtDepth,1);
  assert.equal(
    result.sourceUrl,
    `https://www.jra.go.jp/JRADB/accessD.html?CNAME=${raceToken}`
  );
  assert.equal(calls.length,2);
});

test('unrelated dates/tracks are not followed indefinitely',async()=>{
  let calls=0;
  const fetchImpl=async()=>{
    calls++;
    return new Response(`<html><body>
      <a href="#" onclick="return doAction('/JRADB/accessD.html','pw01drl10052026040320260912/CC');">東京</a>
      <a href="#" onclick="return doAction('/JRADB/accessD.html','pw01drl10062026040320260913/DD');">翌日中山</a>
    </body></html>`);
  };

  await assert.rejects(
    ()=>discoverRaceCardUrl(fetchImpl,context,new AbortController().signal),
    /JRA_RACE_NOT_FOUND/
  );
  assert.ok(calls<=6);
});
