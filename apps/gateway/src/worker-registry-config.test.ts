import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReloadableWorkerRegistry } from "./worker-registry-config.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

async function legacyFile(root: string) {
  const file = path.join(root, "config.yaml");
  await writeFile(file, `environments:\n  - environmentId: windows\n    url: http://127.0.0.1:7576\n    token: ${"a".repeat(32)}\n`);
  return file;
}

describe("ReloadableWorkerRegistry", () => {
  it("adopts valid legacy endpoint changes and retains the last good registry after invalid YAML", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-registry-"));
    const file = await legacyFile(temporary);
    const source = new ReloadableWorkerRegistry({ file });
    await source.initialize();
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, `environments:\n  - environmentId: windows\n    url: http://127.0.0.1:7576\n    token: ${"a".repeat(32)}\n  - environmentId: wsl\n    url: http://127.0.0.1:7577\n    token: ${"b".repeat(32)}\n`);
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows", "wsl"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, "environments: [invalid");
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows", "wsl"]);
  });

  it("cuts over from legacy routing when the first persistent membership is committed", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-cutover-"));
    const file = await legacyFile(temporary);
    const store = new WorkerMembershipStore(path.join(temporary, "state"));
    const source = new ReloadableWorkerRegistry({ memberships: store, legacy: { file } });
    await source.initialize();
    expect(source.isMembershipAuthoritative()).toBe(false);
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows"]);

    const credential = path.join(temporary, "worker.secret");
    await writeFile(credential, `${"c".repeat(32)}\n`);
    await store.add({
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "wsl",
      transport: { type: "http", endpoint: "http://127.0.0.1:7577" },
      credentialRefs: [{ kind: "secret-file", path: credential }],
    });

    expect((await source.current()).configuredEnvironmentIds()).toEqual(["wsl"]);
    expect(source.isMembershipAuthoritative()).toBe(true);
  });

  it("never resurrects legacy endpoints once the membership store exists, even when it is empty", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-authority-"));
    const file = await legacyFile(temporary);
    const store = new WorkerMembershipStore(path.join(temporary, "state"));
    await store.replace({ version: 1, workers: [] });
    const source = new ReloadableWorkerRegistry({ memberships: store, legacy: { file } });
    await source.initialize();

    expect(source.isMembershipAuthoritative()).toBe(true);
    expect((await source.current()).configuredEnvironmentIds()).toEqual([]);

    await writeFile(file, `environments:\n  - environmentId: windows\n    url: http://127.0.0.1:7576\n    token: ${"d".repeat(32)}\n  - environmentId: wsl\n    url: http://127.0.0.1:7577\n    token: ${"e".repeat(32)}\n`);
    expect((await source.current()).configuredEnvironmentIds()).toEqual([]);
  });
});
