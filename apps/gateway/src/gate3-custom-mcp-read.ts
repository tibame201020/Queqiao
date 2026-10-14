import {createHash} from "node:crypto";
import {createAuditEvent,type AuditSink} from "@queqiao/audit";

/** Context MUST be minted from the approved Controller/Worker at the Gateway,
 * not accepted from a ChatGPT user turn, tool arguments or a model-generated claim.
 * This is a read-only executor slice, not yet a deployed MCP tool or hosted L3 proof.
 */
export type Gate3CustomMcpContext={
 controllerRunId:string;controllerAttempt:string;workerRunId:string;
 environmentId:string;leaseId:string;taskId:string;expectedSha:string;
};
const ID=/^[1-9]\d{0,19}$/,ATTEMPT=/^[1-9]\d{0,7}$/,SHA=/^[a-f0-9]{40}$/;
const URL="https://api.github.com/repos/tibame201020/Queqiao/branches/main";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
function validContext(c:Gate3CustomMcpContext){
 return ID.test(c.controllerRunId)&&ATTEMPT.test(c.controllerAttempt)&&ID.test(c.workerRunId)&&
  /^gha_[a-z0-9_]{4,64}$/.test(c.environmentId)&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.leaseId)&&
  c.taskId===`gate3-${c.workerRunId}-1`&&SHA.test(c.expectedSha);
}
export class Gate3CustomMcpRead {
 constructor(private readonly context:Gate3CustomMcpContext,
  private readonly audit:AuditSink,private readonly fetchImpl:typeof fetch=fetch){
  if(!validContext(context))throw Error("G3_CUSTOM_MCP_CONTEXT_INVALID");
 }
 async readHead(authenticatedPrincipalId:string){
  if(!authenticatedPrincipalId)throw Error("G3_CUSTOM_MCP_UNAUTHORIZED");
  const c=this.context;
  const requestSha256=digest(`GET ${URL}\n${c.controllerRunId}/${c.controllerAttempt}/${c.workerRunId}/${c.taskId}`);
  let resultSha="";
  let failed=false;
  try {
   const response=await this.fetchImpl(URL,{method:"GET",headers:{accept:"application/vnd.github+json",
    "user-agent":"Queqiao-Gate3-Read-Only"},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error("provider_unavailable");
   const doc:unknown=await response.json();
   if(!doc||typeof doc!=="object"||Array.isArray(doc))throw Error("invalid_response");
   const commit=(doc as Record<string,unknown>)["commit"];
   if(!commit||typeof commit!=="object"||Array.isArray(commit))throw Error("invalid_commit");
   const sha=(commit as Record<string,unknown>)["sha"];
   if(typeof sha!=="string"||!SHA.test(sha)||sha!==c.expectedSha)throw Error("sha_mismatch");
   resultSha=sha;
  }catch {
   failed=true;
  }
  const event=createAuditEvent({
   component:"gateway",category:"tool",action:"gate3.custom-mcp-read",outcome:failed?"failed":"success",
   subject:{provider:"queqiao_custom_mcp",tool:"gate3_read_public_head"},
   detail:{runId:c.controllerRunId,attempt:c.controllerAttempt,workerRunId:c.workerRunId,
    environmentId:c.environmentId,leaseId:c.leaseId,taskId:c.taskId,tool:"gate3_read_public_head",
    requestSha256,...(!failed?{resultSha256:digest(resultSha)}:{failureClass:"provider_read_unconfirmed"})},
  });
  try{await this.audit.append(event);}catch{throw Error("G3_CUSTOM_MCP_AUDIT_FAILED");}
  if(failed)throw Error("G3_CUSTOM_MCP_READ_UNCONFIRMED");
  return {schema:"queqiao.gate3.custom-mcp-read.v1" as const,provider:"queqiao_custom_mcp" as const,
   controllerRunId:c.controllerRunId,controllerAttempt:c.controllerAttempt,workerRunId:c.workerRunId,
   environmentId:c.environmentId,leaseId:c.leaseId,taskId:c.taskId,
   tool:"gate3_read_public_head" as const,requestSha256,resultSha,resultSha256:digest(resultSha),
   auditEventId:event.id,verified:true as const};
 }
}
