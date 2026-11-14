#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',windowsHide:true});if(r.status!==0||r.error)throw Error('SETUP_COMMAND_FAILED: '+bin);return r.stdout.trim();}
function privateDirectory(dir){
 fs.mkdirSync(dir,{mode:0o700});
 if(process.platform==='win32'){
   const who=run('whoami',[]);
   run('icacls',[dir,'/inheritance:r','/grant:r',who+':(OI)(CI)F','SYSTEM:(OI)(CI)F']);
 }
}
export async function install(target,{port=43188,name='ihcp3k-live'}={}){
 if(!target||!Number.isInteger(port)||port<1024||port>65535||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))throw Error('INVALID_INSTALL_ARGUMENTS');
 const dir=path.resolve(target),runtimeFile=path.join(dir,'runtime.json'),lock=dir+'.install.lock';
 // A sibling lock coordinates installers even before the private root exists.
 const fd=fs.openSync(lock,'wx',0o600);
 try{
   const existing=fs.existsSync(dir);
   let cfg;
   if(existing){
     if(!fs.existsSync(runtimeFile))throw Error('INCOMPLETE_INSTALL_REQUIRES_REVIEW');
     cfg=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
     if(cfg.port!==port||cfg.name!==name)throw Error('INSTALL_CONFIGURATION_MISMATCH');
   }else{
     // An occupied port is not evidence of a trusted IHCP3K instance.
     const net=await import('node:net');
     await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error('PORT_OCCUPIED')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
     const volumes=run('docker',['volume','ls','--format','{{.Name}}']).split(/\r?\n/);
     if(volumes.includes(name+'-data')||volumes.includes(name+'-backups'))throw Error('EXISTING_VOLUME_REQUIRES_REVIEW');
     privateDirectory(dir);fs.mkdirSync(path.join(dir,'tokens'),{mode:0o700});
     const admin=randomBytes(32).toString('base64url'),serviceId=randomUUID();
     const config={mode:'live',synthetic:false,service_id:serviceId,recipients:['bootstrap'],principals:[{id:'admin',token:admin,permissions:['admin','status','registry'],scopes:{admin:['bootstrap'],status:['bootstrap'],registry:['bootstrap']}}]};
     fs.writeFileSync(path.join(dir,'tokens','admin.tok'),admin+'\n',{flag:'wx',mode:0o600});
     fs.writeFileSync(path.join(dir,'service.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
     run('docker',['build','--quiet','-t','ihcp3k-service:0.4.0',path.join(root,'service')]);
     const image=run('docker',['image','inspect','ihcp3k-service:0.4.0','--format','{{.Id}}']);
     if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('INVALID_IMAGE_ID');
     cfg={name,port,image,service_id:serviceId,data_volume:name+'-data',backup_volume:name+'-backups',service_config:path.join(dir,'service.json')};
     fs.writeFileSync(runtimeFile,JSON.stringify(cfg,null,2)+'\n',{flag:'wx',mode:0o600});
     run(process.execPath,[path.join(root,'scripts','ops.mjs'),runtimeFile,'start']);
   }
   const identity=JSON.parse(run('docker',['inspect',cfg.name]))[0];
   const label=createHash('sha256').update(runtimeFile).digest('hex');
   if(identity.Config.Labels?.['org.ihcp3k.runtime']!==label||!identity.State.Running||identity.Image!==cfg.image||!identity.Mounts.some(m=>m.Name===cfg.data_volume&&m.Destination==='/data'))throw Error('SERVICE_OWNERSHIP_MISMATCH');
   const admin=fs.readFileSync(path.join(dir,'tokens','admin.tok'),'utf8').trim();
   let health;
   for(let i=0;i<20;i++){
     try{const r=await fetch(`http://127.0.0.1:${cfg.port}/health`,{headers:{Authorization:`Bearer ${admin}`},signal:AbortSignal.timeout(1000)});if(r.ok){health=await r.json();break;}}catch{}
     await new Promise(resolve=>setTimeout(resolve,100));
   }
   if(health?.service_id!==cfg.service_id||!health.owner_lock||health.protocol_version!=='0.4.0')throw Error('SERVICE_HEALTH_MISMATCH');
   return {status:existing?'reused':'installed',runtime:runtimeFile,endpoint:`http://127.0.0.1:${cfg.port}/mcp`,version:health.protocol_version};
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [target,port,name]=process.argv.slice(2);
 install(target,{...(port?{port:Number(port)}:{}),...(name?{name}:{})}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
