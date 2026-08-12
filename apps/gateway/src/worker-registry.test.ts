import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerRegistry } from "./worker-registry.js";

afterEach(() => vi.unstubAllGlobals());

function state(environmentId: string, workspaceId = "shared") {
  return { environmentId, defaultWorkspaceId: workspaceId, workspaces: [{ environmentId, workspaceId, displayName: workspaceId, root: "/workspace", profile: "read-only", tools: { allow: [], deny: [] }, commands: { allow: [] } }] };
}

describe("Worker routing security", () => {
  it("fails closed when a workspace ID is ambiguous across environments", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL | string) => {
      const environmentId = String(url).includes("7576") ? "windows" : "wsl";
      return Promise.resolve(new Response(JSON.stringify(state(environmentId)), { status: 200, headers: { "content-type": "application/json" } }));
    }));
    const registry = new WorkerRegistry([
      { environmentId: "windows", url: new URL("http://127.0.0.1:7576"), token: "a" },
      { environmentId: "wsl", url: new URL("http://127.0.0.1:7577"), token: "b" },
    ]);
    await expect(registry.route("shared")).rejects.toThrow(/ambiguous/);
  });

  it("marks a Worker offline when its claimed environment identity differs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(state("attacker")), { status: 200, headers: { "content-type": "application/json" } }))));
    const registry = new WorkerRegistry([{ environmentId: "windows", url: new URL("http://127.0.0.1:7576"), token: "secret" }]);
    await expect(registry.listEnvironments()).resolves.toEqual([{ environmentId: "windows", online: false, workspaces: [] }]);
    await expect(registry.route("shared")).rejects.toThrow(/not available/);
  });
});
