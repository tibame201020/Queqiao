import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MembershipWorkerRegistry } from "./worker-membership-registry.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("MembershipWorkerRegistry", () => {
  it("reloads only Gateway-owned membership state and adopts committed membership changes", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-registry-"));
    const store = new WorkerMembershipStore(path.join(temporary, "state"));
    await store.replace({ version: 1, workers: [] });
    const source = new MembershipWorkerRegistry(store);
    await source.initialize();
    expect((await source.current()).configuredEnvironmentIds()).toEqual([]);

    const credential = path.join(temporary, "worker.secret");
    await writeFile(credential, `${"c".repeat(32)}\n`);
    await store.add({
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "wsl",
      transport: { type: "http", endpoint: "http://127.0.0.1:7577" },
      credentialRefs: [{ kind: "secret-file", path: credential }],
    });
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["wsl"]);
  });

  it("retains the last good registry when a committed credential reference cannot be loaded", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-last-good-"));
    const store = new WorkerMembershipStore(path.join(temporary, "state"));
    const credential = path.join(temporary, "worker.secret");
    await writeFile(credential, `${"c".repeat(32)}\n`);
    await store.replace({ version: 1, workers: [{
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "windows",
      transport: { type: "http", endpoint: "http://127.0.0.1:7576" },
      credentialRefs: [{ kind: "secret-file", path: credential }],
    }] });
    const source = new MembershipWorkerRegistry(store);
    await source.initialize();
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows"]);

    await store.replace({ version: 1, workers: [{
      workerId: "22222222-2222-4222-8222-222222222222",
      environmentId: "wsl",
      transport: { type: "http", endpoint: "http://127.0.0.1:7577" },
      credentialRefs: [{ kind: "secret-file", path: path.join(temporary, "missing.secret") }],
    }] });
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows"]);
  });
});
