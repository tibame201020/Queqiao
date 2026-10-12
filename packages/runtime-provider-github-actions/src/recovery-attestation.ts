import { z } from "zod";
import type { GitHubActionsOidcVerifier } from "./index.js";

/**
 * Attest a discovered Run with a GitHub-issued OIDC JWT.
 * A run title is never proof of ownership. The token must be validated
 * by the configured GitHub JWKS verifier and bind the exact run identity.
 */
export class GitHubActionsRecoveryAttestor {
  constructor(private readonly verifier: GitHubActionsOidcVerifier) {}

  async attest(input: {
    leaseId: string; runId: number; token: string;
    repository: string; workflowId: string; ref: string;
  }): Promise<{ runId: number; leaseId: string }> {
    const leaseId=z.string().uuid().parse(input.leaseId);
    const runId=z.number().int().positive().parse(input.runId);
    const repository=z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).parse(input.repository);
    const workflowId=z.string().regex(/^[A-Za-z0-9_.-]+\.ya?ml$/).parse(input.workflowId);
    const ref=z.string().regex(/^[A-Za-z0-9_./-]+$/).parse(input.ref);
    const token=z.string().min(32).max(16384).parse(input.token);
    const audience="urn:queqiao:run-recovery:"+leaseId;
    const signed=await this.verifier.verify(token,audience);
    const gitRef="refs/heads/"+ref;
    if(signed.runId!==runId ||
       signed.repository!==repository ||
       signed.workflowRef!==repository+"/.github/workflows/"+workflowId+"@"+gitRef ||
       signed.ref!==gitRef ||
       signed.eventName!=="workflow_dispatch" ||
       signed.subject!=="repo:"+repository+":ref:"+gitRef){
      throw new Error("GitHub OIDC run provenance mismatch");
    }
    return {runId,leaseId};
  }
}
