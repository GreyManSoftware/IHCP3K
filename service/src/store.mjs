import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const hash = value => createHash('sha256').update(value).digest('hex');
export class ServiceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireThat = (value, code) => { if (!value) throw new ServiceError(code); };

export class Store extends EventEmitter {
  constructor(filename, {recipients, now = Date.now, maxPending = 10000, wakeGapMs = 30000, shared = false} = {}) {
    super();
    this.setMaxListeners(100);
    this.now = now;
    this.shared=shared;
    this.recipients = new Set(recipients);
    this.maxPending = maxPending;
    this.wakeGapMs = wakeGapMs;
    this.instanceId = randomUUID();
    this.armed = new Map();
    this.lastSeen = new Map();
    // Presence is deliberately ephemeral: a service restart restores normal wakes.
    this.attendees = new Map();
    this.receiving = new Set();
    // A separate rollback-journal lock DB holds an OS-backed exclusive writer lock
    // for this process lifetime. SQLite releases it even after an abrupt crash.
    if (filename !== ':memory:' && !shared) {
      this.owner = new DatabaseSync(filename+'.owner');
      try { this.owner.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner_guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;'); }
      catch { this.owner.close(); throw new ServiceError('SERVICE_ALREADY_RUNNING'); }
    }
    try {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout=5000;');
    if(shared)this.db.function('ihcp_writer_version',()=>5);
    const version = this.db.prepare('select sqlite_version() as v').get().v;
    const [major, minor, patch] = version.split('.').map(Number);
    requireThat(major > 3 || (major === 3 && (minor > 51 || minor === 51 && patch >= 3)), 'SQLITE_VERSION_UNSUPPORTED');
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const schema = this.db.prepare('PRAGMA user_version').get().user_version;
    requireThat(schema >= 0 && schema <= (shared?5:4), 'SCHEMA_VERSION_UNSUPPORTED');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL,
        dedup_key TEXT NOT NULL, input_hash TEXT NOT NULL, kind TEXT NOT NULL,
        body TEXT, state TEXT NOT NULL CHECK(state IN ('pending','claimed','completed','reconcile')),
        created_at INTEGER NOT NULL, completed_at INTEGER,
        handler TEXT, generation INTEGER NOT NULL DEFAULT 0, token_hash TEXT,
        deadline INTEGER, outcome TEXT, outcome_hash TEXT,
        UNIQUE(sender,dedup_key)
      );
      CREATE INDEX IF NOT EXISTS inbox ON messages(recipient,state,created_at,id);
      CREATE INDEX IF NOT EXISTS expiry ON messages(state,deadline);
      CREATE TABLE IF NOT EXISTS outbox (
        message_id TEXT PRIMARY KEY REFERENCES messages(id), recipient TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','claimed','done','reconcile')),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pauses (
        recipient TEXT NOT NULL, pause_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(recipient,pause_id)
      );
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
        principal TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL,
        generation INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    if (schema < 2) this.transaction(() => {
      if(this.db.prepare('PRAGMA user_version').get().user_version>=2)return;
      this.db.exec('ALTER TABLE outbox ADD COLUMN notification_attempts INTEGER NOT NULL DEFAULT 0; ALTER TABLE outbox ADD COLUMN last_notified INTEGER; PRAGMA user_version=2;');
    });
    this.db.exec(`CREATE TABLE IF NOT EXISTS wake_dispatch (
      recipient TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK(state IN ('idle','reserved','queued','uncertain')),
      token_hash TEXT, deadline INTEGER, updated_at INTEGER NOT NULL, detail TEXT
    );`);
    this.transaction(()=>{if(this.db.prepare('PRAGMA user_version').get().user_version<3)this.db.exec('PRAGMA user_version=3;');});
    if(!shared)this.db.exec("UPDATE wake_dispatch SET state='uncertain',deadline=NULL WHERE state='reserved';");
    // After service restart, a former handler might still have performed an external effect.
    if(!shared)this.db.exec("UPDATE messages SET state='reconcile' WHERE state='claimed'; UPDATE outbox SET state='reconcile' WHERE state='claimed';");
    this.sqliteVersion = version;
    } catch(e) {
      this.db?.close(); this.owner?.close(); throw e;
    }
  }
  transaction(fn) {
    const depth=this.transactionDepth??0,savepoint='nested_'+depth;
    // SQLite performs bounded native busy retries. Never replay a callback:
    // only lock acquisition can fail before any of its effects occur.
    try{this.db.exec(depth?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');}
    catch(e){if([5,6].includes(e.errcode))throw new ServiceError('DATABASE_BUSY');throw e;}
    this.transactionDepth=depth+1;
    try {
      const value=fn();
      requireThat(!value?.then,'ASYNC_TRANSACTION_FORBIDDEN');
      this.db.exec(depth?`RELEASE ${savepoint}`:'COMMIT');return value;
    } catch(e) {
      this.db.exec(depth?`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`:'ROLLBACK');throw e;
    } finally {this.transactionDepth=depth;}
  }
  recipient(id) { requireThat(this.recipients.has(id), 'UNKNOWN_RECIPIENT'); }
  scope(principal, permission, recipient) {
    requireThat(principal?.permissions?.includes(permission) && (!this.directory || this.directory.active(principal)), 'FORBIDDEN');
    if(permission==='send'||permission==='wake'||permission==='claim')requireThat(!this.directory||this.directory.allowedRecipient(recipient),'ENDPOINT_DISABLED');
    this.recipient(recipient);
    requireThat((principal.scopes?.[permission] ?? principal.recipients ?? []).includes(recipient) || (['admin','status'].includes(permission)&&principal.permissions.includes('registry')), 'FORBIDDEN');
  }
  paused(recipient) { return !!this.db.prepare('SELECT 1 FROM pauses WHERE recipient=? LIMIT 1').get(recipient); }
  pending(recipient) { return this.db.prepare("SELECT count(*) AS n FROM messages WHERE recipient=? AND state='pending'").get(recipient).n; }
  attendance(recipient) {
    const row=this.attendees.get(recipient);
    if(row && row.deadline<=this.now()){this.attendees.delete(recipient);return undefined;}
    return row;
  }
  attend(principal,{recipient,handler_id,lease_s=60}) {
    this.scope(principal,'claim',recipient);
    requireThat(typeof handler_id==='string' && handler_id.length>0 && handler_id.length<=100,'INVALID_HANDLER');
    requireThat(Number.isInteger(lease_s) && lease_s>=1 && lease_s<=120,'INVALID_ATTENDANCE_LEASE');
    requireThat(!this.paused(recipient),'PAUSED');
    requireThat(!this.attendance(recipient),'INBOX_ATTENDED');
    const token=randomUUID(),deadline=this.now()+lease_s*1000;
    this.attendees.set(recipient,{principal:principal.id,handler_id,token_hash:hash(token),deadline});
    this.emit('changed',recipient);
    const wake=this.db.prepare('SELECT state FROM wake_dispatch WHERE recipient=?').get(recipient);
    return {recipient,attendance_token:token,deadline:new Date(deadline).toISOString(),notification_already_dispatched:!!wake && wake.state!=='idle'};
  }
  attendedBy(principal,{recipient,attendance_token}) {
    this.scope(principal,'claim',recipient);
    const row=this.attendance(recipient);
    requireThat(row && row.principal===principal.id && typeof attendance_token==='string' && row.token_hash===hash(attendance_token),'STALE_ATTENDANCE');
    return row;
  }
  unattend(principal,args) {
    this.attendedBy(principal,args);
    this.attendees.delete(args.recipient);
    this.emit('changed',args.recipient);
    return {recipient:args.recipient,attending:false};
  }
  changedWithin(recipient,timeout_ms,signal) {
    if(signal?.aborted || timeout_ms<=0)return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);this.off('changed',changed);signal?.removeEventListener('abort',done);resolve();};
      const changed=id=>{if(id===recipient)done();};
      const timer=setTimeout(done,timeout_ms);
      this.on('changed',changed);signal?.addEventListener('abort',done,{once:true});
    });
  }
  async receive(principal,args,signal) {
    const {recipient,timeout_ms,limit=10,lease_s=300}=args;
    this.attendedBy(principal,args);
    requireThat(Number.isInteger(timeout_ms) && timeout_ms>=0 && timeout_ms<=25000,'INVALID_TIMEOUT');
    requireThat(Number.isInteger(limit) && limit>=1 && limit<=20,'INVALID_LIMIT');
    requireThat(Number.isInteger(lease_s) && lease_s>=1 && lease_s<=300,'INVALID_LEASE');
    requireThat(!this.receiving.has(recipient),'RECEIVER_ALREADY_WAITING');
    this.receiving.add(recipient);
    const end=this.now()+timeout_ms;
    try {
      while(true){
        const attendance=this.attendedBy(principal,args);
        if(signal?.aborted)return {status:'cancelled',messages:[]};
        if(this.paused(recipient))return {status:'paused',messages:[]};
        const messages=this.claim(principal,{recipient,handler_id:attendance.handler_id,limit,lease_s});
        if(messages.length)return {status:'messages',messages};
        const remaining=Math.min(end,attendance.deadline)-this.now();
        if(remaining<=0)return {status:'timeout',messages:[]};
        // A real timeout must terminate even when tests inject a stationary clock.
        let changed=false;
        const mark=id=>{if(id===recipient)changed=true;};
        this.on('changed',mark);
        try{await this.changedWithin(recipient,remaining,signal);}finally{this.off('changed',mark);}
        if(!changed && !signal?.aborted)return {status:'timeout',messages:[]};
      }
    } finally {this.receiving.delete(recipient);}
  }
  delivery(recipient) {
    if (this.paused(recipient)) return 'paused';
    if (this.attendance(recipient)) return 'receiver_attending';
    if ((this.armed.get(recipient) || 0) > 0) return 'wake_available';
    return this.lastSeen.has(recipient) && this.now()-this.lastSeen.get(recipient)<60000 ? 'wake_recently_seen' : 'pending_without_wake';
  }
  send(principal, {recipient, kind = 'message', body, idempotency_key}) {
    this.scope(principal, 'send', recipient);
    requireThat(typeof body === 'string' && Buffer.byteLength(body) <= 65536, 'BODY_TOO_LARGE');
    requireThat(typeof kind === 'string' && kind.length > 0 && kind.length <= 64, 'INVALID_KIND');
    requireThat(typeof idempotency_key === 'string' && idempotency_key.length > 0 && idempotency_key.length <= 200, 'INVALID_KEY');
    const inputHash = hash(JSON.stringify([recipient,kind,body]));
    const result = this.transaction(() => {
      const old = this.db.prepare('SELECT id,input_hash,state FROM messages WHERE sender=? AND dedup_key=?').get(principal.id,idempotency_key);
      if (old) {
        requireThat(old.input_hash === inputHash, 'IDEMPOTENCY_CONFLICT');
        return {id:old.id,state:old.state,duplicate:true};
      }
      requireThat(this.db.prepare("SELECT count(*) AS n FROM messages WHERE state!='completed'").get().n < this.maxPending, 'CAPACITY_REACHED');
      const id = randomUUID(), at = this.now();
      this.db.prepare("INSERT INTO messages(id,sender,recipient,dedup_key,input_hash,kind,body,state,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)").run(id,principal.id,recipient,idempotency_key,inputHash,kind,body,at);
      this.db.prepare("INSERT INTO outbox(message_id,recipient,state,created_at) VALUES(?,?,'pending',?)").run(id,recipient,at);
      return {id,state:'pending',duplicate:false};
    });
    this.emit('changed',recipient);
    return {...result,delivery:this.delivery(recipient)};
  }
  claim(principal, {recipient, handler_id, limit = 10, lease_s = 300}) {
    this.scope(principal,'claim',recipient);
    requireThat(typeof handler_id === 'string' && handler_id.length > 0 && handler_id.length <= 100, 'INVALID_HANDLER');
    requireThat(Number.isInteger(limit) && limit >= 1 && limit <= 20 && Number.isInteger(lease_s) && lease_s >= 1 && lease_s <= 300, 'INVALID_CLAIM');
    return this.transaction(() => {
      requireThat(!this.paused(recipient),'PAUSED');
      const rows = this.db.prepare("SELECT * FROM messages WHERE recipient=? AND state='pending' ORDER BY created_at,id LIMIT ?").all(recipient,limit);
      if(rows.length)this.db.prepare("UPDATE wake_dispatch SET state='idle',generation=generation+1,token_hash=NULL,deadline=NULL,updated_at=? WHERE recipient=?").run(this.now(),recipient);
      return rows.map(row => {
        const token=randomUUID(), generation=row.generation+1, deadline=this.now()+lease_s*1000;
        this.db.prepare("UPDATE messages SET state='claimed',handler=?,generation=?,token_hash=?,deadline=? WHERE id=?").run(handler_id,generation,hash(token),deadline,row.id);
        this.db.prepare("UPDATE outbox SET state='claimed' WHERE message_id=?").run(row.id);
        return {id:row.id,sender:row.sender,recipient,kind:row.kind,body:row.body,claim_token:token,generation,deadline:new Date(deadline).toISOString()};
      });
    });
  }
  owned(principal, {id,claim_token,generation}, {completed = false} = {}) {
    const row = this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    requireThat(row,'NOT_FOUND');
    this.scope(principal,'claim',row.recipient);
    requireThat(typeof claim_token === 'string' && row.token_hash === hash(claim_token) && row.generation === generation, 'STALE_CLAIM');
    if (completed && row.state === 'completed') return row;
    requireThat(row.state === 'claimed' && row.deadline > this.now(), 'STALE_CLAIM');
    return row;
  }
  renew(principal, args) {
    requireThat(Number.isInteger(args.lease_s) && args.lease_s >= 1 && args.lease_s <= 300, 'INVALID_LEASE');
    return this.transaction(() => {
      const row=this.owned(principal,args);
      requireThat(!this.paused(row.recipient),'PAUSED');
      const deadline=this.now()+args.lease_s*1000;
      this.db.prepare('UPDATE messages SET deadline=? WHERE id=?').run(deadline,row.id);
      return {deadline:new Date(deadline).toISOString()};
    });
  }
  complete(principal, args) {
    requireThat(typeof args.outcome === 'string' && Buffer.byteLength(args.outcome) <= 4096,'INVALID_OUTCOME');
    return this.transaction(() => {
      const row=this.owned(principal,args,{completed:true});
      const outcomeHash=hash(args.outcome);
      if (row.state === 'completed') {
        requireThat(row.outcome_hash === outcomeHash,'COMPLETION_CONFLICT');
        return {id:row.id,state:'completed',duplicate:true};
      }
      this.db.prepare("UPDATE messages SET state='completed',body=NULL,outcome=?,outcome_hash=?,completed_at=?,deadline=NULL WHERE id=?").run(args.outcome,outcomeHash,this.now(),row.id);
      this.db.prepare("UPDATE outbox SET state='done' WHERE message_id=?").run(row.id);
      return {id:row.id,state:'completed',duplicate:false};
    });
  }
  release(principal, args) {
    requireThat(typeof args.work_started === 'boolean','INVALID_RELEASE');
    const result=this.transaction(() => {
      const row=this.owned(principal,args), state=args.work_started?'reconcile':'pending';
      this.db.prepare('UPDATE messages SET state=?,deadline=NULL,token_hash=NULL WHERE id=?').run(state,row.id);
      this.db.prepare('UPDATE outbox SET state=? WHERE message_id=?').run(state,row.id);
      return {id:row.id,state,recipient:row.recipient};
    });
    this.emit('changed',result.recipient);
    return result;
  }
  pause(principal, {recipient,pause_id,paused}) {
    this.scope(principal,'admin',recipient);
    requireThat(typeof pause_id === 'string' && pause_id.length > 0 && pause_id.length <= 100 && typeof paused === 'boolean','INVALID_PAUSE');
    if (paused) this.db.prepare('INSERT OR IGNORE INTO pauses VALUES(?,?,?)').run(recipient,pause_id,this.now());
    else this.db.prepare('DELETE FROM pauses WHERE recipient=? AND pause_id=?').run(recipient,pause_id);
    this.emit('changed',recipient);
    return {recipient,paused:this.paused(recipient)};
  }
  status(principal, {recipient}) {
    this.scope(principal,'status',recipient);
    const last=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('waiter_last_seen:'+recipient);
    const attendance=this.attendance(recipient);
    return {recipient,delivery:this.delivery(recipient),attendance:attendance?{handler_id:attendance.handler_id,deadline:new Date(attendance.deadline).toISOString()}:null,wake_dispatch:this.db.prepare('SELECT state,generation,updated_at,detail FROM wake_dispatch WHERE recipient=?').get(recipient)??null,waiter_last_seen:last?new Date(Number(last.value)).toISOString():null,counts:this.db.prepare('SELECT state,count(*) AS count FROM messages WHERE recipient=? GROUP BY state').all(recipient),instance_id:this.instanceId};
  }
  inspect(principal, {recipient,limit=10}) {
    this.scope(principal,'admin',recipient);
    requireThat(Number.isInteger(limit)&&limit>=1&&limit<=20,'INVALID_LIMIT');
    return {messages:this.db.prepare("SELECT id,sender,recipient,kind,body,generation,created_at FROM messages WHERE recipient=? AND state='reconcile' ORDER BY created_at,id LIMIT ?").all(recipient,limit)};
  }
  resolve(principal, {id,expected_generation,action,reason}) {
    requireThat(['requeue','abandon'].includes(action) && typeof reason==='string' && reason.length>0 && reason.length<=4096,'INVALID_RESOLUTION');
    const result=this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);
      requireThat(row,'NOT_FOUND');this.scope(principal,'admin',row.recipient);
      requireThat(row.state==='reconcile' && row.generation===expected_generation,'RESOLUTION_CONFLICT');
      const outcome=JSON.stringify({action,reason,principal:principal.id});
      this.db.prepare('INSERT INTO audit(message_id,principal,action,reason,generation,created_at) VALUES(?,?,?,?,?,?)').run(id,principal.id,action,reason,row.generation,this.now());
      if (action==='requeue') {
        this.db.prepare("UPDATE messages SET state='pending',generation=generation+1,token_hash=NULL,deadline=NULL,outcome=? WHERE id=?").run(outcome,id);
        this.db.prepare("UPDATE outbox SET state='pending' WHERE message_id=?").run(id);
      } else {
        this.db.prepare("UPDATE messages SET state='completed',generation=generation+1,token_hash=NULL,deadline=NULL,body=NULL,outcome=?,outcome_hash=?,completed_at=? WHERE id=?").run(outcome,hash(outcome),this.now(),id);
        this.db.prepare("UPDATE outbox SET state='done' WHERE message_id=?").run(id);
      }
      return {id,recipient:row.recipient,state:action==='requeue'?'pending':'completed'};
    });
    this.emit('changed',result.recipient);return result;
  }
  nextWake(recipient) {
    const last=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('last_notification:'+recipient);
    return Math.max(last?Number(last.value)+this.wakeGapMs:0,this.attendance(recipient)?.deadline??0);
  }
  reserveWake(principal,{recipient}) {
    this.scope(principal,'wake',recipient);
    return this.transaction(()=>{
      requireThat(!this.paused(recipient),'PAUSED');
      if(this.attendance(recipient))return {recipient,reserved:false,state:'receiver_attending'};
      const row=this.db.prepare('SELECT * FROM wake_dispatch WHERE recipient=?').get(recipient);
      if(!this.pending(recipient) || row && row.state!=='idle')return {recipient,reserved:false,state:row?.state??'idle'};
      const token=randomUUID(),generation=(row?.generation??0)+1,now=this.now();
      this.db.prepare("INSERT INTO wake_dispatch VALUES(?,?,'reserved',?,?,?,NULL) ON CONFLICT(recipient) DO UPDATE SET generation=excluded.generation,state=excluded.state,token_hash=excluded.token_hash,deadline=excluded.deadline,updated_at=excluded.updated_at,detail=NULL").run(recipient,generation,hash(token),now+60000,now);
      return {recipient,reserved:true,generation,dispatch_token:token};
    });
  }
  recordWake(principal,{recipient,generation,dispatch_token,result}) {
    this.scope(principal,'wake',recipient);
    requireThat(['queued','uncertain'].includes(result),'INVALID_WAKE_RESULT');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM wake_dispatch WHERE recipient=?').get(recipient);
      requireThat(row && row.generation===generation && typeof dispatch_token==='string' && row.token_hash===hash(dispatch_token),'STALE_WAKE');
      if(row.state===result)return {recipient,state:result,duplicate:true};
      requireThat(row.state==='reserved' && row.deadline>this.now(),'STALE_WAKE');
      this.db.prepare('UPDATE wake_dispatch SET state=?,deadline=NULL,updated_at=? WHERE recipient=?').run(result,this.now(),recipient);
      return {recipient,state:result};
    });
  }
  resetWake(principal,{recipient,expected_generation,reason}) {
    this.scope(principal,'admin',recipient);
    requireThat(typeof reason==='string' && reason.length>0 && reason.length<=4096,'INVALID_RESOLUTION');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM wake_dispatch WHERE recipient=?').get(recipient);
      requireThat(row && row.generation===expected_generation && ['queued','uncertain'].includes(row.state),'RESOLUTION_CONFLICT');
      this.db.prepare("UPDATE wake_dispatch SET state='idle',generation=generation+1,token_hash=NULL,deadline=NULL,updated_at=?,detail=? WHERE recipient=?").run(this.now(),JSON.stringify({principal:principal.id,reason}),recipient);
      return {recipient,state:'idle',generation:row.generation+1};
    });
  }
  async wait(principal, {recipient,timeout_ms}, signal) {
    this.scope(principal,'wake',recipient);
    requireThat(Number.isInteger(timeout_ms) && timeout_ms >= 0 && timeout_ms <= 25000,'INVALID_TIMEOUT');
    requireThat((this.armed.get(recipient)||0) < 4,'TOO_MANY_WAITERS');
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('waiter_last_seen:'+recipient,String(this.now()));
    this.lastSeen.set(recipient,this.now());
    this.armed.set(recipient,(this.armed.get(recipient)||0)+1);
    try {
      const delayed=this.pending(recipient)>0 && this.nextWake(recipient)>this.now();
      if (!this.paused(recipient) && (!this.pending(recipient) || delayed) && timeout_ms > 0 && !signal?.aborted) {
        await new Promise(resolve => {
          const done=() => { clearTimeout(timer);this.off('changed',changed);signal?.removeEventListener('abort',done);resolve(); };
          const changed=id => { if (id===recipient) done(); };
          const timer=setTimeout(done,delayed?Math.min(timeout_ms,this.nextWake(recipient)-this.now()):timeout_ms);
          this.on('changed',changed); signal?.addEventListener('abort',done,{once:true});
        });
      }
      const count=this.pending(recipient);
      const status=this.paused(recipient)?'paused':count && this.nextWake(recipient)<=this.now() && !signal?.aborted?'pending':'timeout';
      if (status==='pending') this.transaction(()=>{
        this.db.prepare("UPDATE outbox SET notification_attempts=notification_attempts+1,last_notified=? WHERE recipient=? AND state='pending'").run(this.now(),recipient);
        this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('last_notification:'+recipient,String(this.now()));
      });
      return {status,recipient,pending_count:count,observed_at:new Date(this.now()).toISOString(),instance_id:this.instanceId};
    } finally { this.armed.set(recipient,this.armed.get(recipient)-1); }
  }
  maintain() {
    const at=this.now();
    for(const recipient of this.attendees.keys())this.attendance(recipient);
    return this.transaction(() => {
      this.db.prepare("UPDATE wake_dispatch SET state='uncertain',deadline=NULL,updated_at=? WHERE state='reserved' AND deadline<=?").run(at,at);
      const expired=this.db.prepare("SELECT id FROM messages WHERE state='claimed' AND deadline<=? LIMIT 100").all(at);
      for (const {id} of expired) {
        this.db.prepare("UPDATE messages SET state='reconcile',deadline=NULL WHERE id=?").run(id);
        this.db.prepare("UPDATE outbox SET state='reconcile' WHERE message_id=?").run(id);
      }
      if(this.directory){
        this.db.prepare('DELETE FROM enrolments WHERE hash IN (SELECT hash FROM enrolments WHERE expires<=? LIMIT 100)').run(at);
        this.db.prepare('DELETE FROM directory_audit WHERE id IN (SELECT id FROM directory_audit WHERE at<? LIMIT 100)').run(at-90*86400000);
      }
      const compacted=this.db.prepare("UPDATE messages SET outcome=NULL WHERE id IN (SELECT id FROM messages WHERE state='completed' AND completed_at<? AND outcome IS NOT NULL LIMIT 100)").run(at-90*86400000).changes;
      this.db.prepare("DELETE FROM outbox WHERE message_id IN (SELECT message_id FROM outbox WHERE state='done' LIMIT 100)").run();
      this.db.prepare('DELETE FROM audit WHERE id IN (SELECT id FROM audit WHERE created_at<? LIMIT 100)').run(at-90*86400000);
      this.db.prepare("INSERT OR REPLACE INTO metadata VALUES('last_maintenance',?)").run(String(at));
      return {expired:expired.length,compacted};
    });
  }
  close() { if(this.closed)return;this.closed=true;this.db.close(); if(this.owner){this.owner.exec('ROLLBACK');this.owner.close();} }
}
