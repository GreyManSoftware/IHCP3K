import {spawn} from 'node:child_process';

// Apply restrictions after all native config layers. Keep authentication and
// enforced policy native; never copy credentials, change trust, or ignore rules.
export const restrictedCodexArgs=[
 '--disable','hooks','--disable','plugins','--disable','apps',
 '--disable','multi_agent','--disable','multi_agent_v2',
 '-c','agents.enabled=false','-c','web_search="disabled"'
];

// Read the effective configuration for this cwd before starting a model. Disable
// every configured MCP server by name, including servers in project layers.
// Unknown native interfaces fail closed. Returned config/credentials never leave
// this function; only validated server names are retained.
export function codexWorkerPolicy(command,{signal,spawnProcess=spawn}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('worker_policy_cancelled'));return;}
  let child,buffer='',size=0,servers,error,closed=false,timer,killTimer;
  const fail=reason=>{if(error||closed)return;error=reason;child?.stdin?.end();child?.kill();killTimer=setTimeout(()=>child?.kill('SIGKILL'),250);killTimer.unref?.();};
  const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
  const abort=()=>fail('worker_policy_cancelled');
  try{child=spawnProcess(command.executable,[...restrictedCodexArgs,'app-server','--stdio'],command.options);}
  catch{reject(Error('worker_policy_start_failed'));return;}
  timer=setTimeout(()=>fail('worker_policy_timeout'),10000);
  child.on('error',()=>fail('worker_policy_start_failed'));child.stdin.on('error',()=>fail('worker_policy_write_failed'));
  signal?.addEventListener('abort',abort,{once:true});
  child.stderr.on('data',d=>{size+=d.length;if(size>4*1024*1024)fail('worker_policy_output_limit');});
  child.stdout.on('data',d=>{
   size+=d.length;if(size>4*1024*1024){fail('worker_policy_output_limit');return;}
   buffer+=d;for(let n;(n=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;
    try{
     const m=JSON.parse(line);
     if(m.method&&m.id!==undefined){send({id:m.id,error:{code:-32601,message:'Read-only configuration inspection'}});continue;}
     if(m.id===undefined)continue;
     if(m.error)throw Error();
     if(m.id===1){send({method:'initialized'});send({id:2,method:'config/read',params:{cwd:command.options.cwd,includeLayers:false}});}
     else if(m.id===2){
      const config=m.result?.config;if(!config||typeof config!=='object'||Array.isArray(config))throw Error();
      const entries=config.mcp_servers??{};if(typeof entries!=='object'||Array.isArray(entries))throw Error();
      servers=Object.keys(entries);
      // Codex -c paths split on dots and do not decode quoted key components.
      // Reject unusual names rather than accidentally create a different server.
      if(servers.length>200||servers.some(s=>! /^[A-Za-z0-9_-]{1,200}$/.test(s)))throw Error();
      child.stdin.end();
     }else throw Error();
    }catch{fail('worker_policy_unverified');}
   }
  });
  child.on('close',code=>{
   closed=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);
   if(error||code!==0||!servers){reject(Error(error??'worker_policy_unverified'));return;}
   resolve(servers.flatMap(name=>['-c',`mcp_servers.${name}.enabled=false`]));
  });
  send({id:1,method:'initialize',params:{clientInfo:{name:'ihcp3k_worker_policy',version:'1.5.0'}}});
 });
}
