// Research display only: never assigns marks, probabilities or market values.
export function narAbilityDisplayRows(race={}){
 return (race.horses||[]).map(h=>({horseNo:h.horseNo,horseName:h.horseName||'馬名未確認',
  score:h.abilityScore==null||!Number.isFinite(Number(h.abilityScore))?'未確認':Number(h.abilityScore).toFixed(1),
  rank:Number.isInteger(Number(h.abilityRank))&&Number(h.abilityRank)>0?`${Number(h.abilityRank)}位`:'未確認',
  time:h.predictedTimeText||'TIME未生成',
  status:h.runnerStatus==='active'?'出走':h.runnerStatus==='scratched'?'取消':h.runnerStatus==='excluded'?'除外':h.runnerStatus==='withdrawn'?'取止':'状態未確認'}));
}
export function narAbilityTableRow(doc,horse){
 const data=narAbilityDisplayRows({horses:[horse]})[0],row=doc.createElement('tr');
 for(const [i,text] of [data.horseNo??'未確認',data.horseName,data.score,data.rank,data.time,data.status].entries()){
  const cell=doc.createElement(i===1?'th':'td');if(i===1)cell.scope='row';cell.textContent=String(text);row.append(cell);
 }
 return row;
}
export function narAbilityMobileBody(doc,race){
 const body=doc.createElement('div');body.className='viewer-mobile-race-body viewer-nar-ability';
 const note=doc.createElement('p');note.className='viewer-race-meta';note.textContent='能力データ・研究用｜印・勝率・市場評価は未生成';body.append(note);
 for(const h of narAbilityDisplayRows(race)){
  const card=doc.createElement('section');card.className='viewer-nar-ability-row';
  const title=doc.createElement('strong');title.textContent=`${h.horseNo??'未確認'}番 ${h.horseName}`;
  const values=doc.createElement('p');values.textContent=`能力 ${h.score}｜順位 ${h.rank}｜TIME ${h.time}`;
  const status=doc.createElement('small');status.textContent=h.status;
  card.append(title,values,status);body.append(card);
 }
 return body;
}
