#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [target,...harnesses]=process.argv.slice(2);
try {
  if(!target || harnesses.length<1 || new Set(harnesses).size!==harnesses.length || harnesses.some(x=>!/^[a-z][a-z0-9-]{0,39}$/.test(x)))throw Error('Usage: init-runtime <new private directory> <harness-name> [more harnesses]');
  const dir=path.resolve(target);
  // No overwrite, automatic rotation or edits to harness settings.
  fs.mkdirSync(dir,{mode:0o700});
  if(process.platform==='win32'){
    const who=spawnSync('whoami',[],{encoding:'utf8',windowsHide:true});
    if(who.status!==0)throw Error('PRIVATE_ACL_IDENTITY_FAILED');
    // Set the root ACL before creating files, so they inherit it correctly.
    const acl=spawnSync('icacls',[dir,'/inheritance:r','/grant:r',who.stdout.trim()+':(OI)(CI)F','SYSTEM:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
    if(acl.status!==0)throw Error('PRIVATE_ACL_FAILED');
  }
  fs.mkdirSync(path.join(dir,'tokens'),{mode:0o700});
  const recipients=harnesses.map(x=>x+'-pa'),config={mode:'live',synthetic:false,recipients,principals:[]};
  function principal(id,scopes){
    const token=randomBytes(32).toString('base64url');
    fs.writeFileSync(path.join(dir,'tokens',id+'.tok'),token+'\n',{flag:'wx',mode:0o600});
    config.principals.push({id,token,permissions:Object.keys(scopes),scopes});
  }
  for(const h of harnesses){
    principal(h+'-pa',{send:recipients,claim:[h+'-pa'],status:[h+'-pa']});
    principal(h+'-sender',{send:recipients});
    principal(h+'-waiter',{wake:[h+'-pa'],status:[h+'-pa']});
  }
  principal('admin',{admin:recipients,status:recipients});
  fs.writeFileSync(path.join(dir,'service.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(dir,'runtime.json'),JSON.stringify({name:'ihcp3k-live',port:43188,data_volume:'ihcp3k-live-data',backup_volume:'ihcp3k-backups',service_config:path.join(dir,'service.json')},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(`Created private runtime for ${harnesses.length} harness(es). No credentials printed; no harness settings changed.`);
} catch(error){console.error(error.message);process.exitCode=1;}
