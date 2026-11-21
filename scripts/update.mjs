import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {releaseInfo,download,unpack,hash,compareVersions} from './release-package.mjs';
import {planConnections,reloadCodex} from './update-connections.mjs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const same=(a,b,name)=>a.equals(b)||/\.(md|mjs|json|svg|toml|txt)$/.test(name)&&a.toString('utf8').replace(/\r\n/g,'\n')===b.toString('utf8').replace(/\r\n/g,'\n');
function atomic(file,bytes,preserveAcl=false){
 const tmp=file+'.ihcp-next-'+randomUUID();fs.writeFileSync(tmp,'',{flag:'wx',mode:0o600});
 try{
  if(fs.existsSync(file)){
   if(process.platform!=='win32')fs.chmodSync(tmp,fs.statSync(file).mode&0o777);
   else if(preserveAcl){
    // Apply the existing ACL before writing config contents to a temporary file.
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $acl=[System.IO.File]::GetAccessControl($env:IHCP_ACL_SOURCE); [System.IO.File]::SetAccessControl($env:IHCP_ACL_TARGET,$acl)"],{windowsHide:true,stdio:'pipe',env:{...process.env,IHCP_ACL_SOURCE:file,IHCP_ACL_TARGET:tmp}});
    if(r.error||r.status!==0)throw Error('PRIVATE_CONFIG_ACL_FAILED');
   }
  }
  fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,file);
 }catch(e){fs.unlinkSync(tmp);throw e;}
}
const save=(p,v)=>atomic(p,JSON.stringify(v,null,2)+'\n');
function safeTree(root,budget={files:0,bytes:0}){
 if(fs.lstatSync(root).isSymbolicLink()||fs.realpathSync(root)!==path.resolve(root))throw Error('UPDATE_LINK_NOT_ALLOWED');
 for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isSymbolicLink()||fs.realpathSync(p)!==path.resolve(p))throw Error('UPDATE_LINK_NOT_ALLOWED');if(e.isDirectory())safeTree(p,budget);else{budget.files++;budget.bytes+=fs.statSync(p).size;if(budget.files>10000||budget.bytes>128*1024*1024)throw Error('LOCAL_APP_TOO_LARGE');}}
}
function within(root,file){if(!path.resolve(file).startsWith(root+path.sep))throw Error('UPDATE_PATH_ESCAPE');}
function installed(runtimeFile){
 const runtime=read(runtimeFile),data=path.dirname(runtimeFile),root=path.dirname(data);
 if(path.basename(data)!=='data'||runtime.transport!=='stdio'||runtime.schema_version!==6||runtime.private_dir!==data||runtime.database!==path.join(data,'mail.db')||runtime.bundle!==path.join(data,'bundles','stdio.mjs')||runtime.client_bundle!==path.join(data,'bundles','client.mjs')||runtime.service_config!==path.join(data,'service.json'))throw Error('UNSUPPORTED_INSTALL_LAYOUT');
 for(const p of [root,data,runtimeFile,runtime.bundle,runtime.client_bundle,runtime.database,runtime.service_config])if(fs.lstatSync(p).isSymbolicLink()||fs.realpathSync(p)!==path.resolve(p))throw Error('UPDATE_LINK_NOT_ALLOWED');
 for(const [p,digest] of [[runtime.bundle,runtime.bundle_sha256],[runtime.client_bundle,runtime.client_sha256]])if(hash(fs.readFileSync(p))!==digest)throw Error('LOCAL_RUNTIME_MODIFIED');
 const db=new DatabaseSync(runtime.database,{readOnly:true});try{
  if(db.prepare('PRAGMA user_version').get().user_version!==6||db.prepare("SELECT value FROM metadata WHERE key='writer_version'").get()?.value!=='6'||db.prepare("SELECT value FROM metadata WHERE key='service_id'").get()?.value!==runtime.service_id)throw Error('RUNTIME_IDENTITY_MISMATCH');
  if(db.prepare("SELECT count(*) n FROM workers WHERE state='running'").get().n)throw Error('ACTIVE_WORKERS_RETRY_LATER');
 }finally{db.close();}
 return {runtime,data,root};
}
async function getPackage(info,cache,options){
 const checksum=(await download(info.checksum,{...options,maxBytes:2048})).toString('utf8').trim();
 const match=/^([a-f0-9]{64})\s+\*?([^\s]+)$/.exec(checksum);
 if(!match||match[2]!==info.name||info.digest&&info.digest!=='sha256:'+match[1])throw Error('INVALID_RELEASE_CHECKSUM');
 const file=path.join(cache,info.name);let bytes;
 if(fs.existsSync(file)){bytes=fs.readFileSync(file);if(hash(bytes)!==match[1])throw Error('CACHED_RELEASE_CORRUPT');}
 else{bytes=await download(info.url,options);if(hash(bytes)!==match[1])throw Error('RELEASE_CHECKSUM_MISMATCH');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
 return unpack(bytes,info.version);
}
export async function verifyRuntime(runtimeFile,harnessDir){
 const runtime=read(runtimeFile),{connect}=await import(pathToFileURL(runtime.client_bundle).href+'?version='+runtime.version);
 const c=await connect({runtimeFile,tokenFile:path.join(harnessDir,'harness.tok')});
 try{const tools=(await c.listTools()).tools.map(t=>t.name);if(c.getServerVersion()?.version!==runtime.version||!tools.includes('harness.discover')||!tools.includes('session.exchange')||!tools.includes('harness.health'))throw Error('UPDATED_MCP_HEALTH_FAILED');const health=await c.callTool({name:'harness.health',arguments:{}});if(health.isError||health.structuredContent?.version!==runtime.version)throw Error('UPDATED_MCP_HEALTH_FAILED');return {version:runtime.version,tools:tools.length,connection:'fresh_client'};}finally{await c.close();}
}
// A catalogue failure cannot undo a verified installation. Do not scan session
// inventory just to warm the advertised models.
async function refreshInstalledModels(runtimeFile,harnessDir,{force}){
 const runtime=read(runtimeFile);
 if(compareVersions(runtime.version,'1.5.1')<0)return {status:'unsupported'};
 const {connect}=await import(pathToFileURL(runtime.client_bundle).href+'?version='+runtime.version);
 const client=await connect({runtimeFile,tokenFile:path.join(harnessDir,'harness.tok')});
 try{
  const result=await client.callTool({name:'harness.discover',arguments:{models_only:true,force}},undefined,{timeout:35000});
  if(result.isError||!Array.isArray(result.structuredContent?.harnesses))return {status:'unavailable'};
  const catalogues=result.structuredContent.harnesses.map(h=>({harness:h.harness,...h.model_catalogue,models:h.profile.models.length}));
  return {status:catalogues.length===0?'no_supported_harness':catalogues.some(h=>h.stale)?'stale':'available',catalogues};
 }finally{await client.close();}
}
function rollback(state,root){
 const {txn,files}=state;within(path.join(root,'data','updates'),txn);let conflict=false;
 for(const f of [...files].reverse()){
  if(!fs.existsSync(f.path))continue;
  const current=fs.readFileSync(f.path,'utf8');
  if(current===f.after)atomic(f.path,f.before,true);
  else if(current!==f.before)conflict=true;
 }
 for(const name of ['stdio.mjs','client.mjs','runtime.json']){
  const file=name==='runtime.json'?path.join(root,'data',name):path.join(root,'data','bundles',name);
  const backup=path.join(txn,name);if(fs.existsSync(backup))atomic(file,fs.readFileSync(backup));
 }
 const app=path.join(root,'app'),old=path.join(txn,'old-app');
 if(fs.existsSync(old)){
  if(fs.existsSync(app)){safeTree(app);const failed=path.join(txn,'failed-app');within(root,failed);fs.renameSync(app,failed);}
  fs.renameSync(old,app);
 }
 save(path.join(txn,'owned-update.json'),{kind:'ihcp3k-update',status:'rolled_back',at:Date.now()});
 return {external_edits_preserved:conflict};
}
function prune(data,current,previous){
 const dir=path.join(data,'updates'),groups={installed:[],rolled_back:[]};
 for(const name of fs.readdirSync(dir)){
  if(!/^[a-f0-9-]{36}$/.test(name))continue;
  const folder=path.join(dir,name),marker=path.join(folder,'owned-update.json');within(dir,folder);
  if(!fs.existsSync(marker)||fs.lstatSync(folder).isSymbolicLink())continue;
  const m=read(marker);if(m.kind==='ihcp3k-update'&&groups[m.status])groups[m.status].push({folder,at:m.at});
 }
 for(const group of Object.values(groups))for(const {folder} of group.sort((a,b)=>b.at-a.at).slice(2)){safeTree(folder);within(dir,folder);fs.rmSync(folder,{recursive:true});}
 const cache=path.join(data,'release-cache');
 for(const name of fs.readdirSync(cache))if(/^IHCP3K-\d+\.\d+\.\d+\.zip$/.test(name)&&![`IHCP3K-${current}.zip`,`IHCP3K-${previous}.zip`].includes(name)){
  const file=path.join(cache,name);within(cache,file);if(fs.lstatSync(file).isFile())fs.unlinkSync(file);
 }
}
function acquire(data,root){
 const lock=path.join(data,'update.lock'),journal=path.join(data,'update-state.json');
 if(fs.existsSync(lock)){
  const previous=read(lock);if(!Number.isInteger(previous.pid)||previous.pid<1)throw Error('INVALID_UPDATE_LOCK');
  try{process.kill(previous.pid,0);throw Error('UPDATE_IN_PROGRESS');}catch(e){if(e.code!=='ESRCH')throw e;}
  if(fs.existsSync(journal)){const state=read(journal);if(state.phase==='applying'){rollback(state,root);save(journal,{...state,phase:'rolled_back'});}}
  fs.unlinkSync(lock);
 }
 const fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);return ()=>fs.unlinkSync(lock);
}
export async function update(harnessDir,{check=false,home=os.homedir(),env=process.env,fetchImpl=fetch,verify=verifyRuntime,refreshModels=refreshInstalledModels,reload=reloadCodex,checkpoint=()=>{}}={}){
 process.umask(0o077);harnessDir=path.resolve(harnessDir);
 const h=read(path.join(harnessDir,'harness.json'));if(!h.linked)throw Error('HARNESS_UNREGISTERED');
 const runtimeFile=path.resolve(h.runtime_file),data=path.dirname(runtimeFile),root=path.dirname(data);
 // Recover only our own interrupted transaction, before validating partially updated files.
 if(path.basename(data)!=='data'||fs.realpathSync(data)!==data)throw Error('UNSUPPORTED_INSTALL_LAYOUT');
 const release=check?()=>{}:acquire(data,root);
 try{
  const {runtime}=installed(runtimeFile),info=await releaseInfo('latest',{fetchImpl}),order=compareVersions(info.version,runtime.version);
  if(check)return {status:order>0?'update_available':'up_to_date',installed:runtime.version,available:info.version};
  if(order<0)return {status:'newer_than_release',installed:runtime.version,available:info.version};
  const observeModels=async force=>{
   try{return await refreshModels(runtimeFile,harnessDir,{force});}catch{return {status:'unavailable'};}
  };
  const reconnect=async()=>{
   const plans=planConnections(read(runtimeFile),read(runtimeFile).version,{home,env}),result=[];
   for(const p of plans){
    if(p.status!=='planned'){result.push({harness:p.harness,status:p.status});continue;}
    result.push({harness:p.harness,...(p.type==='codex'?await reload(p.executable):{status:'native_reconnect_required'})});
   }
   return result;
  };
  if(order===0){
   const health=await verify(runtimeFile,harnessDir);
   const edits=planConnections(runtime,runtime.version,{home,env}).filter(p=>p.status==='planned'&&p.before!==p.after).map(p=>({path:p.file,before:p.before,after:p.after}));
   if(edits.length){
    save(path.join(data,'connection-backup.json'),{files:edits});
    try{for(const f of edits){if(fs.readFileSync(f.path,'utf8')!==f.before)throw Error('CONFIG_CHANGED_DURING_UPDATE');atomic(f.path,f.after,true);}}
    catch(e){for(const f of edits)if(fs.readFileSync(f.path,'utf8')===f.after)atomic(f.path,f.before,true);throw e;}
   }
   const model_catalogue=await observeModels(false);
   const connections=await reconnect();save(path.join(data,'update-report.json'),{installed:runtime.version,health,connections,model_catalogue,restart_policy:'ask'});
   return {status:'up_to_date',installed:runtime.version,health,connections,model_catalogue,restart_policy:'ask'};
  }
  if(info.version.split('.')[0]!==runtime.version.split('.')[0])throw Error('MAJOR_UPGRADE_REQUIRES_MIGRATION');
  const cache=path.join(data,'release-cache');fs.mkdirSync(cache,{recursive:true,mode:0o700});if(fs.realpathSync(cache)!==cache)throw Error('UPDATE_LINK_NOT_ALLOWED');
  const candidate=await getPackage(info,cache,{fetchImpl}),previous=await getPackage(await releaseInfo(runtime.version,{fetchImpl}),cache,{fetchImpl});
  if(candidate.build.schema_version!==6||candidate.build.writer_version!==6)throw Error('SCHEMA_UPGRADE_REQUIRES_MIGRATION');
  const app=path.join(root,'app');safeTree(app);
  for(const [name,bytes] of previous.files){const file=path.join(app,name);if(!fs.existsSync(file)||!same(fs.readFileSync(file),bytes,name))throw Error('LOCAL_APP_MODIFIED');}
  for(const name of candidate.files.keys())if(!previous.files.has(name)&&fs.existsSync(path.join(app,name)))throw Error('LOCAL_APP_COLLISION');
  const plans=planConnections(runtime,info.version,{home,env});
  const files=plans.filter(p=>p.status==='planned'&&p.before!==p.after).map(p=>({path:p.file,before:p.before,after:p.after}));
  for(const folder of [path.join(home,'.agents','skills','harness-interop'),path.join(env.CODEX_HOME||path.join(home,'.codex'),'skills','harness-interop'),path.join(env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),'skills','harness-interop')]){
   const file=path.join(folder,'SKILL.md');if(!fs.existsSync(file))continue;
   const real=fs.realpathSync(file);
   // Standard installations link the shared skill to this verified package.
   // The app swap updates that canonical file; never copy through the alias.
   if(real===path.join(app,'skills','harness-interop','SKILL.md'))continue;
   if(real!==file)throw Error('SKILL_LINK_NOT_ALLOWED');
   const before=fs.readFileSync(file,'utf8'),old=previous.files.get('skills/harness-interop/SKILL.md');
   if(!same(Buffer.from(before),old,'SKILL.md'))throw Error('LOCAL_SKILL_MODIFIED');
   files.push({path:file,before,after:candidate.files.get('skills/harness-interop/SKILL.md').toString('utf8')});
  }
  const updates=path.join(data,'updates');fs.mkdirSync(updates,{recursive:true,mode:0o700});if(fs.realpathSync(updates)!==updates)throw Error('UPDATE_LINK_NOT_ALLOWED');
  const txn=path.join(updates,randomUUID());fs.mkdirSync(txn,{mode:0o700});const staged=path.join(txn,'new-app');
  fs.cpSync(app,staged,{recursive:true});
  for(const name of previous.files.keys())if(!candidate.files.has(name)){const p=path.join(staged,name);within(staged,p);fs.unlinkSync(p);}
  for(const [name,bytes] of candidate.files){const p=path.join(staged,name);within(staged,p);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes,{mode:0o600});}
  for(const [name,file] of [['stdio.mjs',runtime.bundle],['client.mjs',runtime.client_bundle],['runtime.json',runtimeFile]])fs.copyFileSync(file,path.join(txn,name));
  const state={phase:'applying',txn,files,from:runtime.version,to:info.version};const journal=path.join(data,'update-state.json');save(journal,state);
  try{
   for(const f of files)if(fs.readFileSync(f.path,'utf8')!==f.before)throw Error('CONFIG_CHANGED_DURING_UPDATE');
   checkpoint('staged');within(root,app);within(root,staged);within(root,path.join(txn,'old-app'));
   fs.renameSync(app,path.join(txn,'old-app'));fs.renameSync(staged,app);
   atomic(runtime.bundle,candidate.files.get('service/dist/stdio.mjs'));atomic(runtime.client_bundle,candidate.files.get('service/dist/client.mjs'));
   save(runtimeFile,{...runtime,version:info.version,bundle_sha256:hash(candidate.files.get('service/dist/stdio.mjs')),client_sha256:hash(candidate.files.get('service/dist/client.mjs'))});
   for(const f of files){if(fs.readFileSync(f.path,'utf8')!==f.before)throw Error('CONFIG_CHANGED_DURING_UPDATE');atomic(f.path,f.after,true);}
   checkpoint('activated');const health=await verify(runtimeFile,harnessDir);
   save(journal,{...state,phase:'installed',health});
   save(path.join(txn,'owned-update.json'),{kind:'ihcp3k-update',status:'installed',at:Date.now()});
   const model_catalogue=await observeModels(true);
   let connections;try{connections=await reconnect();}catch{connections=[{status:'native_reconnect_required'}];}
   save(path.join(data,'update-report.json'),{installed:info.version,health,connections,model_catalogue,restart_policy:'ask'});
   try{prune(data,info.version,runtime.version);}catch{/* Retain backups if safe pruning cannot be established. */}
   return {status:'updated',installed:info.version,previous:runtime.version,health,connections,model_catalogue,restart_policy:'ask'};
  }catch(e){rollback(state,root);save(journal,{...state,phase:'rolled_back'});throw e;}
 }finally{release();}
}
