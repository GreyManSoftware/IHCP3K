import { readFileSync } from 'node:fs';
import { Store } from './store.mjs';
import { createService } from './server.mjs';

if (process.env.INTEROP_MODE!=='synthetic') throw Error('Phase 2 requires INTEROP_MODE=synthetic');
const config=JSON.parse(readFileSync(process.env.INTEROP_CONFIG||'/fixture/config.json','utf8'));
if (config.synthetic!==true || config.recipients.some(r=>!r.startsWith('test-'))) throw Error('Synthetic recipients required');
const store=new Store(process.env.INTEROP_DB||'/data/synthetic.db',{recipients:config.recipients});
const app=createService(store,{principals:config.principals,allowedHosts:['127.0.0.1','localhost','host.docker.internal','interop-phase2-service']});
store.maintain();
const maintenance=setInterval(()=>{try{store.maintain();}catch{console.error('maintenance_failed');}},60000);
await app.listen({port:Number(process.env.PORT||43187),host:'0.0.0.0'});
console.log(JSON.stringify({status:'synthetic-only',port:Number(process.env.PORT||43187),sqlite:store.sqliteVersion}));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(maintenance);await app.close();store.close();}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
