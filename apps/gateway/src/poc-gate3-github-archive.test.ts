import {createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {createAuditEvent} from "@queqiao/audit";
import {verifyHostedGithubArchive} from "./poc-gate3-github-archive.js";
import {gate3GithubHeadRequestHash,gate3GithubHeadResultHash} from "./poc-gate3-github-head.js";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const b={controllerRunId:"12345678",controllerAttempt:"1",workerRunId:"12345679",workerAttempt:"1",
 environmentId:"gha_worker_alpha",leaseId:"ee9f4f43-777b-4578-8fce-e7a4de693898",date:"2026-10-14",repository:"tibame201020/Queqiao"};
const revision="a".repeat(40),principalDigest=hash("anonymous-test-oauth-client");
function fixture(){
 const taskId=`gate3-${b.workerRunId}-1`,logicalKey=`gate3/synthetic-${b.date}`;
 const priorEventId="11111111-1111-4111-8111-111111111111";
 const worker={schema:"queqiao.gate3.hosted-audit.v1",sourceRevision:revision,
  ...b,workerProof:{contentVerified:true,taskId,logicalKey},receipt:{principalDigest,eventId:priorEventId},
  verdict:"candidate_for_independent_review"};
 const workerRaw=JSON.stringify(worker)+"\n";
 const expected={controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
  workerRunId:b.workerRunId,workerAttempt:b.workerAttempt,environmentId:b.environmentId,leaseId:b.leaseId,
  repository:b.repository,taskId,logicalKey,action:"read_public_github_head",
  requestSha256:gate3GithubHeadRequestHash(b,revision),resultSha256:gate3GithubHeadResultHash(revision)};
 const event=createAuditEvent({component:"gateway",category:"tool",action:"gate3.read_public_head",
  outcome:"success",subject:{provider:"queqiao_custom_mcp",taskId},
  detail:{...expected,provider:"queqiao_custom_mcp",principalDigest}});
 const receipt={schema:"queqiao.gate3.connector-execution.v1",provider:"queqiao_custom_mcp",
  ...expected,principalDigest,eventId:event.id,outcome:"success",executionObserved:true};
 const head={schema:"queqiao.gate3.hosted-github-audit.v1",sourceRevision:revision,
  controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
  workerRunId:b.workerRunId,environmentId:b.environmentId,leaseId:b.leaseId,date:b.date,
  repository:b.repository,workerAuditSha256:hash(workerRaw),receipt,auditEvent:event,
  auditEventSha256:hash(JSON.stringify(event)),verdict:"candidate_for_independent_review"};
 const ctx={controllerRunId:b.controllerRunId,controllerAttempt:"1",sourceRevision:revision};
 return {workerRaw,head,ctx};
}
describe("G3.3 independent remote original GitHub audit archive",()=>{
 it("recomputes both archived bytes, original event and SHA-bound OAuth MCP receipt",()=>{
  const {workerRaw,head,ctx}=fixture();
  expect(verifyHostedGithubArchive(workerRaw,JSON.stringify(head),ctx)).toMatchObject({
   archivedEventVerified:true,githubTargetRead:"verified",writeAttempted:false});
 });
 it("rejects missing, wrong task or cross-run original Worker archive",()=>{
  const f=fixture();
  expect(()=>verifyHostedGithubArchive("{}",JSON.stringify(f.head),f.ctx)).toThrow();
  expect(()=>verifyHostedGithubArchive(f.workerRaw+"x",JSON.stringify(f.head),f.ctx)).toThrow();
  expect(()=>verifyHostedGithubArchive(f.workerRaw,JSON.stringify(f.head),{...f.ctx,controllerRunId:"99"})).toThrow();
 });
 it("rejects tampering with the original event, result, principal, and extra fields",()=>{
  for(const mutate of [
   (h:any)=>{h.auditEventSha256="f".repeat(64);},
   (h:any)=>{h.auditEvent.detail.resultSha256="f".repeat(64);h.auditEventSha256=hash(JSON.stringify(h.auditEvent));},
   (h:any)=>{h.receipt.resultSha256="f".repeat(64);},
   (h:any)=>{h.receipt.principalDigest="f".repeat(64);},
   (h:any)=>{h.privateTranscript="never";},
  ]){
   const f=fixture();mutate(f.head);
   expect(()=>verifyHostedGithubArchive(f.workerRaw,JSON.stringify(f.head),f.ctx)).toThrow();
  }
 });
});
