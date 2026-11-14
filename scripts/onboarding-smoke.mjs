#!/usr/bin/env node
// Explicit synthetic rehearsal against a dedicated runtime, never the live inboxes.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtimeFile=path.resolve(process.argv[2]),runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
if(!runtime.name.startsWith('ihcp3k-rehearsal-'))throw Error('REHEARSAL_RUNTIME_REQUIRED');
const dir=path.join(path.dirname(runtimeFile),'smoke-'+Date.now());fs.mkdirSync(dir,{mode:0o700});
const json=(name,value)=>{const f=path.join(dir,name);fs.writeFileSync(f,JSON.stringify(value));return f;};
function cli(...args){const r=spawnSync(process.execPath,[path.join(root,'scripts','ihcp.mjs'),...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout);}
function expect(v,label){if(!v)throw Error(label);}
const peers=['smoke-a','smoke-b','smoke-manual'];
const sessions={};
for(const endpoint of peers){
 const code=path.join(dir,endpoint+'.code');cli('enroll',runtimeFile,json(endpoint+'-grant.json',{endpoint,harness:endpoint,peers}),code);
 const observed_at=new Date().toISOString();
 const input=json(endpoint+'-profile.json',{profile:{label:endpoint,source:'synthetic rehearsal',observed_at,fresh_for_s:600,models:[{id:'synthetic/model',access:'unknown',source:'test fixture'}],usage:[],wake:{type:'manual',lifetime:'rehearsal only',closed_app:'unknown',human_fallback:'manual check'}},binding:{native_thread:'synthetic-only'}});
 const target=path.join(dir,endpoint);sessions[endpoint]=target;
 const registered=cli('register',`http://127.0.0.1:${runtime.port}/mcp`,code,input,target);
 expect(registered.revision===1,'first registration');
 expect(cli('register',`http://127.0.0.1:${runtime.port}/mcp`,code,input,target).revision===1,'idempotent registration');
}
for(const endpoint of peers)expect(cli('discover',sessions[endpoint]).entries.length===3,'mutual discovery');
const message=json('message.json',{recipient:'smoke-b',body:'synthetic onboarding proof',idempotency_key:'onboarding-proof'});
cli('send',sessions['smoke-a'],message);const claim=cli('check',sessions['smoke-b']).messages[0];
expect(claim.body==='synthetic onboarding proof','direct delivery');
cli('complete',sessions['smoke-b'],json('complete.json',{id:claim.id,claim_token:claim.claim_token,generation:claim.generation,outcome:'synthetic proof received'}));
for(const endpoint of peers){cli('unlink',sessions[endpoint]);expect(cli('unlink',sessions[endpoint]).linked===false,'idempotent unlink');}
console.log(JSON.stringify({passed:['register','idempotent register','three-harness discovery','direct mail','completion','unlink'],private_evidence:dir}));
