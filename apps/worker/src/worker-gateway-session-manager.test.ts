import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeRuntimeConfig } from "@queqiao/config";
import { WorkerGatewaySessionManager } from "./worker-gateway-session-manager.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-gateway-session-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const local = path.join(root, "local.secret");
  const membership = path.join(root, "membership.secret");
  await writeFile(local, `${"l".repeat(48)}\n`);
  await writeFile(membership, `${"m".repeat(48)}\n`);
  const configFile = path.join(root, "config.yaml");
  await writeFile(configFile, serializeRuntimeConfig({
    version: 1,
    workspaces: [{ id: "default", displayName: "default", root: workspace, profile: "read-only" }],
    worker: {
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "windows",
      listen: { host: "127.0.0.1", port: 7576 },
      tokenFile: local,
      memberships: [{ gateway: "https://gateway.example/", credentialRef: { kind: "secret-file", path: membership }, protocols: {} }],
    },
  }), "utf8");
  return { configFile };
}

describe("WorkerGatewaySessionManager reconciliation", () => {
  it("publishes the actual local HTTP listening port while preserving the authoritative enabled set", async () => {
    const f = await fixture();
    const requests: Array<{ method: string; body?: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const method = init?.method || "GET";
      requests.push({ method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (method === "GET") return new Response(JSON.stringify({ enabled: ["http", "grpc"], protocols: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ updated: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const manager = new WorkerGatewaySessionManager(f.configFile, { execute: vi.fn() } as any);
    await manager.reconcileMembershipTransports(8676);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      method: "PUT",
      body: {
        workerId: "11111111-1111-4111-8111-111111111111",
        transports: [
          { type: "http", endpoint: "http://127.0.0.1:8676/" },
          { type: "grpc", mode: "reverse" },
        ],
      },
    });
  });

  it("does not overwrite a membership when the Gateway has an enabled future protocol this Worker cannot reconstruct", async () => {
    const f = await fixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ enabled: ["http", "webrtc"], protocols: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const manager = new WorkerGatewaySessionManager(f.configFile, { execute: vi.fn() } as any);
    await manager.reconcileMembershipTransports(8676);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
