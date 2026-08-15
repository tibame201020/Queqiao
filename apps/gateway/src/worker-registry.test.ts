import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerRegistry } from "./worker-registry.js";
import { QUEQIAO_WORKER_LEGACY_CAPABILITIES, QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION } from "@queqiao/worker-protocol";

afterEach(() => vi.unstubAllGlobals());

function state(environmentId: string, workspaceId = "shared") {
  return { environmentId, defaultWorkspaceId: workspaceId, workspaces: [{ environmentId, workspaceId, displayName: workspaceId, root: "/workspace", profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }] };
}
function hello(environmentId: string) { return { protocolVersion: QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, environmentId, instanceId: "11111111-1111-4111-8111-111111111111", platform: "linux", capabilities: [...QUEQIAO_WORKER_LEGACY_CAPABILITIES] }; }

describe("Worker routing security", () => {
  it("fails closed when a workspace ID is ambiguous across environments", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL | string) => {
      const environmentId = String(url).includes("7576") ? "windows" : "wsl";
      return Promise.resolve(new Response(JSON.stringify(String(url).includes("/v1/hello") ? hello(environmentId) : state(environmentId)), { status: 200, headers: { "content-type": "application/json" } }));
    }));
    const registry = new WorkerRegistry([
      { environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "a" },
      { environmentId: "wsl", transport: { type: "http", endpoint: "http://127.0.0.1:7577" }, token: "b" },
    ]);
    await expect(registry.route("shared")).rejects.toThrow(/ambiguous/);
  });

  it("marks a Worker offline when its claimed environment identity differs", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL | string) => Promise.resolve(new Response(JSON.stringify(String(url).includes("/v1/hello") ? hello("attacker") : state("attacker")), { status: 200, headers: { "content-type": "application/json" } }))));
    const registry = new WorkerRegistry([{ environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "secret" }]);
    await expect(registry.listEnvironments()).resolves.toEqual([{ environmentId: "windows", online: false, workspaces: [] }]);
    await expect(registry.route("shared")).rejects.toThrow(/not available/);
  });
});
