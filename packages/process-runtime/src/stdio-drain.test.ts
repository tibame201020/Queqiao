import { mkdtemp, rm, writeFile, access, readFile } from 'node:fs/promises';
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
// cmd start /b exercises the same Win32 inherited-handle behavior as
// PowerShell Start-Process -NoNewWindow, without loading PowerShell modules.
it.skipIf(process.platform!=='win32')('reproduces native Windows inherited handles and preserves the background child',async()=>{
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-windows-drain-'));
  const child=path.join(cwd,'child.cjs');const completed=path.join(cwd,'child-completed.txt');const pidFile=path.join(cwd,'child.pid');
  await writeFile(child,`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(completed)},'done'),8000)`);
  const previousPath=process.env.PATH;process.env.PATH=[path.dirname(process.execPath),previousPath].join(path.delimiter);
  const runner=new ProcessRunner(1);let result;
  try { result=await runner.run({executable:'cmd.exe',cwd,timeoutMs:15000,args:['/d','/s','/c','start /b node child.cjs & echo parent-complete & exit /b 0']}); }
  finally { if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath; }
  let pid:number|undefined;
  try {
    for(let i=0;i<100;i++){try{pid=Number(await readFile(pidFile,'utf8'));break}catch{await new Promise(r=>setTimeout(r,50))}}
    expect(result,JSON.stringify(result)).toMatchObject({exitCode:0,timedOut:false,stdioDrainTimedOut:true});
    expect(result.stdout).toContain('parent-complete');expect(syncProcessResultSchema.parse(result)).toEqual(result);
    expect(pid).toBeGreaterThan(0);expect(()=>process.kill(pid!,0)).not.toThrow();
    await expect(access(completed)).rejects.toMatchObject({code:'ENOENT'});expect(runner.foregroundActiveCount()).toBe(0);
  } finally { if(pid!==undefined&&Number.isInteger(pid)&&pid>0)try{process.kill(pid)}catch{} }
},20000);
