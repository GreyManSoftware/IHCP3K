import path from 'node:path';
import {spawn} from 'node:child_process';
import {ServiceError} from './store.mjs';
import {resolveExecutable,validateResolution} from './trusted-executable.mjs';
const check=(v,c)=>{if(!v)throw new ServiceError(c);};
export function validateDiscovery(c){
 check(c&&['codex','claude'].includes(c.type),'DISCOVERY_UNSUPPORTED');
 validateResolution(c);
 check(typeof c.executable==='string'&&path.isAbsolute(c.executable)&&!/[\r\n]/.test(c.executable)&&! /\.(cmd|bat|ps1|sh)$/i.test(c.executable),'INVALID_DISCOVERY_EXECUTABLE');
 check(typeof c.cwd==='string'&&path.isAbsolute(c.cwd),'INVALID_DISCOVERY_CWD');
 check(c.transport===undefined||['stdio','proxy'].includes(c.transport),'INVALID_DISCOVERY_TRANSPORT');
 check(c.timeout_ms===undefined||Number.isInteger(c.timeout_ms)&&c.timeout_ms>=100&&c.timeout_ms<=30000,'INVALID_DISCOVERY_TIMEOUT');
 check(c.max_sessions===undefined||Number.isInteger(c.max_sessions)&&c.max_sessions>=1&&c.max_sessions<=10000,'INVALID_DISCOVERY_LIMIT');
}
export function normalizeSessions(type,rows,max=10000){
 check(Array.isArray(rows)&&rows.length<=max,'INVALID_SESSION_INVENTORY');
 const seen=new Set();return rows.map(r=>{
  const id=type==='codex'?r.id:r.sessionId;
  check(typeof id==='string'&&id.length>0&&id.length<=256&&!/[\x00-\x1f]/.test(id)&&!seen.has(id),'INVALID_SESSION_ID');seen.add(id);
  check(r.archived!==true,'ARCHIVED_SESSION_IN_INVENTORY');
  return {native_id:id,label:typeof r.name==='string'&&r.name.trim()?r.name.slice(0,200):id,
   cwd:typeof r.cwd==='string'?r.cwd.slice(0,4096):null,
   state:typeof r.status==='string'?r.status:typeof r.status?.type==='string'?r.status.type:'unknown'};
 });
}
// Fixed, read-only native interfaces. No model calls, transcript reads, resumes or fallback commands.
export function discoverSessions(config,{spawnProcess=spawn,signal}={}){
 validateDiscovery(config);const c=config,max=c.max_sessions??10000,executable=resolveExecutable(c);
 return new Promise((resolve,reject)=>{
  const args=c.type==='claude'?['agents','--json']:c.transport==='proxy'?['app-server','proxy']:['app-server','--stdio'];
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  let child,buffer='',stdout='',bytes=0,result,error,closed=false,seq=1,cursor=null;const rows=[],cursors=new Set();
  let timer,killTimer;
  const finishError=code=>{if(error||closed)return;error=new ServiceError(code);child?.stdin?.end();child?.kill();killTimer=setTimeout(()=>child?.kill('SIGKILL'),250);killTimer.unref?.();};
  const send=m=>{if(!error&&!closed)child.stdin.write(JSON.stringify(m)+'\n');};
  const list=()=>send({id:++seq,method:'thread/list',params:{limit:100,cursor,archived:false,useStateDbOnly:true,modelProviders:[],sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown']}});
  const abort=()=>finishError('DISCOVERY_CANCELLED');
  if(signal?.aborted){reject(new ServiceError('DISCOVERY_CANCELLED'));return;}
  try{child=spawnProcess(executable,args,{cwd:c.cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}
  catch{reject(new ServiceError('DISCOVERY_START_FAILED'));return;}
  timer=setTimeout(()=>finishError('DISCOVERY_TIMEOUT'),c.timeout_ms??15000);
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',()=>finishError('DISCOVERY_START_FAILED'));child.stdin.on('error',()=>finishError('DISCOVERY_WRITE_FAILED'));
  child.stderr.on('data',d=>{bytes+=d.length;if(bytes>16*1024*1024)finishError('DISCOVERY_OUTPUT_LIMIT');});
  child.stdout.on('data',d=>{
   bytes+=d.length;if(bytes>16*1024*1024){finishError('DISCOVERY_OUTPUT_LIMIT');return;}
   if(c.type==='claude'){stdout+=d;return;}
   buffer+=d;for(let n;(n=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;
    try{
     const m=JSON.parse(line);
     if(m.method&&m.id!==undefined){send({id:m.id,error:{code:-32601,message:'Read-only discovery client'}});continue;}
     if(m.id===undefined)continue;
     check(m.id===seq&&!m.error,'DISCOVERY_RPC_FAILED');
     if(m.id===1){send({method:'initialized'});list();continue;}
     check(Array.isArray(m.result?.data),'DISCOVERY_INVALID_PAGE');rows.push(...m.result.data);
     check(rows.length<=max,'DISCOVERY_SESSION_LIMIT');
     cursor=m.result.nextCursor;
     check(cursor===null||typeof cursor==='string'&&cursor.length>0&&!cursors.has(cursor),'DISCOVERY_INVALID_CURSOR');
     if(cursor){check(cursors.size<100,'DISCOVERY_PAGE_LIMIT');cursors.add(cursor);list();}
     else{result=normalizeSessions('codex',rows,max);child.stdin.end();}
    }catch(e){finishError(e.code??'DISCOVERY_INVALID_OUTPUT');}
   }
  });
  child.on('close',(code)=>{
   closed=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);
   if(error){reject(error);return;}if(code!==0){reject(new ServiceError('DISCOVERY_EXIT_FAILED'));return;}
   try{if(c.type==='claude')result=normalizeSessions('claude',JSON.parse(stdout),max);check(result!==undefined,'DISCOVERY_INCOMPLETE');resolve(result);}
   catch(e){reject(e instanceof ServiceError?e:new ServiceError('DISCOVERY_INVALID_OUTPUT'));}
  });
  if(c.type==='codex')send({id:1,method:'initialize',params:{clientInfo:{name:'ihcp3k_discovery',version:'1.4.0'}}});else child.stdin.end();
 });
}
