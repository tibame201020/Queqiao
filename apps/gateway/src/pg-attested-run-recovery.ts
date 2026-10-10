import { z } from "zod";
import { githubActionsRuntimeEnvironmentId, GitHubActionsRecoveryAttestor } from "@queqiao/runtime-provider-github-actions";
import type { PostgresTaskLedger, LedgerTask } from "./postgres-task-ledger.js";
import type { PostgresUnknownRunInspector } from "./pg-unknown-run-inspector.js";

export type RecoveryRun={
  id:number;repository:string;workflow:string;path:string;
  head_branch:string;event:string;actor:string;display_title:string;
  run_attempt:number;status:string;conclusion:string|null;
};
export type RecoveryRunPort={
  get(owner:string,repo:string,runId:number):Promise<RecoveryRun>;
  cancel(owner:string,repo:string,runId:number):Promise<void>;
};
type Config={owner:string;repo:string;workflowId:string;ref:string;trustedActor:string};

/**
 * Internal-only recovery controller. Never exposed through public MCP.
 * Requires signed job OIDC proof plus a uniquely discovered Run candidate.
 * Cancellation is fenced; acknowledgment requires remote terminal evidence.
 */
export class PostgresAttestedRunRecovery {
  constructor(
    private readonly ledger:PostgresTaskLedger,
    private readonly finder:Pick<PostgresUnknownRunInspector,"inspect">,
    private readonly attestor:GitHubActionsRecoveryAttestor,
    private readonly api:RecoveryRunPort,
    private readonly config:Config,
    private readonly gatewayId:string,
    private readonly wait:(ms:number)=>Promise<void>=async(ms)=>new Promise(resolve=>setTimeout(resolve,ms)),
  ){z.string().uuid().parse(gatewayId);}

  async recover(ownerDigest:string,taskId:string,token:string):
    Promise<{state:"not_found"|"ambiguous"|"busy"|"pending"|"reconciled";runId?:number}> {
    const task=await this.requirePending(ownerDigest,taskId);
    if(task.runId!==null)throw new Error("Recovered Run already has a persisted identity; use resume");
    const candidate=await this.finder.inspect(ownerDigest,taskId);
    if(candidate.status!=="candidate")return {state:candidate.status};
    await this.attestor.attest({
      leaseId:task.id,runId:candidate.runId,token,
      repository:this.config.owner+"/"+this.config.repo,
      workflowId:this.config.workflowId,ref:this.config.ref,
    });
    const lease=await this.ledger.claimCleanup(task.id,this.gatewayId,90);
    if(!lease)return {state:"busy"};
    // Re-fetch under cleanup fencing before trusting any mutable listing.
    const remote=await this.api.get(this.config.owner,this.config.repo,candidate.runId);
    this.verifyRun(task,remote,candidate.runId);
    const bound=await this.ledger.recordAttestedRun(task.id,this.gatewayId,lease.fence,
      String(candidate.runId),githubActionsRuntimeEnvironmentId(task.id));
    if(!bound)throw new Error("Lost PostgreSQL cleanup fencing before attested Run binding");
    return this.dispose(task,lease.fence,candidate.runId,remote);
  }

  async resume(ownerDigest:string,taskId:string):Promise<{state:"busy"|"pending"|"reconciled";runId:number}>{
    const task=await this.requirePending(ownerDigest,taskId);
    if(task.recoveryProvenance!=="oidc"||!task.runId||!task.environmentId ||
       task.environmentId!==githubActionsRuntimeEnvironmentId(task.id)){
      throw new Error("Task has no durable signed GitHub OIDC recovery provenance");
    }
    const runId=z.coerce.number().int().positive().parse(task.runId);
    const lease=await this.ledger.claimCleanup(task.id,this.gatewayId,90);
    if(!lease)return {state:"busy",runId};
    const remote=await this.api.get(this.config.owner,this.config.repo,runId);
    this.verifyRun(task,remote,runId);
    return this.dispose(task,lease.fence,runId,remote);
  }

  private async requirePending(ownerDigest:string,id:string):Promise<LedgerTask>{
    const task=await this.ledger.read(ownerDigest,z.string().uuid().parse(id));
    if(!task)throw new Error("Task not found");
    if(task.state!=="reconciling")throw new Error("Task not eligible for recovery");
    return task;
  }
  private verifyRun(task:LedgerTask,remote:RecoveryRun,expected:number):void {
    if(remote.id!==expected||remote.repository!==this.config.owner+"/"+this.config.repo||
       remote.workflow!==this.config.workflowId||
       remote.path!==".github/workflows/"+this.config.workflowId||
       remote.head_branch!==this.config.ref||remote.event!=="workflow_dispatch"||
       remote.actor!==this.config.trustedActor||
       remote.display_title!=="Queqiao Runtime "+task.id||remote.run_attempt!==1){
      throw new Error("GitHub recovered Run provenance mismatch");
    }
  }
  private async dispose(task:LedgerTask,fence:string,runId:number,initial:RecoveryRun):
    Promise<{state:"pending"|"reconciled";runId:number}> {
    if(initial.status!=="completed")await this.api.cancel(this.config.owner,this.config.repo,runId);
    for(let i=0;i<4;i++){
      const current=i===0?initial:await this.api.get(this.config.owner,this.config.repo,runId);
      this.verifyRun(task,current,runId);
      if(current.status==="completed"&&current.conclusion!==null){
        const committed=await this.ledger.acknowledgeCleanup(task.id,this.gatewayId,fence,"failed");
        if(!committed)throw new Error("Lost PostgreSQL cleanup fencing before disposal acknowledgment");
        return {state:"reconciled",runId};
      }
      if(i<3)await this.wait(500);
    }
    return {state:"pending",runId};
  }
}
