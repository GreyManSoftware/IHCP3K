#!/usr/bin/env node
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function connect({url,tokenFile}) {
  const target=new URL(url);
  if(target.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.username || target.password)throw Error('LOOPBACK_REQUIRED');
  const token=fs.readFileSync(tokenFile,'utf8').trim();
  const client=new Client({name:'ihcp3k-local-client',version:'0.3.0'});
  try {await client.connect(new StreamableHTTPClientTransport(target,{requestInit:{headers:{Authorization:`Bearer ${token}`}}}),{timeout:10000});}
  catch {await client.close().catch(()=>{});throw Error('MCP_CONNECT_FAILED');}
  return client;
}
export async function call(client,name,args) {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:40000});
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
  const [url,tokenFile,tool,inputFile]=args;
  if(!url || !tokenFile || !tool)throw Error('Usage: client <loopback-url> <token-file> <tool> [input-json-file; otherwise stdin]');
  const input=JSON.parse(fs.readFileSync(inputFile||0,'utf8'));
  const client=await connect({url,tokenFile});
  try{process.stdout.write(JSON.stringify(await (tool==='exchange'?exchange(client,input):call(client,tool,input)))+'\n');}
  finally{await client.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(String(e.message).replace(/Bearer\s+\S+/gi,'Bearer [redacted]'));process.exitCode=1;});
