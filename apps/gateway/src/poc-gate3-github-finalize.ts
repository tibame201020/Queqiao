import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {AuditLogStore} from "@queqiao/audit";
import {verifyPersistedGate3GithubHeadAudit} from "./poc-gate3-github-head.js";
import type {Gate3McpBinding} from "./poc-gate3-audit-read.js";
import {validateCustomMcpExecutionReceipt} from "./poc-gate3-connector-execution.js";
import {gate3GithubHeadRequestHash,gate3GithubHeadResultHash} from "./poc-gate3-github-head.js";
const env=process.env;
const workerPath=env["G3_AUDIT_PROOF_PATH"],headPath=env["G3_GITHUB_RECEIPT_PATH"],
 output=env["G3_GITHUB_AUDIT_PROOF_PATH"],stateDir=env["G3_GATEWAY_STATE_DIR"];
if(!workerPath||!headPath||!output||!stateDir)throw Error("G3_GITHUB_AUDIT_PATH_MISSING");
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const read=(p:string)=>{try{return readFileSync(p,"utf8");}catch{throw Error("G3_GITHUB_AUDIT_INPUT_INVALID");}};
const parse=(p:string)=>{try{return JSON.parse(p) as Record<string,unknown>;}catch{throw Error("G3_GITHUB_AUDIT_INPUT_INVALID");}};
const workerRaw=read(workerPath),worker=parse(workerRaw),receipt=parse(read(headPath));
const b:Gate3McpBinding={
 controllerRunId:env["GITHUB_RUN_ID"]??"",controllerAttempt:env["GITHUB_RUN_ATTEMPT"]??"",
 workerRunId:env["WORKER_RUN_ID"]??"",workerAttempt:"1",environmentId:env["EXPECTED_ENVIRONMENT_ID"]??"",
 leaseId:env["LEASE_ID"]??"",date:env["G3_DATE"]??"",repository:env["GITHUB_REPOSITORY"]??"",
};
const revision=env["GITHUB_SHA"]??"";
const previous=worker.receipt as Record<string,unknown>|undefined;
if(worker.schema!=="queqiao.gate3.hosted-audit.v1"||
 worker.verdict!=="candidate_for_independent_review"||
 worker.controllerRunId!==b.controllerRunId||worker.controllerAttempt!==b.controllerAttempt||
 worker.workerRunId!==b.workerRunId||worker.environmentId!==b.environmentId||
 worker.leaseId!==b.leaseId||worker.date!==b.date||worker.repository!==b.repository||
 worker.sourceRevision!==revision||!previous||previous.principalDigest!==receipt.principalDigest||
 previous.eventId===receipt.eventId)throw Error("G3_GITHUB_WORKER_CORRELATION_INVALID");
const p=worker.workerProof as Record<string,unknown>|undefined;
if(!p||p.contentVerified!==true||p.taskId!==`gate3-${b.workerRunId}-1`||
 p.logicalKey!==`gate3/synthetic-${b.date}`)throw Error("G3_GITHUB_WORKER_PROOF_INVALID");
const expected={controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
 workerRunId:b.workerRunId,workerAttempt:"1",environmentId:b.environmentId,leaseId:b.leaseId,
 taskId:p.taskId as string,logicalKey:p.logicalKey as string,repository:b.repository,
 action:"read_public_github_head",requestSha256:gate3GithubHeadRequestHash(b,revision),
 resultSha256:gate3GithubHeadResultHash(revision)};
if(validateCustomMcpExecutionReceipt(receipt,expected,null)!=="witness_missing")
 throw Error("G3_GITHUB_RECEIPT_INVALID");
const store=new AuditLogStore(path.join(stateDir,"audit"));
const verdict=await verifyPersistedGate3GithubHeadAudit(store,receipt,b,revision);
if(verdict!=="candidate_for_independent_review")throw Error("G3_GITHUB_WITNESS_UNCONFIRMED");
const q=await store.query({component:"gateway",category:"tool",action:"gate3.read_public_head",limit:1000});
const matches=q.events.filter(x=>x.id===receipt.eventId);
if(q.issues.length||matches.length!==1)throw Error("G3_GITHUB_EVENT_AMBIGUOUS");
const auditEvent=matches[0]!;
const artifact={schema:"queqiao.gate3.hosted-github-audit.v1",sourceRevision:revision,
 controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
 workerRunId:b.workerRunId,environmentId:b.environmentId,leaseId:b.leaseId,date:b.date,
 repository:b.repository,workerAuditSha256:hash(workerRaw),
 receipt,auditEvent,auditEventSha256:hash(JSON.stringify(auditEvent)),verdict};
writeFileSync(output,JSON.stringify(artifact)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
console.log(JSON.stringify({schema:artifact.schema,controllerRunId:b.controllerRunId,workerRunId:b.workerRunId,
 originalEventVerified:true,githubTargetRead:"candidate_for_independent_review",writeAttempted:false}));
