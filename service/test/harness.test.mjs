import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshot,restore} from '../src/backup.mjs';
import {SharedStore} from '../src/shared-store.mjs';
import {sessionAddress} from '../src/harness-registry.mjs';
import {NativeCatalogue} from '../src/native-catalogue.mjs';
import {WorkerManager} from '../src/worker-manager.mjs';
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

test('harness-only remote work needs no target session; correlation, scope and duplicate prevention survive completion',async t=>{
 const {store,r,a,b,inventory}=fixture(t);inventory.beta=[];let calls=0,configUsed,inputUsed;
 store.workers=new WorkerManager(store,{}, {run:async(config,input)=>{calls++;configUsed=config;inputUsed=input;return {status:'completed',exited:true,answer:'A useful answer',persisted:false};}});
 store.workers.defaultDirectory=tmpdir();t.after(()=>store.workers.stop());
 const args={session_id:'a1',harness:'beta',prompt:'Review this',context:'example code',allow_new_session:true,idempotency_key:'one-job',model:'test-model'};
 const first=await r.invoke(a,'remote_prompt',args);
 const result=await r.invoke(a,'worker_wait',{session_id:'a1',id:first.id,timeout_ms:1000});
 assert.equal(result.state,'completed');assert.equal(result.result.answer,'A useful answer');
 assert.equal(first.reply_to,sessionAddress('alpha','a1'));assert.equal(first.working_folder,tmpdir());
 assert.equal(configUsed.executable,'/native/codex');assert.equal(configUsed.persist,false);assert.equal(configUsed.managed_read_only,true);
 assert.equal(configUsed.model,'test-model');assert.match(inputUsed.prompt,/example code/);
 assert.equal((await r.invoke(a,'remote_prompt',args)).id,first.id);assert.equal(calls,1);
 await assert.rejects(r.invoke(a,'remote_prompt',{...args,prompt:'changed'}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(r.invoke(a,'worker_status',{session_id:'a2',id:first.id}),/FORBIDDEN/);
 await assert.rejects(r.invoke(a,'remote_prompt',{...args,session_id:'b1'}),/SESSION_NOT_DISCOVERED/);
 for(const [change,error] of [
  [{allow_new_session:false},'NEW_SESSION_NOT_AUTHORIZED'],[{permissions:'workspace-write'},'REMOTE_WORK_PERMISSION_UNSUPPORTED'],
  [{harness:'unknown'},'HARNESS_NOT_REGISTERED_OR_PERMITTED'],[{working_folder:'relative'},'ABSOLUTE_WORKING_FOLDER_REQUIRED'],
  [{model:'--unsafe'},'INVALID_MODEL'],[{executable:'/bin/sh'},'INVALID_REMOTE_WORK_FIELD'],
  [{timeout_ms:300001},'INVALID_TIMEOUT'],[{prompt:'x'.repeat(65537)},'INVALID_PROMPT']
 ])await assert.rejects(r.invoke(a,'remote_prompt',{...args,...change}),new RegExp(error));
 const nativeDefault=await r.invoke(a,'remote_prompt',{...args,model:undefined,idempotency_key:'native-default'});
 await r.invoke(a,'worker_wait',{session_id:'a1',id:nativeDefault.id,timeout_ms:1000});
 assert.equal(configUsed.native_default_model,true);assert.equal(configUsed.model,undefined);
 store.db.prepare('UPDATE harnesses SET peers_json=? WHERE id=?').run('[]','beta');
 await assert.rejects(r.invoke(a,'remote_prompt',{...args,idempotency_key:'denied'}),/HARNESS_NOT_REGISTERED_OR_PERMITTED/);
 r.unregister(b);
 await assert.rejects(r.invoke(a,'remote_prompt',args),/HARNESS_NOT_REGISTERED_OR_PERMITTED/);
 assert.equal(calls,2);
});

test('quiet listener owns a renewable lease, never claims, and restores notification fallback',async t=>{
 const {store,r,a,b}=fixture(t);await r.discover(a);
 const recipient=sessionAddress('alpha','a1');let now=Date.now();store.now=()=>now;
 const first=await r.invoke(a,'listen',{session_id:'a1',timeout_ms:0});assert.equal(first.status,'timeout');
 await assert.rejects(r.invoke(a,'wait',{session_id:'a1',timeout_ms:0}),/INBOX_ATTENDED/);
 await assert.rejects(r.invoke(a,'unattend',{session_id:'a2',attendance_token:first.attendance_token}),/STALE_ATTENDANCE/);
 now+=1000;
 const renewed=await r.invoke(a,'listen',{session_id:'a1',attendance_token:first.attendance_token,timeout_ms:0});
 assert.equal(renewed.attendance_token,first.attendance_token);assert.equal(store.attendance(recipient).deadline,now+120000);
 await r.invoke(b,'send',{session_id:'b1',recipient,body:'pending',idempotency_key:'listen'});
 const p=await r.sessionPrincipal(a,'a1');assert.equal(store.reserveWake(p,{recipient}).reserved,false);
 const ready=await r.invoke(a,'listen',{session_id:'a1',attendance_token:first.attendance_token,timeout_ms:0});
 assert.equal(ready.status,'pending');assert.equal(ready.pending_count,1);assert.equal(store.pending(recipient),1);
 assert.equal(store.attendance(recipient).deadline,now+15000);
 now+=15001;assert.equal(store.reserveWake(p,{recipient}).reserved,true);
});

test('quiet waits release attendance after cancellation, pause, invalid requests and revocation',async t=>{
 const {store,r,a}=fixture(t);await r.discover(a);const recipient=sessionAddress('alpha','a1');
 await assert.rejects(r.invoke(a,'exchange',{session_id:'a1',recipient:sessionAddress('beta','b1'),body:'x'.repeat(65537),idempotency_key:'invalid',timeout_ms:0}));
 assert.equal(store.attendance(recipient),undefined);
 for(const action of ['cancel','pause','revoke']){
  const abort=new AbortController();
  // Inject the event at the actual waiting boundary, without timing sleeps.
  store.changedWithin=async()=>{
   if(action==='cancel')abort.abort();
   if(action==='pause')store.db.prepare('INSERT INTO pauses(recipient,pause_id,created_at) VALUES(?,?,?)').run(recipient,'test',store.now());
   if(action==='revoke')r.unregister(a);
  };
  const result=r.invoke(a,'wait',{session_id:'a1',timeout_ms:1000},abort.signal);
  if(action==='revoke')await assert.rejects(result);else assert.equal((await result).status,action==='cancel'?'cancelled':'paused');
  assert.equal(store.attendance(recipient),undefined);
  if(action==='pause')store.db.prepare('DELETE FROM pauses WHERE recipient=?').run(recipient);
 }
});
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
 await assert.rejects(r.invoke(a,'request',{session_id:'a1',recipient:sessionAddress('beta','b1'),body:'no',idempotency_key:'bad-scan'}),/RECIPIENT_DISCOVERY_STALE:INVALID_SESSION_INVENTORY/);
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


test('operator config refresh preserves credentials, addresses and claims; races and stale revisions fail closed',async t=>{
 const {store,r,a,b,inventory}=fixture(t);await r.discover(a);
 const sent=await r.invoke(b,'request',{session_id:'b1',recipient:sessionAddress('alpha','a1'),body:'keep',idempotency_key:'keep'});
 const [claim]=(await r.invoke(a,'claim',{session_id:'a1'})).messages;
 const rowBefore=store.db.prepare('SELECT * FROM harnesses WHERE id=?').get('alpha');
 const discovery={type:'codex',executable:'/new/codex',cwd:'/alpha'};
 const update={harness:'alpha',expected_revision:1,discovery,profile:{...profile,native_version:'new',models:[{id:'new-model',access:'available',source:'native observation'}]}};
 assert.throws(()=>r.configure(a,update),/FORBIDDEN/);
 let release;r.discoverNative=()=>new Promise(resolve=>release=resolve);const scan=r.refresh('alpha',{force:true});
 const changed=r.configure(admin,update);assert.equal(changed.revision,2);assert.ok(r.authenticate('a'.repeat(43)));assert.equal(r.active(a),true);
 release(inventory.alpha);await assert.rejects(scan,/DISCOVERY_LEASE_EXPIRED|HARNESS_CHANGED_DURING_DISCOVERY/);
 assert.equal(r.configure(admin,update).reused,true);
 assert.throws(()=>r.configure(admin,{...update,discovery:{...discovery,executable:'/third/codex'}}),/REVISION_CONFLICT/);
 const after=store.db.prepare('SELECT * FROM harnesses WHERE id=?').get('alpha');assert.equal(after.token_hash,rowBefore.token_hash);assert.equal(after.peers_json,rowBefore.peers_json);
 r.discoverNative=async c=>inventory[c.cwd.slice(1)];
 const result=await r.invoke(a,'reply',{session_id:'a1',id:claim.id,claim_token:claim.claim_token,generation:claim.generation,body:'preserved',idempotency_key:'preserved'});assert.equal(result.request_id,sent.id);
 assert.equal(store.db.prepare('SELECT revision FROM endpoints WHERE id=?').get(sessionAddress('alpha','a1')).revision,1);
 r.unregister(a);assert.equal(r.active(a),false);
});

test('failed own scan permits retained inbox and correlated replies, but never new identities or sends',async t=>{
 const {store,r,a,b,inventory}=fixture(t);await r.discover(a);
 const request=await r.invoke(b,'request',{session_id:'b1',recipient:sessionAddress('alpha','a1'),body:'read me',idempotency_key:'retained'});
 r.discoverNative=async()=>{throw Object.assign(Error('DISCOVERY_START_FAILED'),{code:'DISCOVERY_START_FAILED'});};
 await r.discover(a,{force:true});
 const health=r.health(a);assert.equal(health.healthy,false);assert.equal(health.harnesses[0].error,'DISCOVERY_START_FAILED');
 assert.equal((await r.invoke(a,'status',{session_id:'a1'})).retained_identity,true);
 const claimed=await r.invoke(a,'claim',{session_id:'a1'});assert.equal(claimed.discovery_warning,'DISCOVERY_START_FAILED');const [msg]=claimed.messages;
 await assert.rejects(r.invoke(a,'claim',{session_id:'invented'}),/SESSION_NOT_DISCOVERED/);
 await assert.rejects(r.invoke(a,'claim',{session_id:'b1'}),/SESSION_NOT_DISCOVERED/);
 await assert.rejects(r.invoke(a,'send',{session_id:'a1',recipient:sessionAddress('beta','b1'),body:'no',idempotency_key:'no'}),/DISCOVERY_START_FAILED/);
 await assert.rejects(r.invoke(a,'reply',{session_id:'a2',id:msg.id,claim_token:msg.claim_token,generation:msg.generation,body:'wrong',idempotency_key:'wrong'}),/FORBIDDEN/);
 const reply=await r.invoke(a,'reply',{session_id:'a1',id:msg.id,claim_token:msg.claim_token,generation:msg.generation,body:'answer',idempotency_key:'retained-answer'});assert.equal(reply.request_id,request.id);
 const answers=await r.invoke(b,'claim',{session_id:'b1'});assert.equal(answers.messages[0].in_reply_to,request.id);
 await r.invoke(b,'complete',{session_id:'b1',id:answers.messages[0].id,claim_token:answers.messages[0].claim_token,generation:answers.messages[0].generation,outcome:'received'});
 assert.equal((await r.invoke(a,'wait',{session_id:'a1',timeout_ms:0})).retained_identity,true);
 // A successful empty inventory disables retained identities; revocation remains decisive.
 r.discoverNative=async c=>c.cwd==='/alpha'?[]:inventory.beta;await r.discover(a,{force:true});
 await assert.rejects(r.invoke(a,'claim',{session_id:'a1'}),/SESSION_NOT_DISCOVERED/);
 r.unregister(a);await assert.rejects(r.invoke(a,'status',{session_id:'a1'}),/FORBIDDEN/);
});


test('native catalogue follows executable and entitlement changes, keeps last complete list on failure, and fences concurrent probes',async t=>{
 const {store,r,a}=fixture(t);
 let now=Date.now(),build='one',ids=['old','keep'],failure=false,probes=0,gate;
 store.now=()=>now;
 r.catalogue=new NativeCatalogue(store,{
  identify:config=>({executable:config.executable,fingerprint:build}),
  observe:async(config,base,options)=>{
   probes++;
   if(failure)throw Object.assign(Error('offline'),{code:'NATIVE_PROFILE_RPC_FAILED'});
   if(gate)await gate;
   return {...base,native_version:build,observed_at:options.now(),models:ids.map(id=>({id,access:'available',source:'fixture'}))};
  }
 });
 const list=async()=> (await r.discover(a)).harnesses.find(h=>h.harness==='alpha');
 assert.deepEqual((await list()).profile.models.map(m=>m.id),['old','keep']);
 await list();assert.equal(probes,2); // Two permitted harnesses, one probe each.
 const originalRevision=r.configuration(admin,'alpha').revision;
 build='two';ids=['new','keep'];
 const upgraded=await list();assert.deepEqual(upgraded.profile.models.map(m=>m.id),['new','keep']);assert.equal(upgraded.profile.native_version,'two');
 assert.equal(r.configuration(admin,'alpha').revision,originalRevision);
 build='three';failure=true;
 const failed=await list();assert.deepEqual(failed.profile.models.map(m=>m.id),['new','keep']);assert.equal(failed.model_catalogue.error,'NATIVE_PROFILE_RPC_FAILED');
 const attempted=probes;await list();assert.equal(probes,attempted);
 now+=60000;failure=false;ids=[];
 const empty=await list();assert.deepEqual(empty.profile.models,[]);assert.equal(empty.model_catalogue.stale,false);
 now+=3600000;ids=['new-entitlement'];assert.deepEqual((await list()).profile.models.map(m=>m.id),ids);
 build='four';let release;gate=new Promise(resolve=>release=resolve);
 const row=store.db.prepare('SELECT * FROM harnesses WHERE id=?').get('alpha'),config=JSON.parse(row.config_json);
 const active=r.catalogue.refresh(row,config);
 const sameDatabase=new NativeCatalogue(store,{observe:()=>assert.fail('only the lease owner may probe'),identify:r.catalogue.identify});
 await sameDatabase.refresh(row,config);
 const current=r.configuration(admin,'alpha');
 r.configure(admin,{harness:'alpha',expected_revision:current.revision,discovery:current.discovery,profile:{...current.profile,native_version:'operator replacement'}});
 release();await active;
 assert.equal(r.catalogue.profile(store.db.prepare('SELECT * FROM harnesses WHERE id=?').get('alpha')).native_version,'operator replacement');
});
