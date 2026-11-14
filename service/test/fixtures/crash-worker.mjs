import { Store } from '../../src/store.mjs';
const store=new Store(process.argv[2],{recipients:['a','b']});
const sender={id:'sender',permissions:['send'],recipients:['a','b']};
store.send(sender,{recipient:'a',body:'synthetic body',idempotency_key:'key'});
store.claim({id:'pa',permissions:['claim'],recipients:['a']},{recipient:'a',handler_id:'worker'});
store.send(sender,{recipient:'a',body:'synthetic body',idempotency_key:'pending'});
// Keep the actual owner object reachable, as the service's timer does, until killed.
// Merely keeping IPC alive permits SQLite handles to be garbage-collected.
process.on('message',()=>process.send({open:store.db.isOpen}));
process.send('committed');
