import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerMembershipStore, workerMembershipRegistrySchema, type WorkerMembership } from "./worker-membership-store.js";

const roots: string[] = [];
const worker = (workerId: string, environmentId: string, port: number): WorkerMembership => ({
  workerId: workerId as WorkerMembership["workerId"],
  environmentId: environmentId as WorkerMembership["environmentId"],
  transports: [{ type: "http", endpoint: `http://127.0.0.1:${port}` }],
  credentialRefs: [{ kind: "secret-file", path: path.join("secrets", `${workerId}.secret`) }],
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkerMembershipStore", () => {
  it("persists validated membership atomically outside main config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-")); roots.push(root);
    const store = new WorkerMembershipStore(path.join(root, "gateway"));
    const first = worker("11111111-1111-4111-8111-111111111111", "windows", 7576);
    await store.add(first);

    expect(await store.read()).toEqual({ version: 1, workers: [first] });
    expect(workerMembershipRegistrySchema.parse(JSON.parse(await readFile(store.file, "utf8"))).workers).toHaveLength(1);
    if (process.platform !== "win32") expect((await stat(store.file)).mode & 0o777).toBe(0o600);
  });

  it("fails closed on duplicate workerId or environmentId without replacing the last good file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-")); roots.push(root);
    const store = new WorkerMembershipStore(path.join(root, "gateway"));
    const first = worker("11111111-1111-4111-8111-111111111111", "windows", 7576);
    await store.add(first);
    const before = await readFile(store.file, "utf8");

    await expect(store.add(worker(first.workerId, "linux", 7577))).rejects.toThrow(/workerId must be unique/);
    await expect(store.add(worker("22222222-2222-4222-8222-222222222222", "windows", 7578))).rejects.toThrow(/environmentId must be unique/);
    await expect(store.add(worker("33333333-3333-4333-8333-333333333333", "linux", 7576))).rejects.toThrow(/Gateway-visible Worker transport endpoint must be unique/);
    expect(await readFile(store.file, "utf8")).toBe(before);
  });

  it("serializes concurrent membership mutations without losing an accepted Worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-")); roots.push(root);
    const store = new WorkerMembershipStore(path.join(root, "gateway"));
    const first = worker("11111111-1111-4111-8111-111111111111", "windows", 7576);
    const second = worker("22222222-2222-4222-8222-222222222222", "linux", 7577);
    await Promise.all([store.add(first), store.add(second)]);
    expect((await store.read()).workers.map((entry) => entry.workerId).sort()).toEqual([first.workerId, second.workerId].sort());
  });

  it("accepts reverse gRPC membership without treating the shared session transport as an endpoint conflict", () => {
    const first = {
      ...worker("11111111-1111-4111-8111-111111111111", "windows", 7576),
      transports: [{ type: "grpc", mode: "reverse" }],
    };
    const second = {
      ...worker("22222222-2222-4222-8222-222222222222", "linux", 7577),
      transports: [{ type: "grpc", mode: "reverse" }],
    };
    expect(workerMembershipRegistrySchema.parse({ version: 1, workers: [first, second] }).workers).toMatchObject([
      { workerId: first.workerId, transports: [{ type: "grpc", mode: "reverse" }] },
      { workerId: second.workerId, transports: [{ type: "grpc", mode: "reverse" }] },
    ]);
  });

  it("keeps HTTP transport loopback-only and reserves at most two credential references", () => {
    expect(() => workerMembershipRegistrySchema.parse({ version: 1, workers: [{
      ...worker("11111111-1111-4111-8111-111111111111", "windows", 7576),
      transports: [{ type: "http", endpoint: "http://example.com:7576" }],
    }] })).toThrow(/loopback-only/);

    expect(() => workerMembershipRegistrySchema.parse({ version: 1, workers: [{
      ...worker("11111111-1111-4111-8111-111111111111", "windows", 7576),
      credentialRefs: [
        { kind: "secret-file", path: "a" },
        { kind: "secret-file", path: "b" },
        { kind: "secret-file", path: "c" },
      ],
    }] })).toThrow();
  });
});
