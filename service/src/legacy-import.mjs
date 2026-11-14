import {createHash,randomUUID} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeName=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.json$/.test(value);

function processedLists(store,manifest) {
  if(manifest.processed_lists!==undefined && !Array.isArray(manifest.processed_lists))throw Error('IMPORT_PROCESSED_FORMAT');
  const lists=new Map();
  for(const list of manifest.processed_lists??[]){
    if(list?.format!=='claude-watch-filenames-v1' || typeof list.source!=='string' || Buffer.byteLength(list.source)>1048576 || hash(list.source)!==list.sha256)throw Error('IMPORT_PROCESSED_HASH');
    store.recipient(list.recipient);
    if(lists.has(list.recipient))throw Error('IMPORT_PROCESSED_DUPLICATE');
    const names=new Set();
    for(const name of list.source.split(/\r?\n/)){
      if(!name.trim())continue;
      if(!safeName(name))throw Error('IMPORT_PROCESSED_NAME');
      names.add(name);
    }
    if(names.size>10000)throw Error('IMPORT_PROCESSED_CAPACITY');
    const records=new Set(manifest.records.filter(r=>r.recipient===list.recipient).map(r=>r.filename));
    if([...names].some(name=>!records.has(name)))throw Error('IMPORT_PROCESSED_MISSING_RECORD');
    lists.set(list.recipient,{...list,names});
  }
  return lists;
}

// Offline, explicit migration only. A terminal receipt must match the original
// bytes. Legacy handled-filename lists have distinct provenance: their snapshot
// hash is not a claim that the old consumer recorded per-message hashes.
export function importLegacy(store,manifest) {
  if(manifest?.version!==1 || !Array.isArray(manifest.allowed_senders) || !Array.isArray(manifest.records) || manifest.records.length>10000)throw Error('INVALID_IMPORT');
  const lists=processedLists(store,manifest);
  return store.transaction(()=>{
    const result={completed:0,reconcile:0,duplicates:0};
    const seen=new Set();
    for(const record of manifest.records){
      if(typeof record.source!=='string' || Buffer.byteLength(record.source)>1048576 || hash(record.source)!==record.sha256)throw Error('IMPORT_SOURCE_HASH');
      const msg=JSON.parse(record.source);
      if(msg.schema!==0 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(msg.message_id) || record.filename!==msg.message_id+'.json' || msg.to!==record.recipient || typeof msg.from!=='string' || !manifest.allowed_senders.includes(msg.from))throw Error('IMPORT_IDENTITY');
      store.recipient(msg.to);
      const receipt=record.receipt?JSON.parse(record.receipt):null;
      if(receipt && (receipt.message_id!==msg.message_id || (receipt.source_sha256??receipt.sha256)!==record.sha256 || receipt.source_sha256 && receipt.sha256 && receipt.source_sha256!==receipt.sha256))throw Error('IMPORT_RECEIPT_CONFLICT');
      const key='legacy:'+msg.message_id;
      if(seen.has(key))throw Error('IMPORT_DUPLICATE_RECORD');seen.add(key);
      const body=JSON.stringify(msg),kind='legacy-message';
      if(Buffer.byteLength(body)>65536)throw Error('IMPORT_BODY_TOO_LARGE');
      const list=lists.get(msg.to),marked=list?.names.has(record.filename)??false;
      const receiptTerminal=!!receipt && ['completed','rejected','blocked'].includes(receipt.status);
      if(marked && receipt && !receiptTerminal)throw Error('IMPORT_RECEIPT_MARKER_CONFLICT');
      const completed=receiptTerminal||marked;
      const provenance=receiptTerminal?{type:'hash-bound-receipt',receipt_sha256:hash(record.receipt)}:marked?{type:'legacy-processed-list',format:list.format,recipient:msg.to,list_sha256:list.sha256,filename:record.filename}:{type:'unresolved'};
      const semantics=hash(JSON.stringify([record.sha256,completed,receiptTerminal?hash(record.receipt):marked?'processed-list':'unresolved']));
      const old=store.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
      if(old){
        if(old.value!==record.sha256)throw Error('IMPORT_CONFLICT');
        const oldSemantics=store.db.prepare('SELECT value FROM metadata WHERE key=?').get('legacy-semantics:'+msg.message_id);
        if(oldSemantics && oldSemantics.value!==semantics)throw Error('IMPORT_PROVENANCE_CONFLICT');
        if(!oldSemantics){
          // v0.2 imported rows lack provenance fingerprints. Never silently
          // upgrade an uncertain row to handled based on newly supplied markers.
          const row=store.db.prepare('SELECT state FROM messages WHERE sender=? AND dedup_key=?').get('legacy:'+msg.from,key);
          if(!row || (row.state==='completed')!==completed)throw Error('IMPORT_PROVENANCE_CONFLICT');
          store.db.prepare('INSERT INTO metadata VALUES(?,?)').run('legacy-semantics:'+msg.message_id,semantics);
        }
        result.duplicates++;continue;
      }
      const outcome=completed?JSON.stringify({legacy_status:receiptTerminal?receipt.status:'handled-marker',outcome:receiptTerminal?String(receipt.outcome||'Legacy terminal receipt').slice(0,2000):'Recorded as handled by the legacy consumer; no work replayed',provenance}):null;
      const id=randomUUID(),state=completed?'completed':'reconcile',now=store.now();
      if(!completed && store.db.prepare("SELECT count(*) AS n FROM messages WHERE state!='completed'").get().n>=store.maxPending)throw Error('CAPACITY_REACHED');
      store.db.prepare('INSERT INTO messages(id,sender,recipient,dedup_key,input_hash,kind,body,state,created_at,completed_at,outcome,outcome_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'legacy:'+msg.from,msg.to,key,hash(JSON.stringify([msg.to,kind,body])),kind,completed?null:body,state,Date.parse(msg.created_at)||now,completed?now:null,outcome,outcome?hash(outcome):null);
      if(!completed)store.db.prepare("INSERT INTO outbox(message_id,recipient,state,created_at) VALUES(?,?,'reconcile',?)").run(id,msg.to,now);
      store.db.prepare('INSERT INTO metadata VALUES(?,?)').run(key,record.sha256);
      store.db.prepare('INSERT INTO metadata VALUES(?,?)').run('legacy-semantics:'+msg.message_id,semantics);
      store.db.prepare('INSERT INTO metadata VALUES(?,?)').run('legacy-provenance:'+msg.message_id,JSON.stringify({source_sha256:record.sha256,...provenance}));
      result[state]++;
    }
    for(const list of lists.values())store.db.prepare('INSERT OR IGNORE INTO metadata VALUES(?,?)').run('legacy-processed-list:'+list.recipient+':'+list.sha256,JSON.stringify({format:list.format,sha256:list.sha256,entry_count:list.names.size}));
    return result;
  });
}
