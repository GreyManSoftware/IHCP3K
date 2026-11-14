import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {importLegacy} from '../src/legacy-import.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
function markerFixture(){
  const row=(id,recipient='a')=>{const source=JSON.stringify({schema:0,message_id:id,from:'sender',to:recipient,payload:{text:'old work'}});return {source,sha256:digest(source),filename:id+'.json',recipient,receipt:null};};
  const source='handled.json\r\nhandled.json\r\n';
  return {version:1,allowed_senders:['sender'],records:[row('handled'),row('unresolved'),row('other-inbox','b')],processed_lists:[{format:'claude-watch-filenames-v1',recipient:'a',source,sha256:digest(source)}]};
}

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

test('handled filename snapshots retain distinct provenance without replay or cross-inbox effects',()=>{
  const store=new Store(':memory:',{recipients:['a','b']});
  try{
    const manifest=markerFixture();
    assert.deepEqual(importLegacy(store,manifest),{completed:1,reconcile:2,duplicates:0});
    assert.deepEqual(importLegacy(store,manifest),{completed:0,reconcile:0,duplicates:3});
    const row=store.db.prepare("SELECT body,outcome FROM messages WHERE dedup_key='legacy:handled'").get();
    assert.equal(row.body,null);
    const outcome=JSON.parse(row.outcome);assert.equal(outcome.legacy_status,'handled-marker');
    assert.equal(outcome.provenance.type,'legacy-processed-list');assert.equal(outcome.provenance.list_sha256,manifest.processed_lists[0].sha256);
    assert.equal(store.pending('a'),0);assert.equal(store.pending('b'),0);
    const changed=structuredClone(manifest);changed.processed_lists[0].source+='unresolved.json\n';changed.processed_lists[0].sha256=digest(changed.processed_lists[0].source);
    assert.throws(()=>importLegacy(store,changed),/IMPORT_PROVENANCE_CONFLICT/);
    assert.equal(store.db.prepare("SELECT state FROM messages WHERE dedup_key='legacy:unresolved'").get().state,'reconcile');
    store.db.exec("DELETE FROM metadata WHERE key LIKE 'legacy-semantics:%'");
    assert.throws(()=>importLegacy(store,changed),/IMPORT_PROVENANCE_CONFLICT/); // v0.2 rows also cannot silently change state
  }finally{store.close();}
});

test('processed-list validation fails atomically on unsafe names, incomplete snapshots and conflicts',()=>{
  const cases=[
    m=>m.processed_lists[0].sha256='0'.repeat(64),
    m=>m.processed_lists.push(structuredClone(m.processed_lists[0])),
    m=>m.processed_lists[0].recipient='missing',
    m=>{m.processed_lists[0].source='../handled.json\n';m.processed_lists[0].sha256=digest(m.processed_lists[0].source);},
    m=>{m.processed_lists[0].source='absent.json\n';m.processed_lists[0].sha256=digest(m.processed_lists[0].source);},
    m=>{m.processed_lists[0].recipient='b';},
    m=>m.records.push(structuredClone(m.records[0])),
    m=>m.records[0].receipt=JSON.stringify({message_id:'handled',source_sha256:m.records[0].sha256,status:'claimed'}),
    m=>m.records[1].sha256='0'.repeat(64)
  ];
  for(const change of cases){
    const store=new Store(':memory:',{recipients:['a','b']});
    try{const manifest=markerFixture();change(manifest);assert.throws(()=>importLegacy(store,manifest));assert.equal(store.db.prepare('SELECT count(*) AS n FROM messages').get().n,0);assert.equal(store.db.prepare("SELECT count(*) AS n FROM metadata WHERE key LIKE 'legacy%'").get().n,0);}
    finally{store.close();}
  }
});
