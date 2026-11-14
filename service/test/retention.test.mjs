import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SharedStore} from '../src/shared-store.mjs';
import {RETENTION,checkAdmission,walSize} from '../src/retention.mjs';
const day=86400000,p={id:'a',permissions:['send','claim','status'],recipients:['a']};
function fixture(t,file=false){let now=Date.now();const dir=file?mkdtempSync(join(tmpdir(),'ihcp-retention-')):null;const store=new SharedStore(dir?join(dir,'db'):':memory:',{recipients:['a'],now:()=>now});t.after(()=>{store.close();if(dir)rmSync(dir,{recursive:true,force:true});});return {s:store,advance:ms=>now+=ms};}
const send=(s,key)=>s.send(p,{recipient:'a',body:'payload',idempotency_key:key});
const claim=s=>s.claim(p,{recipient:'a',handler_id:'test'})[0];
test('history expires as complete request/reply groups; recent dedup and unresolved work survive',t=>{
 const {s,advance}=fixture(t);const req=s.request(p,{recipient:'a',body:'ask',idempotency_key:'request'});const c=claim(s);const reply=s.reply(p,{...c,body:'answer',idempotency_key:'reply'});
 const plain=send(s,'plain');const claimed=s.claim(p,{recipient:'a',handler_id:'test',limit:10});s.complete(p,{...claimed.find(x=>x.id===plain.id),outcome:'done'});
 const held=claimed.find(x=>x.id===reply.id);s.release(p,{...held,work_started:false});
 advance(89*day);s.maintain();assert.equal(send(s,'plain').duplicate,true);
 advance(2*day);s.maintain();assert.equal(s.db.prepare('SELECT 1 FROM messages WHERE id=?').get(plain.id),undefined);
 assert.ok(s.db.prepare('SELECT 1 FROM messages WHERE id=?').get(req.id));assert.equal(s.requestStatus(p,{id:req.id}).reply.state,'pending');
 const received=claim(s);s.complete(p,{...received,outcome:'read'});const unresolved=send(s,'unresolved');const uc=claim(s);s.release(p,{...uc,work_started:true});
 advance(91*day);const result=s.maintain();assert.equal(result.retention.messages,2);assert.equal(s.db.prepare('SELECT count(*) n FROM requests').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM replies').get().n,0);
 assert.equal(s.db.prepare('SELECT state,body FROM messages WHERE id=?').get(unresolved.id).state,'reconcile');assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(s.maintain().skipped,true);assert.equal(send(s,'plain').duplicate,false); // documented finite retry window
});
test('pruning removes only unreferenced inactive sessions and acknowledged settled workers',t=>{
 const {s,advance}=fixture(t);const at=s.now();
 for(const [id,active] of [['inactive',0],['paused',0],['active',1],['unresolved',0]])s.db.prepare('INSERT INTO endpoints VALUES(?,?,1,?,?,?,?)').run(id,'legacy',active,'{}','{}',at);
 s.db.prepare('INSERT INTO pauses VALUES(?,?,?)').run('paused','user-pause',at);
 const unresolved=send(s,'open');s.db.prepare('UPDATE messages SET sender=? WHERE id=?').run('unresolved',unresolved.id);
 const workers=[['settled','completed','retained',at],['failed','failed','pending',at],['unacked','completed','retained',null],['uncertain','uncertain','retained',at],['cleanup','completed','uncertain',at]];
 for(const [id,state,cleanup,ack] of workers)s.db.prepare(`INSERT INTO workers(id,owner,endpoint,adapter,dedup_key,input_hash,config_hash,state,result_json,created_at,deadline,acknowledged_at,cleanup_action,cleanup_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,'a','a','test',id,'h','h',state,'{}',at,at+1000,ack,'none',cleanup);
 advance(31*day);let r=s.maintain();assert.equal(r.retention.sessions,1);assert.equal(r.retention.workers,0);
 advance(60*day);r=s.maintain();assert.equal(r.retention.workers,2);assert.deepEqual(s.db.prepare('SELECT id FROM workers ORDER BY id').all().map(x=>x.id),['cleanup','unacked','uncertain']);
 assert.deepEqual(s.db.prepare('SELECT id FROM endpoints ORDER BY id').all().map(x=>x.id),['active','paused','unresolved']);assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('row and SQLite size limits reject growth atomically; a pinned WAL pauses writes until readers release',t=>{
 const {s}=fixture(t,true);send(s,'one');assert.throws(()=>checkAdmission(s,'messages',1),/DATABASE_CAPACITY/);assert.equal(send(s,'one').duplicate,true);
 const pages=s.db.prepare('PRAGMA page_count').get().page_count;s.db.exec(`PRAGMA max_page_count=${pages+4}`);
 assert.throws(()=>s.send(p,{recipient:'a',body:'x'.repeat(65536),idempotency_key:'large'}),/DATABASE_CAPACITY/);assert.equal(s.db.prepare('SELECT count(*) n FROM messages').get().n,1);
 s.db.exec('PRAGMA max_page_count=65536');
 const reader=new DatabaseSync(s.filename);reader.exec('BEGIN');reader.prepare('SELECT count(*) FROM messages').get();send(s,'two');
 const old=RETENTION.walBytes;RETENTION.walBytes=1;
 try{assert.ok(walSize(s)>1);assert.throws(()=>send(s,'blocked'),/DATABASE_WAL_CAPACITY/);}finally{reader.exec('ROLLBACK');reader.close();RETENTION.walBytes=old;}
 s.maintain();assert.equal(walSize(s),0);assert.equal(send(s,'after').state,'pending');assert.equal(s.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
