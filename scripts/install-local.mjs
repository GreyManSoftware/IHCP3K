#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
function run(command,args,env=process.env) {
  const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true,env});
  if(result.error||result.status!==0)throw Error('PRIVATE_ACL_FAILED');
  return result.stdout.trim();
}
function privateDirectory(dir) {
  fs.mkdirSync(dir,{mode:0o700});
  if(process.platform==='win32') {
    const who=run('whoami',[]);
    // Apply before any secret is created. A fresh directory has no explicit ACEs.
    run('icacls',[dir,'/inheritance:r','/grant:r',who+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F']);
  }
}
function verifyPrivate(dir,entries) {
  for(const file of [dir,...entries]) {
    const stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()||fs.realpathSync(file)!==path.resolve(file))throw Error('RUNTIME_LINK_NOT_ALLOWED');
    if(process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid()))throw Error('PRIVATE_PERMISSIONS_REQUIRED');
  }
  if(process.platform==='win32') {
    // Use an environment value, never interpolate a chosen path into shell code.
    const script=`$ErrorActionPreference='Stop'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$files=ConvertFrom-Json $env:IHCP_PRIVATE_FILES
foreach($file in $files){
  $acl=if([System.IO.Directory]::Exists($file)){[System.IO.Directory]::GetAccessControl($file)}else{[System.IO.File]::GetAccessControl($file)}
  if($file -eq $env:IHCP_PRIVATE_ROOT -and !$acl.AreAccessRulesProtected){throw 'inherited root'}
  foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid -and $rule.IdentityReference.Value -ne 'S-1-5-18'){throw 'public ACL'}
  }
}`;
    run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{...process.env,IHCP_PRIVATE_ROOT:dir,IHCP_PRIVATE_FILES:JSON.stringify([dir,...entries])});
  }
}
export async function install(target,{backupFile,sha256,workingDirectory=target}={}) {
  process.umask(0o077);
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(!(major>24||major===24&&minor>=15))throw Error('NODE_24_15_REQUIRED');
  if(typeof target!=='string'||!path.isAbsolute(target)||path.resolve(target)===path.parse(target).root)throw Error('EXPLICIT_PRIVATE_DIRECTORY_REQUIRED');
  if(typeof workingDirectory!=='string'||!path.isAbsolute(workingDirectory))throw Error('EXPLICIT_WORKING_DIRECTORY_REQUIRED');
  const dir=path.resolve(target),runtimeFile=path.join(dir,'runtime.json'),lock=dir+'.install.lock';
  // Parent must already exist; no guessed destination, live state import, or upgrade.
  if(fs.realpathSync(path.dirname(dir))!==path.dirname(dir))throw Error('RUNTIME_LINK_NOT_ALLOWED');
  const fd=fs.openSync(lock,'wx',0o600);
  try {
    const existing=fs.existsSync(dir);
    if(existing&&backupFile)throw Error('MIGRATION_REQUIRES_NEW_DIRECTORY');
    if(Boolean(backupFile)!==Boolean(sha256)||backupFile&&(!path.isAbsolute(backupFile)||!/^[a-f0-9]{64}$/.test(sha256)))throw Error('INVALID_BACKUP_ARGUMENTS');
    if(existing&&!fs.existsSync(runtimeFile))throw Error('INCOMPLETE_INSTALL_REQUIRES_REVIEW');
    if(!existing) {
      // Read both release artifacts before creating private state. No npm/Docker here.
      const stdio=fs.readFileSync(path.join(root,'service','dist','stdio.mjs'));
      const client=fs.readFileSync(path.join(root,'service','dist','client.mjs'));
      privateDirectory(dir);
      fs.mkdirSync(path.join(dir,'tokens'),{mode:0o700});
      fs.mkdirSync(path.join(dir,'bundles'),{mode:0o700});
      verifyPrivate(dir,[path.join(dir,'tokens'),path.join(dir,'bundles')]);
      const serviceId=randomUUID(),admin=randomBytes(32).toString('base64url');
      fs.writeFileSync(path.join(dir,'tokens','admin.tok'),admin+'\n',{flag:'wx',mode:0o600});
      write(path.join(dir,'service.json'),{mode:'live',synthetic:false,service_id:serviceId,recipients:['bootstrap'],principals:[{id:'admin',token:admin,permissions:['admin','status','registry'],scopes:{admin:['bootstrap'],status:['bootstrap'],registry:['bootstrap']}}]});
      fs.writeFileSync(path.join(dir,'bundles','stdio.mjs'),stdio,{flag:'wx',mode:0o600});
      fs.writeFileSync(path.join(dir,'bundles','client.mjs'),client,{flag:'wx',mode:0o600});
      if(!fs.statSync(workingDirectory).isDirectory())throw Error('WORKING_DIRECTORY_REQUIRED');
      write(runtimeFile,{transport:'stdio',version:'1.3.0',schema_version:6,initialized:false,service_id:serviceId,private_dir:dir,working_directory:path.resolve(workingDirectory),database:path.join(dir,'mail.db'),service_config:path.join(dir,'service.json'),bundle:path.join(dir,'bundles','stdio.mjs'),client_bundle:path.join(dir,'bundles','client.mjs'),bundle_sha256:digest(stdio),client_sha256:digest(client),notifications:{},workers:{}});
      if(backupFile){
        // Import an integrity-checked snapshot into a NEW private root only.
        // No source mutation, native relink, unpause, or service cutover occurs.
        const {DatabaseSync}=await import('node:sqlite');
        const {restore}=await import('../service/src/backup.mjs');
        const {SharedStore}=await import('../service/src/shared-store.mjs');
        const source=new DatabaseSync(backupFile,{readOnly:true});let recipients;
        try{recipients=[...new Set(['bootstrap',...source.prepare('SELECT recipient FROM messages UNION SELECT recipient FROM pauses').all().map(r=>r.recipient)])];}finally{source.close();}
        const database=path.join(dir,'mail.db');
        const restored=restore(backupFile,database,{sha256,recipients});
        fs.chmodSync(database,0o600);
        const imported=new SharedStore(database,{recipients});
        try{imported.transaction(()=>{
          imported.db.prepare("INSERT OR REPLACE INTO metadata VALUES('service_id',?)").run(serviceId);
          imported.db.prepare("INSERT OR REPLACE INTO metadata VALUES('migration',?)").run(JSON.stringify({from_sha256:sha256,pause_id:restored.pause_id}));
        });}finally{imported.close();}
      }
    }
    const tokenFile=path.join(dir,'tokens','admin.tok');
    const entries=['runtime.json','service.json','tokens','tokens/admin.tok','bundles','bundles/stdio.mjs','bundles/client.mjs'].map(name=>path.join(dir,name));
    for(const suffix of ['','-wal','-shm','.owner'])if(fs.existsSync(path.join(dir,'mail.db'+suffix)))entries.push(path.join(dir,'mail.db'+suffix));
    verifyPrivate(dir,entries);
    // Validate the copied client before importing executable code from the chosen root.
    const manifest=read(runtimeFile),clientFile=path.join(dir,'bundles','client.mjs');
    if(manifest.client_bundle!==clientFile||digest(fs.readFileSync(clientFile))!==manifest.client_sha256)throw Error('RUNTIME_BUNDLE_MISMATCH');
    const {connect,readRuntime,verifyDatabase}=await import(pathToFileURL(clientFile).href);
    const runtime=readRuntime(runtimeFile),config=read(runtime.service_config),token=fs.readFileSync(tokenFile,'utf8').trim();
    if(runtime.working_directory&&runtime.working_directory!==path.resolve(workingDirectory))throw Error('WORKING_DIRECTORY_MISMATCH');
    const admin=config.principals?.find(p=>p.id==='admin');
    if(!admin||admin.token!==token||!admin.permissions.includes('registry'))throw Error('ADMIN_IDENTITY_MISMATCH');
    // Reuse is strictly read-only until schema and identity are established. In
    // particular, a v4 database must never be opened by the upgrading stdio store.
    const result={status:existing?'reused':'installed',runtime:runtimeFile,transport:'stdio',version:runtime.version,service_id:runtime.service_id};
    if(existing) {
      if(runtime.initialized!==true)throw Error('INCOMPLETE_INSTALL_REQUIRES_REVIEW');
      await verifyDatabase(runtime);
      // No process launch on reuse: configured notifications/workers remain inert.
      return result;
    }
    const client=await connect({runtimeFile,tokenFile});
    try {
      if(client.getServerVersion()?.version!=='1.3.0')throw Error('RUNTIME_VERSION_MISMATCH');
      const {tools}=await client.listTools();
      if(!tools.some(t=>t.name==='directory.enroll')||!tools.some(t=>t.name==='directory.inspect'))throw Error('RUNTIME_TOOLS_MISMATCH');
      await verifyDatabase(runtime);
    } finally {await client.close();}
    // SQLite inherits the private root ACL on Windows; owner-only modes on POSIX
    // are set by the runtime. Never repair widened permissions silently on reuse.
    verifyPrivate(dir,[runtime.database]);
    write(runtimeFile+'.ready',{...runtime,initialized:true});
    fs.renameSync(runtimeFile+'.ready',runtimeFile);
    return result;
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  let workingDirectory;const index=args.indexOf('--workdir');
  if(index>=0){workingDirectory=args[index+1];args.splice(index,2);}
  (args.length===1||args.length===3?install(args[0],{...(args.length===3?{backupFile:args[1],sha256:args[2]}:{}),...(workingDirectory?{workingDirectory}:{})}):Promise.reject(Error('Usage: install-local <absolute private directory> [offline-backup-file sha256] [--workdir chosen-working-folder]')))
    .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
