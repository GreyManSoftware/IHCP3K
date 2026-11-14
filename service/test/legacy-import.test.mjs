import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {importLegacy} from '../src/legacy-import.mjs';

test('legacy migration preserves terminal receipts and quarantines unknown work atomically',()=>{
  const store=new Store(':memory:',{recipients:['a']});
  const row=(id,terminal)=>{
    const source=JSON.stringify({schema:0,message_id:id,from:'b',to:'a',type:'message',payload:{text:'old work'}});
    const sha256=createHash('sha256').update(source).digest('hex');
    return {source,sha256,filename:id+'.json',recipient:'a',receipt:terminal?JSON.stringify({message_id:id,source_sha256:sha256,status:'completed',outcome:'done'}):null};
  };
  try {
    const manifest={version:1,allowed_senders:['b'],records:[row('done',true),row('pending',false)]};
    assert.deepEqual(importLegacy(store,manifest),{completed:1,reconcile:1,duplicates:0});
    assert.deepEqual(importLegacy(store,manifest),{completed:0,reconcile:0,duplicates:2});
    assert.equal(store.pending('a'),0);
    assert.equal(store.db.prepare("SELECT body FROM messages WHERE state='completed'").get().body,null);
    const conflict={...manifest,records:[row('before-error',true),{...row('bad',true),receipt:'{}'}]};
    assert.throws(()=>importLegacy(store,conflict),/RECEIPT_CONFLICT/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM messages').get().n,2);
    const changed=row('done',false);changed.source+=' ';changed.sha256=createHash('sha256').update(changed.source).digest('hex');
    assert.throws(()=>importLegacy(store,{...manifest,records:[changed]}),/IMPORT_CONFLICT/);
  } finally{store.close();}
});
