import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/store.mjs';
import { createService } from '../src/server.mjs';
import { exchange } from '../src/client.mjs';
const config=JSON.parse(readFileSync(new URL('../fixture/config.json',import.meta.url)));
test('official SDK clients authenticate, wait, send, claim and complete with concurrent dedup',async t=>{
  const store=new Store(':memory:',{recipients:config.recipients});
  const server=createService(store,{principals:config.principals});
  const address=await server.listen();const url=`http://127.0.0.1:${address.port}/mcp`;
  const clients=[];
  t.after(async()=>{for(const c of clients)await c.close();await server.close();store.close();});
  async function connect(id){const p=config.principals.find(p=>p.id===id);const c=new Client({name:id,version:'0.1.0'});await c.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${p.token}`}}}));clients.push(c);return c;}
  const sender=await connect('test-sender'),waiter=await connect('test-waiter'),pa=await connect('test-claude-pa'),other=await connect('test-codex-pa');
  const toolNames=(await sender.listTools()).tools.map(x=>x.name);assert.deepEqual(toolNames,['mail.send']);
  const wait=waiter.callTool({name:'wake.wait',arguments:{recipient:'test-claude',timeout_ms:1000}});
  const args={recipient:'test-claude',body:'synthetic integration message',idempotency_key:'same'};
  const sends=await Promise.all(Array.from({length:4},()=>sender.callTool({name:'mail.send',arguments:args})));
  assert.equal(new Set(sends.map(x=>x.structuredContent.id)).size,1);
  assert.equal((await wait).structuredContent.status,'pending');
  const forbidden=await other.callTool({name:'mail.claim',arguments:{recipient:'test-claude',handler_id:'wrong'}});assert.equal(forbidden.isError,true);
  const claims=await Promise.all([pa.callTool({name:'mail.claim',arguments:{recipient:'test-claude',handler_id:'one'}}),pa.callTool({name:'mail.claim',arguments:{recipient:'test-claude',handler_id:'two'}})]);
  const messages=claims.flatMap(x=>x.structuredContent.messages);assert.equal(messages.length,1);
  const {id,claim_token,generation}=messages[0];
  const done=await pa.callTool({name:'mail.complete',arguments:{id,claim_token,generation,outcome:'handled'}});
  assert.equal(done.structuredContent.state,'completed');
  // The bounded SDK exchange registers the reader before sending. Process an
  // actual peer reply while the request waits, without a native wake reservation.
  const request=exchange(pa,{inbox:'test-claude',handler_id:'requester',recipient:'test-codex',body:'question',idempotency_key:'exchange'});
  // Wait deterministically for the service to publish the outbound request.
  if(!store.pending('test-codex'))await new Promise(resolve=>{const changed=r=>{if(r==='test-codex'){store.off('changed',changed);resolve();}};store.on('changed',changed);});
  const peerClaims=await other.callTool({name:'mail.claim',arguments:{recipient:'test-codex',handler_id:'peer'}});
  const peerMessage=peerClaims.structuredContent.messages[0];
  await other.callTool({name:'mail.complete',arguments:{id:peerMessage.id,claim_token:peerMessage.claim_token,generation:peerMessage.generation,outcome:'answered'}});
  await other.callTool({name:'mail.send',arguments:{recipient:'test-claude',body:'reply',idempotency_key:'exchange-reply'}});
  const answer=await request;assert.equal(answer.status,'messages');assert.equal(answer.messages[0].body,'reply');
  assert.equal(store.status(config.principals.find(p=>p.id==='test-claude-pa'),{recipient:'test-claude'}).attendance,null);
  const {id:replyId,claim_token:replyToken,generation:replyGeneration}=answer.messages[0];
  await pa.callTool({name:'mail.complete',arguments:{id:replyId,claim_token:replyToken,generation:replyGeneration,outcome:'received'}});
  await assert.rejects(exchange(pa,{inbox:'test-claude',handler_id:'requester',recipient:'test-claude',body:'not allowed',idempotency_key:'forbidden-exchange'}),/FORBIDDEN/);
  assert.equal(store.status(config.principals.find(p=>p.id==='test-claude-pa'),{recipient:'test-claude'}).attendance,null);
  const escaped=await sender.callTool({name:'mail.send',arguments:{...args,idempotency_key:'escaped-limit',body:'\u0001'.repeat(65536)}});
  assert.equal(escaped.structuredContent.state,'pending');
  const tooLarge=await sender.callTool({name:'mail.send',arguments:{...args,idempotency_key:'byte-limit',body:'😀'.repeat(20000)}});
  assert.equal(tooLarge.isError,true);
  const missingAuth=await fetch(url,{method:'POST'});assert.equal(missingAuth.status,401);
  const hostileOrigin=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${config.principals[0].token}`,Origin:'https://evil.invalid'}});assert.equal(hostileOrigin.status,403);
  const badBody=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${config.principals[0].token}`,'Content-Type':'application/json'},body:'{'});assert.equal(badBody.status,400);
});


test('MCP registration returns no session secrets and native SDK discovery enforces scopes',async t=>{
 const {randomBytes}=await import('node:crypto');const token=()=>randomBytes(32).toString('base64url');
 const admin={id:'operator',token:token(),permissions:['registry'],scopes:{registry:['bootstrap']}};
 const store=new Store(':memory:',{recipients:['bootstrap']});const server=createService(store,{principals:[admin]});
 const address=await server.listen(),url=new URL(`http://127.0.0.1:${address.port}/mcp`),clients=[];
 t.after(async()=>{for(const c of clients)await c.close();await server.close();store.close();});
 async function client(secret){const c=new Client({name:'synthetic',version:'1'});await c.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${secret}`}}}));clients.push(c);return c;}
 const {call}=await import('../src/client.mjs');const op=await client(admin.token);
 const grant=await call(op,'directory.enroll',{endpoint:'test-a',harness:'test-harness',peers:['test-a']});
 const enrol=await client(grant.enrolment_token),sessionToken=token(),wakeToken=token();
 const profile={label:'Test',source:'synthetic',observed_at:new Date().toISOString(),fresh_for_s:300,models:[],usage:[],wake:{type:'manual',lifetime:'manual only',closed_app:'unknown',human_fallback:'manual check'}};
 const registered=await call(enrol,'directory.register',{profile,session_token:sessionToken,wake_token:wakeToken});
 assert.equal(registered.endpoint,'test-a');assert.ok(!JSON.stringify(registered).includes(sessionToken));
 const session=await client(sessionToken);assert.equal((await call(session,'directory.discover',{})).entries[0].profile.label,'Test');
 assert.ok(!(await session.listTools()).tools.some(t=>t.name==='directory.enroll'));
 await call(session,'mail.send',{recipient:'test-a',body:'proof',idempotency_key:'proof'});
 await call(session,'directory.deregister',{endpoint:'test-a',expected_revision:1});
 await assert.rejects(call(session,'directory.discover',{}));
});
