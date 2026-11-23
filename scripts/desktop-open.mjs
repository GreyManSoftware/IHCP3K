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
function samePath(first,second){
 if(typeof first!=='string'||typeof second!=='string'||!path.isAbsolute(first)||!path.isAbsolute(second))return false;
 const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
 return normalize(first)===normalize(second);
}

// Per-chat local evidence. A live native registration on this machine (~/.claude/sessions,
// entrypoint claude-desktop) whose CLI UUID matches the Desktop record proves that exact chat ran
// locally. Its stable desktop ID, name, project and account folder are kept privately so a
// later CLI UUID rotation can still be verified. Nothing else (field names, a marked sibling,
// an existing folder) counts as locality evidence.
const EVIDENCE_LIMIT=2000;
// One small file per desktop ID, so overlapping resolves writing different chats never
// overwrite each other; each write is an atomic tmp+rename of that chat's file alone.
const evidenceDir=runtimeFile=>path.join(path.dirname(path.resolve(runtimeFile)),'desktop-evidence');
export function readDesktopEvidence(dir,desktopId){
 if(!local.test(desktopId??''))return null;
 try{const file=path.join(dir,desktopId+'.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)return null;
  const d=JSON.parse(fs.readFileSync(file,'utf8'));return d?.version===1&&d.desktop_id===desktopId&&text(d.name)&&text(d.cwd)&&text(d.account)?d:null;}catch{return null;}
}
// A uniqueness check must see the whole bounded inventory; an over-limit one records nothing.
function desktopRecordFile(roots,desktopId){
 const found=[];
 for(const root of roots){
  try{const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())continue;}catch{continue;}
  const orgs=directories(root);if(orgs.length>32)return null;
  for(const org of orgs.filter(d=>uuid.test(path.basename(d)))){
   const accounts=directories(org);if(accounts.length>32)return null;
   for(const account of accounts.filter(d=>uuid.test(path.basename(d)))){
    const file=path.join(account,desktopId+'.json');try{if(fs.lstatSync(file).isFile())found.push(file);}catch{}
   }
  }
 }
 return found;
}
// observations: [{desktop_id,name,cwd,native_id}] from live, binding-verified sessions only.
export function recordDesktopEvidence(dir,observations,{roots=desktopRoots(),now=Date.now}={}){
 let written=0;
 for(const o of observations){
  if(!local.test(o.desktop_id??'')||!uuid.test(o.native_id??'')||!text(o.name)||!text(o.cwd))continue;
  const files=desktopRecordFile(roots,o.desktop_id);if(!files||files.length!==1)continue;
  let parsed;try{parsed=parseDesktopSession(files[0]);}catch{continue;}
  const r=parsed?.record;
  if(!r||r.native_id!==o.native_id||r.label!==o.name||!samePath(r.cwd,o.cwd))continue;
  const body=JSON.stringify({version:1,desktop_id:o.desktop_id,name:r.label,cwd:r.cwd,account:path.dirname(files[0]),cli_session_id:r.native_id,seen_at:now()});
  if(Buffer.byteLength(body)>16384)continue;
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,o.desktop_id+'.json'),tmp=file+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp';
  fs.writeFileSync(tmp,body,{mode:0o600});fs.renameSync(tmp,file);written++;
 }
 if(written)pruneDesktopEvidence(dir);
 return written>0;
}
// Keep the newest EVIDENCE_LIMIT sightings; stale temporary files from a crash are removed.
function pruneDesktopEvidence(dir){
 let names;try{names=fs.readdirSync(dir);}catch{return;}
 for(const n of names.filter(n=>n.endsWith('.tmp')))try{if(Date.now()-fs.lstatSync(path.join(dir,n)).mtimeMs>60000)fs.unlinkSync(path.join(dir,n));}catch{}
 const files=names.filter(n=>local.test(n.replace(/\.json$/,''))&&n.endsWith('.json'));
 if(files.length<=EVIDENCE_LIMIT)return;
 const dated=files.map(n=>{try{return [n,fs.lstatSync(path.join(dir,n)).mtimeMs];}catch{return [n,0];}}).sort((x,y)=>y[1]-x[1]);
 for(const [n] of dated.slice(EVIDENCE_LIMIT))try{fs.unlinkSync(path.join(dir,n));}catch{}
}
export function desktopEvidenceRecorder(runtimeFile,options){
 return observations=>recordDesktopEvidence(evidenceDir(runtimeFile),observations,options);
}

// Historical evidence only qualifies the exact requested chat. Unknown scope
// alone never qualifies a record, and explicitly remote scopes stay rejected.
export function retainedDesktopTarget(runtimeFile,harness,input){
 if(!input.cwd||!path.isAbsolute(input.cwd))return ()=>false;
 const runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
 const db=new DatabaseSync(runtime.database,{readOnly:true});
 let rows;
 try{
  const registration=db.prepare('SELECT config_json FROM harnesses WHERE id=? AND active=1').get(harness.harness);
  if(!registration||JSON.parse(registration.config_json).type!=='claude')return ()=>false;
  rows=db.prepare('SELECT native_id,label,cwd FROM harness_sessions WHERE harness=? AND lower(label)=lower(?)').all(harness.harness,input.name);
 }finally{db.close();}
 const matching=rows.filter(row=>samePath(row.cwd,input.cwd));
 const evidence=evidenceDir(runtimeFile);
 const exact=record=>record.label.toLowerCase()===String(input.name).toLowerCase()&&samePath(record.cwd,input.cwd)&&(!input.desktop_id||input.desktop_id===record.desktop_id);
 return record=>exact(record)&&(
   (matching.length===1&&matching[0].native_id===record.native_id&&matching[0].label.toLowerCase()===record.label.toLowerCase()&&samePath(matching[0].cwd,record.cwd))||
   (()=>{const e=readDesktopEvidence(evidence,record.desktop_id);return !!e&&e.name===record.label&&samePath(e.cwd,record.cwd)&&samePath(e.account,path.dirname(record.file));})());
}

// Older Desktop records carry no envScopeId. Such a record qualifies only through
// per-chat evidence (retained). An explicit non-local scope or an environment origin
// is always rejected.
function parseDesktopSession(file){
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)return null;
 const d=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!local.test(d.sessionId)||!uuid.test(d.cliSessionId)||path.basename(file)!==d.sessionId+'.json'||d.isArchived!==false||d.startedFromEnvironmentId||!text(d.title)||!text(d.cwd)||!path.isAbsolute(d.cwd))return null;
 // Project only identity fields. Never return prompt/permission snapshots or change app state.
 const marked=d.envScopeId==='builtin_local';
 const record={native_id:d.cliSessionId,desktop_id:d.sessionId,label:d.title,cwd:d.cwd,file,scope:marked?'local':'unmarked'};
 if(marked)return {record,marked:true};
 const unmarked=d.envScopeId===undefined&&(d.startedFromEnvironmentId===undefined||d.startedFromEnvironmentId===null)&&(d.originCwd===undefined||samePath(d.originCwd,d.cwd));
 return unmarked?{record,marked:false}:null;
}
export function readDesktopSession(file,{retained=()=>false}={}){
 try{
  const parsed=parseDesktopSession(file);if(!parsed)return null;
  return parsed.marked||retained(parsed.record)?parsed.record:null;
 }catch{return null;}
}
export function desktopSessions({roots=desktopRoots(),retained}={}){
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
     const row=readDesktopSession(file,{retained});if(row)rows.push(row);
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
  // The retained lookup runs only for a structurally valid record with missing
  // scope. Both the record and its evidence are rechecked before launch.
  const readTarget=()=>readDesktopSession(target.file,{retained:record=>retainedDesktopTarget(runtimeFile,harness,input)(record)});
  const fresh=readTarget();
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
  if(JSON.stringify(readTarget())!==JSON.stringify(target))return {status:'desktop_identity_changed'};
  let fd;try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({native_id:target.native_id,desktop_id:target.desktop_id,attempted_at:now(),state:'attempted'}));fs.fsyncSync(fd);}catch(e){if(e.code==='EEXIST')return {status:'desktop_open_uncertain'};throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
  // Inherit the host's PTY. No prompt, new worker, shell, permission changes or resume-copy flags.
  const r=run(config.executable,['--desktop','--resume',target.native_id],{cwd:target.cwd,env,windowsHide:true,stdio:'inherit',timeout:15000});
  return {status:!r.error&&r.status===0?'desktop_opened':'desktop_open_uncertain'};
 };
}
