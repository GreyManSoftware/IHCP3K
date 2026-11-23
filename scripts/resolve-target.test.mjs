import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveTarget,desktopBindings} from './resolve-target.mjs';
import {desktopSessions,readDesktopSession,desktopOpener,retainedDesktopTarget,accountHasLocalRecords} from './desktop-open.mjs';
import {DatabaseSync} from 'node:sqlite';
const A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const req={session_id:A,harness:'Claude',name:'Game',cwd:'E:/Projects/Game',idempotency_key:'wake-game'};
const relay={native_id:B,endpoint:'relay',label:'Any desktop chat',cwd:'E:/Projects/Other',state:'idle'};
const target={native_id:'target-id',endpoint:'target',label:'Game',cwd:'E:\\Projects\\Game',state:'idle'};
function fixture(sessions=[relay]){
  const h={harness:'claude',type:'claude',profile:{label:'Claude'},sessions,stale:false,error:null},calls=[];
  const records=new Map([[B,{desktop_id:`local_${B}`,name:relay.label,cwd:relay.cwd}]]);
  const invoke=async(_c,name,args)=>{calls.push({name,args});
    if(name==='harness.discover')return {harnesses:[h]};
    if(name==='session.request')return {id:A,request_id:A,native_notification:{status:'uncertain'}};
    if(name==='session.request_status')return {id:A,state:'pending',reply:null};
    assert.fail('unexpected operation '+name);
  };
  return {h,calls,records,options:{invoke,bindings:()=>records}};
}
test('resolution uses a live exact target and never sends a relay request',async()=>{
  const f=fixture([relay,target]);const r=await resolveTarget(null,req,f.options);
  assert.equal(r.status,'found');assert.equal(r.target.endpoint,'target');assert.equal(f.calls.length,1);
});
test('missing Claude target requests one verified desktop relay without forwarding project work',async()=>{
  const f=fixture();const r=await resolveTarget(null,req,f.options);
  assert.equal(r.status,'wake_requested');assert.equal(r.relay,'relay');assert.equal(r.native_notification.status,'uncertain');
  const sent=f.calls[1];assert.equal(sent.name,'session.request');assert.equal(sent.args.idempotency_key,'resolve:wake-game');
  const body=JSON.parse(sent.args.body);assert.equal(body.type,'ihcp.desktop-wake.v1');assert.deepEqual(body.target,{name:req.name,cwd:req.cwd});
  assert.match(body.instructions,/Do not perform project work, create\/resume\/copy a chat/);
  assert.match(body.instructions,/routine IHCP3K relay work, not a task in your project/);
  assert.match(body.instructions,/do not release it/);
});
test('an operator relay preference picks a verified live relay first and is ignored when absent or invalid',async()=>{
  const C='cccccccc-cccc-4ccc-cccc-cccccccccccc',other={native_id:C,endpoint:'another',label:'Preferred chat',cwd:'E:/Projects/PA',state:'busy'};
  for(const [preferredRelays,expected] of [[[`local_${C}`],'another'],[[`LOCAL_${C.toUpperCase()}`],'another'],[[],'relay'],[['not-an-id',`local_${A}`],'relay']]){
    const f=fixture([relay,other]);f.records.set(C,{desktop_id:`local_${C}`,name:other.label,cwd:other.cwd});
    const r=await resolveTarget(null,req,{...f.options,preferredRelays});
    assert.equal(r.status,'wake_requested');assert.equal(r.relay,expected);
    assert.equal(f.calls.filter(c=>c.name==='session.request').length,1);
  }
  const f=fixture([relay,other]);// A preferred chat without a verified desktop record is never chosen.
  const r=await resolveTarget(null,req,{...f.options,preferredRelays:[`local_${C}`]});assert.equal(r.relay,'relay');
});
test('unavailable, stale, ambiguous and unsupported targets do not trigger guesses or fanout',async()=>{
  for(const [change,status,input] of [
    [f=>f.h.sessions.push(target,{...target,endpoint:'duplicate'}),'ambiguous_target',req],
    [f=>f.h.stale=true,'discovery_unavailable',req],
    [f=>f.h.error='DISCOVERY_TIMEOUT','discovery_unavailable',req],
    [f=>f.records.clear(),'desktop_relay_unavailable',req],
    [f=>f.records.get(B).name='Changed name','desktop_relay_unavailable',req],
    [f=>f.records.get(B).cwd='/different','desktop_relay_unavailable',req],
    [f=>{f.h.harness='codex';f.h.type='codex';f.h.profile.label='Codex';},'target_unavailable',{...req,harness:'Codex'}],
    [()=>{},'harness_unavailable',{...req,harness:'Unknown'}],
    [()=>{},'desktop_relay_unavailable',{...req,session_id:B}],
  ]){
    const f=fixture();change(f);assert.equal((await resolveTarget(null,input,f.options)).status,status);
    assert.equal(f.calls.some(c=>c.name==='session.request'),false);
  }
});
test('wake follow-up checks the original request without resending, then verifies desktop identity after native ID changes',async()=>{
  const f=fixture();const input={...req,wake_request_id:A,desktop_id:`local_${A}`};
  assert.equal((await resolveTarget(null,input,f.options)).status,'wake_pending');
  assert.equal(f.calls.at(-1).name,'session.request_status');
  f.h.sessions.push(target);f.records.set(target.native_id,{desktop_id:`local_${A}`,name:target.label,cwd:target.cwd});
  assert.equal((await resolveTarget(null,input,f.options)).status,'found');
  f.records.get(target.native_id).desktop_id=`local_${B}`;
  assert.equal((await resolveTarget(null,input,f.options)).status,'wake_pending');
  assert.equal(f.calls.some(c=>c.name==='session.request'),false);
});
test('malformed resolution inputs fail before native or MCP activity',async()=>{
  for(const changes of [{name:''},{harness:''},{session_id:''},{idempotency_key:''},{desktop_id:'wrong'},{wake_request_id:'wrong'},{cwd:'x\ny'}]){
    const f=fixture();await assert.rejects(resolveTarget(null,{...req,...changes},f.options),/INVALID_RESOLVE_TARGET/);assert.equal(f.calls.length,0);
  }
});
test('desktop metadata requires one unambiguous native desktop registration, not a transcript or a title',t=>{
  const dir=mkdtempSync(join(tmpdir(),'ihcp-resolve-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const d={sessionId:A,hostSessionId:`local_${B}`,entrypoint:'claude-desktop',pid:12,startedAt:1,name:'Game',cwd:'/project'};
  writeFileSync(join(dir,'12.json'),JSON.stringify(d));
  assert.deepEqual(desktopBindings(dir).get(A),{desktop_id:`local_${B}`,name:'Game',cwd:'/project'});
  writeFileSync(join(dir,'13.json'),JSON.stringify({...d,pid:13}));assert.equal(desktopBindings(dir).size,0);
  writeFileSync(join(dir,'13.json'),JSON.stringify({...d,pid:13,sessionId:B,entrypoint:'cli'}));assert.equal(desktopBindings(dir).size,1);
  writeFileSync(join(dir,'12.json'),JSON.stringify({...d,pid:99}));assert.equal(desktopBindings(dir).size,0);
  mkdirSync(join(dir,'14.json'));assert.equal(desktopBindings(dir).size,0);
});

test('all-suspended resolution opens one existing desktop identity and verifies discovery before sending',async()=>{
 const f=fixture([]),saved={native_id:B,desktop_id:`local_${B}`,label:'Game',cwd:req.cwd,file:'/native/account/chat.json'};
 let opens=0;
 const options={...f.options,desktop:()=>[saved],wait:async()=>{},openDesktop:async()=>{
  opens++;f.h.sessions.push(target);f.records.set(target.native_id,{desktop_id:saved.desktop_id,name:'Game',cwd:req.cwd});return {status:'desktop_open_uncertain'};
 }};
 assert.equal((await resolveTarget(null,req,options)).status,'found');assert.equal(opens,1);
 assert.equal(f.calls.some(c=>c.name==='session.request'),false);
});

test('desktop fallback rejects ambiguous, changed, unsupported and uncertain identities without replay',async()=>{
 const saved={native_id:B,desktop_id:`local_${B}`,label:'Game',cwd:req.cwd,file:'/native/account/chat.json'};
 for(const status of ['desktop_open_requires_tty','desktop_open_uncertain','desktop_identity_changed','desktop_launcher_unavailable']){
  const f=fixture([]);let opens=0;
  assert.equal((await resolveTarget(null,req,{...f.options,desktop:()=>[saved],wait:async()=>{},openDesktop:async()=>{opens++;return {status};}})).status,status);assert.equal(opens,1);
 }
 const f=fixture([]),base={...f.options,desktop:()=>[saved,{...saved,file:'/other/chat.json'}],openDesktop:async()=>assert.fail('ambiguous open')};
 assert.equal((await resolveTarget(null,req,base)).status,'ambiguous_target');
 const g=fixture([]);let n=0;
 assert.equal((await resolveTarget(null,req,{...g.options,desktop:()=>[saved],wait:async()=>{},openDesktop:async()=>{n++;return {status:'desktop_opened'};}})).status,'desktop_open_uncertain');assert.equal(n,1);
 const h=fixture([]);
 assert.equal((await resolveTarget(null,req,{...h.options,desktop:()=>[saved],openDesktop:async()=>{h.h.sessions.push({...target,native_id:B});h.records.set(B,{desktop_id:`local_${A}`,name:'Game',cwd:req.cwd});return {status:'desktop_opened'};}})).status,'desktop_identity_changed');
});

test('desktop bootstrap opens one relay when target is not in metadata; never chains bootstraps',async()=>{
 const f=fixture([]),saved={native_id:B,desktop_id:`local_${B}`,label:relay.label,cwd:relay.cwd,file:'/native/account/relay.json',scope:'local'};let n=0;
 const result=await resolveTarget(null,req,{...f.options,desktop:()=>[saved],wait:async()=>{},openDesktop:async()=>{n++;f.h.sessions.push(relay);return {status:'desktop_opened'};}});
 assert.equal(result.status,'wake_requested');assert.equal(n,1);assert.equal(f.calls.filter(c=>c.name==='session.request').length,1);
 // An unmarked older record can be a target, but is never opened just to act as a relay.
 const u=fixture([]);let opened=0;
 const none=await resolveTarget(null,req,{...u.options,desktop:()=>[{...saved,scope:'unmarked'}],wait:async()=>{},openDesktop:async()=>{opened++;return {status:'desktop_opened'};}});
 assert.equal(none.status,'desktop_target_unavailable');assert.equal(opened,0);
 // The operator preference survives the bounded bootstrap recursion.
 const C='cccccccc-cccc-4ccc-cccc-cccccccccccc',preferred={native_id:C,endpoint:'preferred',label:'Preferred chat',cwd:'E:/Projects/PA',state:'busy'};
 const g=fixture([]);g.records.set(C,{desktop_id:`local_${C}`,name:preferred.label,cwd:preferred.cwd});let m=0;
 const chosen=await resolveTarget(null,req,{...g.options,preferredRelays:[`local_${C}`],desktop:()=>[saved],wait:async()=>{},openDesktop:async()=>{m++;g.h.sessions.push(relay,preferred);return {status:'desktop_opened'};}});
 assert.equal(chosen.status,'wake_requested');assert.equal(chosen.relay,'preferred');assert.equal(m,1);
 assert.equal(g.calls.filter(c=>c.name==='session.request').length,1);
});

test('unmarked desktop records count as local only in an account with marked local records and an existing project folder',t=>{
 const dir=mkdtempSync(join(tmpdir(),'ihcp-desktop-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const account=join(dir,A,B),project=join(dir,'project');mkdirSync(account,{recursive:true});mkdirSync(project);
 const C='cccccccc-cccc-4ccc-cccc-cccccccccccc',D='dddddddd-dddd-4ddd-dddd-dddddddddddd';
 const put=(id,cli,fields)=>{const file=join(account,`local_${id}.json`);writeFileSync(file,JSON.stringify({sessionId:`local_${id}`,cliSessionId:cli,title:'Old chat',cwd:project,isArchived:false,...fields}));return file;};
 const old=put(C,D,{originCwd:project});
 // Without any explicitly local record in the account, an unmarked record is never trusted.
 assert.deepEqual(desktopSessions({roots:[dir]}),[]);assert.equal(accountHasLocalRecords(account),false);
 put(A,B,{title:'Marked',envScopeId:'builtin_local',startedFromEnvironmentId:null});
 assert.equal(accountHasLocalRecords(account),true);
 assert.deepEqual(desktopSessions({roots:[dir]}).map(r=>r.desktop_id).sort(),[`local_${A}`,`local_${C}`]);
 assert.equal(readDesktopSession(old,{localAccount:true}).native_id,D);assert.equal(readDesktopSession(old),null);
 for(const change of [{envScopeId:'ssh'},{envScopeId:null},{startedFromEnvironmentId:'cloud'},{originCwd:join(dir,'elsewhere')},{cwd:join(dir,'missing')},{isArchived:true}]){
  writeFileSync(old,JSON.stringify({sessionId:`local_${C}`,cliSessionId:D,title:'Old chat',cwd:project,isArchived:false,originCwd:project,...change}));
  assert.equal(readDesktopSession(old,{localAccount:true}),null);assert.deepEqual(desktopSessions({roots:[dir]}).map(r=>r.desktop_id),[`local_${A}`]);
 }
});
test('desktop state reader excludes archived, remote, malformed and ambiguous metadata without writing it',t=>{
 const dir=mkdtempSync(join(tmpdir(),'ihcp-desktop-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const account=join(dir,A,B);mkdirSync(account,{recursive:true});const file=join(account,`local_${A}.json`);
 const d={sessionId:`local_${A}`,cliSessionId:B,title:'Game',cwd:dir,isArchived:false,envScopeId:'builtin_local',startedFromEnvironmentId:null,secretSnapshot:'must not escape'};
 writeFileSync(file,JSON.stringify(d));const before=readFileSync(file,'utf8');
 assert.equal(desktopSessions({roots:[dir]}).length,1);assert.equal(JSON.stringify(readDesktopSession(file)).includes('must not escape'),false);assert.equal(readFileSync(file,'utf8'),before);
 for(const change of [{isArchived:true},{isArchived:null},{envScopeId:'ssh'},{startedFromEnvironmentId:'cloud'},{cliSessionId:'invalid'},{sessionId:`local_${B}`},{cwd:'relative'}]){
  writeFileSync(file,JSON.stringify({...d,...change}));assert.equal(readDesktopSession(file),null);
 }
 const database=join(dir,'mail.db'),runtimeFile=join(dir,'runtime.json');
 const db=new DatabaseSync(database);db.exec('CREATE TABLE harnesses(id TEXT,active INTEGER,config_json TEXT); CREATE TABLE harness_sessions(harness TEXT,native_id TEXT,label TEXT,cwd TEXT)');
 db.prepare('INSERT INTO harnesses VALUES(?,1,?)').run('claude',JSON.stringify({type:'claude'}));
 db.prepare('INSERT INTO harness_sessions VALUES(?,?,?,?)').run('claude',B,'Game',dir);db.close();writeFileSync(runtimeFile,JSON.stringify({database}));
 const retained=retainedDesktopTarget(runtimeFile,{harness:'claude'},{...req,cwd:dir});
 const legacy={...d,envScopeId:undefined,originCwd:dir};
 writeFileSync(file,JSON.stringify(legacy));assert.equal(readDesktopSession(file),null);
 assert.equal(readDesktopSession(file,{retained}).native_id,B);
 for(const change of [{envScopeId:'ssh'},{envScopeId:null},{isArchived:true},{startedFromEnvironmentId:'cloud'},{originCwd:join(dir,'elsewhere')},{cliSessionId:A}]){
  writeFileSync(file,JSON.stringify({...legacy,...change}));assert.equal(readDesktopSession(file,{retained}),null);
 }
 // Older records may omit startedFromEnvironmentId entirely as well as envScopeId.
 writeFileSync(file,JSON.stringify({...legacy,startedFromEnvironmentId:undefined}));assert.equal(readDesktopSession(file,{retained}).native_id,B);
 writeFileSync(file,JSON.stringify(legacy));
 assert.equal(readDesktopSession(file,{retained:retainedDesktopTarget(runtimeFile,{harness:'claude'},{...req,cwd:join(dir,'elsewhere')})}),null);
 writeFileSync(file,'{');assert.equal(readDesktopSession(file),null);
});

test('native desktop opener uses only registered executable, exact resume args and a durable one-attempt journal',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ihcp-open-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,`local_${A}.json`),runtimeFile=join(dir,'runtime.json'),database=join(dir,'mail.db'),journalDir=join(dir,'attempts');
 const project=join(dir,'game');mkdirSync(project);
 const d={sessionId:`local_${A}`,cliSessionId:B,title:'Game',cwd:project,isArchived:false,envScopeId:'builtin_local'};writeFileSync(file,JSON.stringify(d));
 const db=new DatabaseSync(database);db.exec('CREATE TABLE harnesses(id TEXT,active INTEGER,config_json TEXT)');
 const executable=join(dir,process.platform==='win32'?'claude.exe':'claude');db.prepare('INSERT INTO harnesses VALUES(?,1,?)').run('claude',JSON.stringify({type:'claude',executable,cwd:dir}));db.close();writeFileSync(runtimeFile,JSON.stringify({database}));
 const calls=[],run=(exe,args,opts)=>{calls.push({exe,args,opts});return {status:0,stdout:'[]'};};
 const selected=readDesktopSession(file),h={harness:'claude'};
 assert.equal((await desktopOpener({runtimeFile,journalDir,tty:false,run})(h,selected,req)).status,'desktop_open_requires_tty');assert.equal(calls.length,0);
 const open=desktopOpener({runtimeFile,journalDir,tty:true,run});assert.equal((await open(h,selected,req)).status,'desktop_opened');
 assert.deepEqual(calls.at(-1).args,['--desktop','--resume',B]);assert.equal(calls.at(-1).exe,executable);assert.equal(calls.at(-1).opts.stdio,'inherit');assert.equal(calls.at(-1).opts.cwd,project);
 assert.equal((await open(h,selected,req)).status,'desktop_open_uncertain');assert.equal(calls.filter(c=>c.args[0]==='--desktop').length,1);
 writeFileSync(file,JSON.stringify({...d,isArchived:true}));assert.equal((await open(h,selected,{...req,idempotency_key:'other'})).status,'desktop_identity_changed');
 writeFileSync(file,JSON.stringify(d));
 const running=desktopOpener({runtimeFile,journalDir,tty:true,run:(_exe,args)=>{assert.deepEqual(args,['agents','--json']);return {status:0,stdout:JSON.stringify([{sessionId:B}])};}});
 assert.equal((await running(h,selected,{...req,idempotency_key:'running'})).status,'already_running');
 const changed=desktopOpener({runtimeFile,journalDir,tty:true,run:(_exe,args)=>{assert.deepEqual(args,['agents','--json']);writeFileSync(file,JSON.stringify({...d,isArchived:true}));return {status:0,stdout:'[]'};}});
 assert.equal((await changed(h,selected,{...req,idempotency_key:'race'})).status,'desktop_identity_changed');
});
