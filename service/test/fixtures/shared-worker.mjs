import {SharedStore} from '../../src/shared-store.mjs';
const s=new SharedStore(process.argv[2],{recipients:['a']});
if(process.argv[3]==='crash'){
 s.db.exec('BEGIN IMMEDIATE');
 s.db.prepare("INSERT INTO metadata VALUES('uncommitted-crash','must roll back')").run();
 process.exit(17);
}
const p={id:'test',permissions:['send','claim'],recipients:['a']};
const sent=s.send(p,{recipient:'a',body:'same',idempotency_key:'concurrent'}).id;
const claims=s.claim(p,{recipient:'a',handler_id:'worker'});
process.send({sent,claims});s.close();
