import {randomUUID,createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Store,ServiceError} from './store.mjs';
import {Directory} from './directory.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const check=(v,c)=>{if(!v)throw new ServiceError(c);};

export class SharedStore extends Store {
 constructor(filename,options={}){
   // Probe the old exclusive owner before opening the new format. Never steal it.
   let guard;
   let version=0;
   if(filename!==':memory:'&&existsSync(filename)){const probe=new DatabaseSync(filename,{readOnly:true});try{version=probe.prepare('PRAGMA user_version').get().user_version;}finally{probe.close();}}
   if(filename!==':memory:'&&version<5){
     guard=new DatabaseSync(filename+'.owner');
     try{guard.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS owner_guard(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;');}
     catch(e){guard.close();throw new ServiceError('MIGRATION_OR_LEGACY_OWNER_BUSY');}
   }
   try{super(filename,{...options,shared:true});}
   catch(e){guard?.close();throw e;}
   try {
    this.directory=new Directory(this);
    this.transaction(()=>{
     this.db.exec(`CREATE TABLE IF NOT EXISTS attendance (recipient TEXT PRIMARY KEY,principal TEXT NOT NULL,handler_id TEXT NOT NULL,token_hash TEXT NOT NULL,deadline INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS maintenance_lease (id INTEGER PRIMARY KEY,owner TEXT NOT NULL,until_ms INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS wake_waiters (id TEXT PRIMARY KEY,recipient TEXT NOT NULL,deadline INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS requests (message_id TEXT PRIMARY KEY REFERENCES messages(id),reply_to TEXT NOT NULL,request_id TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS replies (message_id TEXT PRIMARY KEY REFERENCES messages(id),request_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id));
       CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY,owner TEXT NOT NULL,endpoint TEXT NOT NULL,adapter TEXT NOT NULL,dedup_key TEXT NOT NULL,input_hash TEXT NOT NULL,config_hash TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,created_at INTEGER NOT NULL,deadline INTEGER NOT NULL,acknowledged_at INTEGER,cleanup_action TEXT NOT NULL,cleanup_after INTEGER,cleanup_state TEXT NOT NULL,UNIQUE(owner,dedup_key));
       INSERT OR IGNORE INTO metadata VALUES('writer_version','5');`);
     check(this.db.prepare("SELECT value FROM metadata WHERE key='writer_version'").get().value==='5','WRITER_VERSION_MISMATCH');
     // An older already-open connection lacks this function and cannot write.
     for(const {name} of this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
       check(/^[a-z_]+$/.test(name),'INVALID_SCHEMA');
       for(const op of ['INSERT','UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS fence_${name}_${op} BEFORE ${op} ON ${name} BEGIN SELECT CASE WHEN ihcp_writer_version() != CAST((SELECT value FROM metadata WHERE key='writer_version') AS INTEGER) THEN RAISE(ABORT,'WRITER_VERSION_MISMATCH') END; END;`);
     }
     this.db.exec('PRAGMA user_version=5;');
    });
   } catch(e) {this.close();throw e;} finally {guard?.close();}
 }
 recipient(id){if(this.recipients.has(id))return;check(this.db.prepare('SELECT 1 FROM endpoints WHERE id=?').get(id),'UNKNOWN_RECIPIENT');}
 attendance(recipient){return this.db.prepare('SELECT * FROM attendance WHERE recipient=? AND deadline>?').get(recipient,this.now());}
 clearAttendance(recipient){this.db.prepare('DELETE FROM attendance WHERE recipient=?').run(recipient);return true;}
 attend(p,{recipient,handler_id,lease_s=60}){
   this.scope(p,'claim',recipient);check(typeof handler_id==='string'&&handler_id.length>0&&handler_id.length<=100,'INVALID_HANDLER');
   check(Number.isInteger(lease_s)&&lease_s>=1&&lease_s<=120,'INVALID_ATTENDANCE_LEASE');
   return this.transaction(()=>{
     check(!this.paused(recipient),'PAUSED');check(!this.attendance(recipient),'INBOX_ATTENDED');
     const token=randomUUID(),deadline=this.now()+lease_s*1000;
     this.db.prepare('INSERT OR REPLACE INTO attendance VALUES(?,?,?,?,?)').run(recipient,p.id,handler_id,hash(token),deadline);
     const wake=this.db.prepare('SELECT state FROM wake_dispatch WHERE recipient=?').get(recipient);
     return {recipient,attendance_token:token,deadline:new Date(deadline).toISOString(),notification_already_dispatched:!!wake&&wake.state!=='idle'};
   });
 }
 unattend(p,args){return this.transaction(()=>{this.attendedBy(p,args);this.clearAttendance(args.recipient);return {recipient:args.recipient,attending:false};});}
 async receive(p,args,signal){
   check(Number.isInteger(args.timeout_ms)&&args.timeout_ms>=0&&args.timeout_ms<=25000,'INVALID_TIMEOUT');
   const end=Date.now()+args.timeout_ms;
   do{
     if(signal?.aborted)return {status:'cancelled',messages:[]};
     const a=this.attendedBy(p,args);
     if(signal?.aborted)return {status:'cancelled',messages:[]};
     if(this.paused(args.recipient))return {status:'paused',messages:[]};
     const messages=this.transaction(()=>{this.attendedBy(p,args);return this.claim(p,{...args,handler_id:a.handler_id});});
     if(messages.length)return {status:'messages',messages};
     const remaining=Math.min(end-Date.now(),a.deadline-this.now());if(remaining<=0)break;
     await this.changedWithin(args.recipient,Math.min(200,remaining),signal);
   }while(true);
   return {status:'timeout',messages:[]};
 }
 async wait(p,{recipient,timeout_ms},signal){
   check(Number.isInteger(timeout_ms)&&timeout_ms>=0&&timeout_ms<=25000,'INVALID_TIMEOUT');
   this.scope(p,'wake',recipient);
   const waiter=randomUUID();
   this.transaction(()=>{
     this.scope(p,'wake',recipient);
     this.db.prepare('DELETE FROM wake_waiters WHERE deadline<=?').run(this.now());
     check(this.db.prepare('SELECT count(*) n FROM wake_waiters WHERE recipient=?').get(recipient).n<4,'TOO_MANY_WAITERS');
     this.db.prepare('INSERT INTO wake_waiters VALUES(?,?,?)').run(waiter,recipient,this.now()+timeout_ms+5000);
     const seen=this.waiterLastSeen(recipient);
     if(!seen||this.now()-seen>=10000)this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('waiter_last_seen:'+recipient,String(this.now()));
   });
   const end=Date.now()+timeout_ms;
   try{
   do{
     if(signal?.aborted)return {status:'timeout',recipient,pending_count:0,observed_at:new Date(this.now()).toISOString(),instance_id:this.instanceId,cancelled:true};
     this.scope(p,'wake',recipient);
     const observe=(record=false)=>{
       const count=this.pending(recipient),eligible=count&&this.nextWake(recipient)<=this.now()&&!signal?.aborted;
       const status=this.paused(recipient)?'paused':eligible?'pending':'timeout';
       if(record&&status==='pending'){
         this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('last_notification:'+recipient,String(this.now()));
         this.db.prepare("UPDATE outbox SET notification_attempts=notification_attempts+1,last_notified=? WHERE recipient=? AND state='pending'").run(this.now(),recipient);
       }
       return {status,recipient,pending_count:count,observed_at:new Date(this.now()).toISOString(),instance_id:this.instanceId};
     };
     let result=observe();
     if(result.status==='pending')result=this.transaction(()=>{this.scope(p,'wake',recipient);return observe(true);});
     if(result.status!=='timeout'||signal?.aborted||Date.now()>=end)return result;
     await this.changedWithin(recipient,Math.min(200,end-Date.now()),signal);
   }while(true);
   }finally{if(!this.closed)this.db.prepare('DELETE FROM wake_waiters WHERE id=?').run(waiter);}
 }
 waiterLastSeen(recipient){const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('waiter_last_seen:'+recipient);return row?Number(row.value):null;}
 maintain(){
   // Acquire a short lease in its own atomic transaction. A crash can delay, not duplicate, the next pass.
   return this.transaction(()=>{
     const row=this.db.prepare('SELECT * FROM maintenance_lease WHERE id=1').get();
     if(row&&row.until_ms>this.now())return {skipped:true};
     this.db.prepare('INSERT OR REPLACE INTO maintenance_lease VALUES(1,?,?)').run(this.instanceId,this.now()+60000);
     const result=super.maintain();
     this.db.prepare('DELETE FROM attendance WHERE deadline<=?').run(this.now());
     this.db.prepare('DELETE FROM wake_waiters WHERE deadline<=?').run(this.now());
     this.db.prepare("UPDATE workers SET state='uncertain' WHERE state='running' AND deadline<=?").run(this.now());
     this.db.prepare("UPDATE workers SET result_json=NULL WHERE id IN (SELECT id FROM workers WHERE acknowledged_at<? AND state NOT IN ('running','uncertain') AND cleanup_state NOT IN ('pending','reserved','uncertain') AND result_json IS NOT NULL LIMIT 100)").run(this.now()-90*86400000);
     return result;
   });
 }
 send(p,args){
   check(!['ihcp.request','ihcp.reply'].includes(args.kind),'RESERVED_KIND');
   return this.transaction(()=>super.send(p,args));
 }
 delivery(recipient){
   if(this.paused(recipient))return 'paused';
   if(this.attendance(recipient))return 'receiver_attending';
   const seen=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('waiter_last_seen:'+recipient);
   return seen&&this.now()-Number(seen.value)<60000?'wake_recently_seen':'pending_without_wake';
 }
 ownEndpoint(p){
   const ids=p.scopes?.claim??p.recipients??[];
   const endpoint=p.endpoint??(ids.length===1?ids[0]:null);
   check(endpoint,'REGISTERED_ENDPOINT_REQUIRED');this.scope(p,'claim',endpoint);return endpoint;
 }
 request(p,args){
   return this.transaction(()=>{
     const replyTo=this.ownEndpoint(p);
     const sent=super.send(p,{...args,kind:'ihcp.request'});
     const old=this.db.prepare('SELECT * FROM requests WHERE message_id=?').get(sent.id);
     if(old)check(old.reply_to===replyTo,'IDEMPOTENCY_CONFLICT');
     else this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(sent.id,replyTo,sent.id);
     return {...sent,request_id:sent.id,reply_to:replyTo};
   });
 }
 reply(p,args){
   return this.transaction(()=>{
     const original=this.owned(p,args,{completed:true});
     const request=this.db.prepare('SELECT * FROM requests WHERE message_id=?').get(original.id);
     check(request,'NOT_A_REQUEST');
     const sent=super.send(p,{recipient:request.reply_to,kind:'ihcp.reply',body:args.body,idempotency_key:args.idempotency_key});
     const previous=this.db.prepare('SELECT * FROM replies WHERE request_message_id=? OR message_id=?').all(original.id,sent.id);
     if(previous.length)check(previous.length===1&&previous[0].message_id===sent.id&&previous[0].request_message_id===original.id,'REPLY_CONFLICT');
     else this.db.prepare('INSERT INTO replies VALUES(?,?)').run(sent.id,original.id);
     super.complete(p,{...args,outcome:args.outcome??'Replied through IHCP3K'});
     return {...sent,request_id:original.id,recipient:request.reply_to};
   });
 }
 requestStatus(p,{id}){
   const row=this.db.prepare('SELECT r.*,m.sender,m.recipient,m.state FROM requests r JOIN messages m ON m.id=r.message_id WHERE r.message_id=?').get(id);
   check(row,'NOT_FOUND');this.scope(p,'claim',row.reply_to);
   const reply=this.db.prepare('SELECT m.id,m.state FROM replies r JOIN messages m ON m.id=r.message_id WHERE r.request_message_id=?').get(id);
   return {id,state:row.state,recipient:row.recipient,reply:reply??null};
 }
 claim(p,args){return this.transaction(()=>super.claim(p,args).map(message=>{
   const request=this.db.prepare('SELECT reply_to FROM requests WHERE message_id=?').get(message.id);
   const reply=this.db.prepare('SELECT request_message_id FROM replies WHERE message_id=?').get(message.id);
   return {...message,...(request?{request_id:message.id,reply_to:request.reply_to}:{}),...(reply?{in_reply_to:reply.request_message_id}:{})};
 }));}
 reserveWake(p,args){return this.transaction(()=>super.reserveWake(p,args));}
 recordWake(p,args){return this.transaction(()=>super.recordWake(p,args));}
 pause(p,args){return this.transaction(()=>super.pause(p,args));}
}
