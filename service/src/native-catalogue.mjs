import {randomUUID} from 'node:crypto';
import {realpathSync,statSync} from 'node:fs';
import {observeNativeProfile} from './native-profile.mjs';
import {resolveExecutable} from './trusted-executable.mjs';

const REFRESH_MS=3600000;
const RETRY_MS=60000;
const LEASE_MS=45000;
const keyFor=id=>'native_catalogue:'+id;

export function identifyNativeExecutable(config){
 const executable=resolveExecutable(config);
 const canonical=realpathSync(executable);
 const stat=statSync(canonical,{bigint:true});
 if(!stat.isFile())throw Error('EXECUTABLE_NOT_FILE');
 return {executable,fingerprint:[canonical,stat.size,stat.mtimeNs,stat.ino].join('\0')};
}

// This cache is advisory and separate from operator-authorized registration.
// SQLite coordinates probes across MCP processes without a schema migration.
export class NativeCatalogue {
 constructor(store,{observe=observeNativeProfile,identify=identifyNativeExecutable}={}){
  this.store=store;
  this.observe=observe;
  this.identify=identify;
 }
 read(row){
  const saved=this.store.db.prepare('SELECT value FROM metadata WHERE key=?').get(keyFor(row.id));
  const state=saved&&JSON.parse(saved.value);
  return state?.revision===row.revision?state:{};
 }
 save(id,state){
  this.store.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(keyFor(id),JSON.stringify(state));
 }
 remove(id){
  this.store.db.prepare('DELETE FROM metadata WHERE key=?').run(keyFor(id));
 }
 profile(row){
  const base=JSON.parse(row.profile_json),{observed}=this.read(row);
  if(!observed)return base;
  return {...base,...observed};
 }
 status(row){
  const {observed,error,retry_at}=this.read(row);
  const observed_at=observed?.observed_at??null;
  return {observed_at,error:error??null,stale:!!error||!observed_at||this.store.now()-Date.parse(observed_at)>=REFRESH_MS,retry_at:retry_at?new Date(retry_at).toISOString():null};
 }
 async refresh(row,config,{force=false,signal}={}){
  if(config.type!=='codex'||signal?.aborted)return;
  const {db}=this.store;
  const current=()=>db.prepare('SELECT active,revision FROM harnesses WHERE id=?').get(row.id);
  const matches=()=>{const latest=current();return latest?.active&&latest.revision===row.revision;};
  let executable,fingerprint,identityError;
  try{({executable,fingerprint}=this.identify(config));}
  catch(e){identityError=e.code??'NATIVE_EXECUTABLE_UNAVAILABLE';}
  const token=randomUUID();
  const claimed=this.store.transaction(()=>{
   if(!matches())return false;
   const saved=this.read(row),now=this.store.now();
   if(saved.lease_until>now)return false;
   const same=saved.fingerprint===fingerprint;
   if(saved.error&&same&&saved.retry_at>now)return false;
   if(same&&!force&&!saved.error&&saved.observed&&now-Date.parse(saved.observed.observed_at)<REFRESH_MS)return false;
   this.save(row.id,{...saved,revision:row.revision,fingerprint,token,lease_until:now+LEASE_MS});
   return true;
  });
  if(!claimed)return;
  let observed,error;
  try{
   if(identityError)throw Object.assign(Error(identityError),{code:identityError});
   const profile=await this.observe(config,JSON.parse(row.profile_json),{executable,signal,now:()=>new Date(this.store.now()).toISOString()});
   this.store.directory.validateProfile(profile);
   if(this.identify(config).fingerprint!==fingerprint)throw Object.assign(Error('NATIVE_EXECUTABLE_CHANGED'),{code:'NATIVE_EXECUTABLE_CHANGED'});
   observed=Object.fromEntries(['observed_at','native_version','models','source'].map(field=>[field,profile[field]]));
  }catch(e){error=e.code??'NATIVE_PROFILE_FAILED';}
  this.store.transaction(()=>{
   if(!matches())return;
   const saved=this.read(row),now=this.store.now();
   if(saved.token!==token||saved.lease_until<=now)return;
   this.save(row.id,{revision:row.revision,fingerprint,observed:observed??saved.observed,error,retry_at:error?now+RETRY_MS:null});
  });
 }
}
