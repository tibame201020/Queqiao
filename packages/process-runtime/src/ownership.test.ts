import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ProcessRunner } from './index.js';
let cwd: string;
let runner: ProcessRunner;
afterEach(async () => { runner?.shutdown(); if (cwd) await rm(cwd, {recursive:true, force:true, maxRetries:10, retryDelay:150}); });
const request = () => ({ executable:path.basename(process.execPath), args:['-e','setInterval(()=>{},1000)'], cwd, workspaceId:'owner', timeoutMs:2000 });
async function waitTracked() {
  for(let i=0;i<100;i++) { const resource=runner.listTracked().find(x=>x.kind==='sync'); if(resource) return resource; await new Promise(r=>setTimeout(r,10)); }
  throw new Error('Synchronous ownership was not registered');
}
it('isolates bounded persistent sessions from foreground commands and background jobs', async () => {
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-ownership-')); runner=new ProcessRunner(1);
  const session=await runner.openStdio({...request(),timeoutMs:null});
  expect(runner.capacity()).toMatchObject({foreground:{active:0,limit:1},sessions:{active:1,limit:1}});
  await expect(runner.openStdio({...request(),timeoutMs:null})).rejects.toMatchObject({capacityClass:'session',active:1,limit:1});
  const command=await runner.run({...request(),args:['-e','process.stdout.write("available")']});
  expect(command.stdout).toBe('available');
  const job=await runner.startJob({...request(),args:['-e','0']});
  expect(job.state).toBe('running');
  await session.close(); expect(runner.capacity().sessions?.active).toBe(0);
  // Wait for the background process to release its Windows working directory
  // before the fixture teardown removes it.
  if (runner.jobStatus(job.jobId).state === 'running') {
    expect(runner.cancelJob(job.jobId)).toBe(true);
  }
  for (let i = 0; i < 100 && ['queued', 'running'].includes(runner.jobStatus(job.jobId).state); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(['completed', 'cancelled']).toContain(runner.jobStatus(job.jobId).state);
});
it('lists and stops synchronous owners without exposing argv or crossing workspace authority', async () => {
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-ownership-')); runner=new ProcessRunner(1);
  const command=runner.run(request()); const resource=await waitTracked();
  expect(resource).toMatchObject({kind:'sync',workspaceId:'owner',capacityClass:'foreground'});
  expect(resource).not.toHaveProperty('args');
  expect(runner.listTracked('other')).toEqual([]);
  expect(runner.stopTracked(resource.handle,'other')).toBe(false);
  expect(runner.foregroundActiveCount()).toBe(1);
  expect(runner.stopTracked(resource.handle,'owner')).toBe(true);
  await expect(command).resolves.toMatchObject({aborted:true});
  expect(runner.foregroundActiveCount()).toBe(0); expect(runner.listTracked()).toEqual([]);
});
it('reaps synchronous owners on shutdown and releases reservations only after close', async () => {
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-ownership-')); runner=new ProcessRunner(1);
  const command=runner.run(request()); await waitTracked(); runner.shutdown();
  expect(runner.foregroundActiveCount()).toBe(1);
  await expect(command).resolves.toMatchObject({aborted:true});
  expect(runner.foregroundActiveCount()).toBe(0);
});
it.skipIf(process.platform!=='win32')('handles missing Windows tree terminator without an unhandled error',async()=>{
  cwd=await mkdtemp(path.join(os.tmpdir(),'queqiao-ownership-')); runner=new ProcessRunner(1);
  const command=runner.run(request()); const resource=await waitTracked();
  const previous=process.env.SystemRoot;
  try { process.env.SystemRoot=cwd; runner.stopTracked(resource.handle,'owner'); await expect(command).resolves.toMatchObject({aborted:true}); }
  finally { if(previous===undefined) delete process.env.SystemRoot; else process.env.SystemRoot=previous; }
  expect(runner.activeCount()).toBe(0);
});
