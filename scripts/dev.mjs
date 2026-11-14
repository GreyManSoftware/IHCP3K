#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const image='node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7';
const name='ihcp3k-demo';
function docker(args,{capture=false}={}) {
  const result=spawnSync('docker',args,{encoding:'utf8',stdio:capture?'pipe':'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`Docker exited ${result.status}${capture?': '+result.stderr.trim():''}`);
  return result.stdout?.trim();
}
function tooling(relative,volume,command) {
  docker(['run','--rm','--cpus','2','--mount',`type=bind,source=${path.join(root,relative)},target=/app`,'--mount',`type=volume,source=${volume},target=/app/node_modules`,'--mount','type=volume,source=ihcp3k-npm-cache,target=/root/.npm','-w','/app',image,'sh','-c',command]);
}
function prepare() {
  // Docker cannot create nested volume mountpoints under a read-only source bind.
  for(const relative of ['service','adapters/claude-waiter'])fs.mkdirSync(path.join(root,relative,'node_modules'),{recursive:true});
  tooling('service','ihcp3k-service-deps','npm ci --ignore-scripts --no-audit --no-fund');
  tooling('adapters/claude-waiter','ihcp3k-waiter-deps','npm ci --no-audit --no-fund && npm run build');
  docker(['run','--rm','--cpus','2','--mount',`type=bind,source=${root},target=/repo`,'--mount','type=volume,source=ihcp3k-service-deps,target=/repo/service/node_modules','--mount','type=volume,source=ihcp3k-waiter-deps,target=/repo/adapters/claude-waiter/node_modules','-w','/repo',image,'./adapters/claude-waiter/node_modules/esbuild/bin/esbuild','service/src/client.mjs','--bundle','--platform=node','--format=esm','--packages=bundle','--outfile=service/dist/client.mjs']);
}
const action=process.argv[2]||'status';
try {
  if(action==='prepare')prepare();
  else if(action==='test') {
    const lockPath=process.env.IHCP3K_TEST_LOCK||path.join(root,'.local','fullrun.lock');
    if(!process.env.IHCP3K_TEST_LOCK)fs.mkdirSync(path.dirname(lockPath),{recursive:true});
    let fd;
    try {
      fd=fs.openSync(lockPath,'wx');fs.writeFileSync(fd,`IHCP3K tests pid=${process.pid}\n`);
      prepare();
      tooling('service','ihcp3k-service-deps','npm test');
      tooling('adapters/claude-waiter','ihcp3k-waiter-deps','npm test');
      docker(['run','--rm','--cpus','2','--mount',`type=bind,source=${path.join(root,'scripts')},target=/scripts,readonly`,image,'node','--test','/scripts/native-queue.test.mjs']);
    } finally {if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lockPath);}}
  } else if(action==='start') {
    fs.mkdirSync(path.join(root,'service','node_modules'),{recursive:true});
    docker(['run','--rm','--cpus','1','--mount','type=volume,source=ihcp3k-demo-data,target=/data',image,'chown','node:node','/data']);
    docker(['run','-d','--rm','--name',name,'--label','org.ihcp3k.kind=synthetic','--cpus','2','--memory','256m','--pids-limit','64','--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','-p','127.0.0.1:43187:43187','--mount',`type=bind,source=${path.join(root,'service')},target=/app,readonly`,'--mount','type=volume,source=ihcp3k-service-deps,target=/app/node_modules,readonly','--mount','type=volume,source=ihcp3k-demo-data,target=/data','-e','INTEROP_MODE=synthetic','-e','INTEROP_CONFIG=/app/fixture/config.json','-w','/app',image,'node','src/main.mjs']);
  } else if(action==='stop') {
    const label=docker(['inspect',name,'--format','{{index .Config.Labels "org.ihcp3k.kind"}}'],{capture:true});
    if(label!=='synthetic')throw Error('Refusing to stop an unlabelled container');
    docker(['stop',name]);
  } else if(action==='status')docker(['ps','-a','--filter',`name=^/${name}$`,'--format','{{.Names}} {{.Status}} {{.Ports}}']);
  else throw Error('Usage: node scripts/dev.mjs prepare|test|start|stop|status');
} catch(error) {console.error(error.message);process.exitCode=1;}
