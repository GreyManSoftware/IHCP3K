import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {snapshot,restore} from '../src/backup.mjs';

test('WAL backup and restore retain dedup, fence effects and refuse overwrite or corruption',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ihcp-backup-'));
  let store,restored;
  const sender={id:'sender',permissions:['send'],recipients:['a']},pa={id:'pa',permissions:['claim'],recipients:['a']};
  try {
    store=new Store(join(dir,'live.db'),{recipients:['a']});
    const msg={recipient:'a',body:'private',idempotency_key:'done'};
    store.send(sender,msg);store.complete(pa,{...store.claim(pa,{recipient:'a',handler_id:'test'})[0],outcome:'done'});
    store.send(sender,{...msg,idempotency_key:'pending'});
    const destination=join(dir,'backup.db'),saved=await snapshot(join(dir,'live.db'),destination);
    await assert.rejects(snapshot(join(dir,'live.db'),destination),/BACKUP_EXISTS/);
    store.complete(pa,{...store.claim(pa,{recipient:'a',handler_id:'later'})[0],outcome:'effect after backup'});
    assert.throws(()=>restore(destination,join(dir,'bad.db'),{sha256:'0'.repeat(64),recipients:['a']}),/HASH/);
    const target=join(dir,'restored.db');const result=restore(destination,target,{...saved,recipients:['a']});
    assert.ok(result.pause_id.startsWith('restore-review-'));
    assert.throws(()=>restore(destination,target,{...saved,recipients:['a']}),/TARGET_EXISTS/);
    restored=new Store(target,{recipients:['a']});
    assert.equal(restored.send(sender,msg).state,'completed');
    assert.equal(restored.send(sender,{...msg,idempotency_key:'pending'}).state,'reconcile');
    assert.throws(()=>restored.claim(pa,{recipient:'a',handler_id:'no-replay'}),/PAUSED/);
    assert.equal(restored.db.prepare("SELECT body FROM messages WHERE state='completed'").get().body,null);
  } finally {restored?.close();store?.close();rmSync(dir,{recursive:true,force:true});}
});
