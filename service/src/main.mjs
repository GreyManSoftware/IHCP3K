import { readFileSync } from 'node:fs';
import { Store } from './store.mjs';
import { createService } from './server.mjs';
import { validateConfig } from './config.mjs';

const mode=process.env.INTEROP_MODE;
const config=validateConfig(JSON.parse(readFileSync(process.env.INTEROP_CONFIG||'/fixture/config.json','utf8')),mode);
const store=new Store(process.env.INTEROP_DB||`/data/${mode}.db`,{recipients:config.recipients});
const app=createService(store,{principals:config.principals,mode,serviceId:config.service_id??null});
store.maintain();
const maintenance=setInterval(()=>{try{store.maintain();}catch{console.error('maintenance_failed');}},60000);
await app.listen({port:Number(process.env.PORT||43187),host:'0.0.0.0'});
console.log(JSON.stringify({status:mode,port:Number(process.env.PORT||43187),sqlite:store.sqliteVersion}));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(maintenance);await app.close();store.close();}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
