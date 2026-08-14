import type { RuntimeConfig } from "@queqiao/config";
import { workerIdSchema } from "@queqiao/contracts";
import { WorkerMembershipStore, workerMembershipRegistrySchema, type WorkerMembership, type WorkerMembershipRegistry } from "./worker-membership-store.js";

export type StaticMembershipMigrationPlan = {
  additions: WorkerMembership[];
  unresolvedEnvironmentIds: string[];
  next: WorkerMembershipRegistry;
};

/**
 * Prepare a fail-closed migration from already-trusted static environment entries.
 * The planner never mutates config or membership state. External environments require
 * an explicitly supplied stable workerId; only the local Worker can inherit config.worker.workerId.
 */
export function planStaticMembershipMigration(
  config: RuntimeConfig,
  current: WorkerMembershipRegistry,
  suppliedWorkerIds: Readonly<Record<string, string>> = {},
): StaticMembershipMigrationPlan {
  const validatedCurrent = workerMembershipRegistrySchema.parse(current);
  const additions: WorkerMembership[] = [];
  const unresolvedEnvironmentIds: string[] = [];

  for (const environment of config.environments) {
    const existing = validatedCurrent.workers.find((worker) => worker.environmentId === environment.environmentId);
    if (existing) continue;

    const localWorkerId = config.worker?.environmentId === environment.environmentId ? config.worker.workerId : undefined;
    const suppliedWorkerId = suppliedWorkerIds[environment.environmentId];
    const workerId = localWorkerId ?? (suppliedWorkerId ? workerIdSchema.parse(suppliedWorkerId) : undefined);
    if (!workerId) {
      unresolvedEnvironmentIds.push(environment.environmentId);
      continue;
    }

    additions.push({
      workerId,
      environmentId: environment.environmentId,
      transport: { type: "http", endpoint: environment.url },
      credentialRefs: [{ kind: "secret-file", path: environment.tokenFile }],
    });
  }

  const next = workerMembershipRegistrySchema.parse({
    version: 1,
    workers: [...validatedCurrent.workers, ...additions],
  });
  return { additions, unresolvedEnvironmentIds, next };
}

export async function migrateStaticMemberships(
  store: WorkerMembershipStore,
  config: RuntimeConfig,
  suppliedWorkerIds: Readonly<Record<string, string>> = {},
  execute = false,
): Promise<StaticMembershipMigrationPlan> {
  const plan = planStaticMembershipMigration(config, await store.read(), suppliedWorkerIds);
  if (execute) {
    if (plan.unresolvedEnvironmentIds.length) {
      throw new Error(`Static membership migration requires stable workerId for: ${plan.unresolvedEnvironmentIds.join(", ")}`);
    }
    await store.replace(plan.next);
  }
  return plan;
}
