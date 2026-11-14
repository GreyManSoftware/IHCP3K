import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {Directory} from '../src/directory.mjs';

const secret=()=>randomBytes(32).toString('base64url');
const admin={id:'operator',permissions:['registry']};
const profile=()=>({label:'Synthetic harness',source:'synthetic native inventory',observed_at:'2026-11-14T00:00:00.000Z',fresh_for_s:600,models:[{id:'custom/model',access:'unknown',source:'manual'}],usage:[{pool:'shared',window:'weekly',percent_used:74,resets_at:null,source:'synthetic',observed_at:'2026-11-14T00:00:00.000Z'}],wake:{type:'manual',lifetime:'while linked',closed_app:'unknown',human_fallback:'check this inbox manually'}});
function fixture(t){let now=Date.parse('2026-11-14T00:00:00Z');const store=new Store(':memory:',{recipients:['bootstrap'],now:()=>now});const dir=new Directory(store);t.after(()=>store.close());return {store,dir,advance:ms=>now+=ms};}
function register(dir,id,peers=[],revision=0){const issued=dir.issue(admin,{endpoint:id,harness:id,peers,expected_revision:revision});const enrol=dir.authenticate(issued.enrolment_token);const input={profile:profile(),binding:{native_thread:'private-synthetic-binding'},session_token:secret(),wake_token:secret()};return {issued,enrol,input,result:dir.register(enrol,input),session:dir.authenticate(input.session_token)};}

test('enrolment is one-use, fenced, scoped and confidential in discovery',t=>{
 const {store,dir}=fixture(t),a=register(dir,'a',['b']),b=register(dir,'b',['a']);register(dir,'hidden');
 assert.deepEqual(dir.register(a.enrol,a.input),a.result);
 assert.throws(()=>dir.register(a.enrol,{...a.input,session_token:secret()}),/ENROLMENT_USED/);
 assert.throws(()=>dir.issue(a.session,{endpoint:'evil',harness:'evil',peers:[]}),/FORBIDDEN/);
 assert.throws(()=>store.claim(a.session,{recipient:'b',handler_id:'wrong'}),/FORBIDDEN/);
 const found=dir.discover(a.session,{limit:1});assert.equal(found.entries.length,1);assert.equal(found.next_after,'a');
 assert.equal(dir.discover(a.session,{after:found.next_after}).entries[0].endpoint,'b');
 const all=dir.discover(a.session);assert.equal(all.entries.length,2);
 assert.ok(!JSON.stringify(all).includes('private-synthetic-binding'));
 assert.ok(!JSON.stringify(all).includes(a.input.session_token));
 const sent=store.send(a.session,{recipient:'b',body:'direct',idempotency_key:'direct'});
 const claim=store.claim(b.session,{recipient:'b',handler_id:'peer'})[0];assert.equal(claim.id,sent.id);
 store.complete(b.session,{...claim,outcome:'done'});
 assert.throws(()=>dir.discover(dir.authenticate(a.input.wake_token)),/FORBIDDEN/);
});

test('expired grants, conflicting revisions and observation validation fail closed',t=>{
 const {dir,advance}=fixture(t);const code=dir.issue(admin,{endpoint:'a',harness:'a',peers:[],ttl_s:30});const p=dir.authenticate(code.enrolment_token);advance(30001);
 assert.equal(dir.authenticate(code.enrolment_token),null);
 assert.throws(()=>dir.register(p,{profile:profile(),session_token:secret(),wake_token:secret()}),/ENROLMENT_EXPIRED/);
 const a=register(dir,'a');assert.throws(()=>register(dir,'a'),/REVISION_CONFLICT/);
 for(const [field,value,error] of [['models',[{id:'x',access:'yes',source:'guess'}],'INVALID_MODELS'],['usage',[{...profile().usage[0],percent_used:101}],'INVALID_USAGE'],['observed_at','2099-01-01T00:00:00Z','INVALID_OBSERVATION']]){
   assert.throws(()=>dir.refresh(a.session,{endpoint:'a',expected_revision:1,profile:{...profile(),[field]:value}}),new RegExp(error));
 }
});

test('relink and deregistration revoke stale principals without discarding mail',async t=>{
 const {dir,store}=fixture(t),a=register(dir,'a',['b']),b=register(dir,'b',['a']);
 store.send(a.session,{recipient:'b',body:'work',idempotency_key:'one'});
 const claim=store.claim(b.session,{recipient:'b',handler_id:'old'})[0];
 const b2=register(dir,'b',['a'],1);
 assert.equal(dir.authenticate(b.input.session_token),null);
 assert.throws(()=>store.complete(b.session,{...claim,outcome:'late'}),/FORBIDDEN/);
 const stopped=dir.deregister(b2.session,{endpoint:'b',expected_revision:2});assert.equal(stopped.active,false);
 assert.equal(dir.inspect(admin,{endpoint:'b'}).revision,3);
 assert.throws(()=>dir.inspect(a.session,{endpoint:'b'}),/FORBIDDEN/);
 assert.throws(()=>store.send(a.session,{recipient:'b',body:'no',idempotency_key:'two'}),/ENDPOINT_DISABLED/);
 assert.equal(store.db.prepare('SELECT state,body FROM messages WHERE id=?').get(claim.id).state,'reconcile');
 assert.equal(dir.discover(a.session).entries.length,1);
 assert.equal(dir.authenticate(b2.input.wake_token),null);
 const b3=register(dir,'b',['a'],3);assert.equal(b3.result.revision,4);
 assert.equal(store.pending('b'),0); // uncertain work was not replayed
});

test('usage is advisory, does not reset itself and rejects older snapshots',t=>{
 const {dir,advance}=fixture(t),a=register(dir,'a');advance(700000);
 const row=dir.discover(a.session).entries[0];assert.equal(row.stale,true);assert.equal(row.usage[0].stale,true);assert.equal(row.usage[0].percent_used,74);assert.equal(row.presence.awake,'unknown');
 const newer={...profile(),observed_at:'2026-11-14T00:11:00Z'};
 assert.equal(dir.refresh(a.session,{endpoint:'a',expected_revision:1,profile:newer}).revision,2);
 assert.throws(()=>dir.refresh(a.session,{endpoint:'a',expected_revision:2,profile:profile()}),/STALE_OBSERVATION/);
});

test('directory and credentials survive restart, while restored credentials require relink',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'ihcp-directory-')),file=join(folder,'db');t.after(()=>rmSync(folder,{recursive:true,force:true}));
 let store=new Store(file,{recipients:['bootstrap'],now:()=>Date.parse('2026-11-14T00:00:00Z')}),dir=new Directory(store);
 const a=register(dir,'a');assert.throws(()=>new Store(file,{recipients:[]}),/SERVICE_ALREADY_RUNNING/);store.close();
 store=new Store(file,{recipients:['bootstrap']});dir=new Directory(store);t.after(()=>store.close());
 assert.equal(dir.authenticate(a.input.session_token).endpoint,'a');assert.equal(dir.discover(dir.authenticate(a.input.session_token)).entries[0].endpoint,'a');
 const {snapshot,restore}=await import('../src/backup.mjs');
 const backup=join(folder,'backup.db'),saved=await snapshot(file,backup);
 const restored=join(folder,'restored.db');restore(backup,restored,{...saved,recipients:['bootstrap']});
 const recovered=new Store(restored,{recipients:['bootstrap']}),recoveredDir=new Directory(recovered);
 try{assert.equal(recoveredDir.authenticate(a.input.session_token),null);assert.equal(recovered.paused('a'),true);}finally{recovered.close();}
});
