// Research-only, Node-side contract. No storage, network or runtime integration.
export const MARKS=Object.freeze(['◎','○','▲','△','☆']);
const venues=new Set(['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉']);
export const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
export const text=(x,max=160)=>typeof x==='string'&&x.length>0&&x.length<=max&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);
export const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
export const score=(x,max=100)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max;
export const nullableScore=(x,max=100)=>x===null||score(x,max);
export function schema(x,keys){return plain(x)&&Object.keys(x).every(k=>keys.includes(k));}
export function copyInput(input){
 let nodes=0,chars=0;const seen=new WeakSet();
 function copy(x,depth=0){
  if(++nodes>250000||depth>12)throw Error('BOUNDS');
  if(x===null||typeof x==='boolean')return x;
  if(typeof x==='number'){if(!Number.isFinite(x))throw Error('NUMBER');return x;}
  if(typeof x==='string'){chars+=x.length;if(x.length>2048||chars>4000000)throw Error('STRING');return x;}
  if(typeof x!=='object'||seen.has(x)||Object.getOwnPropertySymbols(x).length)throw Error('TYPE');
  if(!Array.isArray(x)&&!plain(x))throw Error('OBJECT');
  seen.add(x);const ds=Object.getOwnPropertyDescriptors(x);let out;
  if(Array.isArray(x)){
   if(x.length>3000||Object.keys(ds).length!==x.length+1)throw Error('ARRAY');
   out=[];for(let i=0;i<x.length;i++){const d=ds[String(i)];if(!d?.enumerable||!Object.hasOwn(d,'value'))throw Error('ACCESSOR');out.push(copy(d.value,depth+1));}
  }else{
   if(Object.keys(ds).length>40)throw Error('OBJECT');out=Object.create(null);
   for(const [k,d] of Object.entries(ds)){if(!d.enumerable||!Object.hasOwn(d,'value')||['__proto__','constructor','prototype'].includes(k))throw Error('ACCESSOR');out[k]=copy(d.value,depth+1);}
  }
  seen.delete(x);return out;
 }
 return copy(input);
}
export function timestamp(x){
 if(typeof x!=='string')return NaN;
 const m=x.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
 if(!m)return NaN;const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number);
 if(y<1000||mo<1||mo>12||d<1||d>new Date(Date.UTC(y,mo,0)).getUTCDate()||h>23||mi>59||s>59)return NaN;
 if(m[7]!=='Z'&&(Number(m[7].slice(1,3))>23||Number(m[7].slice(4,6))>59))return NaN;
 return Date.parse(x);
}
export const jstDate=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
export function raceParts(id){
 if(!text(id,100))return null;const m=id.match(/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|([1-9]|1[0-2])$/);
 return m&&venues.has(m[2])&&Number.isFinite(timestamp(m[1]+'T00:00:00+09:00'))?{date:m[1],venue:m[2],raceNo:Number(m[3])}:null;
}
export function seal(x){if(x&&typeof x==='object'){Object.values(x).forEach(seal);Object.freeze(x);}return x;}
export const authority=()=>({formalKpiEligible:false,formalKpiReadiness:'HOLD',originalEarlyMutation:false,
 formalDiamondAssigned:false,formalDangerAssigned:false,actualProbabilitiesGenerated:false,
 probabilityDecision:'MODEL_HOLD',productionActivation:'NO-GO'});
export function sourceValid(s,binding,cutoff,now,{horseNo}={}){
 if(!schema(s,['raceId','organization','runId','inputFreezeId','snapshotId','capturedAt','kind','sourceRef','horseNo'])
  ||s.kind!=='EARLY'||!text(s.sourceRef,512)||!Number.isFinite(timestamp(s.capturedAt))
  ||timestamp(s.capturedAt)>cutoff||timestamp(s.capturedAt)>now)return false;
 for(const key of ['raceId','organization','runId','inputFreezeId','snapshotId'])if(s[key]!==binding[key])return false;
 return horseNo===undefined?s.horseNo===undefined:s.horseNo===horseNo;
}
export function percentage(n,d){
 if(d===0||d===0n)return null;
 const a=BigInt(n),b=BigInt(d),scaled=(a*1000n+b/2n)/b;
 return scaled<=BigInt(Number.MAX_SAFE_INTEGER)?Number(scaled)/10:null;
}
export function safeSum(values){const total=values.reduce((s,x)=>s+BigInt(x),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw Error('MONEY_SUM_RANGE');return Number(total);}
