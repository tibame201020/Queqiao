import {describe,it,expect,vi} from "vitest";
import {Gate3McpGithubHeadRead,gate3GithubHeadRequestHash,verifyPersistedGate3GithubHeadAudit} from "./poc-gate3-github-head.js";
const b={controllerRunId:"38569718518",controllerAttempt:"1",workerRunId:"38569775824",workerAttempt:"1",
 environmentId:"gha_worker_alpha",leaseId:"ee9f4f43-777b-4578-8fce-e7a4de693898",
 date:"2026-10-14",repository:"tibame201020/Queqiao"};
const revision="a".repeat(40);
function fixture(){
 const events:any[]=[];
 const lease={state:"ready",expiresAt:"2099-01-01T00:00:00Z",
  worker:{workerId:"worker-1",environmentId:b.environmentId},
  metadata:{taskKind:"gate3-content",gate3Date:b.date,controllerRunId:b.controllerRunId,
   controllerRunAttempt:b.controllerAttempt,sourceRevision:revision},
  providerMetadata:{runId:b.workerRunId,environmentId:b.environmentId}};
 const coordinator={get:vi.fn(()=>lease)};
 const append=vi.fn(async(e:any)=>{events.push(e);});
 const audit={append,query:vi.fn(async()=>({events,issues:[]}))};
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({commit:{sha:revision}}),{status:200}));
 const service=new Gate3McpGithubHeadRead(b,revision,coordinator,audit,fetchImpl as typeof fetch);
 return {events,coordinator,audit,append,fetchImpl,service};
}
describe("G3.3 Route B server-bound GitHub default HEAD",()=>{
 it("GETs exactly one fixed public target, binds the pinned SHA, appends audit BEFORE receipt",async()=>{
  const {service,events,fetchImpl,append,audit}=fixture();
  let released=false;
  append.mockImplementationOnce(async(e:any)=>{events.push(e);await new Promise<void>(resolve=>setImmediate(resolve));released=true;});
  const receipt=await service.execute("approved-oauth-client");
  expect(released).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/tibame201020/Queqiao/branches/main");
  expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({method:"GET",redirect:"error"});
  expect(receipt).toMatchObject({schema:"queqiao.gate3.connector-execution.v1",action:"read_public_github_head",
   repository:b.repository,requestSha256:gate3GithubHeadRequestHash(b,revision),outcome:"success"});
  expect(receipt.eventId).toBe(events[0]?.id);
  expect(receipt.resultSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(receipt)+JSON.stringify(events)).not.toContain("approved-oauth-client");
  expect(await verifyPersistedGate3GithubHeadAudit(audit,receipt,b,revision)).toBe("candidate_for_independent_review");
 });
 it("fails closed without valid live lease or authenticated principal and does no GET",async()=>{
  const x=fixture();x.coordinator.get.mockReturnValueOnce(undefined as never);
  await expect(x.service.execute("approved-oauth-client")).rejects.toThrow("G3_GITHUB_LEASE_INVALID");
  expect(x.fetchImpl).not.toHaveBeenCalled();
  await expect(x.service.execute("approved-oauth-client")).rejects.toThrow("G3_GITHUB_ALREADY_CLAIMED");
  const y=fixture();await expect(y.service.execute("")).rejects.toThrow("G3_GITHUB_UNAUTHENTICATED");
  expect(y.fetchImpl).not.toHaveBeenCalled();
 });
 it("fails closed on wrong branch SHA, HTTP error, malformed response, audit write error",async()=>{
  for(const response of [new Response(JSON.stringify({commit:{sha:"b".repeat(40)}}),{status:200}),
   new Response("unavailable",{status:503}),new Response(JSON.stringify({commit:{sha:12}}),{status:200})]){
   const x=fixture();x.fetchImpl.mockResolvedValueOnce(response);
   await expect(x.service.execute("approved-oauth-client")).rejects.toThrow("G3_GITHUB_HEAD_UNCONFIRMED");
   expect(x.events).toHaveLength(1);expect(x.events[0].outcome).toBe("failed");
  }
  const x=fixture();x.append.mockRejectedValueOnce(new Error("disk full"));
  await expect(x.service.execute("approved-oauth-client")).rejects.toThrow("G3_GITHUB_AUDIT_FAILED");
 });
 it("rejects duplicate calls and independent witness tampering",async()=>{
  const x=fixture();const r=await x.service.execute("approved-oauth-client");
  await expect(x.service.execute("approved-oauth-client")).rejects.toThrow("G3_GITHUB_ALREADY_CLAIMED");
  expect(x.fetchImpl).toHaveBeenCalledTimes(1);
  x.events[0].detail.resultSha256="b".repeat(64);
  expect(await verifyPersistedGate3GithubHeadAudit(x.audit,r,b,revision)).toBe("witness_mismatch");
 });
});
