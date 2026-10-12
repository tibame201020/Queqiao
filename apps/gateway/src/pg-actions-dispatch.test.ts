import { randomUUID } from "node:crypto";
import pg from "pg";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { PostgresTaskLedger } from "./postgres-task-ledger.js";
import { PostgresActionsDispatch } from "./pg-actions-dispatch.js";
import { githubActionsRuntimeEnvironmentId, GitHubActionsRuntimeCoordinator,
  GitHubActionsRuntimeProvider, GitHubActionsRuntimeClaimRegistry } from "@queqiao/runtime-provider-github-actions";

const dsn=process.env.QUEQIAO_TEST_PG_URL;
const schema="qqdispatch_"+randomUUID().replaceAll("-","");
let poolA:pg.Pool;
let poolB:pg.Pool;
let ledgerA:PostgresTaskLedger;
let ledgerB:PostgresTaskLedger;
const gatewayA=randomUUID(),gatewayB=randomUUID(),revision="c".repeat(40);
let count=0;
const newKey=()=>String(++count).padStart(64,"0");
async function task(owner="a"){
 return ledgerA.reserve({ownerDigest:owner.repeat(64),idempotencyDigest:newKey(),
   taskId:"gateway-vitest",sourceRevision:revision});
}
function fakeRuntime(){
 return {
   provision:vi.fn(async (input:unknown)=>({
     leaseId:(input as {leaseId:string}).leaseId,
     state:"provisioning" as const,
     providerMetadata:{runId:"8822",environmentId:githubActionsRuntimeEnvironmentId((input as {leaseId:string}).leaseId)},
   })),
   fail:vi.fn(async (_leaseId:string)=>({state:"disposed" as const})),
 };
}

describe.runIf(Boolean(dsn))("real PostgreSQL fenced Actions dispatch integration",()=>{
 beforeAll(async()=>{
  poolA=new pg.Pool({connectionString:dsn!,max:10});
  poolB=new pg.Pool({connectionString:dsn!,max:10});
 });
 beforeEach(async()=>{
  await poolA.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
  await poolA.query('CREATE SCHEMA "'+schema+'"');
  ledgerA=new PostgresTaskLedger(poolA,schema);
  ledgerB=new PostgresTaskLedger(poolB,schema);
  await ledgerA.migrate();
 },10000);
 afterAll(async()=>{
  if(poolA){await poolA.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await poolA.end();await poolB.end();}
 });
 it("permits only one actual runtime dispatch across two Gateway instances, source SHA pinned",async()=>{
  const r=fakeRuntime();
  const t=await task();
  const a=new PostgresActionsDispatch(ledgerA,r,gatewayA);
  const b=new PostgresActionsDispatch(ledgerB,r,gatewayB);
  const results=await Promise.all([a.dispatch(t.id),b.dispatch(t.id)]);
  expect(results.filter(x=>x?.runId==="8822")).toHaveLength(1);
  expect(r.provision).toHaveBeenCalledTimes(1);
  expect(r.provision).toHaveBeenCalledWith(expect.objectContaining({
    leaseId:t.id,metadata:expect.objectContaining({sourceRevision:revision}),
  }));
  expect(await ledgerB.read(t.ownerDigest,t.id)).toMatchObject({runId:"8822",environmentId:githubActionsRuntimeEnvironmentId(t.id)});
 });
 it("binds a real Runtime Coordinator dispatch and OIDC registry to one PostgreSQL task",async()=>{
  const t=await task("9");
  const dispatch=vi.fn(async()=>({
    runId:7788,runUrl:"https://api.github.test/runs/7788",htmlUrl:"https://github.test/runs/7788",
  }));
  const cancel=vi.fn(async()=>undefined);
  const claims=new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime");
  const provider=new GitHubActionsRuntimeProvider({
    owner:"example",repo:"runtime-host",workflowId:"runtime.yml",ref:"main",
    gatewayUrl:"https://gateway.example.test/",api:{dispatch,cancel},
    claimRegistry:claims,
  });
  const coordinator=new GitHubActionsRuntimeCoordinator(provider,claims);
  const wired=new PostgresActionsDispatch(ledgerA,coordinator,gatewayA);
  const taskResult=await wired.dispatch(t.id);
  expect(taskResult).toMatchObject({
    runId:"7788",environmentId:githubActionsRuntimeEnvironmentId(t.id),
  });
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch.mock.calls[0]?.[0].inputs).toMatchObject({
    lease_id:t.id,source_revision:revision,
    environment_id:githubActionsRuntimeEnvironmentId(t.id),
  });
  expect(claims.get(t.id)).toMatchObject({
    leaseId:t.id,runId:7788,
  });
  expect((await ledgerB.read(t.ownerDigest,t.id))?.runId).toBe("7788");
  await coordinator.fail(t.id,"test cleanup");
  expect(cancel).toHaveBeenCalledWith({owner:"example",repo:"runtime-host",runId:7788});
 });
 it("compensates remote dispatch if a concurrent cancellation invalidates the fence before bind",async()=>{
  const t=await task("b");
  let release!:()=>void;
  let entered!:()=>void;
  const begin=new Promise<void>(resolve=>entered=resolve);
  const ready=new Promise<void>(resolve=>release=resolve);
  const r=fakeRuntime();
  r.provision.mockImplementationOnce(async (input)=>{
    entered();await ready;
    return {leaseId:(input as {leaseId:string}).leaseId,state:"provisioning",providerMetadata:{runId:"8822",environmentId:githubActionsRuntimeEnvironmentId(t.id)}};
  });
  const dispatch=new PostgresActionsDispatch(ledgerA,r,gatewayA);
  const pending=dispatch.dispatch(t.id);
  await begin;
  const cancelled=await ledgerB.cancel(t.id,t.ownerDigest);
  expect(cancelled.state).toBe("cancelling");
  release();
  await expect(pending).rejects.toThrow(/fenc|cancel|stale/i);
  expect(r.fail).toHaveBeenCalledWith(t.id,expect.any(String));
  expect((await ledgerB.read(t.ownerDigest,t.id))?.state).toBe("cancelling");
 });
 it("leaves uncertain provider responses in reconciling, never silently retries dispatch",async()=>{
  const t=await task("d");
  const r=fakeRuntime();
  r.provision.mockRejectedValueOnce(new Error("GitHub response lost after dispatch"));
  const app=new PostgresActionsDispatch(ledgerA,r,gatewayA);
  await expect(app.dispatch(t.id)).rejects.toThrow(/response lost/);
  expect((await ledgerB.read(t.ownerDigest,t.id))?.state).toBe("reconciling");
  expect(await new PostgresActionsDispatch(ledgerB,r,gatewayB).dispatch(t.id)).toBeNull();
  expect(r.provision).toHaveBeenCalledTimes(1);
 });
 it("never requeues an ambiguous dispatch when GitHub cleanup itself fails",async()=>{
  const t=await task("f");
  const r=fakeRuntime();
  r.provision.mockResolvedValueOnce({leaseId:t.id,state:"provisioning",providerMetadata:{
    runId:"8822",environmentId:"wrong-runtime-environment",
  }});
  r.fail.mockRejectedValueOnce(new Error("GitHub cancel failed"));
  const app=new PostgresActionsDispatch(ledgerA,r,gatewayA);
  await expect(app.dispatch(t.id)).rejects.toThrow(/environment mismatch/i);
  expect(r.fail).toHaveBeenCalledOnce();
  expect((await ledgerB.read(t.ownerDigest,t.id))?.state).toBe("reconciling");
  expect(await new PostgresActionsDispatch(ledgerB,r,gatewayB).dispatch(t.id)).toBeNull();
 });
 it("rejects incomplete or forged provider run metadata and compensates the runtime",async()=>{
  const t=await task("e");
  const r=fakeRuntime();
  r.provision.mockResolvedValueOnce({leaseId:t.id,state:"provisioning",providerMetadata:{runId:"not-a-run",environmentId:githubActionsRuntimeEnvironmentId(t.id)}});
  const app=new PostgresActionsDispatch(ledgerA,r,gatewayA);
  await expect(app.dispatch(t.id)).rejects.toThrow(/invalid|provider|run/i);
  expect(r.fail).toHaveBeenCalledOnce();
  expect((await ledgerB.read(t.ownerDigest,t.id))?.state).toBe("reconciling");
 });
});
