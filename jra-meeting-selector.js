/* J1 only: schedule selection never invokes the prediction model. */
(() => {
  'use strict';
  window.CHASS_JRA_MEETING = {create({isActive,getGeneration=()=>0,onSelection}) {
    const get=id=>document.getElementById(id),date=get('jraDate'),course=get('jraCourse'),race=get('jraRaceNo');
    let generation=0,timer,controller,meetings=null,active=false;
    const status=get('jraMeetingStatus');
    const options=values=>values.map(value=>new Option(String(value)+'R',String(value)));
    function unlock(){for(const option of course.options){option.disabled=false;option.textContent=option.value;}const value=race.value;race.replaceChildren(...options(Array.from({length:12},(_,i)=>i+1)));race.value=value||'1';}
    function cancel(){generation++;clearTimeout(timer);controller?.abort();}
    function manual(){cancel();meetings=null;unlock();status.textContent='手動選択中。JSON・CSVまたは手動入力を使用できます。';}
    function applyRaces(){const value=race.value,entry=meetings?.find(x=>x.track===course.value);if(!entry)return;race.replaceChildren(...options(entry.raceNumbers));race.value=entry.raceNumbers.includes(Number(value))?value:String(entry.raceNumbers[0]||'');}
    async function refresh(){
      cancel();meetings=null;unlock();
      if(!active||!isActive())return;
      if(window.CHASS_FEATURES?.ENABLE_JRA_MEETING_DISCOVERY===false){manual();return;}
      const token=generation,appGeneration=getGeneration(),selectedDate=date.value;controller=new AbortController();const requestController=controller;
      status.textContent='開催予定を確認中…（手動入力も使用できます）';
      const timeout=setTimeout(()=>requestController.abort(),10000);
      try{
        const response=await fetch('/api/jra/meeting?date='+encodeURIComponent(selectedDate),{signal:controller.signal});
        const data=await response.json();
        if(token!==generation||!active||!isActive()||appGeneration!==getGeneration()||date.value!==selectedDate)return;
        if(!response.ok||!data.ok||data.organization!=='JRA'||data.date!==selectedDate||!Array.isArray(data.meetings)||data.meetings.length!==10)throw Error('unknown');
        const tracks=[...course.options].map(x=>x.value);
        if(!tracks.every(track=>data.meetings.filter(x=>x.track===track).length===1)||!data.meetings.every(x=>x.organization==='JRA'&&x.date===selectedDate&&['meeting','non_meeting'].includes(x.status)&&Array.isArray(x.raceNumbers)&&new Set(x.raceNumbers).size===x.raceNumbers.length&&x.raceNumbers.every(n=>Number.isInteger(n)&&n>=1&&n<=12)&&(x.status==='meeting'?x.raceNumbers.length>0:x.raceNumbers.length===0)))throw Error('unknown');
        meetings=data.meetings;
        for(const option of course.options){const item=meetings.find(x=>x.track===option.value);option.disabled=item?.status!=='meeting';option.textContent=option.value+(option.disabled?'（開催予定なし）':'');}
        if(course.selectedOptions[0]?.disabled)course.value=meetings.find(x=>x.status==='meeting')?.track||'';
        applyRaces();onSelection();
        status.textContent='JRA公式の開催予定です。中止・変更は公式情報をご確認ください。予想は下のJSON・CSV／手動入力から行えます。';
      }catch(error){if(token!==generation||!active||!isActive()||appGeneration!==getGeneration())return;meetings=null;unlock();status.textContent='開催予定を確認できませんでした（不明）。手動で選択・入力できます。';}
      finally{clearTimeout(timeout);}
    }
    date.addEventListener('input',()=>{cancel();meetings=null;unlock();timer=setTimeout(refresh,400);});
    course.addEventListener('input',()=>{if(!meetings)manual();applyRaces();onSelection();});
    race.addEventListener('input',()=>{if(!meetings)manual();});
    get('jraMeetingRefresh').addEventListener('click',refresh);
    get('jraManualFallback').addEventListener('toggle',()=>{if(get('jraManualFallback').open)manual();});
    get('jraDataFile').addEventListener('change',manual);
    return {manual,setActive(value,{discover=true}={}){if(!discover){active=value;manual();return;}if(active===value)return;active=value;cancel();if(value)refresh();}};
  }};
})();
