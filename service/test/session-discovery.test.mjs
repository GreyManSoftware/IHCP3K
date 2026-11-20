import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {resolveExecutable} from '../src/trusted-executable.mjs';
import {observeNativeProfile} from '../src/native-profile.mjs';
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


test('operator-pinned Windows package survives versioned paths without PATH fallback',()=>{
 const cfg={...config,executable_resolution:{type:'windows-package',package_family:'Vendor.Codex_publisher',relative_path:'app/resources/codex.exe'}};
 const packages=[{PackageFamilyName:'Vendor.Codex_publisher',InstallLocation:'C:\\Packages\\Codex_2'}];
 assert.equal(resolveExecutable(cfg,{platform:'win32',queryPackages:()=>packages,exists:()=>true}),'C:\\Packages\\Codex_2\\app\\resources\\codex.exe');
 for(const rows of [[],[...packages,...packages],[{...packages[0],PackageFamilyName:'Other_publisher'}]])assert.throws(()=>resolveExecutable(cfg,{platform:'win32',queryPackages:()=>rows,exists:()=>true}),/NOT_UNIQUE/);
 assert.throws(()=>resolveExecutable(cfg,{platform:'win32',queryPackages:()=>packages,exists:()=>false}),/FILE_MISSING/);
 assert.throws(()=>resolveExecutable(cfg,{platform:'linux'}),/PLATFORM_UNSUPPORTED/);
 for(const relative_path of ['../codex.exe','/codex.exe','app/../../codex.exe','app/codex.cmd'])assert.throws(()=>validateDiscovery({...cfg,executable_resolution:{...cfg.executable_resolution,relative_path}}),/INVALID_PACKAGE_EXECUTABLE/);
 assert.equal(resolveExecutable(config),config.executable);
});

test('native profile uses only version and paginated catalogue, preserving separately dated usage',async()=>{
 const {process,calls}=processFixture(req=>req.id===1?{id:1,result:{}}:req.id===2?{id:2,result:{data:[{id:'model-a'}],nextCursor:'next'}}:req.id===3?{id:3,result:{data:[{id:'model-b'}],nextCursor:null}}:null);
 const previous={models:[],usage:[{observed_at:'2020-01-01T00:00:00Z'}]};
 const next=await observeNativeProfile(config,previous,{spawnProcess:()=>process,runVersion:()=>({status:0,stdout:'codex 2'}),now:()=> '2026-01-01T00:00:00Z'});
 assert.deepEqual(calls.map(c=>c.method),['initialize','initialized','model/list','model/list']);
 assert.deepEqual(next.models.map(m=>m.id),['model-a','model-b']);assert.equal(next.native_version,'codex 2');assert.deepEqual(next.usage,previous.usage);
 await assert.rejects(observeNativeProfile(config,previous,{runVersion:()=>({status:1})}),/NATIVE_VERSION_UNAVAILABLE/);
 const {process:broken}=processFixture(req=>req.id?{id:req.id,error:{code:1}}:null);
 await assert.rejects(observeNativeProfile(config,previous,{spawnProcess:()=>broken,runVersion:()=>({status:0,stdout:'codex 3'})}),/NATIVE_PROFILE_RPC_FAILED/);
 const claude=await observeNativeProfile({...config,type:'claude'},{models:[{id:'old',access:'available'}],usage:[]},{runVersion:()=>({status:0,stdout:'claude 2'})});assert.equal(claude.models[0].access,'unknown');
});
