import {createHash} from "node:crypto";
import {AuditLogStore,createAuditEvent} from "@queqiao/audit";
import type {WorkerRegistry} from "./worker-registry.js";
import {verifyRoutedGate3Content} from "./poc-gate3-worker-receipt.js";
import {validateCustomMcpExecutionReceipt,type ExpectedCustomMcpExecution,type CustomMcpReceiptVerdict} from "./poc-gate3-connector-execution.js";

export type Gate3McpBinding={
 controllerRunId:string;controllerAttempt:string;workerRunId:string;workerAttempt:string;
 environmentId:string;leaseId:string;date:string;repository:string;
};
type LeaseView={state:string;expiresAt:string;worker?:{workerId:string;environmentId:string};
 metadata:Record<string,string>;providerMetadata?:Record<string,string>};
type CoordinatorView={get(leaseId:string):LeaseView|undefined};
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const validBinding=(b:Gate3McpBinding)=>
 /^[1-9]\d{0,19}$/.test(b.controllerRunId)&&/^[1-9]\d{0,19}$/.test(b.workerRunId)&&
 /^[1-9]\d{0,7}$/.test(b.controllerAttempt)&&b.workerAttempt==="1"&&
 /^gha_[a-z0-9_]{4,64}$/.test(b.environmentId)&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(b.leaseId)&&
 /^\d{4}-\d{2}-\d{2}$/.test(b.date)&&!Number.isNaN(Date.parse(b.date))&&
 new Date(b.date).toISOString().slice(0,10)===b.date&&
 /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(b.repository);
export const gate3ReadRequestHash=(b:Gate3McpBinding):string=>hash(JSON.stringify({
 provider:"queqiao_custom_mcp",action:"read_gate3_artifact",
 controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
 workerRunId:b.workerRunId,workerAttempt:b.workerAttempt,environmentId:b.environmentId,
 leaseId:b.leaseId,date:b.date,repository:b.repository,path:"gate3-artifact.json",
}));
const expectedFrom=(b:Gate3McpBinding,resultSha256:string):ExpectedCustomMcpExecution=>({
 controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,workerRunId:b.workerRunId,
 workerAttempt:b.workerAttempt,environmentId:b.environmentId,leaseId:b.leaseId,
 taskId:`gate3-${b.workerRunId}-${b.workerAttempt}`,logicalKey:`gate3/synthetic-${b.date}`,
 repository:b.repository,action:"read_gate3_artifact",
 requestSha256:gate3ReadRequestHash(b),resultSha256,
});
/** Explicitly injected opt-in controller binding, never an MCP user argument.
 * A server-side Worker read, verified Runtime Lease and awaited audit append precede
 * receipt emission. This is a read-only POC path, not GitHub publishing or L3 PASS.
 */
export class Gate3McpAuditRead{
 private claimed=false;
 private readonly binding:Readonly<Gate3McpBinding>;
 constructor(binding:Gate3McpBinding,private readonly workers:Pick<WorkerRegistry,"requireTool"|"readFile">,
  private readonly coordinator:CoordinatorView,private readonly audit:Pick<AuditLogStore,"append"|"query">){
  if(!validBinding(binding))throw Error("G3_MCP_BINDING_INVALID");
  this.binding=Object.freeze({...binding});
 }
 async execute(principalId:string){
  if(this.claimed)throw Error("G3_MCP_ALREADY_CLAIMED");
  this.claimed=true; // no retry on an uncertain outcome
  if(!principalId)throw Error("G3_MCP_UNAUTHENTICATED");
  const b=this.binding;
  const lease=this.coordinator.get(b.leaseId);
  if(!lease||!["ready","running"].includes(lease.state)||
   Date.parse(lease.expiresAt)<=Date.now()||
   !lease.worker?.workerId||lease.worker.environmentId!==b.environmentId||
   lease.providerMetadata?.runId!==b.workerRunId||lease.providerMetadata.environmentId!==b.environmentId||
   lease.metadata.taskKind!=="gate3-content"||lease.metadata.gate3Date!==b.date||
   lease.metadata.controllerRunId!==b.controllerRunId||
   lease.metadata.controllerRunAttempt!==b.controllerAttempt)
   throw Error("G3_MCP_LEASE_BINDING_INVALID");
  await this.workers.requireTool("runtime","read_file",b.environmentId);
  const routed=await this.workers.readFile({workspaceId:"runtime",environmentId:b.environmentId,path:"gate3-artifact.json",offset:0,limit:1});
  const read=routed.value;
  const verified=verifyRoutedGate3Content({
   _meta:{"dev.queqiao/routing":routed.routing},
   content:[{type:"text",text:`Workspace: runtime\nPath: ${read.path}\nLines: ${read.startLine}-${read.endLine} of ${read.totalLines}\n\n${read.text}`}],
  },{environmentId:b.environmentId,workerRunId:b.workerRunId,
   controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,date:b.date});
  const e=expectedFrom(b,hash(JSON.stringify(verified)));
  const principalDigest=hash(principalId);
  const event=createAuditEvent({component:"gateway",category:"tool",action:"gate3.read_artifact",
   outcome:"success",subject:{provider:"queqiao_custom_mcp",taskId:e.taskId},
   detail:{...e,provider:"queqiao_custom_mcp",principalDigest}});
  const receipt={schema:"queqiao.gate3.connector-execution.v1" as const,provider:"queqiao_custom_mcp" as const,
   ...e,principalDigest,eventId:event.id,outcome:"success" as const,executionObserved:true as const};
  await this.audit.append(event); // failure is fail-closed; never emit an unaudited success
  return receipt;
 }
}
/** Query a separately reopened, authenticated Gateway audit store. An arbitrary
 * user/model-supplied witness cannot enter this verifier. A candidate is NOT L3 PASS.
 */
export async function verifyPersistedGate3McpAudit(
 audit:Pick<AuditLogStore,"query">,receipt:unknown,b:Gate3McpBinding
):Promise<CustomMcpReceiptVerdict>{
 if(!validBinding(b)||!receipt||typeof receipt!=="object"||Array.isArray(receipt))return "invalid_receipt";
 const r=receipt as Record<string,unknown>;
 const e=expectedFrom(b,String(r.resultSha256??""));
 const pre=validateCustomMcpExecutionReceipt(receipt,e,null);
 if(pre!=="witness_missing")return pre;
 const queried=await audit.query({component:"gateway",category:"tool",action:"gate3.read_artifact",limit:1000});
 if(queried.issues.length)return "witness_untrusted";
 const matched=queried.events.filter(x=>x.id===r.eventId);
 if(matched.length!==1)return "witness_missing";
 const event=matched[0]!;
 if(event.outcome!=="success"||event.subject?.provider!=="queqiao_custom_mcp"||
  event.subject.taskId!==r.taskId||!event.detail)return "witness_mismatch";
 const required={...e,provider:"queqiao_custom_mcp",principalDigest:r.principalDigest};
 if(Object.keys(event.detail).sort().join(",")!==Object.keys(required).sort().join(",")||
  (Object.keys(required) as Array<keyof typeof required>).some(k=>event.detail?.[k]!==required[k]))
  return "witness_mismatch";
 return validateCustomMcpExecutionReceipt(receipt,e,{
  source:"authenticated_gateway_audit",authenticated:true,eventId:event.id,
  provider:"queqiao_custom_mcp",action:event.detail.action,
  requestSha256:event.detail.requestSha256,resultSha256:event.detail.resultSha256,taskId:event.detail.taskId,
 });
}
