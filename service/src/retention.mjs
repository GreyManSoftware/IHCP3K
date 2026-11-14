import {statSync} from 'node:fs';
import {ServiceError} from './store.mjs';
export const RETENTION={historyDays:90,inactiveDays:30,batch:500,maxMessages:100000,maxWorkers:10000,maxEndpoints:50000,maxHarnesses:1000,databaseBytes:256*1024*1024,walBytes:32*1024*1024,reserveBytes:32*1024*1024};
const day=86400000;
export function storageSetup(store){
 const db=store.db,page=db.prepare('PRAGMA page_size').get().page_size;
 db.exec(`PRAGMA max_page_count=${Math.floor(RETENTION.databaseBytes/page)}; PRAGMA journal_size_limit=4194304; PRAGMA wal_autocheckpoint=1000;`);
}
export function walSize(store){try{return statSync(store.filename+'-wal').size;}catch(e){if(e.code==='ENOENT')return 0;throw e;}}
export function checkpoint(store){
 if(store.filename===':memory:'||store.transactionDepth)return;
 const busy=store.db.prepare('PRAGMA busy_timeout').get().timeout;
 try{store.db.exec('PRAGMA busy_timeout=0');store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();}
 finally{store.db.exec(`PRAGMA busy_timeout=${busy}`);}
}
export function checkWriteBudget(store){
 if(walSize(store)>RETENTION.walBytes){checkpoint(store);if(walSize(store)>RETENTION.walBytes)throw new ServiceError('DATABASE_WAL_CAPACITY');}
}
export function checkAdmission(store,table,max){
 const db=store.db,page=db.prepare('PRAGMA page_size').get().page_size,used=(db.prepare('PRAGMA page_count').get().page_count-db.prepare('PRAGMA freelist_count').get().freelist_count)*page;
 if(used>=RETENTION.databaseBytes-RETENTION.reserveBytes||db.prepare(`SELECT count(*) n FROM ${table}`).get().n>=max)throw new ServiceError('DATABASE_CAPACITY');
}
export function pruneHistory(store){
 const db=store.db,now=store.now(),cutoff=now-RETENTION.historyDays*day,ids=new Set();
 const candidates=db.prepare(`SELECT m.id FROM messages m WHERE m.state='completed' AND m.completed_at<?
 AND NOT EXISTS(SELECT 1 FROM replies r JOIN messages other ON other.id=CASE WHEN r.message_id=m.id THEN r.request_message_id ELSE r.message_id END WHERE (r.message_id=m.id OR r.request_message_id=m.id) AND (other.state!='completed' OR other.completed_at IS NULL OR other.completed_at>=?)) ORDER BY m.completed_at LIMIT ?`).all(cutoff,cutoff,RETENTION.batch);
 for(const {id} of candidates){ids.add(id);for(const r of db.prepare('SELECT message_id,request_message_id FROM replies WHERE message_id=? OR request_message_id=?').all(id,id)){ids.add(r.message_id);ids.add(r.request_message_id);}}
 if(ids.size){
  const args=[...ids],marks=args.map(()=>'?').join(',');
  db.prepare(`DELETE FROM replies WHERE message_id IN (${marks}) OR request_message_id IN (${marks})`).run(...args,...args);
  for(const table of ['requests','outbox','audit'])db.prepare(`DELETE FROM ${table} WHERE message_id IN (${marks})`).run(...args);
  db.prepare(`DELETE FROM messages WHERE id IN (${marks})`).run(...args);
 }
 const workers=db.prepare(`DELETE FROM workers WHERE id IN (SELECT id FROM workers WHERE state IN ('completed','failed','unsupported') AND acknowledged_at<? AND (cleanup_state IN ('retained','archived','deleted') OR cleanup_action='none' AND cleanup_state='pending') LIMIT ?)`).run(cutoff,RETENTION.batch).changes;
 const dead=db.prepare(`SELECT e.id FROM endpoints e WHERE e.active=0 AND e.last_seen<?
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.sender=e.id OR m.recipient=e.id)
 AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.endpoint=e.id OR w.owner=e.id)
 AND NOT EXISTS(SELECT 1 FROM pauses p WHERE p.recipient=e.id)
 AND NOT EXISTS(SELECT 1 FROM wake_dispatch w WHERE w.recipient=e.id AND w.state IN ('reserved','uncertain'))
 AND NOT EXISTS(SELECT 1 FROM attendance a WHERE a.recipient=e.id AND a.deadline>?) LIMIT ?`).all(now-RETENTION.inactiveDays*day,now,RETENTION.batch);
 for(const {id} of dead){
  for(const table of ['attendance','wake_waiters','wake_dispatch'])db.prepare(`DELETE FROM ${table} WHERE recipient=?`).run(id);
  db.prepare('DELETE FROM credentials WHERE endpoint=?').run(id);db.prepare('DELETE FROM harness_sessions WHERE endpoint=?').run(id);
  db.prepare('DELETE FROM directory_audit WHERE endpoint=?').run(id);db.prepare('DELETE FROM endpoints WHERE id=?').run(id);
  for(const prefix of ['waiter_last_seen:','last_notification:'])db.prepare('DELETE FROM metadata WHERE key=?').run(prefix+id);store.recipients.delete(id);
 }
 db.prepare('DELETE FROM harness_scans WHERE deadline<=?').run(now);
 const harnesses=db.prepare(`DELETE FROM harnesses WHERE id IN (SELECT h.id FROM harnesses h WHERE h.active=0 AND NOT EXISTS(SELECT 1 FROM harness_sessions s WHERE s.harness=h.id) AND NOT EXISTS(SELECT 1 FROM directory_audit a WHERE a.endpoint=h.id AND a.at>=?) AND NOT EXISTS(SELECT 1 FROM harness_scans s WHERE s.harness=h.id) LIMIT ?)`).run(cutoff,RETENTION.batch).changes;
 const result={at:now,messages:ids.size,workers,sessions:dead.length,harnesses};
 db.prepare("INSERT OR REPLACE INTO metadata VALUES('last_retention',?)").run(JSON.stringify(result));return result;
}
