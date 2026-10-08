import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ProcessRunner } from './index.js';
import { syncProcessResultSchema } from '../../contracts/src/index.js';
let cwd: string;
afterEach(async()=>{if(cwd)await rm(cwd,{recursive:true,force:true,maxRetries:20,retryDelay:100})});
it.skipIf(process.platform==='win32')('bounds inherited pipe draining after native exit and immediately permits another command',async()=>{
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-drain-'));
  const runner=new ProcessRunner(1);const executable=path.basename(process.execPath);
  const started=Date.now();
  const result=await runner.run({executable,cwd,timeoutMs:2000,args:['-e',"require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{stdio:['ignore',process.stdout,process.stderr]});process.stdout.write('parent-complete');process.exit(0)"]});
  expect(Date.now()-started).toBeLessThan(1300);
  expect(result).toMatchObject({exitCode:0,stdout:'parent-complete',timedOut:false,stdioDrainTimedOut:true});
  expect(syncProcessResultSchema.parse(result)).toEqual(result);
  expect(runner.foregroundActiveCount()).toBe(0);expect(runner.listTracked()).toEqual([]);
  await expect(runner.run({executable,cwd,args:['-e','0']})).resolves.toMatchObject({exitCode:0});
});
it('drains ordinary final output without marking it truncated',async()=>{
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-drain-'));const runner=new ProcessRunner(1);
  const result=await runner.run({executable:path.basename(process.execPath),cwd,args:['-e',"process.stdout.write('x'.repeat(65536));process.stderr.write('done')"]});
  expect(result.stdout.length).toBe(65536);expect(result.stderr).toBe('done');expect(result).not.toHaveProperty('stdioDrainTimedOut');
});
it.skipIf(process.platform!=='win32')('reproduces PowerShell Start-Process inherited Windows handles',async()=>{
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-powershell-drain-'));
  const child=path.join(cwd,'child.cjs');const completed=path.join(cwd,'child-completed.txt');await writeFile(child,`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(completed)},'done'),8000)`);
  const quote=(s:string)=>s.replaceAll("'","''");const runner=new ProcessRunner(1);
  const result=await runner.run({executable:'powershell.exe',cwd,timeoutMs:15000,args:['-NoProfile','-NonInteractive','-Command',`Start-Process -FilePath '${quote(process.execPath)}' -ArgumentList @('${quote(child)}') -NoNewWindow -PassThru | Select-Object -ExpandProperty Id; exit 0`]});
  try {
    expect(result, JSON.stringify(result)).toMatchObject({exitCode:0,timedOut:false,stdioDrainTimedOut:true});
    expect(syncProcessResultSchema.parse(result)).toEqual(result);
    await expect(access(completed)).rejects.toMatchObject({code:'ENOENT'});
    expect(runner.foregroundActiveCount()).toBe(0);
  } finally {
    const pid=Number(result.stdout.trim());if(Number.isInteger(pid)&&pid>0)try{process.kill(pid)}catch{}
  }
},20000);
