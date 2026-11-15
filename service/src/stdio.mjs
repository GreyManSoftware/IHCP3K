#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {SharedStore} from './shared-store.mjs';
import {createToolServer} from './server.mjs';
import {validateConfig} from './config.mjs';
import {WorkerManager} from './worker-manager.mjs';
import {Notifications} from './notifications.mjs';

export async function startStdio(runtimeFile,tokenFile){
 process.umask(0o077);
 const runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
 if(runtime.transport!=='stdio'||!path.isAbsolute(runtime.database)||!path.isAbsolute(runtime.service_config))throw Error('INVALID_STDIO_RUNTIME');
 const workingDirectory=runtime.working_directory??runtime.private_dir;
 if(!path.isAbsolute(workingDirectory)||!fs.statSync(workingDirectory).isDirectory())throw Error('INVALID_WORKING_DIRECTORY');
 const config=validateConfig(JSON.parse(fs.readFileSync(runtime.service_config,'utf8')),'live');
 const store=new SharedStore(runtime.database,{recipients:config.recipients});
 try{store.transaction(()=>{
   const saved=store.db.prepare("SELECT value FROM metadata WHERE key='service_id'").get();
   if(saved&&saved.value!==config.service_id)throw Error('SERVICE_IDENTITY_MISMATCH');
   if(!saved)store.db.prepare("INSERT INTO metadata VALUES('service_id',?)").run(config.service_id);
 });}catch(e){store.close();throw e;}
 let secret;try{secret=fs.readFileSync(tokenFile,'utf8').trim();}catch(e){store.close();throw e;}
 const eq=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
 const authenticate=()=>config.principals.find(p=>eq(p.token,secret))??store.directory.authenticate(secret)??store.harnesses.authenticate(secret);
 const principal=authenticate();if(!principal){store.close();throw Error('UNAUTHORIZED');}
 store.workers=new WorkerManager(store,runtime.workers??{});
 store.workers.defaultDirectory=path.dirname(runtime.private_dir??path.dirname(runtimeFile));
 const notifications=new Notifications(store,Object.fromEntries(Object.entries(runtime.notifications??{}).map(([endpoint,adapter])=>[endpoint,{...adapter,cwd:workingDirectory}])));
 store.notifications=notifications;
 const abort=new AbortController();
 const server=createToolServer(store,store.directory,principal,abort,authenticate);
 try{store.maintain();}catch{console.error('startup_maintenance_deferred');}
 const maintain=()=>{try{store.maintain();void store.workers.maintain().catch(()=>console.error('worker_maintenance_failed'));}catch{console.error('maintenance_failed');}};
 const timer=setInterval(maintain,60000);timer.unref();
 const notifier=setInterval(()=>{void notifications.tick().catch(()=>console.error('notification_failed'));},1000);notifier.unref();
 let closed=false;
 const stop=async()=>{if(closed)return;closed=true;clearInterval(timer);clearInterval(notifier);abort.abort();await Promise.allSettled([notifications.stop(),store.workers.stop()]);await server.close().catch(()=>{});store.close();};
 const cli=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
 const shutdown=()=>{void stop().then(()=>{if(cli)process.exit(0);},()=>{console.error('shutdown_failed');if(cli)process.exit(1);});};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);process.stdin.once('end',shutdown);
 try{await server.connect(new StdioServerTransport());}catch(e){await stop();throw e;}
 void store.workers.maintain().catch(()=>console.error('worker_maintenance_failed'));
 return {stop,store,server};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startStdio(...process.argv.slice(2)).catch(e=>{console.error(e?.code??e?.message??'STDIO_START_FAILED');process.exitCode=1;});
