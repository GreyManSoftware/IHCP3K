import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';

export const repository='https://api.github.com/repos/GreyManSoftware/IHCP3K';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function compareVersions(a,b){
 const parse=v=>{if(!/^\d+\.\d+\.\d+$/.test(v))throw Error('INVALID_STABLE_VERSION');return v.split('.').map(Number);};
 const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;
}
export async function download(url,{fetchImpl=fetch,maxBytes=32*1024*1024}={}){
 const u=new URL(url);
 if(u.protocol!=='https:'||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname)||u.username||u.password)throw Error('UNTRUSTED_RELEASE_URL');
 const r=await fetchImpl(url,{signal:AbortSignal.timeout(30000),redirect:'manual',headers:{'User-Agent':'IHCP3K-updater','Accept':'application/vnd.github+json'}});
 if([301,302,303,307,308].includes(r.status)){
  const next=new URL(r.headers.get('location'),url);await r.body?.cancel();
  // One GitHub asset redirect; reject chains rather than following arbitrary hosts.
  return download(next.href,{maxBytes,fetchImpl:async(...args)=>{const v=await fetchImpl(...args);if(v.status>=300&&v.status<400){await v.body?.cancel();throw Error('RELEASE_REDIRECT_CHAIN');}return v;}});
 }
 if(!r.ok)throw Error('RELEASE_FETCH_FAILED_'+r.status);
 let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>maxBytes)throw Error('RELEASE_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);
}
export async function releaseInfo(tag='latest',options){
 if(tag!=='latest'&&!/^\d+\.\d+\.\d+$/.test(tag))throw Error('INVALID_STABLE_VERSION');
 const r=JSON.parse(await download(repository+'/releases/'+(tag==='latest'?'latest':'tags/v'+tag),{...options,maxBytes:1024*1024}));
 if(r.draft||r.prerelease||!/^v\d+\.\d+\.\d+$/.test(r.tag_name))throw Error('STABLE_RELEASE_REQUIRED');
 const version=r.tag_name.slice(1),name='IHCP3K-'+version+'.zip';
 if(tag!=='latest'&&tag!==version)throw Error('RELEASE_VERSION_MISMATCH');
 const asset=r.assets?.find(a=>a.name===name),sum=r.assets?.find(a=>a.name===name+'.sha256');
 const prefix='https://github.com/GreyManSoftware/IHCP3K/releases/download/v'+version+'/';
 if(!asset?.browser_download_url?.startsWith(prefix)||!sum?.browser_download_url?.startsWith(prefix))throw Error('RELEASE_ASSETS_MISSING');
 return {version,name,url:asset.browser_download_url,checksum:sum.browser_download_url,digest:asset.digest};
}
// Only bounded regular-file ZIPs from a checksum-verified official release.
export function unpack(bytes,version){
 const prefix='IHCP3K-'+version+'/',files=new Map(),seen=new Set();let total=0,end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50){end=p;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10)||end+22+bytes.readUInt16LE(end+20)!==bytes.length)throw Error('INVALID_RELEASE_ZIP');
 const count=bytes.readUInt16LE(end+10),central=bytes.readUInt32LE(end+16);let pos=central;
 if(count>5000||central+bytes.readUInt32LE(end+12)!==end)throw Error('INVALID_RELEASE_ZIP');
 for(let i=0;i<count;i++){
  if(bytes.readUInt32LE(pos)!==0x02014b50)throw Error('INVALID_RELEASE_ZIP');
  const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),size=bytes.readUInt32LE(pos+24),packed=bytes.readUInt32LE(pos+20),len=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42),mode=bytes.readUInt32LE(pos+38)>>>16;
  const name=bytes.subarray(pos+46,pos+46+len).toString('utf8');pos+=46+len+extra+comment;
  if(pos>end||(flags&1)||![0,8].includes(method)||(mode&0xf000)===0xa000||!name.startsWith(prefix))throw Error('UNSAFE_RELEASE_ZIP');
  const relative=name.slice(prefix.length);
  if(!relative||relative.endsWith('/'))continue;
  if(relative.split('/').some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))||/[\\:\x00-\x1f]/.test(relative)||seen.has(relative.toLowerCase())||relative.toLowerCase().startsWith('data/')||relative.toLowerCase().startsWith('.git/'))throw Error('UNSAFE_RELEASE_PATH');
  seen.add(relative.toLowerCase());total+=size;if(size>16*1024*1024||total>64*1024*1024)throw Error('RELEASE_TOO_LARGE');
  if(bytes.readUInt32LE(offset)!==0x04034b50)throw Error('INVALID_RELEASE_ZIP');
  const localName=bytes.readUInt16LE(offset+26),start=offset+30+localName+bytes.readUInt16LE(offset+28);
  if(bytes.subarray(offset+30,offset+30+localName).toString('utf8')!==name||start+packed>central)throw Error('INVALID_RELEASE_ZIP');
  const body=method===0?bytes.subarray(start,start+packed):inflateRawSync(bytes.subarray(start,start+packed),{maxOutputLength:Math.max(1,size)});
  if(body.length!==size)throw Error('INVALID_RELEASE_ZIP');files.set(relative,body);
 }
 if(pos!==end)throw Error('INVALID_RELEASE_ZIP');
 const build=JSON.parse(files.get('BUILD.json')??'null');
 if(build?.release_version!==version||build.runtime_version!==version||!/^[0-9a-f]{40}$/.test(build.source_commit??''))throw Error('INVALID_RELEASE_BUILD');
 for(const p of ['service/dist/stdio.mjs','service/dist/client.mjs','adapters/claude-waiter/dist/claude-waiter.mjs'])if(!files.has(p)||hash(files.get(p))!==build.bundles?.[p])throw Error('RELEASE_BUNDLE_MISMATCH');
 for(const p of ['scripts/ihcp.mjs','skills/harness-interop/SKILL.md'])if(!files.has(p))throw Error('INCOMPLETE_RELEASE');
 return {files,build};
}
