import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../service/src/store.mjs';
import {Directory} from '../service/src/directory.mjs';
import {snapshot} from '../service/src/backup.mjs';
import {randomBytes} from 'node:crypto';
import {install} from './install-local.mjs';
import {main as cli,runWorker} from './ihcp.mjs';
import {connect,call,requireNode} from '../service/dist/client.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(tmpdir(),'ihcp-local-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function editDatabase(file,fn) {
  const db=new DatabaseSync(file);
  try {db.function('ihcp_writer_version',()=>6);fn(db);}finally{db.close();}
}

test('offline v4 import uses a new identity, revokes credentials and pauses unresolved work',async t=>{
 const base=fixture(t),file=path.join(base,'old.db'),backup=path.join(base,'offline.db');
 const store=new Store(file,{recipients:['bootstrap']}),directory=new Directory(store);
 const grant=directory.issue({id:'admin',permissions:['registry']},{endpoint:'old-peer',harness:'test',peers:['old-peer']});
 const token=randomBytes(32).toString('base64url');
 directory.register(directory.authenticate(grant.enrolment_token),{profile:{label:'old',source:'synthetic',observed_at:new Date().toISOString(),fresh_for_s:600,models:[],usage:[],wake:{type:'manual',lifetime:'manual',closed_app:'unknown',human_fallback:'manual'}},session_token:token,wake_token:randomBytes(32).toString('base64url')});
 store.send(directory.authenticate(token),{recipient:'old-peer',body:'unfinished',idempotency_key:'old-work'});
 const saved=await snapshot(file,backup);store.close();
 const target=path.join(base,'imported'),installed=await install(target,{backupFile:backup,sha256:saved.sha256,workingDirectory:base});
 const runtime=read(installed.runtime),db=new DatabaseSync(runtime.database,{readOnly:true});
 try{
   assert.equal(db.prepare("SELECT value FROM metadata WHERE key='service_id'").get().value,runtime.service_id);
   assert.equal(db.prepare("SELECT state FROM messages").get().state,'reconcile');
   assert.equal(db.prepare("SELECT active FROM endpoints").get().active,0);
   assert.equal(db.prepare("SELECT count(*) n FROM credentials WHERE revoked=0").get().n,0);
   assert.ok(db.prepare("SELECT 1 FROM pauses WHERE recipient='old-peer'").get());
 }finally{db.close();}
 const original=new DatabaseSync(backup,{readOnly:true});try{assert.equal(original.prepare('PRAGMA user_version').get().user_version,4);assert.equal(original.prepare('SELECT state FROM messages').get().state,'pending');}finally{original.close();}
 await assert.rejects(install(target,{backupFile:backup,sha256:saved.sha256}),/MIGRATION_REQUIRES_NEW_DIRECTORY/);
 assert.equal((await install(target,{workingDirectory:base})).status,'reused');
 await assert.rejects(install(target),/WORKING_DIRECTORY_MISMATCH/);
});

test('worker holds one client through bounded waits and never acknowledges results',async()=>{
  for(const completed of [true,false]) {
    let at=0,waits=0;const calls=[];
    const result=await runWorker({}, {adapter:'test',prompt:'explicit',idempotency_key:'worker-key',timeout_ms:30000},{stdio:true,now:()=>at,invoke:async(client,name,args)=>{
      calls.push({name,args});
      if(name==='worker.wait'){at+=args.timeout_ms;waits++;}
      return {id:'owned-job',state:completed&&waits===2?'completed':'running',result:completed&&waits===2?{output:'persist me'}:null};
    }});
    assert.deepEqual(calls.map(x=>x.name),['worker.start','worker.status','worker.wait','worker.wait']);
    assert.equal(calls[0].args.timeout_ms,undefined);
    assert.deepEqual(calls.slice(2).map(x=>x.args.timeout_ms),[25000,5000]);
    if(completed){assert.equal(result.state,'completed');assert.equal(result.result.output,'persist me');}
    else{assert.equal(result.wait_timed_out,true);assert.equal(result.connection_closing,true);}
  }
  await assert.rejects(runWorker({}, {timeout_ms:0}),/INVALID_WORKER_WAIT_TIMEOUT/);
});

test('local prerequisites and occupied destinations fail without installing',async t=>{
  const dir=fixture(t),occupied=path.join(dir,'occupied');fs.mkdirSync(occupied);
  for(const version of ['22.22.0','24.14.9'])assert.throws(()=>requireNode(version),/NODE_24_15_REQUIRED/);
  for(const version of ['24.15.0','24.16.0','25.0.0'])assert.doesNotThrow(()=>requireNode(version));
  await assert.rejects(install(),/EXPLICIT_PRIVATE_DIRECTORY_REQUIRED/);
  await assert.rejects(install('relative'),/EXPLICIT_PRIVATE_DIRECTORY_REQUIRED/);
  await assert.rejects(install(occupied),/INCOMPLETE_INSTALL_REQUIRES_REVIEW/);
  assert.deepEqual(fs.readdirSync(occupied),[]);
  assert.equal(fs.existsSync(occupied+'.install.lock'),false);
  const locked=path.join(dir,'locked');fs.writeFileSync(locked+'.install.lock','another installer');
  await assert.rejects(install(locked),{code:'EEXIST'});
  assert.equal(fs.existsSync(locked),false);
  assert.equal(fs.readFileSync(locked+'.install.lock','utf8'),'another installer');
});

test('bundled local install, strict reuse and explicit stdio CLI workflow',async t=>{
  const base=fixture(t),dir=path.join(base,'private runtime');
  const installed=await install(dir),runtimeFile=installed.runtime,runtime=read(runtimeFile);
  const tokenFile=path.join(dir,'tokens','admin.tok'),originalToken=fs.readFileSync(tokenFile,'utf8');
  assert.equal(installed.status,'installed');assert.equal(installed.transport,'stdio');
  assert.equal(runtime.initialized,true);
  assert.deepEqual(runtime.notifications,{});assert.deepEqual(runtime.workers,{});
  assert.equal(runtime.service_id,read(runtime.service_config).service_id);
  assert.equal(JSON.stringify(installed).includes(originalToken.trim()),false);
  const originalRuntime=fs.readFileSync(runtimeFile,'utf8');
  assert.equal((await install(dir)).status,'reused');
  assert.equal(fs.readFileSync(runtimeFile,'utf8'),originalRuntime);
  assert.equal(fs.readFileSync(tokenFile,'utf8'),originalToken);

  await t.test('rejects manifest, config, credential, bundle and schema mismatches before reuse',async()=>{
    const cases=[
      [runtimeFile,v=>({...v,service_id:'00000000-0000-4000-8000-000000000001'}),/SERVICE_IDENTITY_MISMATCH/],
      [runtimeFile,v=>({...v,schema_version:4}),/INVALID_STDIO_RUNTIME/],
      [runtimeFile,v=>({...v,initialized:false}),/INCOMPLETE_INSTALL_REQUIRES_REVIEW/],
      [runtimeFile,v=>({...v,database:path.join(base,'foreign.db')}),/RUNTIME_PATH_MISMATCH/],
      [runtime.service_config,v=>({...v,service_id:'00000000-0000-4000-8000-000000000002'}),/SERVICE_IDENTITY_MISMATCH/]
    ];
    for(const [file,change,error] of cases){
      const before=fs.readFileSync(file);try{write(file,change(read(file)));await assert.rejects(install(dir),error);}finally{fs.writeFileSync(file,before);}
    }
    try{fs.writeFileSync(tokenFile,'x'.repeat(43));await assert.rejects(install(dir),/ADMIN_IDENTITY_MISMATCH/);}finally{fs.writeFileSync(tokenFile,originalToken);}
    for(const file of [runtime.bundle,runtime.client_bundle]){
      const before=fs.readFileSync(file);try{fs.appendFileSync(file,'\n// changed');await assert.rejects(install(dir),/RUNTIME_BUNDLE_MISMATCH/);}finally{fs.writeFileSync(file,before);}
    }
    const missing=runtime.database+'.saved';fs.renameSync(runtime.database,missing);
    try {
      await assert.rejects(install(dir),/RUNTIME_DATABASE_MISSING/);
      await assert.rejects(connect({runtimeFile,tokenFile}),/RUNTIME_DATABASE_MISSING/);
      assert.equal(fs.existsSync(runtime.database),false);
    }finally{fs.renameSync(missing,runtime.database);}
    editDatabase(runtime.database,db=>db.exec('PRAGMA user_version=4'));
    const oldDatabase=fs.readFileSync(runtime.database);
    try {
      await assert.rejects(install(dir),/RUNTIME_SCHEMA_MISMATCH/);
      await assert.rejects(connect({runtimeFile,tokenFile}),/RUNTIME_SCHEMA_MISMATCH/);
      assert.deepEqual(fs.readFileSync(runtime.database),oldDatabase);
    }finally{editDatabase(runtime.database,db=>db.exec('PRAGMA user_version=6'));}
    editDatabase(runtime.database,db=>db.prepare("UPDATE metadata SET value='wrong-instance' WHERE key='service_id'").run());
    try{await assert.rejects(install(dir),/SERVICE_IDENTITY_MISMATCH/);}finally{editDatabase(runtime.database,db=>db.prepare("UPDATE metadata SET value=? WHERE key='service_id'").run(runtime.service_id));}
    editDatabase(runtime.database,db=>db.prepare("UPDATE metadata SET value='7' WHERE key='writer_version'").run());
    try{await assert.rejects(install(dir),/RUNTIME_WRITER_MISMATCH/);}finally{editDatabase(runtime.database,db=>{db.function('ihcp_writer_version',()=>7);db.prepare("UPDATE metadata SET value='6' WHERE key='writer_version'").run();});}
    if(process.platform!=='win32'){
      fs.chmodSync(tokenFile,0o644);
      try{await assert.rejects(install(dir),/PRIVATE_PERMISSIONS_REQUIRED/);}finally{fs.chmodSync(tokenFile,0o600);}
      const original=runtime.bundle+'.saved';fs.renameSync(runtime.bundle,original);fs.symlinkSync(original,runtime.bundle);
      try{await assert.rejects(install(dir),/RUNTIME_LINK_NOT_ALLOWED/);}finally{fs.unlinkSync(runtime.bundle);fs.renameSync(original,runtime.bundle);}
    }
    assert.equal((await install(dir)).status,'reused');
  });

  await t.test('connect uses official SDK tools and rejects ambiguous/nonlocal transports',async()=>{
    const client=await connect({runtimeFile,tokenFile});
    try {
      assert.equal(client.getServerVersion().version,'1.1.1');
      assert.ok((await client.listTools()).tools.some(tool=>tool.name==='directory.enroll'));
      assert.equal((await call(client,'mail.status',{recipient:'bootstrap'})).recipient,'bootstrap');
    }finally{await client.close();}
    await assert.rejects(connect({url:'http://example.com/mcp',tokenFile}),/LOOPBACK_REQUIRED/);
    await assert.rejects(connect({url:'http://127.0.0.1/mcp',runtimeFile,tokenFile}),/ONE_TRANSPORT_REQUIRED/);
    const wrongToken=path.join(base,'bad.tok');fs.writeFileSync(wrongToken,'x'.repeat(43));
    await assert.rejects(connect({runtimeFile,tokenFile:wrongToken}),/MCP_CONNECT_FAILED/);
  });

  await t.test('register/unregister manages one reusable harness credential through the packaged MCP server',async()=>{
    const harnessDir=path.join(base,'harness'),input=path.join(base,'harness-config.json');
    write(input,{harness:'synthetic-harness',discovery:{type:'codex',executable:process.execPath,cwd:base},profile:{label:'Synthetic',source:'fixture',observed_at:new Date().toISOString(),fresh_for_s:600,models:[],usage:[],wake:{type:'manual',lifetime:'test',closed_app:'unknown',human_fallback:'check'}}});
    const first=await cli(['register',runtimeFile,input,harnessDir]);assert.equal(first.registered,true);
    const second=await cli(['register',runtimeFile,input,harnessDir]);assert.equal(second.reused,true);
    assert.equal(fs.existsSync(path.join(harnessDir,'session.tok')),false);assert.equal(fs.existsSync(path.join(harnessDir,'harness.tok')),true);
    assert.equal((await cli(['unregister',harnessDir])).registered,false);
    assert.equal((await cli(['unregister',harnessDir])).registered,false);
    await assert.rejects(cli(['discover',harnessDir]),/HARNESS_UNREGISTERED/);
    const revoked=fs.readFileSync(path.join(harnessDir,'harness.tok'),'utf8');
    assert.equal((await cli(['register',runtimeFile,input,harnessDir])).registered,true);
    assert.notEqual(fs.readFileSync(path.join(harnessDir,'harness.tok'),'utf8'),revoked);
    await cli(['unregister',harnessDir]);
  });

  await t.test('enroll/register/inspect/request/reply operate through the chosen runtime',async()=>{
    const json=(name,value)=>{const file=path.join(base,name+'.json');write(file,value);return file;};
    const sessions={};
    for(const endpoint of ['alice','bob']) {
      const code=path.join(base,endpoint+'.code'),session=path.join(base,endpoint);
      const grant=json(endpoint+'-grant',{endpoint,harness:'test',peers:['alice','bob']});
      const enrollment=await cli(['enroll',runtimeFile,grant,code]);assert.equal(enrollment.endpoint,endpoint);
      const profile=json(endpoint+'-profile',{profile:{label:endpoint,source:'synthetic test',observed_at:new Date().toISOString(),fresh_for_s:600,models:[],usage:[],wake:{type:'manual',lifetime:'test only',closed_app:'unknown',human_fallback:'check inbox'}}});
      assert.equal((await cli(['register-session',runtimeFile,code,profile,session])).revision,1);
      assert.equal((await cli(['register-session',runtimeFile,code,profile,session])).revision,1);
      assert.equal((await cli(['inspect',runtimeFile,json(endpoint+'-inspect',{endpoint})])).active,true);
      assert.equal(read(path.join(session,'session.json')).runtime_file,runtimeFile);
      sessions[endpoint]=session;
    }
    const request=json('request',{recipient:'bob',body:'explicit synthetic request',idempotency_key:'test-request'});
    const sent=await cli(['remote_prompt',sessions.alice,request]);
    for(const alias of ['prompt','chat','request']) assert.equal((await cli([alias,sessions.alice,request])).id,sent.id);
    const claim=(await cli(['check',sessions.bob])).messages[0];assert.equal(claim.id,sent.id);
    const reply=json('reply',{id:claim.id,claim_token:claim.claim_token,generation:claim.generation,body:'explicit synthetic reply',idempotency_key:'test-reply',outcome:'answered'});
    await cli(['reply',sessions.bob,reply]);
    assert.equal((await cli(['status',sessions.alice,json('request-status',{id:sent.id})])).state,'completed');
    const received=(await cli(['check',sessions.alice])).messages[0];assert.equal(received.body,'explicit synthetic reply');
    await cli(['complete',sessions.alice,json('complete',{id:received.id,claim_token:received.claim_token,generation:received.generation,outcome:'received'})]);
    assert.equal((await cli(['status',sessions.alice])).recipient,'alice');
    await assert.rejects(cli(['worker',sessions.alice,json('worker',{adapter:'not-configured',prompt:'explicit synthetic task',idempotency_key:'worker'})]),/WORKER_NOT_CONFIGURED/);
    assert.equal((await cli(['unregister',sessions.bob])).active,false);
    assert.equal((await cli(['unlink',sessions.bob])).linked,false);
    await assert.rejects(cli(['discover',sessions.bob]),/SESSION_UNLINKED/);
    assert.equal((await cli(['status',sessions.alice])).recipient,'alice');
  });
});
