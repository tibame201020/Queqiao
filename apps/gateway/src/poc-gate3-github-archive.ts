import {createHash} from "node:crypto";
import {auditEventSchema} from "@queqiao/audit";
import {gate3GithubHeadRequestHash,gate3GithubHeadResultHash} from "./poc-gate3-github-head.js";
import type {Gate3McpBinding} from "./poc-gate3-audit-read.js";
import {validateCustomMcpExecutionReceipt} from "./poc-gate3-connector-execution.js";
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);
const keys=(x:Record<string,unknown>)=>Object.keys(x).sort().join(",");
const artifactKeys="auditEvent,auditEventSha256,controllerAttempt,controllerRunId,date,environmentId,leaseId,receipt,repository,schema,sourceRevision,verdict,workerAuditSha256,workerRunId";
type Context={controllerRunId:string;controllerAttempt:string;sourceRevision:string};
/** Independent separate-job validation of both original archives and their cross-event linkage.
 * The authenticated GitHub Actions download supplies original bytes, never a model-produced witness.
 */
export function verifyHostedGithubArchive(workerRaw:string,githubRaw:string,c:Context){
 let w:unknown,h:unknown;
 try{w=JSON.parse(workerRaw);h=JSON.parse(githubRaw);}catch{throw Error("G3_GITHUB_ARCHIVE_INVALID");}
 if(!obj(w)||!obj(h)||keys(h)!==artifactKeys||h.schema!=="queqiao.gate3.hosted-github-audit.v1"||
  w.schema!=="queqiao.gate3.hosted-audit.v1"||w.verdict!=="candidate_for_independent_review"||
  h.verdict!=="candidate_for_independent_review"||h.workerAuditSha256!==hash(workerRaw)||
  h.controllerRunId!==c.controllerRunId||h.controllerAttempt!==c.controllerAttempt||
  h.sourceRevision!==c.sourceRevision||w.sourceRevision!==c.sourceRevision||
  w.controllerRunId!==c.controllerRunId||w.controllerAttempt!==c.controllerAttempt||
  h.workerRunId!==w.workerRunId||h.environmentId!==w.environmentId||
  h.leaseId!==w.leaseId||h.date!==w.date||h.repository!==w.repository||
  h.repository!=="tibame201020/Queqiao")
  throw Error("G3_GITHUB_ARCHIVE_CORRELATION_INVALID");
 const r=h.receipt,prior=w.receipt,p=w.workerProof;
 if(!obj(r)||!obj(prior)||!obj(p)||p.contentVerified!==true||
  r.principalDigest!==prior.principalDigest||r.eventId===prior.eventId)
  throw Error("G3_GITHUB_ARCHIVE_PRINCIPAL_INVALID");
 const b:Gate3McpBinding={controllerRunId:String(h.controllerRunId),controllerAttempt:String(h.controllerAttempt),
  workerRunId:String(h.workerRunId),workerAttempt:"1",environmentId:String(h.environmentId),
  leaseId:String(h.leaseId),date:String(h.date),repository:String(h.repository)};
 if(p.taskId!==`gate3-${b.workerRunId}-1`||p.logicalKey!==`gate3/synthetic-${b.date}`)
  throw Error("G3_GITHUB_ARCHIVE_TASK_INVALID");
 const expected={controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,workerRunId:b.workerRunId,
  workerAttempt:b.workerAttempt,environmentId:b.environmentId,leaseId:b.leaseId,taskId:String(p.taskId),
  logicalKey:String(p.logicalKey),repository:b.repository,action:"read_public_github_head",
  requestSha256:gate3GithubHeadRequestHash(b,c.sourceRevision),resultSha256:gate3GithubHeadResultHash(c.sourceRevision)};
 let event:ReturnType<typeof auditEventSchema.parse>;
 try{event=auditEventSchema.parse(h.auditEvent);}catch{throw Error("G3_GITHUB_ARCHIVE_EVENT_INVALID");}
 const detail={...expected,provider:"queqiao_custom_mcp",principalDigest:r.principalDigest};
 if(hash(JSON.stringify(event))!==h.auditEventSha256||event.id!==r.eventId||
  event.component!=="gateway"||event.category!=="tool"||event.action!=="gate3.read_public_head"||
  event.outcome!=="success"||event.subject?.provider!=="queqiao_custom_mcp"||
  event.subject.taskId!==expected.taskId||!event.detail||
  keys(event.detail)!==keys(detail)||
  (Object.keys(detail) as Array<keyof typeof detail>).some(k=>event.detail?.[k]!==detail[k])||
  validateCustomMcpExecutionReceipt(r,expected,{
   source:"authenticated_gateway_audit",authenticated:true,eventId:event.id,
   provider:event.subject.provider,action:expected.action,requestSha256:expected.requestSha256,
   resultSha256:expected.resultSha256,taskId:expected.taskId,
  })!=="candidate_for_independent_review")
  throw Error("G3_GITHUB_ARCHIVE_WITNESS_MISMATCH");
 return {schema:"queqiao.gate3.github-archive-recheck.v1" as const,controllerRunId:b.controllerRunId,
  workerRunId:b.workerRunId,archivedEventVerified:true as const,githubTargetRead:"verified" as const,
  provider:"queqiao_custom_mcp" as const,verdict:"candidate_for_independent_review" as const,
  writeAttempted:false as const};
}
