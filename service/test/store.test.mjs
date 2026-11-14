import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../src/store.mjs';

const sender={id:'sender',permissions:['send'],recipients:['a','b']};
const pa={id:'pa',permissions:['claim','status'],recipients:['a']};
const waiter={id:'waiter',permissions:['wake','status'],recipients:['a']};
const admin={id:'admin',permissions:['admin'],recipients:['a']};
const msg={recipient:'a',body:'synthetic body',idempotency_key:'key'};
function fixture(t,options={}) {let now=1700000000000;const store=new Store(':memory:',{recipients:['a','b'],now:()=>now,wakeGapMs:0,...options});t.after(()=>store.close());return {store,advance:ms=>now+=ms};}
const take=store=>store.claim(pa,{recipient:'a',handler_id:'worker'})[0];
test('transactional enqueue and dedup survive completion and body removal',t=>{
  const {store}=fixture(t);const sent=store.send(sender,msg);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM outbox').get().n,1);
  assert.equal(store.send(sender,msg).id,sent.id);
  assert.throws(()=>store.send(sender,{...msg,body:'changed'}),/IDEMPOTENCY_CONFLICT/);
  const claimed=take(store);
  store.complete(pa,{...claimed,outcome:'done'});
  assert.equal(store.db.prepare('SELECT body FROM messages WHERE id=?').get(sent.id).body,null);
  assert.equal(store.complete(pa,{...claimed,outcome:'done'}).duplicate,true);
  assert.throws(()=>store.complete(pa,{...claimed,outcome:'different'}),/COMPLETION_CONFLICT/);
  assert.equal(store.send(sender,msg).state,'completed');
  assert.deepEqual(store.claim(pa,{recipient:'a',handler_id:'another'}),[]);
});
test('failed outbox insert rolls back the message and idempotency key',t=>{
  const {store}=fixture(t);
  store.db.exec("CREATE TRIGGER fault BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected'); END;");
  assert.throws(()=>store.send(sender,msg),/injected/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM messages').get().n,0);
  store.db.exec('DROP TRIGGER fault');assert.equal(store.send(sender,msg).duplicate,false);
});
test('sender, waiter and foreign inbox principals cannot claim',t=>{
  const {store}=fixture(t);store.send(sender,msg);
  for(const principal of [sender,waiter,{...pa,recipients:['b']}])assert.throws(()=>store.claim(principal,{recipient:'a',handler_id:'bad'}),/FORBIDDEN/);
  assert.throws(()=>store.send(pa,msg),/FORBIDDEN/);
});
test('release fences old claim, and expired/started work requires reconciliation',t=>{
  const {store,advance}=fixture(t);store.send(sender,msg);
  const first=take(store);store.release(pa,{...first,work_started:false});const next=take(store);
  assert.equal(next.generation,first.generation+1);
  assert.throws(()=>store.complete(pa,{...first,outcome:'late'}),/STALE_CLAIM/);
  store.renew(pa,{...next,lease_s:2});advance(2000);
  assert.throws(()=>store.complete(pa,{...next,outcome:'late'}),/STALE_CLAIM/);
  assert.equal(store.maintain().expired,1);
  assert.deepEqual(store.claim(pa,{recipient:'a',handler_id:'third'}),[]);
  store.send(sender,{...msg,idempotency_key:'second'});
  assert.equal(store.release(pa,{...take(store),work_started:true}).state,'reconcile');
});
test('independent pause identities survive unrelated resume, completion still records outcomes',t=>{
  const {store}=fixture(t);store.send(sender,msg);const claimed=take(store);
  for(const id of ['old','new'])store.pause(admin,{recipient:'a',pause_id:id,paused:true});
  store.pause(admin,{recipient:'a',pause_id:'old',paused:false});
  assert.throws(()=>take(store),/PAUSED/);
  assert.throws(()=>store.renew(pa,{...claimed,lease_s:30}),/PAUSED/);
  assert.equal(store.complete(pa,{...claimed,outcome:'already finished'}).state,'completed');
  store.pause(admin,{recipient:'a',pause_id:'new',paused:false});assert.equal(store.paused('a'),false);
});
test('bounded wait sees pending work, rearm gap and pause without ever claiming',async t=>{
  const {store}=fixture(t);
  assert.equal((await store.wait(waiter,{recipient:'a',timeout_ms:1})).status,'timeout');
  const pending=store.wait(waiter,{recipient:'a',timeout_ms:1000});
  assert.equal(store.delivery('a'),'wake_available');store.send(sender,msg);
  assert.equal((await pending).status,'pending');assert.equal(store.pending('a'),1);
  assert.equal(store.delivery('a'),'wake_recently_seen');
  assert.equal((await store.wait(waiter,{recipient:'a',timeout_ms:1000})).status,'pending');
  store.pause(admin,{recipient:'a',pause_id:'p',paused:true});
  assert.equal((await store.wait(waiter,{recipient:'a',timeout_ms:1000})).status,'paused');
});
test('abort clears armed state and listener; wait admission is bounded',async t=>{
  const {store}=fixture(t);const controllers=Array.from({length:4},()=>new AbortController());
  const promises=controllers.map(c=>store.wait(waiter,{recipient:'a',timeout_ms:1000},c.signal));
  await assert.rejects(store.wait(waiter,{recipient:'a',timeout_ms:1}),/TOO_MANY_WAITERS/);
  for(const c of controllers)c.abort();await Promise.all(promises);
  assert.equal(store.listenerCount('changed'),0);assert.equal(store.delivery('a'),'wake_recently_seen');
});
test('maintenance compacts metadata but preserves dedup and unresolved payloads',t=>{
  const {store,advance}=fixture(t);store.send(sender,msg);const c=take(store);store.complete(pa,{...c,outcome:'done'});
  store.send(sender,{...msg,idempotency_key:'unresolved'});advance(91*86400000);
  assert.equal(store.maintain().compacted,1);
  assert.equal(store.db.prepare('SELECT outcome FROM messages WHERE id=?').get(c.id).outcome,null);
  assert.equal(store.send(sender,msg).duplicate,true);
  assert.equal(store.complete(pa,{...c,outcome:'done'}).duplicate,true);
  assert.equal(take(store).body,msg.body);
});
test('administrator reconciliation is fenced, auditable and preserves duplicate protection',t=>{
  const {store}=fixture(t);store.send(sender,msg);const c=take(store);store.release(pa,{...c,work_started:true});
  const held=store.inspect(admin,{recipient:'a'}).messages[0];assert.equal(held.body,msg.body);
  const resolution={id:held.id,expected_generation:held.generation,action:'requeue',reason:'External state inspected: no effect'};
  assert.throws(()=>store.resolve(pa,resolution),/FORBIDDEN/);
  assert.equal(store.resolve(admin,resolution).state,'pending');
  assert.throws(()=>store.resolve(admin,resolution),/RESOLUTION_CONFLICT/);
  const second=take(store);store.release(pa,{...second,work_started:true});
  store.resolve(admin,{id:second.id,expected_generation:second.generation,action:'abandon',reason:'Test cancelled'});
  assert.deepEqual(store.db.prepare('SELECT action FROM audit ORDER BY id').all().map(x=>x.action),['requeue','abandon']);
  assert.equal(store.send(sender,msg).state,'completed');assert.equal(store.pending('a'),0);
});
test('notification attempts are persisted and throttled; freshness expires honestly',async t=>{
  const {store,advance}=fixture(t,{wakeGapMs:30000});store.send(sender,msg);
  assert.equal((await store.wait(waiter,{recipient:'a',timeout_ms:0})).status,'pending');
  assert.equal((await store.wait(waiter,{recipient:'a',timeout_ms:0})).status,'timeout');
  assert.equal(store.db.prepare('SELECT notification_attempts AS n FROM outbox').get().n,1);
  advance(30000);assert.equal((await store.wait(waiter,{recipient:'a',timeout_ms:0})).status,'pending');
  assert.equal(store.db.prepare('SELECT notification_attempts AS n FROM outbox').get().n,2);
  advance(60001);assert.equal(store.delivery('a'),'pending_without_wake');
});
test('capacity, byte size and recipient validation reject without dropping existing work',t=>{
  const {store}=fixture(t,{maxPending:1});store.send(sender,msg);
  assert.throws(()=>store.send(sender,{...msg,idempotency_key:'other'}),/CAPACITY_REACHED/);
  assert.equal(store.send(sender,msg).duplicate,true);
  assert.throws(()=>store.send(sender,{...msg,body:'😀'.repeat(20000)}),/BODY_TOO_LARGE/);
  assert.throws(()=>store.send(sender,{...msg,recipient:'unknown'}),/UNKNOWN_RECIPIENT/);
});
test('abrupt process death releases ownership lock and preserves committed mail for reconciliation',{timeout:5000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'interop-test-')),filename=join(dir,'test.db');
  let store,child;
  try {
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    child=fork(new URL('./fixtures/crash-worker.mjs',import.meta.url),[filename],{execArgv:[],env,stdio:['ignore','ignore','pipe','ipc']});
    await new Promise((resolve,reject)=>{child.on('message',m=>{if(m==='committed')resolve();});child.once('error',reject);child.once('exit',()=>reject(Error('Worker failed before commit')));});
    assert.throws(()=>new Store(filename,{recipients:['a','b']}),/SERVICE_ALREADY_RUNNING/);
    const exited=once(child,'exit');child.kill('SIGKILL');await exited;
    store=new Store(filename,{recipients:['a','b']});
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM messages WHERE state='reconcile'").get().n,1);
    assert.equal(store.pending('a'),1);assert.equal(store.send(sender,msg).duplicate,true);
    assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally {child?.kill('SIGKILL');store?.close();rmSync(dir,{recursive:true,force:true});}
});
