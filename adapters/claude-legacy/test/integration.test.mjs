import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {exportSnapshot,writeManifest} from '../src/export.mjs';
import {Store} from '../../../service/src/store.mjs';
import {importLegacy} from '../../../service/src/legacy-import.mjs';

test('exporter to importer keeps both receipt formats terminal and unhandled work quarantined',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ihcp-migration-'));
  const mail=path.join(root,'mail'),inbox=path.join(mail,'alpha-pa');fs.mkdirSync(path.join(inbox,'processed'),{recursive:true});
  const hash=s=>createHash('sha256').update(s).digest('hex');
  for(const id of ['marked','receipted','unhandled']){
    const source=JSON.stringify({schema:0,message_id:id,from:'beta-pa',to:'alpha-pa',payload:{text:'never repeat old work'}})+'\r\n';
    fs.writeFileSync(path.join(inbox,id+'.json'),source);
    if(id==='receipted')fs.writeFileSync(path.join(inbox,'processed',id+'.json'),JSON.stringify({message_id:id,source_sha256:hash(source),status:'completed',outcome:'already done'}));
  }
  fs.writeFileSync(path.join(inbox,'.processed'),'marked.json\r\nmarked.json\r\n  \r\n');
  const store=new Store(':memory:',{recipients:['alpha-pa']});
  try{
    const {manifest}=exportSnapshot({mailRoot:mail,recipients:['alpha-pa'],allowedSenders:['beta-pa']});
    const out=path.join(root,'snapshot.json');const sha=writeManifest(out,manifest);assert.equal(sha,hash(fs.readFileSync(out)));
    const saved=JSON.parse(fs.readFileSync(out,'utf8'));
    assert.deepEqual(importLegacy(store,saved),{completed:2,reconcile:1,duplicates:0});
    assert.deepEqual(importLegacy(store,saved),{completed:0,reconcile:0,duplicates:3});
    assert.equal(store.pending('alpha-pa'),0);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM messages WHERE state='completed' AND body IS NOT NULL").get().n,0);
    const proof=JSON.parse(store.db.prepare("SELECT value FROM metadata WHERE key='legacy-provenance:marked'").get().value);
    assert.equal(proof.type,'legacy-processed-list');assert.equal(proof.list_sha256,manifest.processed_lists[0].sha256);
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});
