// Synthetic official-page-shaped HTML, not downloaded pages or evidence of a real meeting.
export const REHEARSAL_DATE='2026-10-16';
export const REHEARSAL_AT='2026-10-15T22:00:00.000Z';
export const REHEARSAL_SCENARIOS=Object.freeze(['baseline','swapped_card','history_link_failure','time_gap','tampered_readback']);
const tracks={'22':'金沢','23':'笠松'};
export function versionedSaveFixture(url,scenario='baseline'){
 const u=new URL(url),code=u.searchParams.get('k_babaCode'),track=tracks[code];
 if(u.origin!=='https://www.keiba.go.jp'||!track||u.searchParams.get('k_raceDate')!=='2026/10/16')throw Error('FIXTURE_URL_UNSUPPORTED');
 if(u.pathname==='/KeibaWeb/TodayRaceInfo/RaceList')return `<h1>2026年10月16日 ${track}競馬 当日メニュー</h1><a href="/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=${code}&amp;k_raceDate=2026/10/16&amp;k_raceNo=1">1R</a>`;
 if(u.searchParams.get('k_raceNo')!=='1')throw Error('FIXTURE_RACE_UNSUPPORTED');
 const header=`<h4>2026年10月16日 ${scenario==='swapped_card'&&code==='22'?'笠松':track} 第1競走 15:00発走</h4><h2>ダート1400m</h2>`;
 const name=no=>`合成${code}試験${no}`;
 if(u.pathname==='/KeibaWeb/TodayRaceInfo/DebaTableSmall')return '<html><body>'+header+'<table>'+[1,2].map(no=>{
  const distance=scenario==='time_gap'&&code==='23'&&no===2?900:1400;
  return `<tr class="dbitem"><td>${no}</td><td><font class="bamei"><b>${name(no)}</b></font></td><td>検証調教師（${track}）</td><td>56.0 検証騎手</td><td>金沢09.30 良 右 ${distance} 1/12 2人 130${no}（0.1） 2-2-1 38.1 笠松09.29 良 右 ${distance} 2/12 3人 131${no}（0.2） 3-3-2 38.2</td></tr>`;
 }).join('')+'</table></body></html>';
 if(u.pathname==='/KeibaWeb/TodayRaceInfo/DebaTable')return '<html><body>'+header+'<table>'+[1,2].map(no=>{
  const id=String(30012403217+Number(code)*10+(scenario==='history_link_failure'&&code==='22'?1:no));
  return `<tr class="tBorder"><td class="horseNum">${no}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=${id}">${name(no)}</a></td><td><a href="../TodayRaceInfo/RaceMarkTable?k_raceDate=2026%2F09%2F30&amp;k_babaCode=22&amp;k_raceNo=1">過去走1</a><a href="../TodayRaceInfo/RaceMarkTable?k_raceDate=2026%2F09%2F29&amp;k_babaCode=23&amp;k_raceNo=1">過去走2</a></td></tr>`;
 }).join('')+'</table></body></html>';
 throw Error('FIXTURE_PATH_UNSUPPORTED');
}
