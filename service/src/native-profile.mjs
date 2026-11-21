import {spawn,spawnSync} from 'node:child_process';
import {resolveExecutable} from './trusted-executable.mjs';
import {ServiceError} from './store.mjs';
import {StringDecoder} from 'node:string_decoder';

export async function observeNativeProfile(config,previous,{
 spawnProcess=spawn,runVersion=spawnSync,now=()=>new Date().toISOString(),signal,executable=resolveExecutable(config)
}={}){
 if(signal?.aborted)throw new ServiceError('NATIVE_PROFILE_CANCELLED');
 const v=runVersion(executable,['--version'],{windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:65536,cwd:config.cwd});
 if(v.error||v.status!==0||!v.stdout?.trim())throw new ServiceError('NATIVE_VERSION_UNAVAILABLE');
 const native_version=v.stdout.trim().slice(0,200),observed_at=now();
 if(config.type!=='codex')return {...previous,native_version,observed_at,models:previous.models.map(m=>({...m,access:'unknown',source:'No verified native model-list adapter; previous catalogue is advisory'})),source:'Native --version; model access unknown (no supported catalogue adapter)'};
 const models=await new Promise((resolve,reject)=>{
  let child,buffer='',bytes=0,seq=1,cursor=null,complete=false,settled=false,exited=false,timer;
  const models=[],ids=new Set(),cursors=new Set(),decoder=new StringDecoder('utf8');
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const fail=code=>{
   if(settled)return;
   settled=true;cleanup();
   if(!exited)try{child?.kill('SIGKILL');}catch{/* Preserve the failure even if the child is gone. */}
   for(const stream of [child?.stdin,child?.stdout,child?.stderr])stream?.destroy?.();
   reject(new ServiceError(code));
  };
  const abort=()=>fail('NATIVE_PROFILE_CANCELLED');
  const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  try{child=spawnProcess(executable,config.transport==='proxy'?['app-server','proxy']:['app-server','--stdio'],{cwd:config.cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}
  catch{fail('NATIVE_PROFILE_START_FAILED');return;}
  timer=setTimeout(()=>fail('NATIVE_PROFILE_TIMEOUT'),config.timeout_ms??15000);
  child.on('spawn',()=>{if(settled&&!exited)try{child.kill('SIGKILL');}catch{/* Best effort. */}});
  child.on('exit',()=>{exited=true;});
  child.on('error',()=>fail('NATIVE_PROFILE_START_FAILED'));
  child.stdin.on('error',()=>fail('NATIVE_PROFILE_WRITE_FAILED'));
  child.stderr.on('data',d=>{bytes+=d.length;if(bytes>4194304)fail('NATIVE_PROFILE_OUTPUT_LIMIT');});
  child.stdout.on('data',d=>{
   if(settled)return;
   bytes+=d.length;if(bytes>4194304){fail('NATIVE_PROFILE_OUTPUT_LIMIT');return;}
   buffer+=decoder.write(d);
   for(let n;!settled&&(n=buffer.indexOf('\n'))>=0;){
    const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;
    try{
     const m=JSON.parse(line);
     if(m.method&&m.id!==undefined){if(!complete)send({id:m.id,error:{code:-32601,message:'Read-only profile observer'}});continue;}
     if(m.id===undefined)continue;
     if(complete||m.id!==seq||m.error)throw new ServiceError('NATIVE_PROFILE_RPC_FAILED');
     if(seq===1)send({method:'initialized'});
     else{
      if(!Array.isArray(m.result?.data))throw new ServiceError('NATIVE_PROFILE_INVALID_MODELS');
      for(const row of m.result.data){
       if(typeof row?.id!=='string'||!row.id||row.id.length>200||ids.has(row.id))throw new ServiceError('NATIVE_PROFILE_INVALID_MODELS');
       ids.add(row.id);models.push({id:row.id,access:'available',source:'Native model/list at '+observed_at});
      }
      if(models.length>200)throw new ServiceError('NATIVE_PROFILE_MODEL_LIMIT');
      cursor=m.result.nextCursor;
      if(cursor===null){complete=true;child.stdin.end();continue;}
      if(typeof cursor!=='string'||!cursor||cursors.has(cursor)||cursors.size>=100)throw new ServiceError('NATIVE_PROFILE_INVALID_CURSOR');
      cursors.add(cursor);
     }
     send({id:++seq,method:'model/list',params:{limit:100,cursor}});
    }catch(e){fail(e.code??'NATIVE_PROFILE_INVALID_OUTPUT');}
   }
  });
  child.on('close',code=>{
   exited=true;
   if(settled)return;
   if(!complete||code!==0){fail('NATIVE_PROFILE_INCOMPLETE');return;}
   settled=true;cleanup();resolve(models);
  });
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  try{send({id:1,method:'initialize',params:{clientInfo:{name:'ihcp3k_profile',version:'1.5.2'}}});}
  catch{fail('NATIVE_PROFILE_WRITE_FAILED');}
 });
 return {...previous,native_version,observed_at,models,source:'Native --version and paginated read-only model/list; usage observations retained with original timestamps'};
}
