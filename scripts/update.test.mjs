import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {update} from './update.mjs';
import {hash,unpack,compareVersions} from './release-package.mjs';
import {codexConfig,claudeConfig,reloadCodex} from './update-connections.mjs';
import {parseInvocation} from './usage.mjs';
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v));};
function zip(entries){
 const locals=[],centers=[];let offset=0;
 for(const [name,body] of entries){const n=Buffer.from(name),b=Buffer.from(body),l=Buffer.alloc(30),c=Buffer.alloc(46);
  l.writeUInt32LE(0x04034b50);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);
  c.writeUInt32LE(0x02014b50);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  locals.push(l,n,b);centers.push(c,n);offset+=30+n.length+b.length;
 }
 const end=Buffer.alloc(22),central=Buffer.concat(centers);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,central,end]);
}
function pkg(version){
 const files=new Map([['scripts/ihcp.mjs','// '+version],['service/dist/stdio.mjs','server '+version],['service/dist/client.mjs','client '+version],['adapters/claude-waiter/dist/claude-waiter.mjs','waiter '+version],['skills/harness-interop/SKILL.md','skill '+version]]);
 files.set('BUILD.json',JSON.stringify({release_version:version,runtime_version:version,schema_version:6,writer_version:6,source_commit:'a'.repeat(40),bundles:Object.fromEntries([...files].filter(([p])=>p.includes('/dist/')).map(([p,b])=>[p,hash(b)]))}));
 return {files,bytes:zip(new Map([...files].map(([p,b])=>['IHCP3K-'+version+'/'+p,b])))};
}
function fixture(t){
 const base=fs.mkdtempSync(path.join(tmpdir(),'ihcp-update-')),root=path.join(base,'installation'),data=path.join(root,'data'),home=path.join(base,'home'),dir=path.join(data,'harnesses','codex');
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const old=pkg('1.2.3'),next=pkg('1.2.4');
 for(const [p,b] of old.files)write(path.join(root,'app',p),b);
 const r={version:'1.2.3',transport:'stdio',schema_version:6,service_id:'test',private_dir:data,database:path.join(data,'mail.db'),bundle:path.join(data,'bundles','stdio.mjs'),client_bundle:path.join(data,'bundles','client.mjs'),service_config:path.join(data,'service.json')};
 write(r.bundle,old.files.get('service/dist/stdio.mjs'));write(r.client_bundle,old.files.get('service/dist/client.mjs'));write(r.service_config,{});
 r.bundle_sha256=hash(fs.readFileSync(r.bundle));r.client_sha256=hash(fs.readFileSync(r.client_bundle));write(path.join(data,'runtime.json'),r);
 write(path.join(dir,'harness.json'),{linked:true,harness:'codex',runtime_file:path.join(data,'runtime.json')});write(path.join(dir,'registration.json'),{discovery:{type:'codex',executable:'/native/codex'}});
 write(path.join(dir,'harness.tok'),'private-fixture-token');
 const config=path.join(home,'.codex','config.toml'),args=[r.bundle,path.join(data,'runtime.json'),path.join(dir,'harness.tok')];
 write(config,'# keep comments\napproval_policy = "never"\n[mcp_servers.ihcp3k]\ncommand = "node"\nargs = '+JSON.stringify(args)+'\n[mcp_servers.other]\ncommand="other"\n');
 const skill=path.join(home,'.agents','skills','harness-interop','SKILL.md');write(skill,'skill 1.2.3');
 const db=new DatabaseSync(r.database);db.exec("pragma user_version=6;create table metadata(key text,value text);insert into metadata values('writer_version','6'),('service_id','test');create table workers(state text);create table preserved(value text);insert into preserved values('keep');");db.close();
 const urls=new Map();for(const [v,p] of [['1.2.3',old],['1.2.4',next]]){
  const url='https://github.com/GreyManSoftware/IHCP3K/releases/download/v'+v+'/IHCP3K-'+v+'.zip';
  urls.set(url,p.bytes);urls.set(url+'.sha256',hash(p.bytes)+'  IHCP3K-'+v+'.zip\n');
  urls.set('https://api.github.com/repos/GreyManSoftware/IHCP3K/releases/'+(v==='1.2.4'?'latest':'tags/v'+v),JSON.stringify({tag_name:'v'+v,draft:false,prerelease:false,assets:[{name:'IHCP3K-'+v+'.zip',browser_download_url:url,digest:'sha256:'+hash(p.bytes)},{name:'IHCP3K-'+v+'.zip.sha256',browser_download_url:url+'.sha256'}]}));
 }
 let reloads=0;const options={home,env:{},fetchImpl:async url=>new Response(urls.get(String(url)),{status:urls.has(String(url))?200:404}),verify:async()=>({version:'1.2.4',tools:4}),reload:async()=>{reloads++;return {status:'restart_approval_required'};}};
 return {base,root,data,dir,r,old,next,config,skill,urls,options,reloads:()=>reloads};
}
test('update check is read-only; apply preserves data, credentials, settings and connects without restarting apps',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.r.database),config=fs.readFileSync(f.config,'utf8');
 assert.deepEqual(parseInvocation(['update',f.dir,'--check']).check,true);
 assert.equal((await update(f.dir,{...f.options,check:true})).status,'update_available');assert.equal(fs.existsSync(path.join(f.data,'release-cache')),false);assert.equal(f.reloads(),0);
 const result=await update(f.dir,f.options);assert.equal(result.status,'updated');assert.equal(result.connections[0].status,'restart_approval_required');assert.equal(result.restart_policy,'ask');
 assert.deepEqual(fs.readFileSync(f.r.database),before);assert.equal(fs.readFileSync(path.join(f.dir,'harness.tok'),'utf8'),'private-fixture-token');
 assert.ok(fs.readFileSync(f.config,'utf8').includes('approval_policy = "never"'));assert.ok(fs.readFileSync(f.config,'utf8').includes('mcp_servers.other'));assert.match(fs.readFileSync(f.config,'utf8'),/--ihcp-release=1.2.4/);
 assert.equal(fs.readFileSync(f.skill,'utf8'),'skill 1.2.4');
 write(f.config,fs.readFileSync(f.config,'utf8').replace(',"--ihcp-release=1.2.4"',''));
 assert.equal((await update(f.dir,f.options)).status,'up_to_date');assert.equal(f.reloads(),2);
 assert.match(fs.readFileSync(f.config,'utf8'),/--ihcp-release=1.2.4/);
 assert.notEqual(fs.readFileSync(f.config,'utf8'),config);
});
test('failed update rolls back app, runtime, skills and connections',async t=>{
 for(const where of ['staged','activated','health'])await t.test(where,async t=>{
  const f=fixture(t),original=fs.readFileSync(f.config,'utf8');
  await assert.rejects(update(f.dir,{...f.options,checkpoint:p=>{if(p===where)throw Error('injected');},verify:async()=>{if(where==='health')throw Error('injected');return {};}}),/injected/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data,'runtime.json'))).version,'1.2.3');assert.equal(fs.readFileSync(f.skill,'utf8'),'skill 1.2.3');assert.equal(fs.readFileSync(f.config,'utf8'),original);
  assert.equal(fs.readFileSync(path.join(f.root,'app/scripts/ihcp.mjs'),'utf8'),'// 1.2.3');assert.equal(fs.existsSync(path.join(f.data,'update.lock')),false);
  assert.equal((await update(f.dir,f.options)).status,'updated');
 });
});
test('a dead updater is recovered before validating partially activated files',async t=>{
 const f=fixture(t);await update(f.dir,f.options);
 const journal=path.join(f.data,'update-state.json'),state=JSON.parse(fs.readFileSync(journal));
 write(journal,{...state,phase:'applying'});write(path.join(f.data,'update.lock'),{pid:2147483647});
 const result=await update(f.dir,f.options);assert.equal(result.previous,'1.2.3');assert.equal(result.installed,'1.2.4');
 assert.equal(fs.readFileSync(f.skill,'utf8'),'skill 1.2.4');
});
test('bad checksum, local modifications, concurrent updates and active workers leave installation intact',async t=>{
 for(const kind of ['checksum','app','skill','lock','worker'])await t.test(kind,async t=>{
  const f=fixture(t);
  if(kind==='checksum'){const url=[...f.urls.keys()].find(x=>x.includes('1.2.4.zip')&&!x.endsWith('sha256'));f.urls.set(url,'corrupt');}
  if(kind==='app')write(path.join(f.root,'app/scripts/ihcp.mjs'),'local edit');
  if(kind==='skill')write(f.skill,'local edit');
  if(kind==='lock')write(path.join(f.data,'update.lock'),{pid:process.pid});
  if(kind==='worker'){const db=new DatabaseSync(f.r.database);db.exec("insert into workers values('running')");db.close();}
  await assert.rejects(update(f.dir,f.options),/CHECKSUM|MODIFIED|IN_PROGRESS|ACTIVE_WORKERS/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data,'runtime.json'))).version,'1.2.3');assert.equal(f.reloads(),0);
 });
});
test('release paths and version comparison reject traversal, duplicate names and prereleases',()=>{
 assert.equal(compareVersions('1.10.0','1.9.9'),1);assert.throws(()=>compareVersions('1.2.0-rc1','1.2.0'));
 const p=pkg('1.2.4');assert.equal(unpack(p.bytes,'1.2.4').build.schema_version,6);
 for(const bad of ['../escape','C:/escape','a\\escape','DATA/../escape','a/.. /escape','NUL.txt'])assert.throws(()=>unpack(zip(new Map([['IHCP3K-1.2.4/'+bad,'bad']])),'1.2.4'));
 assert.throws(()=>unpack(zip(new Map([['IHCP3K-1.2.4/A','a'],['IHCP3K-1.2.4/a','b']])),'1.2.4'),/UNSAFE_RELEASE_PATH/);
});
test('connection edits preserve permissions and other servers; unsupported paths fail closed',()=>{
 const data=path.resolve('/test/data'),runtime={private_dir:data,bundle:path.join(data,'bundles','stdio.mjs')},args=[runtime.bundle,path.join(data,'runtime.json'),path.join(data,'harnesses','codex','harness.tok')];
 const text='[mcp_servers.ihcp3k]\nargs = [\n'+args.map(a=>"'"+a+"'").join(',\n')+', # comment\n]\n# preserve\n';
 assert.match(codexConfig(text,runtime,'1.2.4'),/--ihcp-release=1.2.4/);assert.ok(codexConfig(text,runtime,'1.2.4').endsWith('# preserve\n'));
 const config={permission:'ask',mcpServers:{ihcp3k:{args,env:{KEEP:'value'}},other:{command:'other'}}};const result=JSON.parse(claudeConfig(JSON.stringify(config),runtime,'1.2.4'));assert.deepEqual(result.mcpServers.other,config.mcpServers.other);assert.equal(result.permission,'ask');assert.deepEqual(result.mcpServers.ihcp3k.env,{KEEP:'value'});
 assert.throws(()=>codexConfig('[mcp_servers.ihcp3k]\nargs=["wrong","wrong","wrong"]',runtime,'1.2.4'),/NOT_OWNED/);
});
test('native reload requests are bounded and failures request approval, never restart an app',async()=>{
 for(const success of [true,false]){
  const sent=[];const result=await reloadCodex('/native/codex',{timeout_ms:100,spawnProcess:(_exe,args,opts)=>{
   assert.deepEqual(args,['app-server','proxy']);assert.equal(opts.windowsHide,true);const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin=new EventEmitter();p.stdin.end=()=>{};p.kill=()=>{};
   p.stdin.write=line=>{const m=JSON.parse(line);sent.push(m.method);if(m.id)queueMicrotask(()=>p.stdout.emit('data',JSON.stringify(success?{id:m.id,result:{}}:{id:m.id,error:{message:'unavailable'}})+'\n'));};return p;
  }});assert.equal(result.status,success?'reload_requested':'restart_approval_required');assert.ok(!sent.some(x=>/turn|restart/.test(x)));
 }
});
