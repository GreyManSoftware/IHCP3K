#!/usr/bin/env node
import fs from 'node:fs';
import {enqueue} from './native-queue.mjs';
import {connect,call} from '../service/dist/client.mjs';

const [configFile]=process.argv.slice(2);
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
if(!config.cli || !/^[a-f0-9-]{36}$/.test(config.thread) || !config.recipient)throw Error('INVALID_BRIDGE_CONFIG');
let stopping=false,client,backoff=1000;
process.on('SIGTERM',()=>{stopping=true;void client?.close();});
process.on('SIGINT',()=>{stopping=true;void client?.close();});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
while(!stopping){
  try {
    client=await connect({url:config.url,tokenFile:config.token_file});backoff=1000;
    while(!stopping){
      const waited=await call(client,'wake.wait',{recipient:config.recipient,timeout_ms:25000});
      if(stopping)break;
      if(waited.status==='pending'){
        const lease=await call(client,'wake.reserve',{recipient:config.recipient});
        if(lease.reserved){
          const result=await enqueue(config);
          try{await call(client,'wake.record',{recipient:config.recipient,generation:lease.generation,dispatch_token:lease.dispatch_token,result});}
          catch(e){if(e.message!=='STALE_WAKE')throw e;}
          console.log(JSON.stringify({at:new Date().toISOString(),recipient:config.recipient,result}));
        }
      }
      // Pauses can return immediately; never spin even with a misbehaving service.
      await delay(2000);
    }
  } catch {if(!stopping)console.error(JSON.stringify({at:new Date().toISOString(),event:'bridge_disconnected',retry_ms:backoff}));}
  finally{await client?.close().catch(()=>{});client=undefined;}
  if(!stopping){await delay(backoff);backoff=Math.min(backoff*2,30000);}
}
