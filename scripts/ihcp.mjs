#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {parseInvocation} from './usage.mjs';
import {resolveTarget} from './resolve-target.mjs';
import {desktopOpener} from './desktop-open.mjs';
import {listenInbox} from './listen-inbox.mjs';
import {update} from './update.mjs';
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
const connection=location=>/^[a-z]+:\/\//i.test(location)?{url:location}:{runtimeFile:path.resolve(location)};
const storedConnection=location=>/^[a-z]+:\/\//i.test(location)?{url:location}:{runtime_file:path.resolve(location)};
function operatorLocation(location) {
 const runtime=read(location);
 return runtime.transport==='stdio'?path.resolve(location):`http://127.0.0.1:${runtime.port}/mcp`;
}
async function withClient(location,tokenFile,fn){const c=await connect({...connection(location),tokenFile});try{return await fn(c);}finally{await c.close();}}
export async function runWorker(client,{timeout_ms=330000,...request},{invoke=call,now=Date.now,stdio=false}={}) {
 if(!Number.isInteger(timeout_ms)||timeout_ms<1||timeout_ms>3600000)throw Error('INVALID_WORKER_WAIT_TIMEOUT');
 const started=await invoke(client,'worker.start',request),until=now()+timeout_ms;
 let result=await invoke(client,'worker.status',{id:started.id});
 while(result.state==='running') {
   const remaining=until-now();
   if(remaining<=0)return {...result,wait_timed_out:true,...(stdio?{connection_closing:true,delivery_limitation:'Closing stdio cancels jobs owned by this connection; reconcile with worker-status.'}:{})};
   result=await invoke(client,'worker.wait',{id:started.id,timeout_ms:Math.min(25000,remaining)});
 }
 // Persist the returned result before explicitly using worker-ack. No autoack.
 return result;
}
export async function runRemotePrompt(client,{session_id,...request},{invoke=call}={}){
 if(request.recipient!==undefined){
   if(request.harness!==undefined||request.allow_new_session!==undefined)throw Error('AMBIGUOUS_REMOTE_DESTINATION');
   return invoke(client,'session.request',{session_id,...request});
 }
 const started=await invoke(client,'session.remote_prompt',{session_id,...request});
 let result=await invoke(client,'session.worker_status',{session_id,id:started.id});
 // Keep the owner connection open through the result. No background relay or
 // notification is required for this single native worker.
 while(result.state==='running')result=await invoke(client,'session.worker_wait',{session_id,id:started.id,timeout_ms:25000});
 return {...result,harness:started.harness,reply_to:started.reply_to,model:started.model,working_folder:started.working_folder,permissions:started.permissions};
}
export async function main(args=process.argv.slice(2)){
 const parsed=parseInvocation(args);
 if(parsed.help)return parsed;
 const mode=parsed.mode==='unregister'?'unlink':parsed.mode;
 const [location,input,output,extra]=parsed.args;
 if(mode==='update')return update(location,{check:parsed.check});
 if(mode==='inspect'){
   return withClient(operatorLocation(location),path.join(path.dirname(location),'tokens','admin.tok'),c=>call(c,'directory.inspect',read(input)));
 }
 if(mode==='enroll'){
   const target=operatorLocation(location),grant=read(input);
   if(!output||fs.existsSync(output))throw Error('NEW_PRIVATE_ENROLMENT_FILE_REQUIRED');
   // Reserve the output before minting the code, avoiding accidental secret loss.
   const fd=fs.openSync(output,'wx',0o600);
   try{
     const result=await withClient(target,path.join(path.dirname(location),'tokens','admin.tok'),c=>call(c,'directory.enroll',grant));
     fs.writeFileSync(fd,result.enrolment_token+'\n');
     return {endpoint:result.endpoint,expires_at:result.expires_at,credential_file:output};
   }finally{fs.closeSync(fd);}
 }
 if(mode==='register'){
   // One private credential/configuration per harness. Native sessions require no enrolment.
   const dir=path.resolve(output),details=read(input),requestFile=path.join(dir,'registration.json');
   let request;
   if(!fs.existsSync(dir)){
     privateDir(dir);request={...details,runtime_file:path.resolve(location),credential:randomBytes(32).toString('base64url')};
     write(requestFile,request);fs.writeFileSync(path.join(dir,'harness.tok'),request.credential+'\n',{flag:'wx',mode:0o600});
   }else{
     request=read(requestFile);const {credential,runtime_file,...saved}=request;
     if(runtime_file!==path.resolve(location)||JSON.stringify(saved)!==JSON.stringify(details))throw Error('REGISTRATION_RETRY_MISMATCH');
     const stateFile=path.join(dir,'harness.json'),state=fs.existsSync(stateFile)?read(stateFile):null;
     if(state?.linked===false&&!state.registration_pending){
       request={...request,credential:randomBytes(32).toString('base64url')};write(requestFile,request);
       fs.writeFileSync(path.join(dir,'harness.tok'),request.credential+'\n',{mode:0o600});
       write(stateFile,{...state,registration_pending:true});
     }

   }
   const {runtime_file,...payload}=request;
   const result=await withClient(operatorLocation(location),path.join(path.dirname(location),'tokens','admin.tok'),c=>call(c,'harness.register',payload));
   write(path.join(dir,'harness.json'),{...result,runtime_file,linked:true});
   return {...result,harness_dir:dir,mcp:{command:process.execPath,args:[read(location).bundle,runtime_file,path.join(dir,'harness.tok')]}};
 }
 if(mode==='register-session'){
   // register <url|runtime.json> <enrolment-file> <profile-and-private-binding.json> <new-session-dir>
   const dir=path.resolve(extra),details=read(output),codeHash=createHash('sha256').update(fs.readFileSync(input,'utf8').trim()).digest('hex');
   const requestFile=path.join(dir,'registration.json');let request;
   if(!fs.existsSync(dir)){
     privateDir(dir);
     request={code_hash:codeHash,...storedConnection(location),profile:details.profile,binding:details.binding??{},session_token:randomBytes(32).toString('base64url'),wake_token:randomBytes(32).toString('base64url')};
     write(requestFile,request);
     fs.writeFileSync(path.join(dir,'session.tok'),request.session_token+'\n',{flag:'wx',mode:0o600});
     fs.writeFileSync(path.join(dir,'wake.tok'),request.wake_token+'\n',{flag:'wx',mode:0o600});
   }else{
     request=read(requestFile);
     if(request.code_hash!==codeHash||(request.runtime_file??request.url)!==(storedConnection(location).runtime_file??location)||JSON.stringify(request.profile)!==JSON.stringify(details.profile)||JSON.stringify(request.binding)!==JSON.stringify(details.binding??{}))throw Error('REGISTRATION_RETRY_MISMATCH');
   }
   const {code_hash,url,runtime_file,...payload}=request;
   const result=await withClient(location,input,c=>call(c,'directory.register',payload));
   write(path.join(dir,'session.json'),{...result,...storedConnection(location),linked:true});
   return {...result,session_dir:dir};
 }
 const dir=path.resolve(location),harnessFile=path.join(dir,'harness.json');
 if(fs.existsSync(harnessFile)){
   const harness=read(harnessFile);
   if(mode==='unlink'&&!harness.linked)return {harness:harness.harness,registered:false};
   if(!harness.linked)throw Error('HARNESS_UNREGISTERED');
   return withClient(harness.runtime_file,path.join(dir,'harness.tok'),async c=>{
     if(mode==='discover'||mode==='refresh')return call(c,'harness.discover',{force:mode==='refresh',...(input?read(input):{})});
     if(mode==='resolve')return resolveTarget(c,read(input),{invoke:call,openDesktop:desktopOpener({runtimeFile:harness.runtime_file,journalDir:path.join(dir,'wake-attempts')})});
     if(mode==='listen'){
       const stop=new AbortController(),cancel=()=>stop.abort();
       process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
       try{return await listenInbox(c,read(input),{invoke:call,signal:stop.signal});}
       finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
     }
     if(mode==='unlink'){const result=await call(c,'harness.unregister',{});write(harnessFile,{...harness,linked:false});return result;}
     if(mode==='remote_prompt')return runRemotePrompt(c,read(input));
     if(mode==='status'&&input){const payload=read(input);if(payload.worker_id)return call(c,'session.worker_status',{session_id:payload.session_id,id:payload.worker_id});}
     if(['worker','worker-status','worker-ack'].includes(mode)){
       if(!input)return parseInvocation([mode,'--help']);
       const {session_id,...payload}=read(input);
       if(mode==='worker')return runWorker(c,payload,{stdio:true,invoke:(client,name,args)=>call(client,'session.'+name.replace('.','_'),{session_id,...args})});
       return call(c,mode==='worker-status'?'session.worker_status':'session.worker_ack',{session_id,...payload});
     }
     const operations={remote_prompt:'request',exchange:'exchange',wait:'wait',unattend:'unattend',check:'claim',status:'status',reply:'reply',send:'send',complete:'complete',renew:'renew',release:'release'};
     if(!operations[mode])throw Error('MODE_REQUIRES_SESSION_WORKER_CONFIGURATION');
     if(!input)return parseInvocation([mode,'--help']);
     const payload=read(input),op=mode==='status'&&payload.id?'request_status':operations[mode];
     return call(c,'session.'+op,payload);
   });
 }
 const file=path.join(dir,'session.json'),session=read(file);
 if(mode==='unlink'&&!session.linked)return {endpoint:session.endpoint,linked:false};
 if(!session.linked)throw Error('SESSION_UNLINKED');
 return withClient(session.runtime_file??session.url,path.join(dir,'session.tok'),async c=>{
   if(mode==='discover')return call(c,'directory.discover',input?read(input):{});
   if(mode==='check')return call(c,'mail.claim',{recipient:session.endpoint,handler_id:'shared-skill',limit:10,lease_s:300});
   if(mode==='status')return input?call(c,'mail.request_status',read(input)):call(c,'mail.status',{recipient:session.endpoint});
   if(mode==='worker')return runWorker(c,read(input),{stdio:!!session.runtime_file});
   if(mode==='worker-status'||mode==='worker-ack')return call(c,mode==='worker-status'?'worker.status':'worker.ack',read(input));
   // Explicit JSON arguments only; remote_prompt means a stored request, not activation,
   // native wake setup, prompt inference, or an automatically selected worker.
   if(mode==='remote_prompt')return call(c,'mail.request',read(input));
   if(mode==='reply')return call(c,'mail.reply',read(input));
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
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().then(result=>console.log(result.help?result.text:JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
