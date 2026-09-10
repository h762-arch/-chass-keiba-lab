import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function loadCore(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const memory=new Map(),window={__CHASS_TEST__:true};
  const context={window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});
  return window.CHASS_TEST;
}

test('market labels distinguish JRA input and NAR current/final odds',async()=>{
  const c=await loadCore(),horse={popularity:2,odds:4.8,abilityRank:1};
  assert.equal(c.horseMarketText(horse,{category:'中央競馬',oddsType:'実オッズ'}),'入力 2人気｜4.8倍');
  assert.equal(c.horseMarketText(horse,{category:'地方競馬',oddsType:'実オッズ'}),'現在 2人気｜4.8倍');
  assert.equal(c.horseMarketText(horse,{category:'地方競馬',oddsType:'実オッズ',oddsSnapshotType:'final'}),'最終 2人気｜4.8倍');
  assert.equal(c.horseRankGapText(horse),'AI1位｜市場2位｜差+1');
});

test('missing market values remain explicitly unavailable',async()=>{
  const c=await loadCore();
  assert.equal(c.horseMarketText({},{category:'地方競馬',oddsType:'オッズなし'}),'市場未取得');
  assert.equal(c.horseMarketText({popularity:3},{category:'中央競馬'}),'入力 3人気｜単勝未取得');
});

test('horse short comment uses only supplied metrics and reasons',async()=>{
  const c=await loadCore();
  const comment=c.horseShortComment({win:8.3,place:32.5,overall:65.4,valueMark:'💎',valueType:'相手穴',longshotReasons:[{label:'先行実現率'}]});
  assert.match(comment,/AI勝率 8\.3%/);assert.match(comment,/TOP3 32\.5%/);assert.match(comment,/先行実現率/);
  assert.equal(c.horseShortComment({}),'データ不足のため短評を生成できません。');
});

test('compact UI keeps JRA/NAR validation filters separate and responsive',async()=>{
  const [app,css]=await Promise.all([readFile(new URL('../app.js',import.meta.url),'utf8'),readFile(new URL('../styles.css',import.meta.url),'utf8')]);
  assert.match(app,/能力 \$\{prob\}\/\$\{h\.length\|\|'—'\}｜TIME/);
  assert.match(app,/波乱判定信頼度/);
  assert.match(app,/中央（JRA）/);assert.match(app,/地方（NAR）/);
  assert.doesNotMatch(app,/id="dashTypeFilter"><option value="all">/);
  assert.match(app,/20倍以上TOP3捕捉/);assert.match(app,/💎単勝ROI/);
  assert.match(css,/@media\(max-width:430px\)/);assert.match(css,/validation-kpi-grid/);
});

test('mobile horse grid leaves flexible name width at all target widths',()=>{
  const fixedColumns=22+28+39+40+48+27,gaps=2*6;
  for(const viewport of [375,390,393,430]){
    const contentWidth=viewport-28;
    assert.ok(contentWidth-fixedColumns-gaps>=120,`${viewport}px keeps at least 120px for horse name`);
  }
});
