import {describe,it,expect,vi} from "vitest";
import {Gate3McpAuditRead} from "./poc-gate3-audit-read.js";
import {resolveHostedGate3Binding,createHostedGate3ReadService} from "./poc-gate3-hosted-binding.js";
const target={controllerRunId:"38565432100",controllerAttempt:"1",date:"2026-10-14",repository:"tibame201020/Queqiao",sourceRevision:"a".repeat(40)};
const lease={providerId:"github-actions",leaseId:"ee9f4f43-777b-4578-8fce-e7a4de693898",state:"ready",expiresAt:"2099-01-01T00:00:00Z",
 worker:{workerId:"gha-worker-1",environmentId:"gha_worker_alpha"},
 metadata:{taskKind:"gate3-content",gate3Date:target.date,controllerRunId:target.controllerRunId,controllerRunAttempt:target.controllerAttempt,sourceRevision:"a".repeat(40)},
 providerMetadata:{runId:"38565432101",environmentId:"gha_worker_alpha"}};
describe("G3.3 hosted injection derives the binding only from actual coordinator lease",()=>{
 it("selects one ready, correctly bound lease without a user MCP argument",()=>{
  expect(resolveHostedGate3Binding([lease],target)).toEqual({
   controllerRunId:target.controllerRunId,controllerAttempt:"1",workerRunId:"38565432101",
   workerAttempt:"1",environmentId:lease.worker.environmentId,leaseId:lease.leaseId,
   date:target.date,repository:target.repository,
  });
 });
 it("rejects ambiguous, stale or mismatched leases (no fallback or guess)",()=>{
  for(const leases of [[],[lease,structuredClone(lease)],[{...lease,state:"disposed"}],
   [{...lease,metadata:{...lease.metadata,controllerRunId:"38565432102"}}],
   [{...lease,metadata:{...lease.metadata,taskKind:"other"}}],
   [{...lease,worker:{...lease.worker,environmentId:"gha_wrong"}}],
   [{...lease,providerId:"other"}],
   [{...lease,providerMetadata:{...lease.providerMetadata,runId:""}}],
  ])expect(()=>resolveHostedGate3Binding(leases,target)).toThrow("G3_HOSTED_LEASE_UNCONFIRMED");
 });
 it("denies a GitHub read before successful same-principal Worker content proof, then prevents replay",async()=>{
  const coordinator={list:()=>[lease],get:()=>lease};
  const service=createHostedGate3ReadService(target,coordinator,async()=>({} as never),{append:async()=>{}} as never);
  await expect(service.readHead("approved")).rejects.toThrow("G3_GITHUB_WORKER_UNVERIFIED");
  await expect(service.readHead("approved")).rejects.toThrow("G3_GITHUB_ALREADY_CLAIMED");
 });
 it("binds GitHub target to the principal from the successful Worker MCP call",async()=>{
  const spy=vi.spyOn(Gate3McpAuditRead.prototype,"execute").mockResolvedValueOnce({outcome:"success"} as never);
  try{
   const coordinator={list:()=>[lease],get:()=>lease};
   const service=createHostedGate3ReadService(target,coordinator,async()=>({} as never),{append:async()=>{}} as never);
   await service.execute("first-oauth-client");
   await expect(service.readHead("other-oauth-client")).rejects.toThrow("G3_GITHUB_PRINCIPAL_MISMATCH");
   await expect(service.readHead("first-oauth-client")).rejects.toThrow("G3_GITHUB_ALREADY_CLAIMED");
  }finally{spy.mockRestore();}
 });
 it("claims once, even when the lease cannot yet be resolved",async()=>{
  let reads=0;
  const coordinator={list:()=>[],get:()=>undefined};
  const service=createHostedGate3ReadService(target,coordinator,async()=>{reads++;return {} as never;},{append:async()=>{}} as never);
  await expect(service.execute("authorized")).rejects.toThrow("G3_HOSTED_LEASE_UNCONFIRMED");
  await expect(service.execute("authorized")).rejects.toThrow("G3_MCP_ALREADY_CLAIMED");
  expect(reads).toBe(0);
 });
});