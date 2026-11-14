import {createHash, randomBytes} from 'node:crypto';
import {ServiceError} from './store.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const check = (v,c) => {if(!v)throw new ServiceError(c);};
const validId = v => typeof v==='string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
const iso = n => new Date(n).toISOString();
const token = v => typeof v==='string' && /^[A-Za-z0-9_-]{43,128}$/.test(v);

// One database owns both credentials and directory state. Only token hashes are stored.
export class Directory {
  constructor(store) {
    this.store=store; this.db=store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enrolments (hash TEXT PRIMARY KEY, grant_json TEXT NOT NULL, expires INTEGER NOT NULL, used_hash TEXT, result_json TEXT);
      CREATE TABLE IF NOT EXISTS endpoints (id TEXT PRIMARY KEY, harness TEXT NOT NULL, revision INTEGER NOT NULL, active INTEGER NOT NULL, profile_json TEXT NOT NULL, binding_json TEXT NOT NULL, last_seen INTEGER);
      CREATE TABLE IF NOT EXISTS credentials (hash TEXT PRIMARY KEY, endpoint TEXT NOT NULL REFERENCES endpoints(id), role TEXT NOT NULL, principal_json TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS directory_audit (id INTEGER PRIMARY KEY, principal TEXT NOT NULL, action TEXT NOT NULL, endpoint TEXT NOT NULL, at INTEGER NOT NULL);
    `);
    for(const row of this.db.prepare('SELECT id FROM endpoints').all())store.recipients.add(row.id);
    store.transaction(()=>{if(this.db.prepare('PRAGMA user_version').get().user_version<4)this.db.exec('PRAGMA user_version=4;');});
    store.directory=this;
  }
  audit(p,action,id){this.db.prepare('INSERT INTO directory_audit(principal,action,endpoint,at) VALUES(?,?,?,?)').run(p.id,action,id,this.store.now());}
  active(p){
    if(p.harness_hash)return this.store.harnesses?.active(p)??false;
    if(!p.directory_hash)return true;
    return !!this.db.prepare('SELECT 1 FROM credentials c JOIN endpoints e ON e.id=c.endpoint WHERE c.hash=? AND c.revoked=0 AND e.active=1').get(p.directory_hash);
  }
  allowedRecipient(id){const e=this.db.prepare('SELECT active FROM endpoints WHERE id=?').get(id);return !e || !!e.active;}
  authenticate(secret){
    const h=hash(secret),row=this.db.prepare('SELECT c.*,e.active FROM credentials c JOIN endpoints e ON e.id=c.endpoint WHERE c.hash=?').get(h);
    if(row && !row.revoked && row.active){
      if(row.role==='session')this.db.prepare('UPDATE endpoints SET last_seen=? WHERE id=?').run(this.store.now(),row.endpoint);
      return {...JSON.parse(row.principal_json),directory_hash:h,endpoint:row.endpoint};
    }
    const code=this.db.prepare('SELECT * FROM enrolments WHERE hash=? AND expires>?').get(h,this.store.now());
    return code?{id:'enrolment',permissions:['enroll'],enrolment_hash:h}:null;
  }
  admin(p){check(p.permissions.includes('registry'),'FORBIDDEN');}
  inspect(p,{endpoint}){
    this.admin(p);
    const row=this.db.prepare('SELECT id,harness,revision,active FROM endpoints WHERE id=?').get(endpoint);
    check(row,'NOT_FOUND');
    return {...row,active:!!row.active,counts:this.db.prepare('SELECT state,count(*) AS count FROM messages WHERE recipient=? GROUP BY state').all(endpoint)};
  }
  issue(p,{endpoint,harness,peers,expected_revision=0,ttl_s=600}){
    this.admin(p);
    check(validId(endpoint)&&validId(harness)&&Array.isArray(peers)&&peers.length<=100&&peers.every(validId)&&new Set(peers).size===peers.length,'INVALID_ENROLMENT');
    check(Number.isInteger(ttl_s)&&ttl_s>=30&&ttl_s<=3600,'INVALID_TTL');
    const old=this.db.prepare('SELECT revision FROM endpoints WHERE id=?').get(endpoint);
    check((old?.revision??0)===expected_revision,'REVISION_CONFLICT');
    const secret=randomBytes(32).toString('base64url'),expires=this.store.now()+ttl_s*1000;
    this.store.transaction(()=>{
      this.db.prepare('INSERT INTO enrolments(hash,grant_json,expires) VALUES(?,?,?)').run(hash(secret),JSON.stringify({endpoint,harness,peers,expected_revision}),expires);
      this.audit(p,'issue',endpoint);
    });
    return {enrolment_token:secret,endpoint,expires_at:iso(expires)};
  }
  validateProfile(profile){
    check(profile && typeof profile==='object' && !Array.isArray(profile),'INVALID_PROFILE');
    check(Buffer.byteLength(JSON.stringify(profile))<=60000,'PROFILE_TOO_LARGE');
    check(Object.keys(profile).every(k=>['label','source','observed_at','fresh_for_s','models','usage','wake','capabilities','adapter_version','native_version','account_scope'].includes(k)),'INVALID_PROFILE_FIELD');
    check(typeof profile.label==='string'&&profile.label.length>0&&profile.label.length<=100,'INVALID_PROFILE');
    check(typeof profile.source==='string'&&profile.source.length>0&&profile.source.length<=500,'INVALID_SOURCE');
    const at=Date.parse(profile.observed_at);
    check(Number.isFinite(at)&&at<=this.store.now()+60000,'INVALID_OBSERVATION');
    check(Number.isInteger(profile.fresh_for_s)&&profile.fresh_for_s>=0&&profile.fresh_for_s<=604800,'INVALID_FRESHNESS');
    check(Array.isArray(profile.models)&&profile.models.length<=200&&profile.models.every(m=>typeof m.id==='string'&&m.id.length<=200&&['available','conditional','unavailable','unknown'].includes(m.access)&&typeof m.source==='string'),'INVALID_MODELS');
    check(Array.isArray(profile.usage)&&profile.usage.length<=50,'INVALID_USAGE');
    for(const u of profile.usage){
      check(typeof u.pool==='string'&&typeof u.window==='string'&&typeof u.source==='string'&&Number.isFinite(Date.parse(u.observed_at))&&Date.parse(u.observed_at)<=this.store.now()+60000,'INVALID_USAGE');
      check(u.percent_used===null || (Number.isFinite(u.percent_used)&&u.percent_used>=0&&u.percent_used<=100),'INVALID_USAGE');
      check(u.resets_at===null||Number.isFinite(Date.parse(u.resets_at)),'INVALID_USAGE');
    }
    check(profile.wake && typeof profile.wake.type==='string' && typeof profile.wake.lifetime==='string' && typeof profile.wake.human_fallback==='string' && ['unknown','supported','unsupported'].includes(profile.wake.closed_app),'INVALID_WAKE');
  }
  register(p,{profile,binding={},session_token,wake_token}){
    check(p.permissions.includes('enroll'),'FORBIDDEN');this.validateProfile(profile);
    check(token(session_token)&&token(wake_token)&&session_token!==wake_token,'INVALID_CREDENTIAL');
    check(binding && typeof binding==='object'&&!Array.isArray(binding)&&Buffer.byteLength(JSON.stringify(binding))<=4000,'INVALID_BINDING');
    const payloadHash=hash(JSON.stringify({profile,binding,session_token,wake_token}));
    let applied=false;
    const result=this.store.transaction(()=>{
      const code=this.db.prepare('SELECT * FROM enrolments WHERE hash=?').get(p.enrolment_hash);
      check(code&&code.expires>this.store.now(),'ENROLMENT_EXPIRED');
      if(code.used_hash){check(code.used_hash===payloadHash,'ENROLMENT_USED');return JSON.parse(code.result_json);}
      const g=JSON.parse(code.grant_json),old=this.db.prepare('SELECT revision FROM endpoints WHERE id=?').get(g.endpoint);
      check((old?.revision??0)===g.expected_revision,'REVISION_CONFLICT');
      const revision=g.expected_revision+1;
      this.db.prepare('INSERT INTO endpoints VALUES(?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET harness=excluded.harness,revision=excluded.revision,active=1,profile_json=excluded.profile_json,binding_json=excluded.binding_json,last_seen=excluded.last_seen').run(g.endpoint,g.harness,revision,JSON.stringify(profile),JSON.stringify(binding),this.store.now());
      this.db.prepare('UPDATE credentials SET revoked=1 WHERE endpoint=?').run(g.endpoint);
      for(const [role,secret,scopes] of [['session',session_token,{send:g.peers,claim:[g.endpoint],status:[g.endpoint],discover:[g.endpoint,...g.peers],profile:[g.endpoint]}],['wake',wake_token,{wake:[g.endpoint],status:[g.endpoint]}]]){
        const principal={id:g.endpoint+'-'+role,permissions:Object.keys(scopes),scopes};
        this.db.prepare('INSERT INTO credentials(hash,endpoint,role,principal_json) VALUES(?,?,?,?)').run(hash(secret),g.endpoint,role,JSON.stringify(principal));
      }
      const answer={endpoint:g.endpoint,harness:g.harness,revision};
      this.db.prepare('UPDATE enrolments SET used_hash=?,result_json=? WHERE hash=?').run(payloadHash,JSON.stringify(answer),p.enrolment_hash);
      this.db.prepare("UPDATE messages SET state='reconcile',deadline=NULL WHERE recipient=? AND state='claimed'").run(g.endpoint);
      this.db.prepare("UPDATE outbox SET state='reconcile' WHERE recipient=? AND state='claimed'").run(g.endpoint);
      this.store.clearAttendance?.(g.endpoint) ?? this.store.attendees.delete(g.endpoint);
      this.db.prepare("UPDATE wake_dispatch SET state='uncertain',generation=generation+1,token_hash=NULL WHERE recipient=? AND state!='idle'").run(g.endpoint);
      applied=true;this.audit(p,'register',g.endpoint);return answer;
    });
    if(!applied)return result;
    this.store.recipients.add(result.endpoint);
    this.store.emit('changed',result.endpoint);return result;
  }
  refresh(p,{endpoint,expected_revision,profile}){
    check(this.active(p)&&p.scopes?.profile?.includes(endpoint),'FORBIDDEN');this.validateProfile(profile);
    return this.store.transaction(()=>{
      check(this.active(p)&&p.scopes?.profile?.includes(endpoint),'FORBIDDEN');
      const row=this.db.prepare('SELECT * FROM endpoints WHERE id=? AND active=1').get(endpoint);
      check(row&&row.revision===expected_revision,'REVISION_CONFLICT');
      const old=JSON.parse(row.profile_json);
      check(Date.parse(profile.observed_at)>=Date.parse(old.observed_at),'STALE_OBSERVATION');
      for(const u of profile.usage){const prev=old.usage.find(x=>x.pool===u.pool&&x.window===u.window);check(!prev||Date.parse(u.observed_at)>=Date.parse(prev.observed_at),'STALE_OBSERVATION');}
      this.db.prepare('UPDATE endpoints SET profile_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(profile),endpoint);
      this.audit(p,'refresh',endpoint);return {endpoint,revision:row.revision+1};
    });
  }
  discover(p,{after='',limit=20}={}){
    check(this.active(p)&&p.permissions.includes('discover'),'FORBIDDEN');
    check(Number.isInteger(limit)&&limit>=1&&limit<=100,'INVALID_LIMIT');
    const permitted=p.scopes.discover;
    const rows=this.db.prepare('SELECT * FROM endpoints WHERE active=1 AND id>? ORDER BY id').all(after).filter(r=>permitted.includes(r.id)).slice(0,limit+1);
    return {entries:rows.slice(0,limit).map(r=>{
      const profile=JSON.parse(r.profile_json),age=Math.max(0,(this.store.now()-Date.parse(profile.observed_at))/1000);
      return {endpoint:r.id,harness:r.harness,revision:r.revision,profile,age_s:age,stale:age>profile.fresh_for_s,advisory:true,usage:profile.usage.map(u=>({...u,age_s:Math.max(0,(this.store.now()-Date.parse(u.observed_at))/1000),stale:this.store.now()-Date.parse(u.observed_at)>300000,advisory:true})),presence:{last_client_seen:r.last_seen?iso(r.last_seen):null,attendance_until:this.store.attendance(r.id)?.deadline?iso(this.store.attendance(r.id).deadline):null,waiter_last_seen:(this.store.waiterLastSeen?.(r.id)??this.store.lastSeen.get(r.id))?iso(this.store.waiterLastSeen?.(r.id)??this.store.lastSeen.get(r.id)):null,awake:'unknown'},can_send:p.scopes.send?.includes(r.id)??false};
    }),next_after:rows.length>limit?rows[limit-1].id:null};
  }
  deregister(p,{endpoint,expected_revision}){
    check(p.permissions.includes('registry')||(this.active(p)&&p.scopes?.profile?.includes(endpoint)),'FORBIDDEN');
    const result=this.store.transaction(()=>{
      check(p.permissions.includes('registry')||(this.active(p)&&p.scopes?.profile?.includes(endpoint)),'FORBIDDEN');
      const row=this.db.prepare('SELECT * FROM endpoints WHERE id=?').get(endpoint);
      check(row&&row.revision===expected_revision,'REVISION_CONFLICT');
      this.db.prepare('UPDATE endpoints SET active=0,revision=revision+1 WHERE id=?').run(endpoint);
      this.db.prepare('UPDATE credentials SET revoked=1 WHERE endpoint=?').run(endpoint);
      this.db.prepare("UPDATE messages SET state='reconcile',deadline=NULL WHERE recipient=? AND state='claimed'").run(endpoint);
      this.db.prepare("UPDATE outbox SET state='reconcile' WHERE recipient=? AND state='claimed'").run(endpoint);
      this.store.clearAttendance?.(endpoint) ?? this.store.attendees.delete(endpoint);
      this.audit(p,'deregister',endpoint);
      return {endpoint,active:false,revision:row.revision+1,pending:this.store.pending(endpoint)};
    });
    this.store.emit('changed',endpoint);return result;
  }
}
