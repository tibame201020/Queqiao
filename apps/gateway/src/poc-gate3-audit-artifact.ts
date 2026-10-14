import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {auditEventSchema} from "@queqiao/audit";
import {gate3ReadRequestHash,type Gate3McpBinding} from "./poc-gate3-audit-read.js";
import {validateCustomMcpExecutionReceipt} from "./poc-gate3-connector-execution.js";
const input=process.env["G3_AUDIT_ARTIFACT_PATH"];
if(!input)throw Error("G3_AUDIT_ARTIFACT_PATH_MISSING");
let raw:unknown;
try{raw=JSON.parse(readFileSync(input,"utf8"));}catch{throw Error("G3_AUDIT_ARCHIVE_INVALID");}
const r=raw as Record<string,unknown>,p=r?.workerProof as Record<string,unknown>;
const receipt=r?.receipt as Record<string,unknown>;
const hash=(x:string)=>createHash("sha256").update(x).digest("hex");
if(!r||Object.keys(r).sort().join(",")!==
 "auditEvent,auditEventSha256,controllerAttempt,controllerRunId,date,environmentId,leaseId,receipt,repository,schema,sourceRevision,verdict,workerProof,workerRunId"||
 r.schema!=="queqiao.gate3.hosted-audit.v1"||r.verdict!=="candidate_for_independent_review"||
 r.controllerRunId!==process.env["GITHUB_RUN_ID"]||
 r.controllerAttempt!==process.env["GITHUB_RUN_ATTEMPT"]||
 r.sourceRevision!==process.env["GITHUB_SHA"]||
 r.repository!=="tibame201020/Queqiao"||
 !p||p.schema!=="queqiao.gate3.worker-content.v1"||p.contentVerified!==true||
 p.controllerRunId!==r.controllerRunId||p.controllerAttempt!==r.controllerAttempt||
 p.workerRunId!==r.workerRunId||p.date!==r.date||
 p.taskId!==`gate3-${r.workerRunId}-1`||p.logicalKey!==`gate3/synthetic-${r.date}`)
 throw Error("G3_AUDIT_ARCHIVE_CORRELATION_INVALID");
const event=auditEventSchema.parse(r.auditEvent);
if(hash(JSON.stringify(event))!==r.auditEventSha256||event.id!==receipt?.eventId||
 event.component!=="gateway"||event.category!=="tool"||
 event.action!=="gate3.read_artifact"||event.outcome!=="success"||
 event.subject?.provider!=="queqiao_custom_mcp"||event.subject.taskId!==p.taskId)
 throw Error("G3_AUDIT_ARCHIVE_SOURCE_INVALID");
const b:Gate3McpBinding={
 controllerRunId:String(r.controllerRunId),controllerAttempt:String(r.controllerAttempt),
 workerRunId:String(r.workerRunId),workerAttempt:"1",
 environmentId:String(r.environmentId),leaseId:String(r.leaseId),
 date:String(r.date),repository:String(r.repository),
};
const expected={
 controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
 workerRunId:b.workerRunId,workerAttempt:b.workerAttempt,
 environmentId:b.environmentId,leaseId:b.leaseId,
 taskId:String(p.taskId),logicalKey:String(p.logicalKey),repository:b.repository,
 action:"read_gate3_artifact",requestSha256:gate3ReadRequestHash(b),
 resultSha256:hash(JSON.stringify(p)),
};
const fields={...expected,provider:"queqiao_custom_mcp",principalDigest:receipt?.principalDigest};
if(!event.detail||
 Object.keys(event.detail).sort().join(",")!==Object.keys(fields).sort().join(",")||
 (Object.keys(fields) as Array<keyof typeof fields>).some(k=>event.detail?.[k]!==fields[k])||
 validateCustomMcpExecutionReceipt(receipt,expected,{
 source:"authenticated_gateway_audit",authenticated:true,eventId:event.id,
 provider:event.subject.provider,action:expected.action,
 requestSha256:event.detail.requestSha256,resultSha256:event.detail.resultSha256,
 taskId:event.subject.taskId,
 })!=="candidate_for_independent_review")
 throw Error("G3_AUDIT_ARCHIVE_WITNESS_MISMATCH");
// Downloaded immutable GitHub Actions artifact is independently checked in a separate job.
// This verifies saved evidence; it is not a cryptographic OpenAI/ChatGPT tool receipt.
console.log(JSON.stringify({schema:"queqiao.gate3.archive-recheck.v1",controllerRunId:b.controllerRunId,
 workerRunId:b.workerRunId,archivedEventVerified:true,verdict:"candidate_for_independent_review",
 provider:"queqiao_custom_mcp",githubTargetRead:"not_observed",writeAttempted:false}));
