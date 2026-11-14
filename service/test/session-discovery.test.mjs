import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {discoverSessions,normalizeSessions,validateDiscovery} from '../src/session-discovery.mjs';
const config={type:'codex',executable:'/native/codex',cwd:'/synthetic',timeout_ms:500};
function processFixture(respond,{code=0}={}){
 const process=new EventEmitter();process.stdout=new EventEmitter();process.stderr=new EventEmitter();process.stdin=new EventEmitter();let closed=false;
 const close=()=>{if(!closed){closed=true;queueMicrotask(()=>process.emit('close',code));}};
 process.kill=close;process.stdin.end=close;
 const calls=[];process.stdin.write=data=>{const req=JSON.parse(data);calls.push(req);queueMicrotask(()=>{const m=respond(req);if(m)process.stdout.emit('data',Buffer.from(JSON.stringify(m)+'\n'));});};
 return {process,calls};
}
test('Codex inventories every page through read-only methods and drops previews',async()=>{
 const {process,calls}=processFixture(req=>req.id===1?{id:1,result:{}}:req.id===2?{id:2,result:{data:[{id:'one',name:'First',preview:'private message',status:{type:'notLoaded'}}],nextCursor:'page2'}}:req.id===3?{id:3,result:{data:[{id:'two',name:'Second'}],nextCursor:null}}:null);
 const result=await discoverSessions(config,{spawnProcess:(exe,args,options)=>{assert.equal(exe,config.executable);assert.deepEqual(args,['app-server','--stdio']);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);return process;}});
 assert.deepEqual(result.map(s=>s.native_id),['one','two']);assert.equal(JSON.stringify(result).includes('private message'),false);
 assert.deepEqual(calls.map(c=>c.method),['initialize','initialized','thread/list','thread/list']);assert.equal(calls[2].params.useStateDbOnly,true);assert.equal(calls[2].params.archived,false);
});
test('Claude uses only agents --json and validates unique session IDs',async()=>{
 const {process}=processFixture(()=>null);process.stdin.end=()=>queueMicrotask(()=>{process.stdout.emit('data',Buffer.from(JSON.stringify([{sessionId:'one',name:'Example',status:'idle'}])));process.emit('close',0);});
 const result=await discoverSessions({...config,type:'claude'},{spawnProcess:(_exe,args)=>{assert.deepEqual(args,['agents','--json']);return process;}});assert.equal(result[0].native_id,'one');
 for(const rows of [[{id:'a'},{id:'a'}],[{id:'a',archived:true}],[{}]])assert.throws(()=>normalizeSessions('codex',rows),/INVALID_SESSION_ID|ARCHIVED_SESSION/);
});
test('bad pagination, RPC errors, unsupported adapters and timeouts fail without fallback',async()=>{
 for(const reply of [{error:{code:401}},{result:{data:[],nextCursor:undefined}}]){
  const {process}=processFixture(req=>req.id===1?{id:1,result:{}}:req.id?{id:req.id,...reply}:null);
  await assert.rejects(discoverSessions(config,{spawnProcess:()=>process}),/DISCOVERY_RPC_FAILED|DISCOVERY_INVALID_CURSOR/);
 }
 const {process}=processFixture(()=>null);await assert.rejects(discoverSessions({...config,timeout_ms:100},{spawnProcess:()=>process}),/DISCOVERY_TIMEOUT/);
 for(const bad of [{type:'copilot'},{executable:'relative'},{executable:'/native/unsafe.cmd'},{timeout_ms:999999}])assert.throws(()=>validateDiscovery({...config,...bad}),/DISCOVERY/);
});
