import {createHash,randomUUID} from 'node:crypto';
import {ServiceError} from './store.mjs';
import {checkAdmission,RETENTION} from './retention.mjs';
import {discoverSessions,validateDiscovery} from './session-discovery.mjs';
import {buildNativeCommand} from './native-adapters.mjs';
import {remoteWorkConfig} from './remote-work.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const check=(v,c)=>{if(!v)throw new ServiceError(c);};
const validId=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v);
export const sessionAddress=(harness,id)=>'s-'+hash(harness+'\0'+id).slice(0,48);
export class HarnessRegistry{
 constructor(store,{discover=discoverSessions}={}){
  this.store=store;this.db=store.db;this.discoverNative=discover;this.inflight=new Map();
  this.db.exec(`CREATE TABLE IF NOT EXISTS harnesses(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,active INTEGER NOT NULL,token_hash TEXT NOT NULL,config_json TEXT NOT NULL,profile_json TEXT NOT NULL,peers_json TEXT NOT NULL,last_scan INTEGER,last_error TEXT);
   CREATE TABLE IF NOT EXISTS harness_sessions(endpoint TEXT PRIMARY KEY REFERENCES endpoints(id),harness TEXT NOT NULL REFERENCES harnesses(id),native_id TEXT NOT NULL,label TEXT NOT NULL,cwd TEXT,state TEXT NOT NULL,seen_at INTEGER NOT NULL,UNIQUE(harness,native_id));
   CREATE TABLE IF NOT EXISTS harness_scans(harness TEXT PRIMARY KEY,token TEXT NOT NULL,deadline INTEGER NOT NULL);`);
  store.harnesses=this;
 }
 authenticate(secret){const h=hash(secret),row=this.db.prepare('SELECT id,revision FROM harnesses WHERE active=1 AND token_hash=?').get(h);return row?{id:'harness:'+row.id,harness:row.id,harness_hash:h,harness_revision:row.revision,permissions:['harness']}:null;}
 active(p){return !p.harness_hash||!!this.db.prepare('SELECT 1 FROM harnesses WHERE id=? AND active=1 AND token_hash=? AND revision=?').get(p.harness,p.harness_hash,p.harness_revision);}
 row(p){check(this.active(p)&&p.permissions.includes('harness'),'FORBIDDEN');const row=this.db.prepare('SELECT * FROM harnesses WHERE id=? AND active=1').get(p.harness);check(row,'HARNESS_UNREGISTERED');return row;}
 register(p,{harness,credential,discovery,profile,peers=['*'],notification}){
  check(p.permissions.includes('registry'),'FORBIDDEN');check(validId(harness)&&typeof credential==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(credential),'INVALID_HARNESS');
  check(Array.isArray(peers)&&peers.length<=100&&peers.every(id=>id==='*'||validId(id))&&new Set(peers).size===peers.length,'INVALID_HARNESS_PEERS');
  validateDiscovery(discovery);this.store.directory.validateProfile(profile);
  if(notification===undefined&&discovery.type==='codex')notification={enabled:true,type:'codex-queue'};
  check(notification,'NOTIFICATION_CONFIGURATION_REQUIRED');
  if(notification)check(notification.enabled===true&&['codex-queue','claude-message'].includes(notification.type)&&((discovery.type==='codex'&&notification.type==='codex-queue')||(discovery.type==='claude'&&notification.type==='claude-message')),'INVALID_NOTIFICATION_TEMPLATE');
  check(buildNativeCommand({...notification,executable:discovery.executable,cwd:discovery.cwd,
    native_session_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',target:{stable_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'},
    permissions:'read-only',persist:false},'notify',{recipient:'setup-check'}).status==='ready','INVALID_NOTIFICATION_TEMPLATE');
  const config=notification?{...discovery,notification}:discovery;
  return this.store.transaction(()=>{
   const old=this.db.prepare('SELECT * FROM harnesses WHERE id=?').get(harness);
   check(!this.db.prepare('SELECT 1 FROM harnesses WHERE token_hash=? AND id!=?').get(hash(credential),harness),'CREDENTIAL_ALREADY_USED');
   check(old?.active||this.db.prepare('SELECT count(*) n FROM harnesses WHERE active=1').get().n<16,'HARNESS_LIMIT');
   if(!old)checkAdmission(this.store,'harnesses',RETENTION.maxHarnesses);
   const fields=[hash(credential),JSON.stringify(config),JSON.stringify(profile),JSON.stringify(peers)];
   if(old?.active){check(old.token_hash===fields[0]&&old.config_json===fields[1]&&old.profile_json===fields[2]&&old.peers_json===fields[3],'HARNESS_ALREADY_REGISTERED');return {harness,revision:old.revision,registered:true,reused:true};}
   check(!old||old.token_hash!==fields[0],'FRESH_HARNESS_CREDENTIAL_REQUIRED');
   const revision=(old?.revision??0)+1;
   // Relink invalidates any old mailbox claims even when stable session addresses are reused.
   for(const s of this.db.prepare('SELECT endpoint FROM harness_sessions WHERE harness=?').all(harness))this.disable(s.endpoint);
   this.db.prepare('INSERT INTO harnesses VALUES(?,?,1,?,?,?,?,NULL,NULL) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,active=1,token_hash=excluded.token_hash,config_json=excluded.config_json,profile_json=excluded.profile_json,peers_json=excluded.peers_json,last_scan=NULL,last_error=NULL').run(harness,revision,...fields);
   this.store.directory.audit(p,'register-harness',harness);return {harness,revision,registered:true,reused:false};
  });
 }
 disable(endpoint){
  this.db.prepare('UPDATE endpoints SET active=0,revision=revision+1 WHERE id=? AND active=1').run(endpoint);
  this.db.prepare("UPDATE messages SET state='reconcile',deadline=NULL,generation=generation+1,token_hash=NULL WHERE recipient=? AND state='claimed'").run(endpoint);
  this.db.prepare("UPDATE outbox SET state='reconcile' WHERE recipient=? AND state='claimed'").run(endpoint);
  this.db.prepare("UPDATE wake_dispatch SET state='uncertain',generation=generation+1,token_hash=NULL WHERE recipient=? AND state!='idle'").run(endpoint);
  this.store.clearAttendance(endpoint);
 }
 async refresh(harness,{force=false,signal}={}){
  if(this.inflight.has(harness))return this.inflight.get(harness);
  const row=this.db.prepare('SELECT * FROM harnesses WHERE id=? AND active=1').get(harness);check(row,'HARNESS_UNREGISTERED');
  if(!force&&row.last_scan!==null&&!row.last_error&&this.store.now()-row.last_scan<15000)return;
  const scanToken=randomUUID();
  this.store.transaction(()=>{
   const active=this.db.prepare('SELECT * FROM harness_scans WHERE harness=?').get(harness);
   check(!active||active.deadline<=this.store.now(),'DISCOVERY_BUSY');
   this.db.prepare('INSERT OR REPLACE INTO harness_scans VALUES(?,?,?)').run(harness,scanToken,this.store.now()+(JSON.parse(row.config_json).timeout_ms??15000)+6000);
  });
  const task=(async()=>{
   try{
    const rows=await this.discoverNative(JSON.parse(row.config_json),{signal});
    check(Array.isArray(rows)&&rows.length<=10000,'INVALID_SESSION_INVENTORY');const ids=new Set();
    for(const s of rows){check(typeof s.native_id==='string'&&s.native_id.length>0&&s.native_id.length<=256&&!ids.has(s.native_id)&&typeof s.label==='string'&&typeof s.state==='string','INVALID_SESSION_INVENTORY');ids.add(s.native_id);}
    this.store.transaction(()=>{
     const lease=this.db.prepare('SELECT * FROM harness_scans WHERE harness=?').get(harness);check(lease?.token===scanToken&&lease.deadline>this.store.now(),'DISCOVERY_LEASE_EXPIRED');
     const current=this.db.prepare('SELECT active,revision FROM harnesses WHERE id=?').get(harness);check(current?.active&&current.revision===row.revision,'HARNESS_CHANGED_DURING_DISCOVERY');
     const now=this.store.now(),seen=new Set();
     for(const s of rows){
      const endpoint=sessionAddress(harness,s.native_id);seen.add(endpoint);
      const previous=this.db.prepare('SELECT harness FROM endpoints WHERE id=?').get(endpoint);check(!previous||previous.harness===harness,'SESSION_ID_COLLISION');
      if(!previous)checkAdmission(this.store,'endpoints',RETENTION.maxEndpoints);
      const binding=JSON.stringify({native_session_id:s.native_id,harness,discovered:true});
      this.db.prepare('INSERT INTO endpoints VALUES(?,?,1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET active=1,profile_json=excluded.profile_json,binding_json=excluded.binding_json,last_seen=excluded.last_seen').run(endpoint,harness,row.profile_json,binding,now);
      this.db.prepare('INSERT INTO harness_sessions VALUES(?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET label=excluded.label,cwd=excluded.cwd,state=excluded.state,seen_at=excluded.seen_at').run(endpoint,harness,s.native_id,s.label.slice(0,200),s.cwd??null,s.state,now);
      this.store.recipients.add(endpoint);
     }
     for(const old of this.db.prepare('SELECT endpoint FROM harness_sessions WHERE harness=?').all(harness))if(!seen.has(old.endpoint))this.disable(old.endpoint);
     this.db.prepare('UPDATE harnesses SET last_scan=?,last_error=NULL WHERE id=?').run(now,harness);
    });
   }catch(e){
    this.store.transaction(()=>this.db.prepare('UPDATE harnesses SET last_error=? WHERE id=? AND revision=? AND active=1 AND EXISTS(SELECT 1 FROM harness_scans WHERE harness=? AND token=?)').run(e.code??'DISCOVERY_FAILED',harness,row.revision,harness,scanToken));throw e;
   }
  })();this.inflight.set(harness,task);try{return await task;}finally{this.inflight.delete(harness);try{this.store.transaction(()=>this.db.prepare('DELETE FROM harness_scans WHERE harness=? AND token=?').run(harness,scanToken));}catch{/* Expired leases are collected on the next maintenance pass. */}}
 }
 permitted(p){const own=this.row(p),peers=JSON.parse(own.peers_json);return this.db.prepare('SELECT * FROM harnesses WHERE active=1 ORDER BY id').all().filter(r=>r.id===own.id||(peers.includes('*')||peers.includes(r.id))&&(JSON.parse(r.peers_json).includes('*')||JSON.parse(r.peers_json).includes(own.id)));}
 async discover(p,{force=false}={},signal){
  const allowed=this.permitted(p);const observations=[];
  signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)]);
  // Discovery is demand-driven, bounded and does not invoke a model.
  for(const r of allowed){try{await this.refresh(r.id,{force,signal});}catch{} }
  this.row(p);
  for(const r of this.permitted(p)){
   const current=this.db.prepare('SELECT * FROM harnesses WHERE id=?').get(r.id);
   observations.push({harness:r.id,type:JSON.parse(r.config_json).type,profile:JSON.parse(r.profile_json),last_scan:current.last_scan?new Date(current.last_scan).toISOString():null,error:current.last_error,stale:!!current.last_error||current.last_scan===null||this.store.now()-current.last_scan>30000,
    sessions:this.db.prepare('SELECT s.endpoint,s.native_id,s.label,s.cwd,s.state FROM harness_sessions s JOIN endpoints e ON e.id=s.endpoint WHERE s.harness=? AND e.active=1 ORDER BY s.label,s.endpoint').all(r.id)});
  }
  return {harnesses:observations};
 }
 async sessionPrincipal(p,sessionId,signal){
  const own=this.row(p);await this.refresh(own.id,{signal});this.row(p);
  const source=this.db.prepare('SELECT s.endpoint FROM harness_sessions s JOIN endpoints e ON e.id=s.endpoint WHERE s.harness=? AND (s.native_id=? OR s.endpoint=?) AND e.active=1').get(own.id,sessionId,sessionId);
  check(source,'SESSION_NOT_DISCOVERED');
  const allowed=this.permitted(p).map(r=>r.id),targets=[];
  for(const id of allowed){const row=this.db.prepare('SELECT last_scan,last_error FROM harnesses WHERE id=?').get(id);if(!row.last_error&&row.last_scan!==null&&this.store.now()-row.last_scan<=30000)targets.push(...this.db.prepare('SELECT s.endpoint FROM harness_sessions s JOIN endpoints e ON e.id=s.endpoint WHERE s.harness=? AND e.active=1').all(id).map(r=>r.endpoint));}
  return {...p,id:source.endpoint,endpoint:source.endpoint,permissions:['send','claim','status','wake','discover'],scopes:{send:targets,claim:[source.endpoint],status:[source.endpoint],wake:[source.endpoint],discover:targets}};
 }
 async invoke(p,operation,{session_id,...args},signal){
  if(operation==='exchange'||operation==='wait'||operation==='listen')return this.inboxCall(p,operation,session_id,args,signal);
  // Never use a mutable connection-wide current-session value: clients may share one process.
  if(['request','send','reply'].includes(operation))await this.discover(p,{},signal);
  const principal=await this.sessionPrincipal(p,session_id,signal);
  if(operation==='remote_prompt'){
   check(!signal?.aborted,'CANCELLED');
   const target=this.permitted(p).find(r=>r.id===args.harness);
   check(target,'HARNESS_NOT_REGISTERED_OR_PERMITTED');
   check(this.store.workers,'WORKER_NOT_CONFIGURED');
   const {config,prompt}=remoteWorkConfig(target,args,this.store.workers.defaultDirectory);
   const job=this.store.workers.startConfigured(principal,{adapter:'remote:'+target.id,prompt,idempotency_key:args.idempotency_key},config);
   return {...job,harness:target.id,model:config.model??'native-default',working_folder:config.cwd,permissions:config.permissions,reply_to:principal.endpoint};
  }
  if(['claim','status','attend','unattend','receive'].includes(operation))args.recipient=principal.endpoint;
  if(operation==='claim'||operation==='attend')args.handler_id=principal.endpoint;
  if(['request','send'].includes(operation))check(principal.scopes.send.includes(args.recipient),'RECIPIENT_NOT_DISCOVERED_OR_PERMITTED');
  let result;
  if(operation.startsWith('worker_')){check(this.store.workers,'WORKER_NOT_CONFIGURED');result=await this.store.workers[operation.slice(7)](principal,args);}
  else result=await this.store[operation](principal,args,signal);
  if(['request','send','reply'].includes(operation)){
   const recipient=operation==='reply'?result.recipient:args.recipient;
   try{result.native_notification=this.store.notifications?await this.store.notifications.dispatch(recipient):{status:'unconfigured'};}catch{result.native_notification={status:'uncertain'};}
  }
  return Array.isArray(result)?{messages:result}:result;
 }
 async inboxCall(p,operation,session_id,args,signal){
  const timeout=args.timeout_ms??25000;
  check(Number.isInteger(timeout)&&timeout>=0&&timeout<=25000,'INVALID_TIMEOUT');
  if(operation==='exchange')await this.discover(p,{},signal);
  const principal=await this.sessionPrincipal(p,session_id,signal),recipient=principal.endpoint;
  check(!signal?.aborted,'CANCELLED');
  if(operation==='exchange')check(principal.scopes.send.includes(args.recipient),'RECIPIENT_NOT_DISCOVERED_OR_PERMITTED');
  const listen=operation==='listen';
  let attendance;
  if(listen&&args.attendance_token){
   attendance={recipient,attendance_token:args.attendance_token};
   this.store.transaction(()=>{this.store.attendedBy(principal,attendance);this.db.prepare('UPDATE attendance SET deadline=? WHERE recipient=?').run(this.store.now()+120000,recipient);});
  }else attendance=this.store.attend(principal,{recipient,handler_id:listen?'ihcp-listen':recipient,lease_s:120});
  let keep=false,request;
  try{
   if(operation==='exchange'){
    request=this.store.request(principal,{recipient:args.recipient,body:args.body,idempotency_key:args.idempotency_key});
    // Attendance exists before the peer can reply, including from another runtime.
    try{request.native_notification=this.store.notifications?await this.store.notifications.dispatch(args.recipient):{status:'unconfigured'};}catch{request.native_notification={status:'uncertain'};}
   }
   if(listen){
    const end=Date.now()+timeout;
    do{
     this.row(p);this.store.attendedBy(principal,attendance);
     if(signal?.aborted)return {status:'cancelled'};
     if(this.store.paused(recipient))return {status:'paused'};
     const count=this.store.pending(recipient);
     if(count){
      // Give the target-owned background task time to surface its completion.
      this.db.prepare('UPDATE attendance SET deadline=? WHERE recipient=?').run(this.store.now()+15000,recipient);
      keep=true;return {status:'pending',pending_count:count,...attendance};
     }
     if(Date.now()>=end){keep=true;return {status:'timeout',...attendance};}
     await this.store.changedWithin(recipient,Math.min(200,end-Date.now()),signal);
    }while(true);
   }
   const result=await this.store.receive(principal,{...attendance,timeout_ms:timeout,limit:20,lease_s:300},signal);
   this.row(p);
   return {...result,...(request?{request_id:request.id,request}:{}),notification_already_dispatched:attendance.notification_already_dispatched??false};
  }finally{
   if(!keep)try{this.store.unattend(principal,attendance);}catch{/* Revocation or expiry already removed/fenced this lease. */}
  }
 }
 notificationFor(endpoint){
  const row=this.db.prepare('SELECT h.config_json,h.active AS harness_active,e.active,e.revision,s.native_id FROM harness_sessions s JOIN harnesses h ON h.id=s.harness JOIN endpoints e ON e.id=s.endpoint WHERE s.endpoint=?').get(endpoint);
  if(!row?.active||!row.harness_active)return;
  const c=JSON.parse(row.config_json),template=c.notification;if(!template?.enabled)return;
  const common={...template,enabled:true,executable:c.executable,cwd:c.cwd,endpoint_revision:row.revision,persist:false,timeout_ms:Math.min(template.timeout_ms??30000,30000),max_output_bytes:65536,kill_grace_ms:250};
  if(c.type==='codex')return {...common,type:'codex-queue',native_session_id:row.native_id,resume:false};
  // Discovery provides an exact native ID, not a title. A version-specific Claude route
  // must support that ID; a failed match stays pending rather than selecting another chat.
  return {...common,type:'claude-message',target:{stable_id:row.native_id},permissions:'read-only'};
 }
 notificationRecipients(){return this.db.prepare('SELECT s.endpoint FROM harness_sessions s JOIN harnesses h ON h.id=s.harness JOIN endpoints e ON e.id=s.endpoint JOIN messages m ON m.recipient=s.endpoint WHERE h.active=1 AND e.active=1 AND m.state=? GROUP BY s.endpoint LIMIT 100').all('pending').map(r=>r.endpoint);}
 unregister(p){
  const row=this.row(p);
  return this.store.transaction(()=>{
   this.row(p);const sessions=this.db.prepare('SELECT endpoint FROM harness_sessions WHERE harness=?').all(row.id);
   for(const s of sessions)this.disable(s.endpoint);
   this.db.prepare('UPDATE harnesses SET active=0,revision=revision+1,last_error=NULL WHERE id=?').run(row.id);
   this.store.directory.audit(p,'unregister-harness',row.id);return {harness:row.id,registered:false,sessions_revoked:sessions.length};
  });
 }
}
