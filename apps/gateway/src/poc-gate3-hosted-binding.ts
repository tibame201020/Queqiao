import type {AuditLogStore} from "@queqiao/audit";
import type {WorkerRegistry} from "./worker-registry.js";
import type {GitHubActionsRuntimeCoordinator} from "@queqiao/runtime-provider-github-actions";
import {Gate3McpAuditRead,type Gate3McpBinding} from "./poc-gate3-audit-read.js";

export type HostedGate3Target={controllerRunId:string;controllerAttempt:string;date:string;repository:string;sourceRevision:string};
type Candidate={providerId:string;leaseId:string;state:string;expiresAt:string;
 worker?:{workerId:string;environmentId:string};metadata:Record<string,string>;
 providerMetadata?:Record<string,string>};
const ID=/^[1-9]\d{0,19}$/,ATT=/^[1-9]\d{0,7}$/,SHA=/^[a-f0-9]{40}$/;
export function resolveHostedGate3Binding(leases:readonly Candidate[],t:HostedGate3Target):Gate3McpBinding{
 const fail=():never=>{throw Error("G3_HOSTED_LEASE_UNCONFIRMED");};
 if(!ID.test(t.controllerRunId)||!ATT.test(t.controllerAttempt)||
  !/^\d{4}-\d{2}-\d{2}$/.test(t.date)||Number.isNaN(Date.parse(t.date))||
  new Date(t.date).toISOString().slice(0,10)!==t.date||
  t.repository!=="tibame201020/Queqiao"||!SHA.test(t.sourceRevision))return fail();
 const matched=leases.filter(l=>l.providerId==="github-actions"&&
  l.metadata.controllerRunId===t.controllerRunId&&
  l.metadata.controllerRunAttempt===t.controllerAttempt&&
  l.metadata.gate3Date===t.date&&l.metadata.taskKind==="gate3-content"&&
  l.metadata.sourceRevision===t.sourceRevision&&
  ["ready","running"].includes(l.state)&&Date.parse(l.expiresAt)>Date.now()&&
  !!l.worker?.workerId&&/^gha_[a-z0-9_]{4,64}$/.test(l.worker.environmentId)&&
  l.providerMetadata?.environmentId===l.worker.environmentId&&
  ID.test(l.providerMetadata.runId??"")&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(l.leaseId));
 if(matched.length!==1)return fail();
 const lease=matched[0]!;
 // A second lease with the matching controller/date (even malformed) is ambiguous.
 if(leases.filter(l=>l.metadata.controllerRunId===t.controllerRunId&&
   l.metadata.controllerRunAttempt===t.controllerAttempt&&l.metadata.gate3Date===t.date).length!==1)return fail();
 return {controllerRunId:t.controllerRunId,controllerAttempt:t.controllerAttempt,
  workerRunId:lease.providerMetadata!.runId!,workerAttempt:"1",
  environmentId:lease.worker!.environmentId,leaseId:lease.leaseId,date:t.date,repository:t.repository};
}
/** Controller opt-in is determined at Gateway process start, never from model fields.
 * Claim at the first invocation before any async work; an uncertain call cannot replay.
 */
export function createHostedGate3ReadService(t:HostedGate3Target,
 coordinator:Pick<GitHubActionsRuntimeCoordinator,"list"|"get">,
 workers:()=>Promise<Pick<WorkerRegistry,"requireTool"|"readFile">>,
 audit:Pick<AuditLogStore,"append"|"query">){
 let claimed=false;
 return {async execute(principalId:string){
  if(claimed)throw Error("G3_MCP_ALREADY_CLAIMED");
  claimed=true;
  if(!principalId)throw Error("G3_MCP_UNAUTHENTICATED");
  const binding=resolveHostedGate3Binding(coordinator.list(),t);
  const registry=await workers();
  return new Gate3McpAuditRead(binding,registry,coordinator,audit).execute(principalId);
 }};
}
