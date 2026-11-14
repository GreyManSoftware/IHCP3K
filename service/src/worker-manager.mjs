import {createHash,randomUUID} from 'node:crypto';
import {ServiceError} from './store.mjs';
import {runNativeWorker,cleanupNativeWorker,buildNativeCommand} from './native-adapters.mjs';
const check=(value,code)=>{if(!value)throw new ServiceError(code);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Each manager owns only its child processes. SQLite owns job identity/results.
export class WorkerManager {
 constructor(store,configs={},executors={}){
   this.store=store;this.db=store.db;this.configs=configs;this.active=new Map();this.stopping=false;
   this.run=executors.run??runNativeWorker;this.cleanup=executors.cleanup??cleanupNativeWorker;this.preflight=executors.preflight??buildNativeCommand;this.maintenanceAbort=new AbortController();
 }
 owned(p,id){const row=this.db.prepare('SELECT * FROM workers WHERE id=?').get(id);check(row,'NOT_FOUND');this.store.scope(p,'claim',row.endpoint);check(row.owner===p.id,'FORBIDDEN');return row;}
 start(p,{adapter,prompt,idempotency_key}){
   check(!this.stopping,'RUNTIME_STOPPING');
   check(typeof prompt==='string'&&prompt.length>0&&Buffer.byteLength(prompt)<=65536,'INVALID_PROMPT');
   check(typeof idempotency_key==='string'&&idempotency_key.length>0&&idempotency_key.length<=200,'INVALID_KEY');
   const endpoint=this.store.ownEndpoint(p),config=this.configs[adapter];
   check(config?.allow_endpoints?.includes(endpoint)||(p.harness_hash&&config?.allow_harnesses?.includes(p.harness)),'WORKER_NOT_CONFIGURED');
   check(this.preflight(config,'worker',{prompt}).status==='ready','WORKER_CONFIGURATION_UNSUPPORTED');
   const retention=config.retention??{action:'none',hours:0};
   check(['none','archive','delete'].includes(retention.action)&&Number.isFinite(retention.hours)&&retention.hours>=0&&retention.hours<=8760,'INVALID_RETENTION');
   check(retention.action==='none'||(config.persist===true&&config.type==='codex-worker'),'CLEANUP_UNSUPPORTED');
   check(retention.action==='none'||config.cleanup?.[retention.action]===true,'CLEANUP_UNSUPPORTED');
   const fingerprint=hash([adapter,prompt,config]),timeout=config.timeout_ms??30000;
   check(Number.isInteger(timeout)&&timeout>=1&&timeout<=300000,'INVALID_TIMEOUT');
   const started=this.store.transaction(()=>{
     this.store.scope(p,'claim',endpoint);check(!this.store.paused(endpoint),'PAUSED');
     const old=this.db.prepare('SELECT * FROM workers WHERE owner=? AND dedup_key=?').get(p.id,idempotency_key);
     if(old){check(old.input_hash===fingerprint,'IDEMPOTENCY_CONFLICT');return {id:old.id,state:old.state,duplicate:true};}
     check(this.db.prepare("SELECT count(*) n FROM workers WHERE state='running'").get().n<8,'WORKER_CAPACITY_REACHED');
     const id=randomUUID(),at=this.store.now();
     this.db.prepare("INSERT INTO workers(id,owner,endpoint,adapter,dedup_key,input_hash,config_hash,state,created_at,deadline,cleanup_action,cleanup_after,cleanup_state) VALUES(?,?,?,?,?,?,?,'running',?,?,?,?, 'pending')").run(id,p.id,endpoint,adapter,idempotency_key,fingerprint,hash(config),at,at+timeout+30000,retention.action,retention.hours*3600000);
     return {id,state:'running',duplicate:false};
   });
   if(!started.duplicate){
     const abort=new AbortController();
     const task=Promise.resolve().then(()=>this.run(config,{prompt,signal:abort.signal})).catch(()=>({status:'uncertain',exited:false,output:'Worker execution failed; inspect before retry.'})).then(result=>{
       const terminal=result.exited===true&&['completed','failed','unsupported'].includes(result.status);
       this.store.transaction(()=>{
         const saved=this.db.prepare("UPDATE workers SET state=?,result_json=?,cleanup_after=? WHERE id=? AND state='running'").run(terminal?result.status:'uncertain',JSON.stringify(result),this.store.now()+retention.hours*3600000,started.id);
         if(!saved.changes)this.db.prepare("UPDATE workers SET result_json=? WHERE id=? AND state='uncertain' AND result_json IS NULL").run(JSON.stringify({status:'uncertain',late_result:result}),started.id);
       });
     }).catch(()=>{console.error('worker_result_persistence_failed');/* Durable running row expires to uncertain; never replay. */}).finally(()=>this.active.delete(started.id));
     this.active.set(started.id,{abort,task});
   }
   return started;
 }
 status(p,{id}){const r=this.owned(p,id);return {id,state:r.state,result:r.result_json?JSON.parse(r.result_json):null,acknowledged:r.acknowledged_at!==null,cleanup:r.cleanup_state,cleanup_action:r.cleanup_action};}
 async wait(p,{id,timeout_ms=25000}){
   check(Number.isInteger(timeout_ms)&&timeout_ms>=0&&timeout_ms<=25000,'INVALID_TIMEOUT');
   const until=Date.now()+timeout_ms;
   do{if(this.stopping)return {id,state:'uncertain',runtime_closing:true};const result=this.status(p,{id});if(result.state!=='running'||Date.now()>=until)return result;await new Promise(resolve=>setTimeout(resolve,Math.min(200,until-Date.now())));}while(true);
 }
 ack(p,{id}){return this.store.transaction(()=>{const r=this.owned(p,id);check(r.result_json&&r.state!=='running','RESULT_NOT_READY');this.db.prepare('UPDATE workers SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=?').run(this.store.now(),id);return {id,acknowledged:true};});}
 maintain(){
   if(this.maintenance)return this.maintenance;
   this.maintenance=this.performMaintenance().finally(()=>{this.maintenance=null;});return this.maintenance;
 }
 async performMaintenance(){
   if(this.stopping)return;
   // Reservation survives a crash. Uncertain deletion is never retried blindly.
   const jobs=this.store.transaction(()=>{
     const rows=this.db.prepare("SELECT * FROM workers WHERE acknowledged_at IS NOT NULL AND state='completed' AND cleanup_state='pending' AND cleanup_after<=? LIMIT 10").all(this.store.now());
     for(const r of rows)this.db.prepare("UPDATE workers SET cleanup_state='reserved' WHERE id=? AND cleanup_state='pending'").run(r.id);
     return rows;
   });
   for(const row of jobs){
     let outcome='uncertain';
     try{
       const config=this.configs[row.adapter],result=JSON.parse(row.result_json);
       if(row.cleanup_action==='none')outcome='retained';
       else if(!config||result.exited!==true||!result.native_session_id)outcome='unsupported';
       else {
         // Retention/config changes cannot silently substitute a different executable.
         const policy=config.retention??{action:'none'};
         if(policy.action!==row.cleanup_action||config.persist!==true||hash(config)!==row.config_hash)outcome='configuration_changed';
         else {const cleaned=await this.cleanup(config,{native_session_id:result.native_session_id,action:row.cleanup_action,signal:this.maintenanceAbort.signal});outcome=cleaned.status;}
       }
     }catch{}
     this.db.prepare('UPDATE workers SET cleanup_state=? WHERE id=?').run(outcome,row.id);
   }
 }
 async stop(){this.stopping=true;this.maintenanceAbort.abort();const active=[...this.active.values()];for(const {abort} of active)abort.abort();await Promise.allSettled([...active.map(x=>x.task),this.maintenance]);}
}
