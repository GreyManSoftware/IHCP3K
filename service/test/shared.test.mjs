import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fork} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SharedStore} from '../src/shared-store.mjs';
import {Store} from '../src/store.mjs';
import {Directory} from '../src/directory.mjs';
import {randomBytes} from 'node:crypto';

const p={id:'test',permissions:['send','claim','wake','status'],recipients:['a']};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'ihcp-shared-')),file=join(dir,'db');const a=new SharedStore(file,{recipients:['a']});const b=new SharedStore(file,{recipients:['a']});t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});return {a,b,file};}
test('another instance preserves claims and observes shared attendance',async t=>{
 const {a,b,file}=fixture(t);a.send(p,{recipient:'a',body:'one',idempotency_key:'one'});
 const claim=a.claim(p,{recipient:'a',handler_id:'first'})[0];
 const third=new SharedStore(file,{recipients:['a']});third.close();
 assert.equal(b.pending('a'),0);assert.equal(a.complete(p,{...claim,outcome:'done'}).state,'completed');
 const attendance=a.attend(p,{recipient:'a',handler_id:'wait'});
 assert.throws(()=>b.attend(p,{recipient:'a',handler_id:'duplicate'}),/INBOX_ATTENDED/);
 b.send(p,{recipient:'a',body:'reply',idempotency_key:'two'});
 assert.equal((await b.wait(p,{recipient:'a',timeout_ms:0})).status,'timeout');
 assert.equal((await a.receive(p,{recipient:'a',attendance_token:attendance.attendance_token,timeout_ms:0})).messages.length,1);
 a.unattend(p,{recipient:'a',attendance_token:attendance.attendance_token});assert.equal(b.attendance('a'),undefined);
 assert.equal(a.maintain().skipped,undefined);assert.equal(b.maintain().skipped,true);
});
test('old connections and old protocol writers cannot mutate upgraded storage',t=>{
 const {a,file}=fixture(t);const old=new DatabaseSync(file);t.after(()=>old.close());
 assert.throws(()=>old.prepare('INSERT INTO metadata VALUES(?,?)').run('bad','bad'),/ihcp_writer_version/);
 old.function('ihcp_writer_version',()=>4);
 assert.throws(()=>old.prepare('INSERT INTO metadata VALUES(?,?)').run('bad','bad'),/WRITER_VERSION_MISMATCH/);
 a.db.prepare('INSERT INTO metadata VALUES(?,?)').run('good','good');
});
test('separate processes atomically deduplicate and claim without clearing each other',async t=>{
 const {a,file}=fixture(t);
 const run=()=>new Promise((resolve,reject)=>{const child=fork(new URL('./fixtures/shared-worker.mjs',import.meta.url),[file],{stdio:['ignore','ignore','pipe','ipc']});let result;child.on('message',m=>result=m);child.on('error',reject);child.on('exit',code=>code===0?resolve(result):reject(Error('worker '+code)));});
 const results=await Promise.all([run(),run(),run()]);
 assert.equal(new Set(results.map(r=>r.sent)).size,1);assert.equal(results.reduce((n,r)=>n+r.claims.length,0),1);
 assert.equal(a.db.prepare("SELECT count(*) n FROM messages WHERE state='claimed'").get().n,1);
});

test('request reply is correlated, fenced, idempotent and atomic with completion',t=>{
 const {a,b}=fixture(t);
 const p1={id:'first',permissions:['send','claim'],scopes:{send:['a'],claim:['a']}},p2={id:'second',permissions:['send','claim'],scopes:{send:['a'],claim:['a']}};
 const sent=a.request(p1,{recipient:'a',body:'question',idempotency_key:'ask'});
 assert.equal(a.request(p1,{recipient:'a',body:'question',idempotency_key:'ask'}).id,sent.id);
 assert.throws(()=>a.send(p1,{recipient:'a',kind:'ihcp.reply',body:'spoof',idempotency_key:'spoof'}),/RESERVED_KIND/);
 const claimed=b.claim(p2,{recipient:'a',handler_id:'answer'})[0];assert.equal(claimed.reply_to,'a');
 const response=b.reply(p2,{...claimed,body:'answer',idempotency_key:'answer',outcome:'answered'});
 assert.equal(b.reply(p2,{...claimed,body:'answer',idempotency_key:'answer',outcome:'answered'}).duplicate,true);
 assert.throws(()=>b.reply(p2,{...claimed,body:'extra',idempotency_key:'extra',outcome:'answered'}),/REPLY_CONFLICT/);
 assert.throws(()=>b.reply(p2,{...claimed,body:'answer',idempotency_key:'answer',outcome:'changed'}),/COMPLETION_CONFLICT/);
 assert.equal(a.pending('a'),1);assert.equal(a.requestStatus(p1,{id:sent.id}).reply.id,response.id);
 const reply=a.claim(p1,{recipient:'a',handler_id:'read'})[0];assert.equal(reply.in_reply_to,sent.id);assert.equal(reply.body,'answer');
 assert.equal(a.db.prepare('SELECT body FROM messages WHERE id=?').get(sent.id).body,null);
});

test('cross-process expiry and late credentials do not resurrect claims or attendance',async t=>{
 const {a,b}=fixture(t);let now=Date.now();a.now=b.now=()=>now;
 const lease=a.attend(p,{recipient:'a',handler_id:'old',lease_s:1});now+=1001;
 const successor=b.attend(p,{recipient:'a',handler_id:'new'});
 assert.throws(()=>a.unattend(p,{recipient:'a',attendance_token:lease.attendance_token}),/STALE_ATTENDANCE/);
 assert.equal(b.attendance('a').handler_id,'new');
 b.unattend(p,{recipient:'a',attendance_token:successor.attendance_token});
 a.send(p,{recipient:'a',body:'expires',idempotency_key:'expires'});const claim=a.claim(p,{recipient:'a',handler_id:'old',lease_s:1})[0];
 now+=1001;b.maintain();assert.throws(()=>a.complete(p,{...claim,outcome:'late'}),/STALE_CLAIM/);
 assert.equal(b.pending('a'),0);
});

test('schema upgrade refuses an active legacy owner and preserves unresolved data',t=>{
 const dir=mkdtempSync(join(tmpdir(),'ihcp-upgrade-')),file=join(dir,'db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const old=new Store(file,{recipients:['a']});new Directory(old);
 const sent=old.send(p,{recipient:'a',body:'pending',idempotency_key:'migration'});
 assert.throws(()=>new SharedStore(file,{recipients:['a']}),/MIGRATION_OR_LEGACY_OWNER_BUSY/);old.close();
 const next=new SharedStore(file,{recipients:['a']});t.after(()=>next.close());
 assert.equal(next.claim(p,{recipient:'a',handler_id:'new'})[0].id,sent.id);
 assert.throws(()=>new Store(file,{recipients:['a']}),/SCHEMA_VERSION_UNSUPPORTED/);
});

test('shared restore fences jobs and credentials and preserves correlated mail',async t=>{
 const {a,file}=fixture(t);const backup=file+'.backup',destination=file+'.restored';
 const {snapshot,restore}=await import('../src/backup.mjs');
 a.request(p,{recipient:'a',body:'recover',idempotency_key:'recover'});
 const result=await snapshot(file,backup);restore(backup,destination,{...result,recipients:['a']});
 const restored=new SharedStore(destination,{recipients:['a']});
 try{assert.equal(restored.paused('a'),true);assert.equal(restored.pending('a'),0);assert.equal(restored.db.prepare('SELECT count(*) n FROM requests').get().n,1);}finally{restored.close();}
});

test('a crashed shared writer rolls back without disturbing another live connection',async t=>{
 const {a,b,file}=fixture(t);
 a.send(p,{recipient:'a',body:'committed',idempotency_key:'before-crash'});
 const code=await new Promise((resolve,reject)=>{const child=fork(new URL('./fixtures/shared-worker.mjs',import.meta.url),[file,'crash'],{stdio:'ignore'});child.on('error',reject);child.on('exit',resolve);});
 assert.equal(code,17);assert.equal(b.db.prepare("SELECT value FROM metadata WHERE key='uncommitted-crash'").get(),undefined);
 assert.equal(b.claim(p,{recipient:'a',handler_id:'survivor'}).length,1);
});

test('wake waits cap cross-process leases and throttle shared presence writes',async t=>{
 const {a,b}=fixture(t);let now=Date.now();a.now=b.now=()=>now;
 const abort=new AbortController();const waits=Array.from({length:4},()=>a.wait(p,{recipient:'a',timeout_ms:1000},abort.signal));
 await assert.rejects(b.wait(p,{recipient:'a',timeout_ms:0}),/TOO_MANY_WAITERS/);
 const seen=b.waiterLastSeen('a');assert.equal(seen,now);
 now+=1000;abort.abort();await Promise.all(waits);
 assert.equal(a.db.prepare('SELECT count(*) n FROM wake_waiters').get().n,0);
 await b.wait(p,{recipient:'a',timeout_ms:0});assert.equal(a.waiterLastSeen('a'),seen);
 now+=10000;await b.wait(p,{recipient:'a',timeout_ms:0});assert.equal(a.waiterLastSeen('a'),now);
});
