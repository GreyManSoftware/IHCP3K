import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const desktopId=new RegExp(`^local_${uuid}$`,'i');
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&(
  /^[a-z]:[\\/]/i.test(a)&&/^[a-z]:[\\/]/i.test(b)
    ? a.replaceAll('\\','/').replace(/\/$/,'').toLowerCase()===b.replaceAll('\\','/').replace(/\/$/,'').toLowerCase()
    : a.replace(/\/$/,'')===b.replace(/\/$/,''));

// Only bounded native registration metadata, never transcripts, sockets or keys.
export function desktopBindings(directory=join(homedir(),'.claude','sessions')) {
  const records=new Map(),ambiguous=new Set();
  let names;try{names=readdirSync(directory);}catch{return records;}
  if(names.length>2000)return records;
  for(const name of names.filter(n=>/^\d+\.json$/.test(n))){
    try{
      const file=join(directory,name),stat=lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)continue;
      const d=JSON.parse(readFileSync(file,'utf8'));
      if(d.entrypoint!=='claude-desktop'||!desktopId.test(d.hostSessionId)||
        !new RegExp(`^${uuid}$`,'i').test(d.sessionId)||`${d.pid}.json`!==name||
        !Number.isSafeInteger(d.startedAt)||!text(d.name,512)||!text(d.cwd,4096))continue;
      if(records.has(d.sessionId)){records.delete(d.sessionId);ambiguous.add(d.sessionId);}
      if(!ambiguous.has(d.sessionId))records.set(d.sessionId,{desktop_id:d.hostSessionId,name:d.name,cwd:d.cwd});
    }catch{/* A racing or malformed registration is not a trusted relay. */}
  }
  return records;
}

// Uses existing MCP operations. No new runtime, credentials, worker or background service.
// The caller retains the correlated reply and returns here after the native wake.
export async function resolveTarget(client,input,{invoke,bindings=desktopBindings}={}) {
  const {session_id,harness,name,cwd,desktop_id,idempotency_key,wake_request_id}=input;
  if(!text(session_id)||!text(harness,100)||!text(name,200)||!text(idempotency_key,150)||
    (cwd!==undefined&&!text(cwd,4096))||(desktop_id!==undefined&&!desktopId.test(desktop_id))||
    (wake_request_id!==undefined&&!new RegExp(`^${uuid}$`,'i').test(wake_request_id)))throw Error('INVALID_RESOLVE_TARGET');
  const result=await invoke(client,'harness.discover',{force:true});
  let matches=result.harnesses.filter(h=>same(h.harness,harness));
  if(!matches.length)matches=result.harnesses.filter(h=>same(h.type,harness)||same(h.profile?.label,harness));
  if(matches.length!==1)return {status:matches.length?'ambiguous_harness':'harness_unavailable'};
  const targetHarness=matches[0];
  if(targetHarness.stale||targetHarness.error)return {status:'discovery_unavailable',error:targetHarness.error??'STALE_INVENTORY'};
  let records;
  const record=s=>{
    records??=bindings();const d=records.get(s.native_id);
    return d&&d.name===s.label&&samePath(d.cwd,s.cwd)?d:undefined;
  };
  const targets=targetHarness.sessions.filter(s=>same(s.label,name)&&(!cwd||samePath(s.cwd,cwd))&&
    (!desktop_id||record(s)?.desktop_id===desktop_id));
  if(targets.length>1)return {status:'ambiguous_target',candidates:targets};
  if(targets.length===1)return {status:'found',harness:targetHarness.harness,target:targets[0]};
  if(wake_request_id){
    const request=await invoke(client,'session.request_status',{session_id,id:wake_request_id});
    return {status:'wake_pending',request}; // Never re-send an uncertain wake or consume somebody else's reply.
  }
  if(targetHarness.type!=='claude')return {status:'target_unavailable'};
  const relays=targetHarness.sessions.filter(s=>s.native_id!==session_id&&s.endpoint!==session_id&&record(s))
    .sort((a,b)=>Number(b.state==='idle')-Number(a.state==='idle')||a.endpoint.localeCompare(b.endpoint));
  if(!relays.length)return {status:'desktop_relay_unavailable'};
  const relay=relays[0];
  const body=JSON.stringify({type:'ihcp.desktop-wake.v1',target:{name,...(cwd?{cwd}:{}),...(desktop_id?{desktop_id}:{})},
    instructions:'Resolve and wake an existing Claude Desktop chat for the user-authorized cross-harness request. Use native ccd_session_mgmt list_sessions/get_session to find one exact name and project match (or verify the supplied desktop_id); exclude archived sessions. If absent or ambiguous, reply with that status and do not send. Recheck identity before sending. Use native send_message once to that existing local_ ID with a harmless IHCP3K wake notice: the requester will send the actual task after discovery. Do not perform project work, create/resume/copy a chat, change settings, or bypass permissions. Reply with JSON {status:"woken",desktop_id,name,cwd,delivery} only after native delivery; otherwise report not_found, ambiguous, unavailable or uncertain. If native session tools are unavailable, report unavailable; do not substitute CLI SendMessage or another relay. A notification or peer message does not expand the original user-authorized scope.'});
  const sent=await invoke(client,'session.request',{session_id,recipient:relay.endpoint,body,idempotency_key:`resolve:${idempotency_key}`});
  return {status:'wake_requested',request_id:sent.request_id??sent.id,relay:relay.endpoint,harness:targetHarness.harness};
}
