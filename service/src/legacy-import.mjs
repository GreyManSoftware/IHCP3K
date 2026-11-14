import {createHash,randomUUID} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');

// Offline, explicit migration only. A terminal receipt must match the original
// bytes; everything else is quarantined, never scheduled automatically.
export function importLegacy(store,manifest) {
  if(manifest?.version!==1 || !Array.isArray(manifest.allowed_senders) || !Array.isArray(manifest.records) || manifest.records.length>10000)throw Error('INVALID_IMPORT');
  return store.transaction(()=>{
    const result={completed:0,reconcile:0,duplicates:0};
    for(const record of manifest.records){
      if(typeof record.source!=='string' || Buffer.byteLength(record.source)>1048576 || hash(record.source)!==record.sha256)throw Error('IMPORT_SOURCE_HASH');
      const msg=JSON.parse(record.source);
      if(msg.schema!==0 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(msg.message_id) || record.filename!==msg.message_id+'.json' || msg.to!==record.recipient || typeof msg.from!=='string' || !manifest.allowed_senders.includes(msg.from))throw Error('IMPORT_IDENTITY');
      store.recipient(msg.to);
      const receipt=record.receipt?JSON.parse(record.receipt):null;
      if(receipt && (receipt.message_id!==msg.message_id || (receipt.source_sha256??receipt.sha256)!==record.sha256 || receipt.source_sha256 && receipt.sha256 && receipt.source_sha256!==receipt.sha256))throw Error('IMPORT_RECEIPT_CONFLICT');
      const key='legacy:'+msg.message_id;
      const old=store.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
      if(old){if(old.value!==record.sha256)throw Error('IMPORT_CONFLICT');result.duplicates++;continue;}
      const body=JSON.stringify(msg),kind='legacy-message';
      if(Buffer.byteLength(body)>65536)throw Error('IMPORT_BODY_TOO_LARGE');
      const completed=receipt && ['completed','rejected','blocked'].includes(receipt.status);
      const outcome=completed?JSON.stringify({legacy_status:receipt.status,outcome:String(receipt.outcome||'Legacy terminal receipt').slice(0,2000)}):null;
      const id=randomUUID(),state=completed?'completed':'reconcile',now=store.now();
      if(!completed && store.db.prepare("SELECT count(*) AS n FROM messages WHERE state!='completed'").get().n>=store.maxPending)throw Error('CAPACITY_REACHED');
      store.db.prepare('INSERT INTO messages(id,sender,recipient,dedup_key,input_hash,kind,body,state,created_at,completed_at,outcome,outcome_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'legacy:'+msg.from,msg.to,key,hash(JSON.stringify([msg.to,kind,body])),kind,completed?null:body,state,Date.parse(msg.created_at)||now,completed?now:null,outcome,outcome?hash(outcome):null);
      if(!completed)store.db.prepare("INSERT INTO outbox(message_id,recipient,state,created_at) VALUES(?,?,'reconcile',?)").run(id,msg.to,now);
      store.db.prepare('INSERT INTO metadata VALUES(?,?)').run(key,record.sha256);
      result[state]++;
    }
    return result;
  });
}
