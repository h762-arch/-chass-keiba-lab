import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync,existsSync,openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export class ResearchSqliteGuardError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ResearchSqliteGuardError(code);};
const sidecars=path=>['-wal','-shm','-journal'].some(s=>existsSync(path+s));
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join('|');
export function localResearchSqlitePath(value){
 if(typeof value!=='string'||!value||value.length>2048||/[\x00-\x1f\x7f]/.test(value)||/^[a-z][a-z0-9+.-]*:/i.test(value))fail('INVALID_LOCAL_SQLITE_PATH');
 return resolve(value);
}
function inspect(path,hashBytes){
 if(!existsSync(path))fail('SQLITE_FILE_MISSING');
 const st=lstatSync(path,{bigint:true});
 if(!st.isFile()||realpathSync(path)!==path)fail('SQLITE_REGULAR_FILE_REQUIRED');
 if(st.size>536870912n)fail('SQLITE_FILE_TOO_LARGE');
 if(sidecars(path))fail('QUIESCENT_SQLITE_COPY_REQUIRED');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const initial=fstatSync(fd,{bigint:true});if(stamp(initial)!==stamp(st))fail('SQLITE_INPUT_CHANGED');
  const header=Buffer.alloc(20),count=readSync(fd,header,0,20,0);
  if(count!==20||header.subarray(0,16).toString('binary')!=='SQLite format 3\x00')fail('SQLITE_HEADER_INVALID');
  if(header[18]!==1||header[19]!==1)fail('QUIESCENT_SQLITE_COPY_REQUIRED');
  let sha256=null;
  if(hashBytes){const h=createHash('sha256'),chunk=Buffer.alloc(65536);let offset=0,n;
   while((n=readSync(fd,chunk,0,chunk.length,offset))>0){h.update(chunk.subarray(0,n));offset+=n;}sha256=h.digest('hex');}
  if(stamp(fstatSync(fd,{bigint:true}))!==stamp(initial)||stamp(lstatSync(path,{bigint:true}))!==stamp(initial)||sidecars(path))fail('SQLITE_INPUT_CHANGED');
  return {stamp:stamp(initial),sha256,sizeBytes:Number(initial.size)};
 }finally{closeSync(fd);}
}

// Shared local-file guard. Connection controls are read-only PRAGMA/BEGIN/
// ROLLBACK, followed only by SELECTs. No schema initialization or writes.
export function openQuiescentResearchSqliteV1(value,{hashBytes=false}={}){
 const path=localResearchSqlitePath(value),before=inspect(path,hashBytes);let db;
 const assertStable=()=>{const after=inspect(path,hashBytes);if(before.stamp!==after.stamp||before.sha256!==after.sha256)fail('SQLITE_INPUT_CHANGED');};
 const close=()=>{if(db){try{db.exec('ROLLBACK');}finally{db.close();db=null;}}};
 try{
  db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA query_only=ON');db.exec('BEGIN');
  db.prepare('SELECT COUNT(*) FROM sqlite_schema').get();assertStable();
  return Object.freeze({get db(){return db;},fingerprint:Object.freeze({sha256:before.sha256,sizeBytes:before.sizeBytes}),assertStable,close});
 }catch(error){if(db)try{close();}catch{}throw error;}
}
