import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { environmentIdSchema, workerIdSchema } from "@queqiao/contracts";
import { WorkerMembershipStore, workerMembershipRegistrySchema, type WorkerMembership, type WorkerMembershipRegistry } from "./worker-membership-store.js";

const legacyStaticEnvironmentSchema = z.object({
  environmentId: environmentIdSchema,
  url: z.url(),
  tokenFile: z.string().min(1),
});

const legacyStaticConfigSchema = z.object({
  worker: z.object({ workerId: workerIdSchema.optional(), environmentId: environmentIdSchema }).optional(),
  environments: z.array(legacyStaticEnvironmentSchema).default([]),
}).passthrough();

export type LegacyStaticConfig = z.infer<typeof legacyStaticConfigSchema>;

export async function readLegacyStaticConfig(file: string): Promise<LegacyStaticConfig> {
  return legacyStaticConfigSchema.parse(parse(await readFile(file, "utf8")));
}

export type StaticMembershipMigrationPlan = {
  additions: WorkerMembership[];
  unresolvedEnvironmentIds: string[];
  next: WorkerMembershipRegistry;
};

/**
 * Compatibility-only migration from already-trusted static environment entries.
 * Normal Gateway runtime never reads these entries. The planner does not mutate
 * the main config and fails closed when a stable workerId cannot be established.
 */
export function planStaticMembershipMigration(
  config: LegacyStaticConfig,
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

  const next = workerMembershipRegistrySchema.parse({ version: 1, workers: [...validatedCurrent.workers, ...additions] });
  return { additions, unresolvedEnvironmentIds, next };
}

export async function migrateStaticMemberships(
  store: WorkerMembershipStore,
  config: LegacyStaticConfig,
  suppliedWorkerIds: Readonly<Record<string, string>> = {},
  execute = false,
): Promise<StaticMembershipMigrationPlan> {
  const plan = planStaticMembershipMigration(config, await store.read(), suppliedWorkerIds);
  if (execute) {
    if (plan.unresolvedEnvironmentIds.length) throw new Error(`Static membership migration requires stable workerId for: ${plan.unresolvedEnvironmentIds.join(", ")}`);
    await store.replace(plan.next);
  }
  return plan;
}
