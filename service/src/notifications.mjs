import {notifyNative,buildNativeCommand} from './native-adapters.mjs';

// No model polling. A live runtime observes only explicitly configured inboxes.
export class Notifications {
 constructor(store,configs={},notify=notifyNative,preflight=buildNativeCommand){this.store=store;this.configs=configs;this.notify=notify;this.preflight=preflight;this.active=new Map();this.stopping=false;}
 async tick(){
   if(this.stopping)return;
   for(const recipient of Object.keys(this.configs).slice(0,100))this.start(recipient);
 }
 start(recipient){
     const config=this.configs[recipient];
     if(this.stopping||!config)return {status:'unconfigured'};
     if(this.active.has(recipient))return this.active.get(recipient);
     if(!this.store.pending(recipient))return {status:'no_pending_mail'};
     const endpoint=this.store.db.prepare('SELECT revision,active FROM endpoints WHERE id=?').get(recipient);
     if(!endpoint?.active||endpoint.revision!==config.endpoint_revision)return {status:'binding_requires_review'};
     if((config.timeout_ms??30000)>30000)return {status:'unsupported',reason:'notification_timeout_limit'};
     const preflight=this.preflight(config,'notify',{recipient});
     if(preflight.status!=='ready')return {status:'unsupported',reason:preflight.reason};
     const p={id:'runtime-wake',permissions:['wake'],scopes:{wake:[recipient]}};
     let reservation;try{reservation=this.store.reserveWake(p,{recipient});}catch{return {status:'unavailable'};}
     if(!reservation.reserved)return {status:reservation.state};
     const abort=new AbortController();
     const task=Promise.resolve().then(()=>this.notify(config,{recipient,signal:abort.signal})).catch(()=>({status:'uncertain'})).then(result=>{
       try{this.store.recordWake(p,{recipient,...reservation,result:result.status==='queued'?'queued':'uncertain'});}catch{/* A claim/relink may already have fenced this result. */}
       return {status:result.status,receipt:'native dispatch only; target consumption requires a claim'};
     }).finally(()=>this.active.delete(recipient));
     const active={abort,task};this.active.set(recipient,active);return active;
 }
 async dispatch(recipient){const result=this.start(recipient);return result.task?await result.task:result;}
 async stop(){this.stopping=true;const active=[...this.active.values()];for(const {abort} of active)abort.abort();await Promise.allSettled(active.map(x=>x.task));}
}
