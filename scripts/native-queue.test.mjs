import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {enqueue} from './native-queue.mjs';

test('queue evidence rejects silent success, warned failure, crashes and timed-out calls',async()=>{
  const thread='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',queued=`Queued message bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb for thread ${thread}.\n`;
  for(const [stdout,stderr,code,expected] of [[queued,'',0,'queued'],['','',0,'uncertain'],[queued,'error: failed resume',0,'uncertain'],[queued,'',1,'uncertain'],['not queued','',0,'uncertain'],[queued.replace(thread,'cccccccc-cccc-4ccc-cccc-cccccccccccc'),'',0,'uncertain']]){
    const spawnProcess=(_cli,args,options)=>{
      assert.equal(args.includes('--resume'),false);assert.equal(options.windowsHide,true);
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
      queueMicrotask(()=>{child.stdout.emit('data',stdout);child.stderr.emit('data',stderr);child.emit('exit',code);});return child;
    };
    assert.equal(await enqueue({cli:'native',thread,recipient:'a',spawnProcess}),expected);
  }
  let killed=false;
  assert.equal(await enqueue({cli:'native',thread:'test',recipient:'a',timeoutMs:1,spawnProcess:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{killed=true;};return c;}}),'uncertain');
  assert.equal(killed,true);
});
