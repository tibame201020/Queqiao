import {createHash} from "node:crypto";
import {AuditLogStore,createAuditEvent} from "@queqiao/audit";
import type {Gate3McpBinding} from "./poc-gate3-audit-read.js";
import {validateCustomMcpExecutionReceipt,type ExpectedCustomMcpExecution,type CustomMcpReceiptVerdict} from "./poc-gate3-connector-execution.js";

const URL="https://api.github.com/repos/tibame201020/Queqiao/branches/main";
const sha=/^[a-f0-9]{40}$/;
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
type Lease={state:string;expiresAt:string;worker?:{workerId:string;environmentId:string};
 metadata:Record<string,string>;providerMetadata?:Record<string,string>};
type Coordinator={get(id:string):Lease|undefined};
const valid=(b:Gate3McpBinding,revision:string)=>
 /^[1-9]\d{0,19}$/.test(b.controllerRunId)&&/^[1-9]\d{0,19}$/.test(b.workerRunId)&&
 /^[1-9]\d{0,7}$/.test(b.controllerAttempt)&&b.workerAttempt==="1"&&
 /^gha_[a-z0-9_]{4,64}$/.test(b.environmentId)&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(b.leaseId)&&
 /^\d{4}-\d{2}-\d{2}$/.test(b.date)&&b.repository==="tibame201020/Queqiao"&&sha.test(revision);
export const gate3GithubHeadRequestHash=(b:Gate3McpBinding,revision:string)=>hash(JSON.stringify({
 provider:"queqiao_custom_mcp",action:"read_public_github_head",method:"GET",url:URL,
 controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
 workerRunId:b.workerRunId,workerAttempt:b.workerAttempt,environmentId:b.environmentId,
 leaseId:b.leaseId,date:b.date,repository:b.repository,sourceRevision:revision,
}));
export const gate3GithubHeadResultHash=(revision:string)=>hash(JSON.stringify({sha:revision}));
const expectedFrom=(b:Gate3McpBinding,revision:string):ExpectedCustomMcpExecution=>({
 controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,workerRunId:b.workerRunId,
 workerAttempt:b.workerAttempt,environmentId:b.environmentId,leaseId:b.leaseId,
 taskId:`gate3-${b.workerRunId}-${b.workerAttempt}`,logicalKey:`gate3/synthetic-${b.date}`,
 repository:b.repository,action:"read_public_github_head",
 requestSha256:gate3GithubHeadRequestHash(b,revision),resultSha256:gate3GithubHeadResultHash(revision),
});
/** This is an explicitly opted-in public GET under the server's live, pinned Controller lease.
 * Never takes a user URL/Run/Lease, GitHub token or PAT. One-shot even on uncertainty.
 */
export class Gate3McpGithubHeadRead{
 private claimed=false;
 private readonly binding:Readonly<Gate3McpBinding>;
 constructor(binding:Gate3McpBinding,private readonly revision:string,
  private readonly coordinator:Coordinator,private readonly audit:Pick<AuditLogStore,"append"|"query">,
  private readonly fetchImpl:typeof fetch=fetch){
  if(!valid(binding,revision))throw Error("G3_GITHUB_CONTEXT_INVALID");
  this.binding=Object.freeze({...binding});
 }
 async execute(principalId:string){
  if(this.claimed)throw Error("G3_GITHUB_ALREADY_CLAIMED");
  this.claimed=true;
  if(!principalId)throw Error("G3_GITHUB_UNAUTHENTICATED");
  const b=this.binding,l=this.coordinator.get(b.leaseId);
  if(!l||!["ready","running"].includes(l.state)||Date.parse(l.expiresAt)<=Date.now()||
   !l.worker?.workerId||l.worker.environmentId!==b.environmentId||
   l.providerMetadata?.runId!==b.workerRunId||l.providerMetadata.environmentId!==b.environmentId||
   l.metadata.taskKind!=="gate3-content"||l.metadata.gate3Date!==b.date||
   l.metadata.controllerRunId!==b.controllerRunId||l.metadata.controllerRunAttempt!==b.controllerAttempt||
   l.metadata.sourceRevision!==this.revision)throw Error("G3_GITHUB_LEASE_INVALID");
  let confirmed=false;
  try{
   const response=await this.fetchImpl(URL,{method:"GET",redirect:"error",
    headers:{accept:"application/vnd.github+json","user-agent":"Queqiao-Gate3-Public-Read"},
    signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error("provider_unavailable");
   const doc:unknown=await response.json();
   if(!doc||typeof doc!=="object"||Array.isArray(doc))throw Error("response_invalid");
   const commit=(doc as Record<string,unknown>).commit;
   if(!commit||typeof commit!=="object"||Array.isArray(commit))throw Error("commit_invalid");
   const observed=(commit as Record<string,unknown>).sha;
   confirmed=typeof observed==="string"&&sha.test(observed)&&observed===this.revision;
  }catch{confirmed=false;}
  const e=expectedFrom(b,this.revision);
  const event=createAuditEvent({component:"gateway",category:"tool",action:"gate3.read_public_head",
   outcome:confirmed?"success":"failed",subject:{provider:"queqiao_custom_mcp",taskId:e.taskId},
   detail:confirmed?{...e,provider:"queqiao_custom_mcp",principalDigest:hash(principalId)}:
    {taskId:e.taskId,action:e.action,failureClass:"provider_read_unconfirmed"}});
  try{await this.audit.append(event);}catch{throw Error("G3_GITHUB_AUDIT_FAILED");}
  if(!confirmed)throw Error("G3_GITHUB_HEAD_UNCONFIRMED");
  return {schema:"queqiao.gate3.connector-execution.v1" as const,provider:"queqiao_custom_mcp" as const,
   ...e,principalDigest:hash(principalId),eventId:event.id,outcome:"success" as const,executionObserved:true as const};
 }
}
export async function verifyPersistedGate3GithubHeadAudit(
 audit:Pick<AuditLogStore,"query">,receipt:unknown,b:Gate3McpBinding,revision:string
):Promise<CustomMcpReceiptVerdict>{
 if(!valid(b,revision))return "invalid_receipt";
 const e=expectedFrom(b,revision);
 const pre=validateCustomMcpExecutionReceipt(receipt,e,null);
 if(pre!=="witness_missing")return pre;
 const r=receipt as Record<string,unknown>;
 const queried=await audit.query({component:"gateway",category:"tool",action:"gate3.read_public_head",limit:1000});
 if(queried.issues.length)return "witness_untrusted";
 const found=queried.events.filter(x=>x.id===r.eventId);
 if(found.length!==1)return "witness_missing";
 const original=found[0]!;
 const required={...e,provider:"queqiao_custom_mcp",principalDigest:r.principalDigest};
 if(original.outcome!=="success"||original.subject?.provider!=="queqiao_custom_mcp"||
  original.subject.taskId!==e.taskId||!original.detail||
  Object.keys(original.detail).sort().join(",")!==Object.keys(required).sort().join(",")||
  (Object.keys(required) as Array<keyof typeof required>).some(k=>original.detail?.[k]!==required[k]))
  return "witness_mismatch";
 return validateCustomMcpExecutionReceipt(receipt,e,{
  source:"authenticated_gateway_audit",authenticated:true,eventId:original.id,
  provider:"queqiao_custom_mcp",action:e.action,requestSha256:e.requestSha256,
  resultSha256:e.resultSha256,taskId:e.taskId,
 });
}
