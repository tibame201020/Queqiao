import { z } from "zod";
import { githubActionsRuntimeEnvironmentId } from "@queqiao/runtime-provider-github-actions";
import { PostgresTaskLedger } from "./postgres-task-ledger.js";
import type { LedgerTask } from "./postgres-task-ledger.js";

type RuntimePort = {
  provision(input: { leaseId: string; ttlSeconds: number; metadata: { sourceRevision: string } }):
    Promise<{ leaseId: string; providerMetadata?: { runId?: string; environmentId?: string } }>;
  fail(leaseId: string, detail: string): Promise<{ state: string }>;
};

const ttlByTask = Object.freeze({
  "gateway-vitest": 180,
  "gateway-cancel-smoke": 240,
} as const);

/**
 * Fenced dispatch coordination adapter, intended for the future hosted
 * Runtime Coordinator. Not registered on the public MCP or Preview API.
 *
 * The database claim reserves the same UUID as the runtime lease identifier
 * BEFORE dispatch. A provider response loss quarantines (never retries).
 * Automatic GitHub lookup by lease UUID is NOT yet available.
 */
export class PostgresActionsDispatch {
  private readonly gatewayId: string;
  constructor(
    private readonly ledger: PostgresTaskLedger,
    private readonly runtime: RuntimePort,
    gatewayId: string,
  ) {
    this.gatewayId = z.string().uuid().parse(gatewayId);
  }

  async dispatch(taskId: string): Promise<LedgerTask | null> {
    const id = z.string().uuid().parse(taskId);
    const claim = await this.ledger.claim(id, this.gatewayId, 300);
    if (!claim) return null; // Task already claimed/cancelled. Never retry dispatch.
    const ttlSeconds = ttlByTask[claim.taskId as keyof typeof ttlByTask];
    if (!ttlSeconds) throw new Error("Unknown trusted task catalog entry");

    let leaseIssued = false;
    try {
      const lease = await this.runtime.provision({
        leaseId: claim.id, ttlSeconds,
        metadata: { sourceRevision: claim.sourceRevision },
      });
      leaseIssued = true;
      // The coordinator's provider is expected to bind this immutable ID
      // to the Actions workflow_dispatch and reverse Worker registration.
      const runId = z.string().regex(/^[0-9]{1,20}$/).parse(lease.providerMetadata?.runId);
      const environmentId = z.string().parse(lease.providerMetadata?.environmentId);
      if (lease.leaseId !== claim.id || environmentId !== githubActionsRuntimeEnvironmentId(claim.id)) {
        throw new Error("GitHub provider runtime lease/environment mismatch");
      }

      const bound = await this.ledger.bindRun(claim.id, this.gatewayId, claim.fence, runId, environmentId);
      if (!bound) throw new Error("Dispatch fencing lost: task cancelled, expired, or taken over");

      const current = await this.ledger.read(claim.ownerDigest, claim.id);
      if (!current) throw new Error("Persisted task disappeared after binding the runtime");
      return current;
    } catch (error) {
      // Any provider response may be ambiguous: do not queue/redispatch.
      // A concurrent owner cancellation may already hold the latest fence.
      await this.ledger.quarantineUncertainDispatch(claim.id, this.gatewayId, claim.fence)
        .catch(() => undefined); // preserve the original error; operator reconciliation required
      if (leaseIssued) {
        await this.runtime.fail(claim.id, "Fenced PostgreSQL Actions dispatch failed")
          .catch(() => undefined); // the remote lease may still exist: quarantined, never automatically retried
      }
      throw error;
    }
  }
}
