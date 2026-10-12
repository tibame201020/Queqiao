import { z } from "zod";
import type { PostgresTaskLedger } from "./postgres-task-ledger.js";
import type { GitHubActionsRunDiscovery } from "@queqiao/runtime-provider-github-actions";

/**
 * Owner-scoped read-only identification of a missing GitHub Actions Run ID.
 * Never writes a guessed run ID or sends a GitHub cancellation.
 *
 * Workflow display_title can be user-controlled. A unique candidate is
 * actionable evidence for operator investigation, not proof of authorized
 * ownership or final disposal.
 */
export class PostgresUnknownRunInspector {
  constructor(
    private readonly ledger:PostgresTaskLedger,
    private readonly finder:Pick<GitHubActionsRunDiscovery,"inspect">,
    private readonly settings:{
      owner:string;repo:string;workflowId:string;ref:string;trustedActor:string;
    },
  ){}
  async inspect(ownerDigest:string,taskId:string):Promise<{status:"not_found"|"ambiguous"}|{status:"candidate";runId:number}>{
    const digest=z.string().regex(/^[0-9a-f]{64}$/).parse(ownerDigest);
    const id=z.string().uuid().parse(taskId);
    const task=await this.ledger.read(digest,id);
    if(!task)throw new Error("Task not found");
    if(task.state!=="reconciling"||task.runId!==null){
      throw new Error("Task is not eligible for unknown-run discovery");
    }
    return this.finder.inspect({
      owner:this.settings.owner,repo:this.settings.repo,
      workflowId:this.settings.workflowId,ref:this.settings.ref,
      actor:this.settings.trustedActor,leaseId:task.id,
      createdAt:task.createdAt.toISOString(),
    });
  }
}
