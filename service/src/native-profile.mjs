import {spawn,spawnSync} from 'node:child_process';
import {resolveExecutable} from './trusted-executable.mjs';
import {ServiceError} from './store.mjs';
export async function observeNativeProfile(config,previous,{spawnProcess=spawn,runVersion=spawnSync,now=()=>new Date().toISOString()}={}){
 const executable=resolveExecutable(config),v=runVersion(executable,['--version'],{windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:65536,cwd:config.cwd});
 if(v.error||v.status!==0||!v.stdout?.trim())throw new ServiceError('NATIVE_VERSION_UNAVAILABLE');
 const native_version=v.stdout.trim().slice(0,200),observed_at=now();
 if(config.type!=='codex')return {...previous,native_version,observed_at,models:previous.models.map(m=>({...m,access:'unknown',source:'No verified native model-list adapter; previous catalogue is advisory'})),source:'Native --version; model access unknown (no supported catalogue adapter)'};
 const models=await new Promise((resolve,reject)=>{
  let child,buffer='',bytes=0,seq=1,cursor=null,finished=false,error;const models=[],cursors=new Set();
  const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
  const stop=e=>{if(finished)return;error=e;finished=true;child?.stdin.end();child?.kill();};
  try{child=spawnProcess(executable,config.transport==='proxy'?['app-server','proxy']:['app-server','--stdio'],{cwd:config.cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch{reject(new ServiceError('NATIVE_PROFILE_START_FAILED'));return;}
  const timer=setTimeout(()=>stop(new ServiceError('NATIVE_PROFILE_TIMEOUT')),config.timeout_ms??15000);
  child.on('error',()=>stop(new ServiceError('NATIVE_PROFILE_START_FAILED')));child.stdin.on('error',()=>stop(new ServiceError('NATIVE_PROFILE_WRITE_FAILED')));
  child.stderr.on('data',d=>{bytes+=d.length;if(bytes>4194304)stop(new ServiceError('NATIVE_PROFILE_OUTPUT_LIMIT'));});
  child.stdout.on('data',d=>{bytes+=d.length;if(bytes>4194304){stop(new ServiceError('NATIVE_PROFILE_OUTPUT_LIMIT'));return;}buffer+=d;
   for(let n;(n=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;
    try{const m=JSON.parse(line);if(m.method&&m.id!==undefined){send({id:m.id,error:{code:-32601,message:'Read-only profile observer'}});continue;}if(m.id===undefined)continue;if(m.id!==seq||m.error)throw new ServiceError('NATIVE_PROFILE_RPC_FAILED');
     if(seq===1){send({method:'initialized'});}else{
      if(!Array.isArray(m.result?.data))throw new ServiceError('NATIVE_PROFILE_INVALID_MODELS');
      for(const row of m.result.data){if(typeof row.id!=='string'||!row.id||row.id.length>200||models.some(x=>x.id===row.id))throw new ServiceError('NATIVE_PROFILE_INVALID_MODELS');models.push({id:row.id,access:'available',source:'Native model/list at '+observed_at});}
      if(models.length>200)throw new ServiceError('NATIVE_PROFILE_MODEL_LIMIT');cursor=m.result.nextCursor;
      if(cursor===null){finished=true;child.stdin.end();continue;}
      if(typeof cursor!=='string'||!cursor||cursors.has(cursor)||cursors.size>=100)throw new ServiceError('NATIVE_PROFILE_INVALID_CURSOR');cursors.add(cursor);
     }
     if(!finished)send({id:++seq,method:'model/list',params:{limit:100,cursor}});
    }catch(e){stop(e);}
   }
  });
  child.on('close',code=>{clearTimeout(timer);if(error)reject(error);else if(!finished||code!==0)reject(new ServiceError('NATIVE_PROFILE_INCOMPLETE'));else resolve(models);});
  send({id:1,method:'initialize',params:{clientInfo:{name:'ihcp3k_profile',version:'1.4.0'}}});
 });
 return {...previous,native_version,observed_at,models,source:'Native --version and paginated read-only model/list; usage observations retained with original timestamps'};
}
