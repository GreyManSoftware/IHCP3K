import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ServiceError } from './store.mjs';
import { Directory } from './directory.mjs';

const recipient=z.string().min(1).max(100);
const claim={id:z.string().uuid(),claim_token:z.string().uuid(),generation:z.number().int().positive()};
const schemas={
  'mail.send':{recipient,kind:z.string().min(1).max(64).default('message'),body:z.string().max(65536),idempotency_key:z.string().min(1).max(200)},
  'mail.claim':{recipient,handler_id:z.string().min(1).max(100),limit:z.number().int().min(1).max(20).default(10),lease_s:z.number().int().min(1).max(300).default(300)},
  'mail.attend':{recipient,handler_id:z.string().min(1).max(100),lease_s:z.number().int().min(1).max(120).default(60)},
  'mail.unattend':{recipient,attendance_token:z.string().uuid()},
  'mail.wait':{recipient,attendance_token:z.string().uuid(),timeout_ms:z.number().int().min(0).max(25000),limit:z.number().int().min(1).max(20).default(10),lease_s:z.number().int().min(1).max(300).default(300)},
  'mail.renew':{...claim,lease_s:z.number().int().min(1).max(300)},
  'mail.complete':{...claim,outcome:z.string().max(4096)},
  'mail.release':{...claim,work_started:z.boolean()},
  'mail.status':{recipient},
  'wake.wait':{recipient,timeout_ms:z.number().int().min(0).max(25000)},
  'wake.reserve':{recipient},
  'wake.record':{recipient,generation:z.number().int().positive(),dispatch_token:z.string().uuid(),result:z.enum(['queued','uncertain'])},
  'control.reset_wake':{recipient,expected_generation:z.number().int().nonnegative(),reason:z.string().min(1).max(4096)},
  'control.pause':{recipient,pause_id:z.string().min(1).max(100),paused:z.boolean()},
  'control.inspect':{recipient,limit:z.number().int().min(1).max(20).default(10)},
  'control.resolve':{id:z.string().uuid(),expected_generation:z.number().int().nonnegative(),action:z.enum(['requeue','abandon']),reason:z.string().min(1).max(4096)}
};
const profile=z.record(z.string(),z.unknown());
Object.assign(schemas,{
  'directory.inspect':{endpoint:recipient},
  'directory.enroll':{endpoint:recipient,harness:recipient,peers:z.array(recipient).max(100),expected_revision:z.number().int().nonnegative().default(0),ttl_s:z.number().int().min(30).max(3600).default(600)},
  'directory.register':{profile,binding:profile.default({}),session_token:z.string(),wake_token:z.string()},
  'directory.refresh':{endpoint:recipient,expected_revision:z.number().int().positive(),profile},
  'directory.discover':{after:z.string().max(100).default(''),limit:z.number().int().min(1).max(100).default(20)},
  'directory.deregister':{endpoint:recipient,expected_revision:z.number().int().positive()}
});
const permissions={'mail.send':'send','mail.claim':'claim','mail.renew':'claim','mail.complete':'claim','mail.release':'claim','mail.status':'status','wake.wait':'wake','control.pause':'admin','control.inspect':'admin','control.resolve':'admin'};
const methods={'mail.send':'send','mail.claim':'claim','mail.renew':'renew','mail.complete':'complete','mail.release':'release','mail.status':'status','wake.wait':'wait','control.pause':'pause','control.inspect':'inspect','control.resolve':'resolve'};
Object.assign(permissions,{'wake.reserve':'wake','wake.record':'wake','control.reset_wake':'admin'});
Object.assign(methods,{'wake.reserve':'reserveWake','wake.record':'recordWake','control.reset_wake':'resetWake'});
Object.assign(permissions,{'mail.attend':'claim','mail.unattend':'claim','mail.wait':'claim'});
Object.assign(methods,{'mail.attend':'attend','mail.unattend':'unattend','mail.wait':'receive'});
Object.assign(permissions,{'directory.enroll':'registry','directory.register':'enroll','directory.refresh':'profile','directory.discover':'discover','directory.deregister':'profile'});
permissions['directory.inspect']='registry';
const directoryMethods={'directory.inspect':'inspect','directory.enroll':'issue','directory.register':'register','directory.refresh':'refresh','directory.discover':'discover','directory.deregister':'deregister'};
function equal(a,b) { const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb); }
function reject(res,code,error) { res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({error})); }

export function createService(store,{principals,allowedHosts=['127.0.0.1','localhost'],allowedOrigins=[],mode='synthetic',serviceId=null}) {
  if (!Array.isArray(principals) || principals.length===0 || principals.some(p=>!p.token || p.token.length<24)) throw Error('Invalid principal configuration');
  const active=new Set();
  const directory=new Directory(store);
  const httpServer=http.createServer(async (req,res)=>{
    const host=req.headers.host;
    if (!host || !allowedHosts.some(h=>host===h || host.startsWith(h+':'))) return reject(res,403,'HOST_REJECTED');
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return reject(res,403,'ORIGIN_REJECTED');
    const auth=req.headers.authorization||'';
    const principal=principals.find(p=>equal(auth,`Bearer ${p.token}`)) ?? (auth.startsWith('Bearer ')?directory.authenticate(auth.slice(7)):null);
    if (!principal) return reject(res,401,'UNAUTHORIZED');
    if (req.url==='/health' && req.method==='GET') {
      res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({status:mode,instance_id:store.instanceId,sqlite:store.sqliteVersion,protocol_version:'0.4.0',service_id:serviceId,owner_lock:!!store.owner}));
    }
    if (req.url!=='/mcp') return reject(res,404,'NOT_FOUND');
    if (req.method!=='POST') {res.setHeader('Allow','POST');return reject(res,405,'METHOD_NOT_ALLOWED');}
    let parsed;
    try {
      if (!(req.headers['content-type']||'').startsWith('application/json')) return reject(res,415,'JSON_REQUIRED');
      const chunks=[];let size=0;
      // A valid 64-KiB body can expand sixfold when JSON escapes control characters.
      for await (const chunk of req) {size+=chunk.length;if(size>512000)return reject(res,413,'REQUEST_TOO_LARGE');chunks.push(chunk);}
      parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {return reject(res,400,'INVALID_JSON');}
    if (active.size>=64) return reject(res,503,'BUSY');
    const server=new McpServer({name:'ihcp3k',version:'0.4.0'});
    const abort=new AbortController();
    for (const [name,inputSchema] of Object.entries(schemas)) {
      if (!principal.permissions.includes(permissions[name]) && !(name==='directory.deregister'&&principal.permissions.includes('registry'))) continue;
      server.registerTool(name,{description:`IHCP3K coordination ${name}`,inputSchema},async (args,extra)=>{
        try {
          const signal=AbortSignal.any([abort.signal,extra.signal]);
          if(!directory.active(principal))throw new ServiceError('REVOKED');
          const value=directoryMethods[name]?await directory[directoryMethods[name]](principal,args):await store[methods[name]](principal,args,signal);
          const structured=Array.isArray(value)?{messages:value}:value;
          return {content:[{type:'text',text:JSON.stringify(structured)}],structuredContent:structured};
        } catch(e) {
          const code=e instanceof ServiceError?e.code:'INTERNAL_ERROR';
          if(code==='INTERNAL_ERROR') console.error(JSON.stringify({code,tool:name,exception:e?.name||'Error',frames:String(e?.stack||'').split('\n').slice(1,5).map(line=>line.replace(/\(.*[/\\]/,'('))}));
          return {isError:true,content:[{type:'text',text:JSON.stringify({error:code})}]};
        }
      });
    }
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    const entry={server,abort};active.add(entry);
    res.on('close',()=>{abort.abort();active.delete(entry);void server.close().catch(()=>{});});
    try {await server.connect(transport);await transport.handleRequest(req,res,parsed);}
    catch {if(!res.headersSent)reject(res,500,'INTERNAL_ERROR');else res.end();}
  });
  httpServer.requestTimeout=30000;
  httpServer.headersTimeout=10000;
  httpServer.maxConnections=128;
  return {
    listen:({port=0,host='127.0.0.1'}={})=>new Promise((resolve,rejectPromise)=>{httpServer.once('error',rejectPromise);httpServer.listen(port,host,()=>resolve(httpServer.address()));}),
    close:async()=>{for(const entry of active){entry.abort.abort();await entry.server.close();}await new Promise(resolve=>{httpServer.close(resolve);httpServer.closeAllConnections();});},
    httpServer
  };
}
