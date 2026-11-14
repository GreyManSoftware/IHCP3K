import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshot,restore} from '../src/backup.mjs';
import {SharedStore} from '../src/shared-store.mjs';
import {sessionAddress} from '../src/harness-registry.mjs';
const admin={id:'admin',permissions:['registry']};
const profile={label:'Synthetic',source:'test',observed_at:new Date().toISOString(),fresh_for_s:600,models:[],usage:[],wake:{type:'manual',lifetime:'test',closed_app:'unknown',human_fallback:'check'}};
const row=id=>({native_id:id,label:id,cwd:'/synthetic',state:'idle'});
function fixture(t){
 const store=new SharedStore(':memory:',{recipients:['bootstrap']});t.after(()=>store.close());
 const r=store.harnesses,inventory={alpha:[row('a1'),row('a2')],beta:[row('b1')]};
 r.discoverNative=async config=>inventory[config.cwd.slice(1)];
 const register=(id,peers=undefined,credential=(id==='alpha'?'a':'b').repeat(43))=>r.register(admin,{harness:id,credential,discovery:{type:'codex',executable:'/native/codex',cwd:'/'+id},profile,peers});
 register('alpha');register('beta');return {store,r,inventory,register,a:r.authenticate('a'.repeat(43)),b:r.authenticate('b'.repeat(43))};
}
test('one harness grant discovers existing and later sessions; stable IDs survive refresh and absent sessions are disabled',async t=>{
 const {store,r,inventory,register,a}=fixture(t);
 assert.equal(register('alpha').reused,true);
 assert.equal((await r.discover(a)).harnesses.find(h=>h.harness==='alpha').sessions.length,2);
 assert.equal(store.db.prepare('SELECT count(*) n FROM credentials').get().n,0);
 const configured=JSON.parse(store.db.prepare('SELECT config_json FROM harnesses WHERE id=?').get('alpha').config_json);assert.deepEqual(configured.notification,{enabled:true,type:'codex-queue'});
 assert.equal(r.notificationFor(sessionAddress('alpha','a1')).native_session_id,'a1');
 for(const notification of [undefined,{enabled:false,type:'claude-message'},{enabled:true,type:'claude-message',verified:false,model:'test'}])assert.throws(()=>r.register(admin,{harness:'claude',credential:'c'.repeat(43),discovery:{type:'claude',executable:'/native/claude',cwd:'/alpha'},profile,notification}),/NOTIFICATION/);
 inventory.alpha=[row('a2'),row('a3')];await r.discover(a,{force:true});
 assert.equal(store.db.prepare('SELECT active FROM endpoints WHERE id=?').get(sessionAddress('alpha','a1')).active,0);
 assert.deepEqual((await r.discover(a)).harnesses.find(h=>h.harness==='alpha').sessions.map(s=>s.native_id),['a2','a3']);
 assert.throws(()=>register('alpha',['beta'],'z'.repeat(43)),/HARNESS_ALREADY_REGISTERED/);
 assert.throws(()=>r.register(admin,{harness:'collision',credential:'a'.repeat(43),discovery:{type:'codex',executable:'/native/codex',cwd:'/alpha'},profile,peers:[]}),/CREDENTIAL_ALREADY_USED/);
});
test('two sessions share one harness connection without sharing reply inboxes or claims',async t=>{
 const {r,a,b}=fixture(t);await r.discover(a);
 const first=await r.invoke(a,'request',{session_id:'a1',recipient:sessionAddress('beta','b1'),body:'one',idempotency_key:'same-key'});
 const second=await r.invoke(a,'request',{session_id:'a2',recipient:sessionAddress('beta','b1'),body:'two',idempotency_key:'same-key'});
 assert.notEqual(first.id,second.id);assert.notEqual(first.reply_to,second.reply_to);
 const requests=(await r.invoke(b,'claim',{session_id:'b1'})).messages;assert.equal(requests.length,2);
 for(const req of requests)await r.invoke(b,'reply',{session_id:'b1',id:req.id,claim_token:req.claim_token,generation:req.generation,body:'answer '+req.body,idempotency_key:'reply-'+req.id});
 const replies=(await r.invoke(a,'claim',{session_id:'a1'})).messages;assert.equal(replies.length,1);assert.equal(replies[0].in_reply_to,first.id);
 const reply=replies[0];await assert.rejects(r.invoke(a,'complete',{session_id:'a2',id:reply.id,claim_token:reply.claim_token,generation:reply.generation,outcome:'wrong'}),/FORBIDDEN/);
 await r.invoke(a,'complete',{session_id:'a1',id:reply.id,claim_token:reply.claim_token,generation:reply.generation,outcome:'received'});
 assert.equal((await r.invoke(a,'claim',{session_id:'a2'})).messages[0].in_reply_to,second.id);
});
test('source identities, peer grants and current harness revocation are enforced',async t=>{
 const {r,a,b,store}=fixture(t);await r.discover(a);
 await assert.rejects(r.invoke(a,'request',{session_id:'b1',recipient:sessionAddress('beta','b1'),body:'spoof',idempotency_key:'spoof'}),/SESSION_NOT_DISCOVERED/);
 await assert.rejects(r.invoke(a,'request',{session_id:'a1',recipient:'invented',body:'x',idempotency_key:'x'}),/RECIPIENT_NOT_DISCOVERED_OR_PERMITTED/);
 await r.invoke(a,'request',{session_id:'a1',recipient:sessionAddress('beta','b1'),body:'keep pending',idempotency_key:'pending'});
 const removed=r.unregister(b);assert.equal(removed.sessions_revoked,1);assert.equal(r.authenticate('b'.repeat(43)),null);
 await assert.rejects(r.discover(b),/FORBIDDEN/);assert.equal(store.pending(sessionAddress('beta','b1')),1);
 assert.equal((await r.discover(a)).harnesses.length,1);
 await assert.rejects(r.invoke(a,'request',{session_id:'a1',recipient:sessionAddress('beta','b1'),body:'no',idempotency_key:'revoked'}),/RECIPIENT_NOT_DISCOVERED_OR_PERMITTED/);
});
test('failed, duplicate or incomplete inventories never erase the last successful directory or authorize sending',async t=>{
 const {r,a,inventory,store}=fixture(t);await r.discover(a);
 inventory.beta=[row('b1'),row('b1')];const result=await r.discover(a,{force:true});const beta=result.harnesses.find(h=>h.harness==='beta');
 assert.equal(beta.stale,true);assert.equal(beta.error,'INVALID_SESSION_INVENTORY');assert.equal(beta.sessions.length,1);
 await assert.rejects(r.invoke(a,'request',{session_id:'a1',recipient:sessionAddress('beta','b1'),body:'no',idempotency_key:'bad-scan'}),/RECIPIENT_NOT_DISCOVERED_OR_PERMITTED/);
 assert.equal(store.pending(sessionAddress('beta','b1')),0);
});
test('unregister racing an inventory cannot resurrect sessions; relink requires a new registration',async t=>{
 const {r,a,inventory,register,store}=fixture(t);await r.discover(a);let release;
 r.discoverNative=()=>new Promise(resolve=>release=resolve);const scan=r.refresh('alpha',{force:true});r.unregister(a);release(inventory.alpha);
 await assert.rejects(scan,/HARNESS_CHANGED_DURING_DISCOVERY/);
 assert.equal(store.db.prepare('SELECT count(*) n FROM endpoints WHERE harness=? AND active=1').get('alpha').n,0);
 assert.throws(()=>register('alpha'),/FRESH_HARNESS_CREDENTIAL_REQUIRED/);
 register('alpha',['alpha','beta'],'c'.repeat(43));assert.equal(r.authenticate('a'.repeat(43)),null);assert.ok(r.authenticate('c'.repeat(43)));
});
test('registration connects existing and later harnesses automatically; explicit restrictions remain enforced',async t=>{
 const {r,a,store,register,inventory}=fixture(t);
 assert.deepEqual((await r.discover(a)).harnesses.map(h=>h.harness),['alpha','beta']);
 inventory.gamma=[row('g1')];register('gamma',undefined,'g'.repeat(43));
 assert.deepEqual((await r.discover(a)).harnesses.map(h=>h.harness),['alpha','beta','gamma']);
 assert.deepEqual((await r.discover(r.authenticate('g'.repeat(43)))).harnesses.map(h=>h.harness),['alpha','beta','gamma']);
 r.unregister(r.authenticate('g'.repeat(43)));
 assert.throws(()=>register('bad',['not valid']),/INVALID_HARNESS_PEERS/);store.db.prepare('UPDATE harnesses SET peers_json=? WHERE id=?').run('[]','beta');
 assert.deepEqual((await r.discover(a)).harnesses.map(h=>h.harness),['alpha']);
});

test('cross-process scan leases reject a late snapshot without poisoning a newer successful inventory',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ihcp-harness-')),file=join(dir,'mail.db');let now=Date.now();
 const a=new SharedStore(file,{recipients:['bootstrap'],now:()=>now}),b=new SharedStore(file,{recipients:['bootstrap'],now:()=>now});t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});
 a.harnesses.register(admin,{harness:'alpha',credential:'a'.repeat(43),discovery:{type:'codex',executable:'/native/codex',cwd:'/alpha'},profile,peers:[]});
 let release;a.harnesses.discoverNative=()=>new Promise(resolve=>release=resolve);b.harnesses.discoverNative=async()=>[row('new')];
 const old=a.harnesses.refresh('alpha');await assert.rejects(b.harnesses.refresh('alpha'),/DISCOVERY_BUSY/);
 now+=22000;await b.harnesses.refresh('alpha');release([row('old')]);await assert.rejects(old,/DISCOVERY_LEASE_EXPIRED/);
 assert.equal(b.db.prepare('SELECT last_error FROM harnesses WHERE id=?').get('alpha').last_error,null);
 assert.equal(b.db.prepare('SELECT count(*) n FROM endpoints WHERE id=?').get(sessionAddress('alpha','old')).n,0);
 assert.equal(b.db.prepare('SELECT active FROM endpoints WHERE id=?').get(sessionAddress('alpha','new')).active,1);
});
test('offline restore revokes harness credentials and discovery leases without deleting stored messages',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ihcp-harness-')),file=join(dir,'mail.db'),saved=join(dir,'backup.db'),target=join(dir,'restored.db');
 const source=new SharedStore(file,{recipients:['bootstrap']});let restored;t.after(()=>{source.close();restored?.close();rmSync(dir,{recursive:true,force:true});});
 const r=source.harnesses;r.register(admin,{harness:'alpha',credential:'a'.repeat(43),discovery:{type:'codex',executable:'/native/codex',cwd:'/alpha'},profile,peers:[]});r.discoverNative=async()=>[row('a1')];await r.refresh('alpha');
 const info=await snapshot(file,saved);restore(saved,target,{sha256:info.sha256,recipients:['bootstrap',sessionAddress('alpha','a1')]});restored=new SharedStore(target,{recipients:['bootstrap']});
 assert.equal(restored.harnesses.authenticate('a'.repeat(43)),null);assert.equal(restored.db.prepare('SELECT active FROM harnesses WHERE id=?').get('alpha').active,0);assert.equal(restored.db.prepare('SELECT count(*) n FROM harness_scans').get().n,0);
});
