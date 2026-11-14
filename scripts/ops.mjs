#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const image='node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7';
const [runtimeFile,action,arg]=process.argv.slice(2);
function docker(args,capture=false){const r=spawnSync('docker',args,{encoding:'utf8',stdio:capture?'pipe':'inherit',windowsHide:true});if(r.error||r.status!==0)throw Error('Docker operation failed'+(capture?': '+r.stderr.trim():''));return r.stdout?.trim();}
try {
  if(!runtimeFile)throw Error('Usage: ops <runtime.json> start|stop|status|backup|restore|import [backup basename or manifest file]');
  const cfg=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
  for(const field of ['name','data_volume','backup_volume'])if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(cfg[field]))throw Error('INVALID_RUNTIME_NAME');
  if(!Number.isInteger(cfg.port)||cfg.port<1024||cfg.port>65535||!path.isAbsolute(cfg.service_config))throw Error('INVALID_RUNTIME_CONFIG');
  const database=cfg.database??'live.db';
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\.db$/.test(database))throw Error('INVALID_DATABASE_NAME');
  const label=createHash('sha256').update(path.resolve(runtimeFile)).digest('hex');
  const mounts=['--mount',`type=bind,source=${path.join(root,'service')},target=/app,readonly`,'--mount','type=volume,source=ihcp3k-service-deps,target=/app/node_modules,readonly','--mount',`type=volume,source=${cfg.data_volume},target=/data`,'--mount',`type=volume,source=${cfg.backup_volume},target=/backups`,'--mount',`type=bind,source=${cfg.service_config},target=/private/service.json,readonly`];
  const security=['--cpus','2','--memory','256m','--pids-limit','64','--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=16m'];
  const env=['-e','INTEROP_MODE=live','-e','INTEROP_CONFIG=/private/service.json','-e',`INTEROP_DB=/data/${database}`,'-w','/app'];
  if(action==='start'){
    fs.mkdirSync(path.join(root,'service','node_modules'),{recursive:true});
    docker(['run','--rm','--cpus','1','--mount',`type=volume,source=${cfg.data_volume},target=/data`,'--mount',`type=volume,source=${cfg.backup_volume},target=/backups`,image,'chown','node:node','/data','/backups']);
    docker(['run','-d','--rm','--name',cfg.name,'--label',`org.ihcp3k.runtime=${label}`,...security,'-p',`127.0.0.1:${cfg.port}:43187`,...mounts,...env,image,'node','src/main.mjs']);
  } else if(action==='stop'){
    if(docker(['inspect',cfg.name,'--format','{{index .Config.Labels "org.ihcp3k.runtime"}}'],true)!==label)throw Error('CONTAINER_OWNERSHIP_MISMATCH');
    docker(['stop',cfg.name]);
  } else if(action==='status')docker(['ps','-a','--filter',`name=^/${cfg.name}$`,'--format','{{.Names}} {{.Status}} {{.Ports}}']);
  else if(['backup','restore','import'].includes(action)){
    const basename=arg??new Date().toISOString().replace(/[:.]/g,'-')+'.db';
    if(action!=='import' && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}\.db$/.test(basename))throw Error('INVALID_BACKUP_NAME');
    // Restoration never overwrites live.db. Select restored.db explicitly only after review.
    const target=action==='backup'?['/data/'+database,'/backups/'+basename]:action==='restore'?['/backups/'+basename,'/data/restored.db']:['/input/manifest.json','/data/'+database];
    if(action==='import')mounts.push('--mount',`type=bind,source=${path.resolve(arg)},target=/input/manifest.json,readonly`);
    docker(['run','--rm',...security,...mounts,...env,image,'node','src/maintenance.mjs',action,...target]);
  } else throw Error('UNKNOWN_OPERATION');
} catch(error){console.error(error.message);process.exitCode=1;}
