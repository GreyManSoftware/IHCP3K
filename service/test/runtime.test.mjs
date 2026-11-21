import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedStore} from '../src/shared-store.mjs';
import {WorkerManager} from '../src/worker-manager.mjs';
import {Notifications} from '../src/notifications.mjs';
import {randomBytes} from 'node:crypto';

const p={id:'test-session',permissions:['send','claim','wake','status'],recipients:['a']};
function fixture(t){const s=new SharedStore(':memory:',{recipients:['a']});t.after(()=>s.close());return s;}
const config={enabled:true,type:'codex-worker',allow_endpoints:['a'],persist:true,retention:{action:'delete',hours:0},timeout_ms:1000,cleanup:{delete:true}};
const result={status:'completed',exited:true,output:'result',persisted:true,native_session_id:'00000000-0000-4000-8000-000000000001'};

test('worker dedup, ownership, acknowledged cleanup and uncertain retry boundary',async t=>{
 const s=fixture(t);let runs=0,deletions=0;let resolveRun;
 const manager=new WorkerManager(s,{test:config},{preflight:()=>({status:'ready'}),run:()=>{runs++;return new Promise(resolve=>resolveRun=resolve);},cleanup:async()=>{deletions++;return {status:'completed'};}});
 const job=manager.start(p,{adapter:'test',prompt:'task',idempotency_key:'one'});
 assert.equal(manager.start(p,{adapter:'test',prompt:'task',idempotency_key:'one'}).duplicate,true);
 assert.throws(()=>manager.start(p,{adapter:'test',prompt:'changed',idempotency_key:'one'}),/IDEMPOTENCY_CONFLICT/);
 assert.throws(()=>manager.status({...p,id:'another'},{id:job.id}),/FORBIDDEN/);
 assert.throws(()=>manager.ack(p,{id:job.id}),/RESULT_NOT_READY/);
 await Promise.resolve();resolveRun(result);await manager.wait(p,{id:job.id,timeout_ms:1000});
 await manager.maintain();assert.equal(deletions,0);manager.ack(p,{id:job.id});
 await Promise.all([manager.maintain(),manager.maintain()]);assert.equal(runs,1);assert.equal(deletions,1);
 assert.equal(manager.status(p,{id:job.id}).cleanup,'completed');
 const uncertain=new WorkerManager(s,{test:config},{preflight:()=>({status:'ready'}),run:async()=>({...result,status:'uncertain',exited:false}),cleanup:async()=>{throw Error('must not delete');}});
 const next=uncertain.start(p,{adapter:'test',prompt:'unknown',idempotency_key:'two'});await uncertain.wait(p,{id:next.id,timeout_ms:1000});uncertain.ack(p,{id:next.id});await uncertain.maintain();
 assert.equal(uncertain.status(p,{id:next.id}).state,'uncertain');assert.equal(uncertain.start(p,{adapter:'test',prompt:'unknown',idempotency_key:'two'}).duplicate,true);
});

test('retention follows the current trusted configuration and elapsed time without model polling',async t=>{
 const s=fixture(t);let now=Date.now();s.now=()=>now;
 const configs={test:{...config,retention:{action:'delete',hours:1}}};let deletes=0;
 const m=new WorkerManager(s,configs,{preflight:()=>({status:'ready'}),run:async()=>result,cleanup:async()=>{deletes++;return {status:'completed'};}});
 const job=m.start(p,{adapter:'test',prompt:'task',idempotency_key:'one'});await m.wait(p,{id:job.id,timeout_ms:1000});m.ack(p,{id:job.id});await m.maintain();assert.equal(deletes,0);
 now+=3600001;configs.test={...configs.test,executable:'/changed'};await m.maintain();assert.equal(deletes,0);assert.equal(m.status(p,{id:job.id}).cleanup,'configuration_changed');
});

test('late worker results preserve uncertainty and persistence failure cannot reject the background task',async t=>{
 const s=fixture(t);let finish;
 const m=new WorkerManager(s,{test:config},{preflight:()=>({status:'ready'}),run:()=>new Promise(resolve=>finish=resolve)});
 const late=m.start(p,{adapter:'test',prompt:'late',idempotency_key:'late'});await Promise.resolve();
 s.db.prepare("UPDATE workers SET state='uncertain' WHERE id=?").run(late.id);finish(result);await m.active.get(late.id).task;
 assert.equal(m.status(p,{id:late.id}).state,'uncertain');assert.equal(m.status(p,{id:late.id}).result.late_result.output,'result');
 const fail=m.start(p,{adapter:'test',prompt:'failure',idempotency_key:'fail'});await Promise.resolve();
 const transaction=s.transaction;s.transaction=()=>{throw Error('injected SQLITE_BUSY');};
 finish(result);await m.active.get(fail.id).task;s.transaction=transaction;
 assert.equal(m.status(p,{id:fail.id}).state,'running');
 s.now=()=>Date.now()+100000;s.maintain();assert.equal(m.status(p,{id:fail.id}).state,'uncertain');
});

test('notification reservations coalesce and respect attendance and endpoint revision',async t=>{
 const s=fixture(t),secret=()=>randomBytes(32).toString('base64url');
 const code=s.directory.issue({id:'admin',permissions:['registry']},{endpoint:'a',harness:'codex',peers:['a']});
 s.directory.register(s.directory.authenticate(code.enrolment_token),{profile:{label:'a',source:'test',observed_at:new Date().toISOString(),fresh_for_s:0,models:[],usage:[],wake:{type:'manual',lifetime:'test',closed_app:'unknown',human_fallback:'manual'}},session_token:secret(),wake_token:secret()});
 let sends=0;const notification=new Notifications(s,{a:{endpoint_revision:1}},async()=>{sends++;return {status:'queued'};},()=>({status:'ready'}));
 const other=new Notifications(s,{a:{endpoint_revision:1}},async()=>{sends++;return {status:'queued'};},()=>({status:'ready'}));
 s.send(p,{recipient:'a',body:'mail',idempotency_key:'mail'});const attended=s.attend(p,{recipient:'a',handler_id:'read'});
 await notification.tick();assert.equal(sends,0);s.unattend(p,{recipient:'a',attendance_token:attended.attendance_token});
 const dispatched=notification.dispatch('a');await other.tick();assert.equal((await dispatched).status,'queued');
 assert.equal(sends,1);await notification.tick();assert.equal(sends,1);
 s.claim(p,{recipient:'a',handler_id:'reader'});s.send(p,{recipient:'a',body:'new',idempotency_key:'new'});
 notification.configs.a.endpoint_revision=2;await notification.tick();assert.equal(sends,1);
 await s.wait(p,{recipient:'a',timeout_ms:0});
 const discovered=s.directory.discover({id:'discover',permissions:['discover'],scopes:{discover:['a']}});
 assert.ok(discovered.entries[0].presence.waiter_last_seen);
 // A proven pre-launch failure can retry after the transport recovers. An
 // ambiguous result must remain fenced, even after the same backoff interval.
 let now=Date.now(),outcome={status:'not_dispatched',definitely_not_started:true};s.now=()=>now;
 const recovery=new Notifications(s,{a:{endpoint_revision:1}},async()=>{sends++;return outcome;},()=>({status:'ready'}));
 s.send(p,{recipient:'a',body:'recovery',idempotency_key:'recovery'});
 assert.equal((await recovery.dispatch('a')).status,'not_dispatched');
 assert.equal((await recovery.dispatch('a')).status,'retry_deferred');
 const attempts=sends;now+=s.wakeGapMs;
 outcome={status:'uncertain'};
 assert.equal((await recovery.dispatch('a')).status,'uncertain');assert.equal(sends,attempts+1);
 now+=s.wakeGapMs*2;outcome={status:'queued'};
 assert.equal((await recovery.dispatch('a')).status,'uncertain');assert.equal(sends,attempts+1);assert.ok(s.pending('a'));
 await Promise.all([notification.stop(),other.stop(),recovery.stop()]);
});
