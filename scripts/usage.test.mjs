import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInvocation,commands} from './usage.mjs';
test('every command provides usage before resolving paths or credentials',()=>{
  for(const name of Object.keys(commands)){
    for(const args of [[name],[name,'--help'],['/'+name,'-h'],['help',name]]){
      const result=parseInvocation(args);
      assert.equal(result.help,true);assert.match(result.text,new RegExp('ihcp.mjs '+name+' '));
    }
  }
  assert.equal(parseInvocation([]).help,true);
  assert.equal(parseInvocation(['prompt','missing-session']).help,true);
  assert.equal(parseInvocation(['register','runtime','code','profile']).help,true);
  assert.throws(()=>parseInvocation(['typo']),/UNKNOWN_MODE.*--help/);
});
test('aliases and explicit arguments preserve routing without executing commands',()=>{
  for(const alias of ['remote_prompt','prompt','chat','request','/remote_prompt']){
    assert.deepEqual(parseInvocation([alias,'session','request.json']),{help:false,mode:'remote_prompt',args:['session','request.json']});
  }
  for(const alias of ['unregister','unlink','/unregister']){
    assert.equal(parseInvocation([alias,'session']).mode,'unregister');
  }
  assert.equal(parseInvocation(['prompt','session','request.json','--help']).help,true);
  assert.throws(()=>parseInvocation(['prompt','session','request.json','--force']),/UNKNOWN_OPTION.*--help/);
});
