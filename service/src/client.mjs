#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

export function requireNode(version=process.versions.node) {
  const [major,minor]=version.split('.').map(Number);
  if(!(major>24||major===24&&minor>=15))throw Error('NODE_24_15_REQUIRED');
}
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// The selected private manifest is the trust root, not a general command launcher.
// Hashes detect replacement/corruption; they do not defend against the same OS user.
export function readRuntime(runtimeFile) {
  requireNode();
  const file=path.resolve(runtimeFile),dir=path.dirname(file),runtime=readJSON(file);
  if(runtime.transport!=='stdio'||runtime.version!=='1.4.0'||runtime.schema_version!==6||runtime.private_dir!==dir||
    !/^[a-f0-9-]{36}$/.test(runtime.service_id??''))throw Error('INVALID_STDIO_RUNTIME');
  const expected={database:path.join(dir,'mail.db'),service_config:path.join(dir,'service.json'),bundle:path.join(dir,'bundles','stdio.mjs'),client_bundle:path.join(dir,'bundles','client.mjs')};
  for(const [key,value] of Object.entries(expected))if(runtime[key]!==value)throw Error('RUNTIME_PATH_MISMATCH');
  for(const entry of [dir,file,path.join(dir,'bundles'),runtime.bundle,runtime.client_bundle,runtime.service_config]) {
    if(fs.lstatSync(entry).isSymbolicLink()||fs.realpathSync(entry)!==path.resolve(entry))throw Error('RUNTIME_LINK_NOT_ALLOWED');
  }
  if(digest(runtime.bundle)!==runtime.bundle_sha256||digest(runtime.client_bundle)!==runtime.client_sha256)throw Error('RUNTIME_BUNDLE_MISMATCH');
  const config=readJSON(runtime.service_config);
  if(config.service_id!==runtime.service_id||config.mode!=='live'||config.synthetic!==false)throw Error('SERVICE_IDENTITY_MISMATCH');
  return runtime;
}
export async function verifyDatabase(runtime) {
  if(!fs.existsSync(runtime.database))throw Error('RUNTIME_DATABASE_MISSING');
  if(fs.lstatSync(runtime.database).isSymbolicLink()||fs.realpathSync(runtime.database)!==runtime.database)throw Error('RUNTIME_LINK_NOT_ALLOWED');
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(runtime.database,{readOnly:true});
  try {
    if(db.prepare('PRAGMA user_version').get().user_version!==6)throw Error('RUNTIME_SCHEMA_MISMATCH');
    if(db.prepare("SELECT value FROM metadata WHERE key='writer_version'").get()?.value!=='6')throw Error('RUNTIME_WRITER_MISMATCH');
    if(db.prepare("SELECT value FROM metadata WHERE key='service_id'").get()?.value!==runtime.service_id)throw Error('SERVICE_IDENTITY_MISMATCH');
  } finally {db.close();}
}
export async function connect({url,runtimeFile,tokenFile}) {
  if(Boolean(url)===Boolean(runtimeFile))throw Error('ONE_TRANSPORT_REQUIRED');
  let transport;
  if(runtimeFile) {
    const runtime=readRuntime(runtimeFile);
    if(runtime.initialized!==false||fs.existsSync(runtime.database))await verifyDatabase(runtime);
    // Only file paths enter argv. Credentials themselves never do. The SDK owns
    // child lifetime, including bounded termination when the client closes.
    transport=new StdioClientTransport({command:process.execPath,args:[runtime.bundle,path.resolve(runtimeFile),path.resolve(tokenFile)],cwd:runtime.private_dir,stderr:'pipe',env:{NODE_OPTIONS:'',NODE_PATH:''}});
    transport.stderr?.resume();
  } else {
    const target=new URL(url);
    if(target.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.username || target.password)throw Error('LOOPBACK_REQUIRED');
    const token=fs.readFileSync(tokenFile,'utf8').trim();
    transport=new StreamableHTTPClientTransport(target,{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
  }
  const client=new Client({name:'ihcp3k-local-client',version:'1.4.0'});
  try {await client.connect(transport,{timeout:10000});}
  catch {await client.close().catch(()=>{});throw Error('MCP_CONNECT_FAILED');}
  return client;
}
export async function call(client,name,args) {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:name==='session.exchange'?90000:40000});
  if(result.isError){
    let code='MCP_TOOL_FAILED';
    try {code=JSON.parse(result.content[0].text).error||code;}catch{}
    throw Error(code);
  }
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
// One bounded request/receive window. The inbox may also contain unrelated mail;
// callers must inspect the returned messages, not assume the first is a reply.
export async function exchange(client,{inbox,handler_id,timeout_ms=25000,...message}) {
  if(!Number.isInteger(timeout_ms)||timeout_ms<0||timeout_ms>25000)throw Error('INVALID_TIMEOUT');
  const lease=await call(client,'mail.attend',{recipient:inbox,handler_id,lease_s:Math.ceil(timeout_ms/1000)+5});
  let response,failure;
  try {
    const sent=await call(client,'mail.send',message);
    const received=await call(client,'mail.wait',{recipient:inbox,attendance_token:lease.attendance_token,timeout_ms});
    response={sent,...received,notification_already_dispatched:lease.notification_already_dispatched};
  } catch(error) {failure=error;}
  try {await call(client,'mail.unattend',{recipient:inbox,attendance_token:lease.attendance_token});}
  catch {if(response)response.attendance_release='unconfirmed; bounded lease expires automatically';}
  if(failure)throw failure;
  return response;
}
export async function main(args=process.argv.slice(2)) {
  const [location,tokenFile,tool,inputFile]=args;
  if(!location || !tokenFile || !tool)throw Error('Usage: client <loopback-url|runtime.json> <token-file> <tool> [input-json-file; otherwise stdin]');
  const input=JSON.parse(fs.readFileSync(inputFile||0,'utf8'));
  const client=await connect({...(/^[a-z]+:\/\//i.test(location)?{url:location}:{runtimeFile:location}),tokenFile});
  try{process.stdout.write(JSON.stringify(await (tool==='exchange'?exchange(client,input):call(client,tool,input)))+'\n');}
  finally{await client.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(String(e.message).replace(/Bearer\s+\S+/gi,'Bearer [redacted]'));process.exitCode=1;});
