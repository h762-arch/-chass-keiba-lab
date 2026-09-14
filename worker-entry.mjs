import baseWorker,{parseRaceCard} from './worker.js';
import {handleNarRecentHistoryRequest} from './src/nar/nar-recent-history.mjs';

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==='/api/nar/history/horse'||u.pathname==='/api/nar/history/race'){
      const response=await handleNarRecentHistoryRequest(request,env,{raceCardParser:parseRaceCard});
      if(response)return response;
    }
    return baseWorker.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){
    if(typeof baseWorker.scheduled==='function')return baseWorker.scheduled(controller,env,ctx);
  }
};
