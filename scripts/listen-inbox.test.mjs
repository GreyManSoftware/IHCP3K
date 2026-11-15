import test from 'node:test';
import assert from 'node:assert/strict';
import {listenInbox} from './listen-inbox.mjs';
test('background listener renews one lease and returns a count, never claims or reads bodies',async()=>{
 let tick=0;const calls=[];
 const result=await listenInbox({}, {session_id:'synthetic',duration_ms:60000},{now:()=>tick,invoke:async(_c,name,args)=>{
  calls.push({name,args});tick+=25000;
  if(calls.length===1)return {status:'timeout',attendance_token:'token'};
  assert.equal(args.attendance_token,'token');return {status:'pending',pending_count:1,attendance_token:'token'};
 }});
 assert.equal(result.status,'pending');assert.equal(result.pending_count,1);
 assert.deepEqual(calls.map(c=>c.name),['session.listen','session.listen']);
});
test('listener releases its lease on bounded timeout, cancellation, pause and failure',async()=>{
 for(const outcome of ['timeout','cancelled','paused','error']){
  let tick=0;const calls=[],stop=new AbortController();
  const pending=listenInbox({}, {session_id:'synthetic',duration_ms:50000},{now:()=>tick,signal:stop.signal,invoke:async(_c,name)=>{
   calls.push(name);if(name==='session.unattend')return {};
   tick+=25000;if(calls.length===1)return {status:'timeout',attendance_token:'token'};
   if(outcome==='error')throw Error('lost connection');
   if(outcome==='cancelled')stop.abort();
   return {status:outcome,attendance_token:'token'};
  }});
  if(outcome==='error')await assert.rejects(pending,/lost connection/);else assert.equal((await pending).status,outcome);
  assert.equal(calls.at(-1),'session.unattend');
 }
});
