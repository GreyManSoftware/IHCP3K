import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveTarget,desktopBindings} from './resolve-target.mjs';
const A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const req={session_id:A,harness:'Claude',name:'Game',cwd:'E:/Projects/Game',idempotency_key:'wake-game'};
const relay={native_id:B,endpoint:'relay',label:'Any desktop chat',cwd:'E:/Projects/Other',state:'idle'};
const target={native_id:'target-id',endpoint:'target',label:'Game',cwd:'E:\\Projects\\Game',state:'idle'};
function fixture(sessions=[relay]){
  const h={harness:'claude',type:'claude',profile:{label:'Claude'},sessions,stale:false,error:null},calls=[];
  const records=new Map([[B,{desktop_id:`local_${B}`,name:relay.label,cwd:relay.cwd}]]);
  const invoke=async(_c,name,args)=>{calls.push({name,args});
    if(name==='harness.discover')return {harnesses:[h]};
    if(name==='session.request')return {id:A,request_id:A};
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
  assert.equal(r.status,'wake_requested');assert.equal(r.relay,'relay');
  const sent=f.calls[1];assert.equal(sent.name,'session.request');assert.equal(sent.args.idempotency_key,'resolve:wake-game');
  const body=JSON.parse(sent.args.body);assert.equal(body.type,'ihcp.desktop-wake.v1');assert.deepEqual(body.target,{name:req.name,cwd:req.cwd});
  assert.match(body.instructions,/Do not perform project work, create\/resume\/copy a chat/);
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
