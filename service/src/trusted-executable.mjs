import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ServiceError} from './store.mjs';
const check=(v,c)=>{if(!v)throw new ServiceError(c);};
const packageCache=new Map();
export function validateResolution(config){
 const r=config.executable_resolution;if(r===undefined)return;
 check(r&&Object.keys(r).every(k=>['type','package_family','relative_path'].includes(k))&&r.type==='windows-package','INVALID_EXECUTABLE_RESOLUTION');
 check(typeof r.package_family==='string'&&/^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/.test(r.package_family),'INVALID_PACKAGE_FAMILY');
 check(typeof r.relative_path==='string'&&/^[A-Za-z0-9_./-]+\.exe$/.test(r.relative_path)&&!r.relative_path.startsWith('/')&&r.relative_path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'INVALID_PACKAGE_EXECUTABLE');
}
// The operator pins a package family and relative executable. Never consult PATH,
// session metadata, a peer, or a different package when resolution fails.
export function resolveExecutable(config,{platform=process.platform,queryPackages,exists=fs.existsSync}={}){
 validateResolution(config);const r=config.executable_resolution;if(!r)return config.executable;
 check(platform==='win32','EXECUTABLE_RESOLUTION_PLATFORM_UNSUPPORTED');
 const cacheKey=JSON.stringify(r),cached=packageCache.get(cacheKey);
 if(!queryPackages&&cached&&Date.now()-cached.at<15000&&exists(cached.executable))return cached.executable;
 const query=queryPackages??(()=>{
  const script="$ErrorActionPreference='Stop'; @(Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $env:IHCP_PACKAGE_FAMILY -and $_.Status -eq 'Ok' } | Select-Object PackageFamilyName,InstallLocation) | ConvertTo-Json -Compress";
  const systemRoot=process.env.SystemRoot;
  check(typeof systemRoot==='string'&&path.win32.isAbsolute(systemRoot),'EXECUTABLE_PACKAGE_QUERY_FAILED');
  const powershell=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:1048576,env:{...process.env,IHCP_PACKAGE_FAMILY:r.package_family}});
  check(!result.error&&result.status===0,'EXECUTABLE_PACKAGE_QUERY_FAILED');
  try{const value=JSON.parse(result.stdout||'[]');return Array.isArray(value)?value:[value];}catch{throw new ServiceError('EXECUTABLE_PACKAGE_QUERY_FAILED');}
 });
 const packages=query().filter(p=>p.PackageFamilyName===r.package_family&&typeof p.InstallLocation==='string'&&path.win32.isAbsolute(p.InstallLocation));
 check(packages.length===1,'EXECUTABLE_PACKAGE_NOT_UNIQUE');
 const root=path.win32.resolve(packages[0].InstallLocation),exe=path.win32.resolve(root,...r.relative_path.split('/'));
 check(exe.toLowerCase().startsWith(root.toLowerCase()+'\\')&&exists(exe),'EXECUTABLE_PACKAGE_FILE_MISSING');
 if(!queryPackages)packageCache.set(cacheKey,{at:Date.now(),executable:exe});return exe;
}
