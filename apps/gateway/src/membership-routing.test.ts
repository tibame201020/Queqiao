import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerApp } from "../../worker/src/app.js";
import { MembershipWorkerRegistry } from "./worker-membership-registry.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

let temporary: string | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("membership-backed Worker routing", () => {
  it("routes through persisted membership using Worker Protocol 3.0 stable identity", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-membership-route-"));
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "membership-routing-secret".repeat(2);
    const workspaceRoot = path.join(temporary, "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspaceRoot));
    const worker = await createWorkerApp({
      workerId,
      environmentId: "windows",
      workerCredential: { current: async () => credential },
      workspaces: [{ id: "fixture", displayName: "Fixture", root: workspaceRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
    });
    server = await new Promise<Server>((resolve) => {
      const listening = worker.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Worker did not listen");

    const credentialFile = path.join(temporary, "worker.secret");
    await writeFile(credentialFile, `${credential}\n`, "utf8");
    const memberships = new WorkerMembershipStore(path.join(temporary, "gateway-state"));
    await memberships.add({
      workerId,
      environmentId: "windows",
      transport: { type: "http", endpoint: `http://127.0.0.1:${address.port}/` },
      credentialRefs: [{ kind: "secret-file", path: credentialFile }],
    });

    const source = new MembershipWorkerRegistry(memberships);
    await source.initialize();
    const registry = await source.current();
    expect(registry.configuredEnvironmentIds()).toEqual(["windows"]);
    await expect(registry.listWorkspaces()).resolves.toMatchObject({
      environments: [{ environmentId: "windows", online: true }],
      workspaces: [{ workspaceId: "fixture", environmentId: "windows" }],
    });
    await expect(registry.workspaceInfo("fixture")).resolves.toMatchObject({
      value: {
        workspaceId: "fixture",
        environmentId: "windows",
        transports: [{
          type: "http",
          status: "healthy",
          mode: "direct",
          traits: { requestResponse: true, streaming: "none", connection: "stateless", topology: "direct" },
        }],
      },
      routing: { environmentId: "windows", requestedTransport: null, selectedTransport: "http", selectionReason: "configured_order" },
    });

    await memberships.updateTransport(workerId, { type: "http", endpoint: "http://127.0.0.1:1/" });
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows"]);
    await expect((await source.current()).listEnvironments()).resolves.toMatchObject([{ environmentId: "windows", online: false }]);

    await memberships.updateTransport(workerId, { type: "http", endpoint: `http://127.0.0.1:${address.port}/` });
    await expect((await source.current()).listEnvironments()).resolves.toMatchObject([{ environmentId: "windows", online: true }]);

    await memberships.remove(workerId);
    expect((await source.current()).configuredEnvironmentIds()).toEqual([]);
  });
});
