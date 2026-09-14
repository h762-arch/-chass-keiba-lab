export const NAR_RACE_CONTEXT_POLICY_VERSION='nar-race-context-history-only-v1';

export function classifyAbilityAvailability({status,payload}={}){
  const httpStatus=Number(status);
  const responseOk=httpStatus>=200&&httpStatus<300&&payload?.ok!==false;
  if(responseOk){
    return {available:true,historyOnly:false,reason:null};
  }
  const code=payload?.error?.code??null;
  if(httpStatus===404&&code==='RACE_NOT_FOUND'){
    return {available:false,historyOnly:true,reason:'ability_race_not_found'};
  }
  return {available:false,historyOnly:false,reason:'ability_api_failed'};
}
