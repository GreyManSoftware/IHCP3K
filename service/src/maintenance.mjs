#!/usr/bin/env node
import fs from 'node:fs';
import {snapshot,restore} from './backup.mjs';
import {importLegacy} from './legacy-import.mjs';
import {Store} from './store.mjs';
const [action,source,destination]=process.argv.slice(2);
try {
  if(action==='backup'){
    const result=await snapshot(source,destination);
    fs.writeFileSync(destination+'.json',JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(result));
  } else if(action==='restore'){
    const config=JSON.parse(fs.readFileSync(process.env.INTEROP_CONFIG,'utf8'));
    console.log(JSON.stringify(restore(source,destination,{...JSON.parse(fs.readFileSync(source+'.json','utf8')),recipients:config.recipients})));
  } else if(action==='import'){
    const config=JSON.parse(fs.readFileSync(process.env.INTEROP_CONFIG,'utf8'));
    const store=new Store(destination,{recipients:config.recipients});
    try{console.log(JSON.stringify(importLegacy(store,JSON.parse(fs.readFileSync(source,'utf8')))));}finally{store.close();}
  } else throw Error('Usage: maintenance backup|restore|import <source> <destination>');
} catch(error){console.error(error.message);process.exitCode=1;}
