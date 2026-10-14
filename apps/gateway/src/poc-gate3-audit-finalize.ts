import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {AuditLogStore} from "@queqiao/audit";
import {gate3ReadRequestHash,verifyPersistedGate3McpAudit,type Gate3McpBinding} from "./poc-gate3-audit-read.js";
import {validateCustomMcpExecutionReceipt} from "./poc-gate3-connector-execution.js";
const env=process.env;
const receiptPath=env["G3_MCP_RECEIPT_PATH"],proofPath=env["G3_PROOF_PATH"],
 output=env["G3_AUDIT_PROOF_PATH"],stateDir=env["G3_GATEWAY_STATE_DIR"];
if(!receiptPath||!proofPath||!output||!stateDir)throw Error("G3_AUDIT_PATH_MISSING");
const read=(p:string):unknown=>{try{return JSON.parse(readFileSync(p,"utf8"));}catch{throw Error("G3_AUDIT_INPUT_INVALID");}};
const receipt=read(receiptPath),workerProof=read(proofPath);
const r=receipt as Record<string,unknown>,p=workerProof as Record<string,unknown>;
const binding:Gate3McpBinding={
 controllerRunId:env["GITHUB_RUN_ID"]??"",controllerAttempt:env["GITHUB_RUN_ATTEMPT"]??"",
 workerRunId:env["WORKER_RUN_ID"]??"",workerAttempt:"1",
 environmentId:env["EXPECTED_ENVIRONMENT_ID"]??"",leaseId:env["LEASE_ID"]??"",
 date:env["G3_DATE"]??"",repository:env["GITHUB_REPOSITORY"]??"",
};
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const revision=env["GITHUB_SHA"]??"";
if(!/^[a-f0-9]{40}$/.test(revision)||!p||p.schema!=="queqiao.gate3.worker-content.v1"||
 p.contentVerified!==true||p.controllerRunId!==binding.controllerRunId||
 p.controllerAttempt!==binding.controllerAttempt||p.workerRunId!==binding.workerRunId||
 p.date!==binding.date||p.taskId!==`gate3-${binding.workerRunId}-1`||
 p.logicalKey!==`gate3/synthetic-${binding.date}`)
 throw Error("G3_AUDIT_WORKER_PROOF_INVALID");
const expected={
 controllerRunId:binding.controllerRunId,controllerAttempt:binding.controllerAttempt,
 workerRunId:binding.workerRunId,workerAttempt:"1",environmentId:binding.environmentId,
 leaseId:binding.leaseId,taskId:p.taskId as string,logicalKey:p.logicalKey as string,
 repository:binding.repository,action:"read_gate3_artifact",
 requestSha256:gate3ReadRequestHash(binding),resultSha256:hash(JSON.stringify(workerProof)),
};
if(validateCustomMcpExecutionReceipt(receipt,expected,null)!=="witness_missing")
 throw Error("G3_AUDIT_RECEIPT_INVALID");
// Independent file handle/process, no browser-generated witness.
const store=new AuditLogStore(path.join(stateDir,"audit"));
const verdict=await verifyPersistedGate3McpAudit(store,receipt,binding);
if(verdict!=="candidate_for_independent_review")throw Error("G3_AUDIT_WITNESS_UNCONFIRMED");
const q=await store.query({component:"gateway",category:"tool",action:"gate3.read_artifact",limit:1000});
const match=q.events.filter(x=>x.id===r.eventId);
if(q.issues.length||match.length!==1)throw Error("G3_AUDIT_SOURCE_AMBIGUOUS");
const event=match[0]!;
const artifact={schema:"queqiao.gate3.hosted-audit.v1",sourceRevision:revision,
 controllerRunId:binding.controllerRunId,controllerAttempt:binding.controllerAttempt,
 workerRunId:binding.workerRunId,environmentId:binding.environmentId,
 leaseId:binding.leaseId,date:binding.date,repository:binding.repository,
 workerProof,receipt,auditEvent:event,
 auditEventSha256:hash(JSON.stringify(event)),verdict};
writeFileSync(output,JSON.stringify(artifact)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
console.log(JSON.stringify({schema:artifact.schema,controllerRunId:binding.controllerRunId,
 workerRunId:binding.workerRunId,verdict,writeAttempted:false}));
