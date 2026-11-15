import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {WorkerManager} from '../src/worker-manager.mjs';
import {SharedStore} from '../src/shared-store.mjs';
import {createToolServer} from '../src/server.mjs';
import {sessionAddress} from '../src/harness-registry.mjs';
const profile={label:'Test',source:'fixture',observed_at:new Date().toISOString(),fresh_for_s:600,models:[],usage:[],wake:{type:'manual',lifetime:'test',closed_app:'unknown',human_fallback:'check'}};
test('one harness MCP configuration serves separate sessions; revocation applies to an already connected client',async t=>{
 const store=new SharedStore(':memory:',{recipients:['bootstrap']});t.after(()=>store.close());
 store.workers=new WorkerManager(store,{reader:{enabled:true,type:'codex-worker',allow_harnesses:['alpha'],persist:false,timeout_ms:1000}},{preflight:()=>({status:'ready'}),run:async()=>({status:'completed',exited:true,output:'reviewed'})});t.after(()=>store.workers.stop());
 const r=store.harnesses;r.discoverNative=async c=>[{native_id:c.cwd.slice(1)+'-1',label:'Example',cwd:'/test',state:'idle'},{native_id:c.cwd.slice(1)+'-2',label:'Other',cwd:'/test',state:'idle'}];
 const clients=[];
 for(const id of ['alpha','beta']){
  const secret=id[0].repeat(43);r.register({id:'admin',permissions:['registry']},{harness:id,credential:secret,discovery:{type:'codex',executable:'/native/codex',cwd:'/'+id},profile});
  const server=createToolServer(store,store.directory,r.authenticate(secret),undefined,()=>r.authenticate(secret));
  const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);clients.push(client);
  t.after(async()=>{await client.close();await server.close();});
 }
 const [a,b]=clients,call=async(c,name,args={})=>{const result=await c.callTool({name,arguments:args});assert.equal(result.isError,undefined,JSON.stringify(result));return result.structuredContent;};
 const names=(await a.listTools()).tools.map(x=>x.name);assert.ok(names.includes('harness.discover'));assert.ok(names.includes('session.request'));assert.ok(!names.includes('harness.register'));assert.ok(!names.includes('mail.claim'));
 assert.equal((await call(a,'harness.discover')).harnesses.length,2);
 const health=await call(a,'harness.health');assert.equal(health.version,a.getServerVersion().version);assert.equal(health.schema_version,6);assert.equal(health.instance_id,store.instanceId);
 const job=await call(a,'session.worker_start',{session_id:'alpha-1',adapter:'reader',prompt:'read only',idempotency_key:'work'});
 await call(a,'session.worker_wait',{session_id:'alpha-1',id:job.id,timeout_ms:1000});
 const deniedWorker=await b.callTool({name:'session.worker_start',arguments:{session_id:'beta-1',adapter:'reader',prompt:'no grant',idempotency_key:'denied'}});assert.equal(deniedWorker.isError,true);
 assert.equal((await call(a,'session.worker_ack',{session_id:'alpha-1',id:job.id})).acknowledged,true);
 const req=await call(a,'session.request',{session_id:'alpha-1',recipient:sessionAddress('beta','beta-2'),body:'question',idempotency_key:'ask'});
 const got=(await call(b,'session.claim',{session_id:'beta-2'})).messages[0];assert.equal(got.id,req.id);
 await call(b,'session.reply',{session_id:'beta-2',id:got.id,claim_token:got.claim_token,generation:got.generation,body:'answer',idempotency_key:'answer'});
 assert.equal((await call(a,'session.claim',{session_id:'alpha-2'})).messages.length,0);
 assert.equal((await call(a,'session.claim',{session_id:'alpha-1'})).messages[0].in_reply_to,req.id);
 // Real SDK tool response carries the answer; the reply cannot reserve a native wake.
 for(const name of ['session.exchange','session.wait','session.listen','session.unattend'])assert.ok(names.includes(name));
 const source=sessionAddress('alpha','alpha-1'),target=sessionAddress('beta','beta-2');
 store.notifications={dispatch:async recipient=>{
   if(recipient===source){assert.ok(store.attendance(source));return {status:'receiver_attending'};}
   assert.equal(recipient,target);assert.ok(store.attendance(source));
   const message=(await call(b,'session.claim',{session_id:'beta-2'})).messages[0];
   await call(b,'session.reply',{session_id:'beta-2',id:message.id,claim_token:message.claim_token,generation:message.generation,body:'tool answer',idempotency_key:'quiet-answer'});
   return {status:'queued'};
 }};
 const quiet=await call(a,'session.exchange',{session_id:'alpha-1',recipient:target,body:'quiet question',idempotency_key:'quiet',timeout_ms:0});
 assert.equal(quiet.status,'messages');assert.equal(quiet.messages[0].body,'tool answer');assert.equal(quiet.messages[0].in_reply_to,quiet.request_id);
 assert.equal(store.attendance(source),undefined);
 await call(a,'session.complete',{session_id:'alpha-1',...Object.fromEntries(['id','generation','claim_token'].map(k=>[k,quiet.messages[0][k]])),outcome:'read'});
 assert.equal((await call(a,'session.wait',{session_id:'alpha-1',timeout_ms:0})).status,'timeout');
 assert.equal(store.attendance(source),undefined);
 const foreign=await a.callTool({name:'session.wait',arguments:{session_id:'beta-2',timeout_ms:0}});assert.equal(foreign.isError,true);
 store.notifications=undefined;
 assert.equal((await call(b,'harness.unregister')).sessions_revoked,2);
 const denied=await b.callTool({name:'harness.discover',arguments:{}});assert.equal(denied.isError,true);assert.match(denied.content[0].text,/REVOKED/);
 assert.equal((await call(a,'harness.discover')).harnesses.length,1);
});
