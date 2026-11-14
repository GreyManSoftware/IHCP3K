import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';

const digest=file=>{
  const hash=createHash('sha256'),buffer=Buffer.alloc(65536),fd=fs.openSync(file,'r');
  try{let bytes;while((bytes=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,bytes));return hash.digest('hex');}
  finally{fs.closeSync(fd);}
};
const check=db=>{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok' || db.prepare('PRAGMA foreign_key_check').all().length)throw Error('BACKUP_INTEGRITY_FAILED');
};
// SQLite's backup API includes committed WAL content; copying the .db alone does not.
export async function snapshot(source, destination) {
  if(fs.existsSync(destination))throw Error('BACKUP_EXISTS');
  const stage=destination+'.partial-'+randomUUID();
  let db;
  try {
    db=new DatabaseSync(source,{readOnly:true});check(db);
    await backup(db,stage);db.close();db=undefined;
    const verify=new DatabaseSync(stage,{readOnly:true});try{check(verify);}finally{verify.close();}
    const fd=fs.openSync(stage,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.linkSync(stage,destination);fs.unlinkSync(stage);
    return {sha256:digest(destination),bytes:fs.statSync(destination).size};
  } catch(e) {db?.close();if(fs.existsSync(stage))fs.unlinkSync(stage);throw e;}
}

// Restore only to a NEW target. Every unfinished record is uncertain because the
// old live service may have completed it since this backup was taken.
export function restore(source,destination,{sha256,recipients}) {
  if(!/^[a-f0-9]{64}$/.test(sha256)||digest(source)!==sha256)throw Error('BACKUP_HASH_MISMATCH');
  if(!Array.isArray(recipients)||!recipients.length)throw Error('RECIPIENTS_REQUIRED');
  if(fs.existsSync(destination))throw Error('RESTORE_TARGET_EXISTS');
  const stage=destination+'.partial-'+randomUUID();
  fs.copyFileSync(source,stage,fs.constants.COPYFILE_EXCL);
  let db;
  try {
    if(digest(stage)!==sha256)throw Error('BACKUP_HASH_MISMATCH');
    db=new DatabaseSync(stage);check(db);
    const schema=db.prepare('PRAGMA user_version').get().user_version;
    if(schema>5)throw Error('SCHEMA_VERSION_UNSUPPORTED');
    if(schema===5)db.function('ihcp_writer_version',()=>5);
    db.exec('BEGIN IMMEDIATE');
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='endpoints'").get()){
      recipients=[...new Set([...recipients,...db.prepare('SELECT id FROM endpoints').all().map(r=>r.id)])];
      // A restored credential may have been revoked since the snapshot: relink explicitly.
      db.exec('UPDATE credentials SET revoked=1; DELETE FROM enrolments; UPDATE endpoints SET active=0,revision=revision+1;');
    }
    const recorded=db.prepare('SELECT DISTINCT recipient FROM messages UNION SELECT recipient FROM pauses').all();
    if(recorded.some(r=>!recipients.includes(r.recipient)))throw Error('RESTORE_RECIPIENT_MISMATCH');
    if(schema===5){
      db.exec("DELETE FROM attendance; DELETE FROM maintenance_lease; UPDATE workers SET state='uncertain' WHERE state='running'; UPDATE workers SET cleanup_state='uncertain' WHERE cleanup_state IN ('pending','reserved');");
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='wake_waiters'").get())db.exec('DELETE FROM wake_waiters;');
    }
    db.exec("UPDATE messages SET state='reconcile',generation=generation+1,token_hash=NULL,deadline=NULL WHERE state!='completed'; UPDATE outbox SET state='reconcile' WHERE state!='done';");
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='wake_dispatch'").get())db.exec("UPDATE wake_dispatch SET state='uncertain',generation=generation+1,token_hash=NULL,deadline=NULL WHERE state!='idle';");
    const pauseId='restore-review-'+randomUUID(),now=Date.now();
    for(const recipient of recipients)db.prepare('INSERT INTO pauses VALUES(?,?,?)').run(recipient,pauseId,now);
    db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('restore',JSON.stringify({sha256,pause_id:pauseId,at:now}));
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');check(db);db.close();db=undefined;
    const fd=fs.openSync(stage,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.linkSync(stage,destination);fs.unlinkSync(stage);
    return {pause_id:pauseId,sha256:digest(destination)};
  } catch(e) {db?.close();for(const suffix of ['', '-wal','-shm'])if(fs.existsSync(stage+suffix))fs.unlinkSync(stage+suffix);throw e;}
}
