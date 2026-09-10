import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import worker,{readMeetingCalendarForDate} from '../worker.js';

async function loadCore(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const memory=new Map(),window={__CHASS_TEST__:true};
  const context={window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,TextEncoder,AbortController,setTimeout,clearTimeout,parseFloat,fetch:async()=>new Response('{}'),localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});return window.CHASS_TEST;
}

class MeetingReadDb{
  constructor(rows=[]){this.rows=rows;this.sql=[];this.bindings=[];this.firstRows=new Map()}
  prepare(sql){
    this.sql.push(sql);const db=this;
    return {args:[],bind(...args){this.args=args;db.bindings.push(args);return this},async all(){return {results:db.rows}},async first(){return db.firstRows.get(this.args.join('|'))??null},async run(){throw new Error('read endpoint must not write')}};
  }
}

const rows=[
  {date:'2026-09-01',track:'大井',status:'meeting',race_numbers_json:'[1,2,3,4,5,6,7,8,9,10,11]',checked_at:'2026-09-01T08:00:00.000Z',source:'NAR公式 RaceList'},
  {date:'2026-09-01',track:'船橋',status:'non_meeting',race_numbers_json:'[]',checked_at:'2026-09-01T08:00:00.000Z',source:'NAR公式 RaceList'}
];

test('shared meeting calendar read is prepared, date-scoped and read-only',async()=>{
  const DB=new MeetingReadDb(rows),result=await readMeetingCalendarForDate(DB,'2026/09/01');
  assert.equal(result.length,2);assert.deepEqual(result[0].raceNumbers,[1,2,3,4,5,6,7,8,9,10,11]);
  assert.deepEqual(DB.bindings[0],['2026-09-01']);assert.match(DB.sql[0],/^SELECT /);assert.doesNotMatch(DB.sql[0],/INSERT|UPDATE|DELETE/i);
});

test('GET meetings returns only cached rows and never writes D1',async()=>{
  const DB=new MeetingReadDb(rows),response=await worker.fetch(new Request('https://example.test/api/db/meetings?date=2026-09-01'),{DB}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.source,'d1_meeting_calendar');assert.equal(body.tracks[0].raceNumbers.at(-1),11);assert.equal(DB.sql.length,1);
});

test('selector uses only actual 11R or 12R lists and rejects non-meetings',async()=>{
  const core=await loadCore();
  core.setMeetingSelectorState({date:'2026-09-01',status:'ready',fallback:false,entries:{大井:{status:'meeting',raceNumbers:[1,2,3,4,5,6,7,8,9,10,11]},高知:{status:'meeting',raceNumbers:[1,2,3,4,5,6,7,8,9,10,11,12]},船橋:{status:'non_meeting',raceNumbers:[]}}});
  assert.deepEqual(Array.from(core.selectorRaceNumbers('大井')),[1,2,3,4,5,6,7,8,9,10,11]);
  assert.deepEqual(Array.from(core.selectorRaceNumbers('高知')),[1,2,3,4,5,6,7,8,9,10,11,12]);
  assert.equal(core.meetingSelectionValid('2026-09-01','大井',12),false);assert.equal(core.meetingSelectionValid('2026-09-01','船橋',1),false);
});

test('lookup failure stays unknown and enables explicit manual fallback only',async()=>{
  const core=await loadCore();
  core.setMeetingSelectorState({date:'2026-09-01',status:'fallback',fallback:true,entries:{大井:{status:'unknown',raceNumbers:[]},船橋:{status:'non_meeting',raceNumbers:[]}}});
  assert.equal(core.meetingSelectionValid('2026-09-01','大井',12),true);assert.equal(core.meetingSelectionValid('2026-09-01','船橋',1),false);
  assert.equal(core.getMeetingSelectorState().entries.大井.status,'unknown');
});

test('past cache is long-lived while current cache uses a finite TTL',async()=>{
  const core=await loadCore(),now=Date.parse('2026-09-01T12:00:00.000Z');
  assert.equal(core.meetingEntryFresh({status:'non_meeting',checkedAt:'2020-01-01T00:00:00.000Z'},'2026-08-31',now),true);
  assert.equal(core.meetingEntryFresh({status:'meeting',checkedAt:'2026-09-01T11:50:00.000Z'},'2026-09-01',now),true);
  assert.equal(core.meetingEntryFresh({status:'meeting',checkedAt:'2026-09-01T11:30:00.000Z'},'2026-09-01',now),false);
});

test('UI declares grouped disabled venues, loading status and no horizontal overflow',async()=>{
  const [app,html,css]=await Promise.all([readFile(new URL('../app.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../styles.css',import.meta.url),'utf8')]);
  assert.match(app,/meetingDiscoveryPromises\.has\(date\)/);assert.match(app,/api\/db\/meetings\?date=/);assert.match(app,/optgroup/);assert.match(app,/この日は非開催/);assert.match(app,/手動選択モード/);
  assert.match(html,/id="meetingSelectorStatus"/);assert.match(css,/option:disabled/);assert.match(css,/max-width:\s*100%/);
});

test('core NAR and background collector routes remain present and separate',async()=>{
  const source=await readFile(new URL('../worker.js',import.meta.url),'utf8');
  for(const route of ['/api/nar/race','/api/nar/sync','/api/nar/odds'])assert.ok(source.includes(route));
  assert.match(source,/runScheduledTasks/);assert.match(source,/runBackgroundHistoricalCollector/);assert.match(source,/api\/db\/historical-job/);
});
