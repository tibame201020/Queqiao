import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import { migrateStaticMemberships, planStaticMembershipMigration } from "./static-membership-migration.js";

const localWorkerId = "11111111-1111-4111-8111-111111111111";
const remoteWorkerId = "22222222-2222-4222-8222-222222222222";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function config() {
  return {
    version: 1,
    worker: {
      workerId: localWorkerId,
      environmentId: "windows",
      listen: { host: "127.0.0.1", port: 7576 },
      tokenFile: "C:/secure/windows.secret",
      defaultWorkspaceId: "default",
    },
    environments: [
      { environmentId: "windows", url: "http://127.0.0.1:7576", tokenFile: "C:/secure/windows.secret" },
      { environmentId: "linux", url: "http://127.0.0.1:7577", tokenFile: "C:/secure/linux.secret" },
    ],
    workspaces: [{ id: "default", displayName: "Default", root: "C:/workspace" }],
  };
}

describe("static Worker membership migration planning", () => {
  it("inherits local workerId but requires an explicit identity for another environment", () => {
    const plan = planStaticMembershipMigration(config(), { version: 1, workers: [] });
    expect(plan.additions.map((entry) => entry.environmentId)).toEqual(["windows"]);
    expect(plan.additions[0]?.workerId).toBe(localWorkerId);
    expect(plan.unresolvedEnvironmentIds).toEqual(["linux"]);
  });

  it("accepts an explicitly supplied stable workerId for an already-trusted remote environment", () => {
    const plan = planStaticMembershipMigration(config(), { version: 1, workers: [] }, { linux: remoteWorkerId });
    expect(plan.unresolvedEnvironmentIds).toEqual([]);
    expect(plan.next.workers.map((entry) => [entry.environmentId, entry.workerId])).toEqual([
      ["windows", localWorkerId],
      ["linux", remoteWorkerId],
    ]);
  });

  it("is idempotent for environments already represented by membership", () => {
    const first = planStaticMembershipMigration(config(), { version: 1, workers: [] }, { linux: remoteWorkerId });
    const second = planStaticMembershipMigration(config(), first.next, { linux: remoteWorkerId });
    expect(second.additions).toEqual([]);
    expect(second.unresolvedEnvironmentIds).toEqual([]);
    expect(second.next).toEqual(first.next);
  });

  it("keeps dry-run side-effect free and executes only when all identities resolve", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-static-migration-")); roots.push(root);
    const store = new WorkerMembershipStore(path.join(root, "gateway"));
    const dryRun = await migrateStaticMemberships(store, config(), { linux: remoteWorkerId }, false);
    expect(dryRun.next.workers).toHaveLength(2);
    expect((await store.read()).workers).toHaveLength(0);

    await migrateStaticMemberships(store, config(), { linux: remoteWorkerId }, true);
    expect((await store.read()).workers).toHaveLength(2);

    const unresolvedStore = new WorkerMembershipStore(path.join(root, "unresolved"));
    await expect(migrateStaticMemberships(unresolvedStore, config(), {}, true)).rejects.toThrow(/requires stable workerId/);
    expect((await unresolvedStore.read()).workers).toHaveLength(0);
  });
});
