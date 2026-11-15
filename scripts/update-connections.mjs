import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

export function markedArgs(args,runtime,version){
 if(!Array.isArray(args)||args.length<3||path.resolve(args[0])!==runtime.bundle||path.resolve(args[1])!==path.join(runtime.private_dir,'runtime.json')||!path.resolve(args[2]).startsWith(path.join(runtime.private_dir,'harnesses')+path.sep)||path.basename(args[2])!=='harness.tok')throw Error('MCP_CONFIG_NOT_OWNED');
 return [...args.filter(a=>!a.startsWith('--ihcp-release=')),'--ihcp-release='+version];
}
// Edit only the managed args array, preserving all unrelated TOML and comments.
export function codexConfig(text,runtime,version){
 const section=/^\[mcp_servers\.(?:ihcp3k|"ihcp3k"|'ihcp3k')\][ \t]*(?:#[^\r\n]*)?\r?$/m.exec(text);
 if(!section)throw Error('MCP_CONFIG_NOT_FOUND');
 const start=section.index+section[0].length,next=text.slice(start).search(/^\[/m),end=next<0?text.length:start+next;
 const m=/^args\s*=\s*\[/m.exec(text.slice(start,end));if(!m)throw Error('MCP_ARGS_NOT_FOUND');
 const begin=start+m.index+m[0].length-1,args=[];let i=begin+1,closed=false;
 while(i<end){
  if(/\s|,/.test(text[i])){i++;continue;}
  if(text[i]==='#'){const n=text.indexOf('\n',i);i=n<0?end:n+1;continue;}
  if(text[i]===']'){i++;closed=true;break;}
  const q=text[i],from=i++;if(q!=="'"&&q!=='"')throw Error('UNSUPPORTED_MCP_ARGS');
  while(i<end){if(q==='"'&&text[i]==='\\'){i+=2;continue;}if(text[i++]===q)break;}
  const value=text.slice(from,i);if(value.at(-1)!==q)throw Error('UNSUPPORTED_MCP_ARGS');
  args.push(q==="'"?value.slice(1,-1):JSON.parse(value));
 }
 if(!closed)throw Error('UNSUPPORTED_MCP_ARGS');
 return text.slice(0,begin)+JSON.stringify(markedArgs(args,runtime,version))+text.slice(i);
}
export function claudeConfig(text,runtime,version){
 const d=JSON.parse(text),entry=d.mcpServers?.ihcp3k;if(!entry)throw Error('MCP_CONFIG_NOT_FOUND');
 entry.args=markedArgs(entry.args,runtime,version);return JSON.stringify(d,null,2)+'\n';
}
export function planConnections(runtime,version,{home=os.homedir(),env=process.env}={}){
 const plans=[],dir=path.join(runtime.private_dir,'harnesses');
 for(const id of fs.readdirSync(dir)){
  const location=path.join(dir,id,'harness.json');if(!fs.existsSync(location))continue;
  const h=JSON.parse(fs.readFileSync(location,'utf8'));if(!h.linked)continue;
  const reg=JSON.parse(fs.readFileSync(path.join(dir,id,'registration.json'),'utf8')),type=reg.discovery?.type;
  const file=type==='codex'?path.join(env.CODEX_HOME||path.join(home,'.codex'),'config.toml'):type==='claude'?path.join(env.CLAUDE_CONFIG_DIR||home,env.CLAUDE_CONFIG_DIR?'.claude.json':'.claude.json'):null;
  const base={harness:id,type,executable:reg.discovery?.executable};
  if(!file||!fs.existsSync(file)){plans.push({...base,status:'native_configuration_required'});continue;}
  try{
   if(fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file)!==path.resolve(file))throw Error('CONFIG_LINK_NOT_ALLOWED');
   const before=fs.readFileSync(file,'utf8'),after=(type==='codex'?codexConfig:claudeConfig)(before,runtime,version);
   plans.push({...base,file,before,after,status:'planned'});
  }catch(e){plans.push({...base,status:'native_configuration_required',reason:e.message});}
 }
 return plans;
}
export function reloadCodex(executable,{spawnProcess=spawn,timeout_ms=15000}={}){
 return new Promise(resolve=>{
  let child,buffer='',done=false,timer;
  const finish=status=>{if(done)return;done=true;clearTimeout(timer);child?.stdin.end();child?.kill();resolve({status});};
  try{child=spawnProcess(executable,['app-server','proxy'],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch{return finish('restart_approval_required');}
  timer=setTimeout(()=>finish('restart_approval_required'),timeout_ms);
  child.stderr.on('data',()=>{});child.on('error',()=>finish('restart_approval_required'));child.on('close',()=>finish('restart_approval_required'));child.stdin.on('error',()=>finish('restart_approval_required'));
  child.stdout.on('data',d=>{buffer+=d;if(buffer.length>1024*1024)return finish('restart_approval_required');
   for(let n;(n=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const m=JSON.parse(line);if(m.error)return finish('restart_approval_required');
    if(m.id===1){child.stdin.write(JSON.stringify({method:'initialized'})+'\n');child.stdin.write(JSON.stringify({id:2,method:'config/mcpServer/reload',params:null})+'\n');}
    if(m.id===2)return finish('reload_requested');
   }catch{return finish('restart_approval_required');}}
  });
  child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'ihcp3k_update',version:'1'}}})+'\n');
 });
}
