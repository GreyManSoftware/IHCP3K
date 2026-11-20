import {resolveExecutable} from '../service/src/trusted-executable.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const local=/^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=4096&&!/[\x00-\x1f]/.test(v);
function directories(root){try{return fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.isSymbolicLink()).map(d=>path.join(root,d.name));}catch{return [];}}
export function desktopRoots({platform=process.platform,env=process.env,home=homedir()}={}){
 if(platform==='win32')return [...directories(path.join(env.LOCALAPPDATA??home,'Claude-Data')).filter(d=>/^claude_/i.test(path.basename(d))).map(d=>path.join(d,'claude-code-sessions')),path.join(env.APPDATA??home,'Claude','claude-code-sessions')];
 if(platform==='darwin')return [path.join(home,'Library','Application Support','Claude','claude-code-sessions')];
 return []; // No claimed Linux desktop support.
}
export function readDesktopSession(file){
 try{
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)return null;
  const d=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!local.test(d.sessionId)||!uuid.test(d.cliSessionId)||path.basename(file)!==d.sessionId+'.json'||d.isArchived!==false||d.envScopeId!=='builtin_local'||d.startedFromEnvironmentId||!text(d.title)||!text(d.cwd)||!path.isAbsolute(d.cwd))return null;
  // Project only identity fields. Never return prompt/permission snapshots or change app state.
  return {native_id:d.cliSessionId,desktop_id:d.sessionId,label:d.title,cwd:d.cwd,file};
 }catch{return null;}
}
export function desktopSessions({roots=desktopRoots()}={}){
 const rows=[];let count=0,bytes=0;
 for(const root of roots){
  try{const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())continue;}catch{continue;}
  if(directories(root).length>32)throw Error('DESKTOP_METADATA_LIMIT');
  for(const org of directories(root).filter(d=>uuid.test(path.basename(d)))){
   const accounts=directories(org);if(accounts.length>32)throw Error('DESKTOP_METADATA_LIMIT');
   for(const account of accounts.filter(d=>uuid.test(path.basename(d)))){
    const names=fs.readdirSync(account);if((count+=names.length)>10000)throw Error('DESKTOP_METADATA_LIMIT');
    for(const name of names.filter(n=>local.test(n.replace(/\.json$/,''))&&n.endsWith('.json'))){
     const file=path.join(account,name);let stat;try{stat=fs.lstatSync(file);}catch{throw Error('DESKTOP_METADATA_CHANGED');}
     if((bytes+=stat.size)>256*1024*1024)throw Error('DESKTOP_METADATA_LIMIT');
     const row=readDesktopSession(file);if(row)rows.push(row);
    }
   }
  }
 }
 return rows;
}

// Native app state is undocumented and read-only. The installed CLI is the only writer.
export function desktopOpener({runtimeFile,journalDir,tty=!!process.stdin.isTTY&&!!process.stdout.isTTY,run=spawnSync,now=Date.now}={}){
 return async(harness,target,input)=>{
  if(!tty)return {status:'desktop_open_requires_tty'};
  const fresh=readDesktopSession(target.file);
  if(!fresh||JSON.stringify(fresh)!==JSON.stringify(target))return {status:'desktop_identity_changed'};
  const runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
  const db=new DatabaseSync(runtime.database,{readOnly:true});let config;
  try{const h=db.prepare('SELECT config_json FROM harnesses WHERE id=? AND active=1').get(harness.harness);if(!h)return {status:'harness_unavailable'};config=JSON.parse(h.config_json);}finally{db.close();}
  try{config={...config,executable:resolveExecutable(config)};}catch{return {status:'desktop_launcher_unavailable'};}
  if(config.type!=='claude'||!path.isAbsolute(config.executable)||!/^(claude|claude\.exe)$/i.test(path.basename(config.executable))||!path.isAbsolute(config.cwd))return {status:'desktop_launcher_unavailable'};
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|SYSTEMDRIVE|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|LANG|LC_ALL)$/i.test(key)));
  const list=run(config.executable,['agents','--json'],{cwd:config.cwd,env,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:16*1024*1024});
  if(list.error||list.status!==0)return {status:'discovery_unavailable'};
  let rows;try{rows=JSON.parse(list.stdout);if(!Array.isArray(rows))throw Error();}catch{return {status:'discovery_unavailable'};}
  if(rows.some(r=>r.sessionId===target.native_id))return {status:'already_running'};
  fs.mkdirSync(journalDir,{recursive:true,mode:0o700});if(fs.lstatSync(journalDir).isSymbolicLink())throw Error('UNSAFE_WAKE_JOURNAL');
  // Deterministic retention and a hard capacity bound; no AI housekeeping.
  const files=fs.readdirSync(journalDir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
  for(const name of files){const file=path.join(journalDir,name),s=fs.lstatSync(file);if(s.isFile()&&!s.isSymbolicLink()&&now()-s.mtimeMs>90*86400000)fs.unlinkSync(file);}
  const key=createHash('sha256').update(JSON.stringify([input.session_id,harness.harness,input.idempotency_key])).digest('hex');
  const file=path.join(journalDir,key+'.json');
  if(fs.existsSync(file))return {status:'desktop_open_uncertain'};
  if(fs.readdirSync(journalDir).length>=1000)throw Error('WAKE_JOURNAL_CAPACITY');
  if(JSON.stringify(readDesktopSession(target.file))!==JSON.stringify(target))return {status:'desktop_identity_changed'};
  let fd;try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({native_id:target.native_id,desktop_id:target.desktop_id,attempted_at:now(),state:'attempted'}));fs.fsyncSync(fd);}catch(e){if(e.code==='EEXIST')return {status:'desktop_open_uncertain'};throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
  // Inherit the host's PTY. No prompt, new worker, shell, permission changes or resume-copy flags.
  const r=run(config.executable,['--desktop','--resume',target.native_id],{cwd:config.cwd,env,windowsHide:true,stdio:'inherit',timeout:15000});
  return {status:!r.error&&r.status===0?'desktop_opened':'desktop_open_uncertain'};
 };
}
