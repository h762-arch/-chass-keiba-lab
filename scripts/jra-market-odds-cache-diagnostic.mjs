// Read-only diagnosis of captured cache rows. Fresh TTL is not proof that a
// payload is complete, authentic or eligible for MARKET Freeze.
export function diagnoseCapturedMarketOdds(job,rows,now){
 if(!Array.isArray(rows)||!Number.isFinite(now))throw Error('invalid_odds_diagnostic');
 const cacheKey=`odds|${job.date}|${job.track}|${Number(job.raceNo)}`;
 const matches=rows.filter(r=>r.kind==='odds'&&r.cache_key===cacheKey);
 const result={cacheKey,rowCount:matches.length,observedAt:new Date(now).toISOString(),
  fetchedAt:null,expiresAt:null,ageMs:null,remainingTtlMs:null,payloadValidated:false};
 if(!matches.length)return {...result,reason:'CACHE_ROW_MISSING'};
 if(matches.length!==1)return {...result,reason:'CACHE_IDENTITY_DUPLICATE'};
 const row=matches[0],fetched=Date.parse(row.fetched_at),expires=Date.parse(row.expires_at);
 result.fetchedAt=typeof row.fetched_at==='string'?row.fetched_at:null;
 result.expiresAt=typeof row.expires_at==='string'?row.expires_at:null;
 result.ageMs=Number.isFinite(fetched)?now-fetched:null;
 result.remainingTtlMs=Number.isFinite(expires)?expires-now:null;
 // The official reader returns null on either invalid expiry or expiry <= now.
 if(!Number.isFinite(expires))return {...result,reason:'CACHE_EXPIRY_INVALID'};
 if(expires<=now)return {...result,reason:'CACHE_EXPIRED'};
 if(!Number.isFinite(fetched))return {...result,reason:'CACHE_FETCH_TIME_INVALID'};
 if(fetched>now)return {...result,reason:'CACHE_FETCH_TIME_FUTURE'};
 return {...result,reason:'CACHE_TTL_FRESH_UNVALIDATED'};
}
