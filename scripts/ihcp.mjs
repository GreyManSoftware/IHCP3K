#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {connect,call,exchange} from '../service/dist/client.mjs';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n',{mode:0o600});
function privateDir(dir){
 fs.mkdirSync(dir,{mode:0o700});
 if(process.platform==='win32'){
   const who=spawnSync('whoami',[],{encoding:'utf8',windowsHide:true});
   if(who.status!==0)throw Error('PRIVATE_IDENTITY_FAILED');
   const r=spawnSync('icacls',[dir,'/inheritance:r','/grant:r',who.stdout.trim()+':(OI)(CI)F','SYSTEM:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
   if(r.status!==0)throw Error('PRIVATE_ACL_FAILED');
 }
}
async function withClient(url,tokenFile,fn){const c=await connect({url,tokenFile});try{return await fn(c);}finally{await c.close();}}
export async function main(args=process.argv.slice(2)){
 const [mode,location,input,output,extra]=args;
 if(mode==='inspect'){
   const runtime=read(location);
   return withClient(`http://127.0.0.1:${runtime.port}/mcp`,path.join(path.dirname(location),'tokens','admin.tok'),c=>call(c,'directory.inspect',read(input)));
 }
 if(mode==='enroll'){
   const runtime=read(location),grant=read(input);
   if(!output||fs.existsSync(output))throw Error('NEW_PRIVATE_ENROLMENT_FILE_REQUIRED');
   // Reserve the output before minting the code, avoiding accidental secret loss.
   const fd=fs.openSync(output,'wx',0o600);
   try{
     const result=await withClient(`http://127.0.0.1:${runtime.port}/mcp`,path.join(path.dirname(location),'tokens','admin.tok'),c=>call(c,'directory.enroll',grant));
     fs.writeFileSync(fd,result.enrolment_token+'\n');
     return {endpoint:result.endpoint,expires_at:result.expires_at,credential_file:output};
   }finally{fs.closeSync(fd);}
 }
 if(mode==='register'){
   // register <url> <enrolment-file> <profile-and-private-binding.json> <new-session-dir>
   const dir=path.resolve(extra),details=read(output),codeHash=createHash('sha256').update(fs.readFileSync(input,'utf8').trim()).digest('hex');
   const requestFile=path.join(dir,'registration.json');let request;
   if(!fs.existsSync(dir)){
     privateDir(dir);
     request={code_hash:codeHash,url:location,profile:details.profile,binding:details.binding??{},session_token:randomBytes(32).toString('base64url'),wake_token:randomBytes(32).toString('base64url')};
     write(requestFile,request);
     fs.writeFileSync(path.join(dir,'session.tok'),request.session_token+'\n',{flag:'wx',mode:0o600});
     fs.writeFileSync(path.join(dir,'wake.tok'),request.wake_token+'\n',{flag:'wx',mode:0o600});
   }else{
     request=read(requestFile);
     if(request.code_hash!==codeHash||request.url!==location||JSON.stringify(request.profile)!==JSON.stringify(details.profile)||JSON.stringify(request.binding)!==JSON.stringify(details.binding??{}))throw Error('REGISTRATION_RETRY_MISMATCH');
   }
   const {code_hash,url,...payload}=request;
   const result=await withClient(location,input,c=>call(c,'directory.register',payload));
   write(path.join(dir,'session.json'),{...result,url:location,linked:true});
   return {...result,session_dir:dir};
 }
 const dir=path.resolve(location),file=path.join(dir,'session.json'),session=read(file);
 if(mode==='unlink'&&!session.linked)return {endpoint:session.endpoint,linked:false};
 if(!session.linked)throw Error('SESSION_UNLINKED');
 return withClient(session.url,path.join(dir,'session.tok'),async c=>{
   if(mode==='discover')return call(c,'directory.discover',input?read(input):{});
   if(mode==='check')return call(c,'mail.claim',{recipient:session.endpoint,handler_id:'shared-skill',limit:10,lease_s:300});
   if(mode==='send'||mode==='exchange'){
     const message=read(input);
     return mode==='send'?call(c,'mail.send',message):exchange(c,{...message,inbox:session.endpoint,handler_id:'shared-skill'});
   }
   if(mode==='complete'||mode==='renew'||mode==='release')return call(c,'mail.'+mode,read(input));
   if(mode==='refresh'){
     const result=await call(c,'directory.refresh',{endpoint:session.endpoint,expected_revision:session.revision,profile:read(input)});
     write(file,{...session,...result});return result;
   }
   if(mode==='unlink'){
     const result=await call(c,'directory.deregister',{endpoint:session.endpoint,expected_revision:session.revision});
     write(file,{...session,revision:result.revision,linked:false});return result;
   }
   throw Error('UNKNOWN_MODE');
 });
}
main().then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
