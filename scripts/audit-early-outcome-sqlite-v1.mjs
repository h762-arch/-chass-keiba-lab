import {lstatSync,openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {auditEarlyOutcomeSqliteV1} from '../src/research/early-outcome-sqlite-audit-v1.mjs';

export async function auditEarlyOutcomeSqliteCliV1(args){
 const evaluatedAt=new Date().toISOString();
 if(!Array.isArray(args)||args.length!==6||args[0]!=='--evidence-db'||args[2]!=='--results-db'||args[4]!=='--targets'
  ||[args[1],args[3],args[5]].some(x=>typeof x!=='string'||!x))
  return {...await auditEarlyOutcomeSqliteV1(''),reason:'EXPLICIT_EVIDENCE_RESULTS_AND_TARGETS_REQUIRED'};
 let raw,targets;
 try{
  const st=lstatSync(args[5],{bigint:true});if(!st.isFile()||st.size>32768n)throw Error();
  const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join('|');
  const fd=openSync(args[5],constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
   if(stamp(fstatSync(fd,{bigint:true}))!==stamp(st))throw Error();
   const bytes=Buffer.alloc(32769),length=readSync(fd,bytes,0,bytes.length,0);
   if(length>32768||stamp(fstatSync(fd,{bigint:true}))!==stamp(st)||stamp(lstatSync(args[5],{bigint:true}))!==stamp(st))throw Error();
   raw=bytes.subarray(0,length).toString('utf8');targets=JSON.parse(raw);
  }finally{closeSync(fd);}
 }
 catch{return {...await auditEarlyOutcomeSqliteV1(''),reason:'TARGETS_FILE_INVALID'};}
 const out=await auditEarlyOutcomeSqliteV1(JSON.stringify({evidenceDbPath:args[1],resultsDbPath:args[3],targets,evaluatedAt}));
 return {...out,clockAuthority:'LOCAL_PROCESS_CLOCK',evaluatedAt,targetsFileUtf8Sha256:createHash('sha256').update(raw,'utf8').digest('hex')};
}
export function earlyOutcomeSqliteExitCode(out){return out.status!=='READ_COMPLETE'?2:out.report.heldRaceCount>0?1:0;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const out=await auditEarlyOutcomeSqliteCliV1(process.argv.slice(2));process.stdout.write(JSON.stringify(out,null,2)+'\n');process.exitCode=earlyOutcomeSqliteExitCode(out);
}
