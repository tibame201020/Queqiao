import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerRegistry } from "./worker-registry.js";
import { QUEQIAO_WORKER_LEGACY_CAPABILITIES, QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION } from "@queqiao/worker-protocol";

afterEach(() => vi.unstubAllGlobals());

function state(environmentId: string, workspaceId = "shared") {
  return { environmentId, workspaces: [{ environmentId, workspaceId, displayName: workspaceId, root: "/workspace", profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }] };
}
function hello(environmentId: string) { return { protocolVersion: QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, environmentId, instanceId: "11111111-1111-4111-8111-111111111111", platform: "linux", capabilities: [...QUEQIAO_WORKER_LEGACY_CAPABILITIES] }; }

describe("Worker routing security", () => {
  it("resolves an omitted workspace only when exactly one Workspace is available", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL | string) => Promise.resolve(new Response(JSON.stringify(String(url).includes("/v1/hello") ? hello("windows") : state("windows", "only")), { status: 200, headers: { "content-type": "application/json" } }))));
    const registry = new WorkerRegistry([{ environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "secret" }]);
    await expect(registry.implicitRoute()).resolves.toMatchObject({ workspaceId: "only" });
  });

  it("requires workspaceId when more than one Workspace is available", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL | string) => {
      const environmentId = String(url).includes("7576") ? "windows" : "wsl";
      const workspaceId = environmentId === "windows" ? "windows-codes" : "wsl-codes";
      return Promise.resolve(new Response(JSON.stringify(String(url).includes("/v1/hello") ? hello(environmentId) : state(environmentId, workspaceId)), { status: 200, headers: { "content-type": "application/json" } }));
    }));
    const registry = new WorkerRegistry([
      { environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "a" },
      { environmentId: "wsl", transport: { type: "http", endpoint: "http://127.0.0.1:7577" }, token: "b" },
    ]);
    await expect(registry.implicitRoute()).rejects.toMatchObject({ code: "workspace_required" });
  });

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

  it("prefers the healthier transport when omitted while an explicit transport remains exact", async () => {
    const runtime = (healthy: boolean) => ({
      execute: vi.fn(async (request: { operation: string }) => {
        if (request.operation === "health") {
          if (!healthy) throw new Error("unhealthy transport");
          return { ok: true };
        }
        if (request.operation === "hello") return hello("windows");
        if (request.operation === "list-workspaces") return state("windows", "only");
        throw new Error(`unexpected operation: ${request.operation}`);
      }),
    });
    const registry = new WorkerRegistry([
      { environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "secret", runtimeTransport: runtime(false) },
      { environmentId: "windows", transport: { type: "grpc", mode: "reverse" }, token: "secret", runtimeTransport: runtime(true) },
    ]);

    await registry.probeLiveness();
    await expect(registry.route("only")).resolves.toMatchObject({
      routing: { requestedTransport: null, selectedTransport: "grpc", selectionReason: "health_preferred" },
    });
    await expect(registry.route("only", "http")).resolves.toMatchObject({
      routing: { requestedTransport: "http", selectedTransport: "http", selectionReason: "explicit" },
    });
  });

  it("distinguishes an unknown dynamic transport from a registered transport that is not enabled", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL | string) => Promise.resolve(new Response(JSON.stringify(String(url).includes("/v1/hello") ? hello("windows") : state("windows", "only")), { status: 200, headers: { "content-type": "application/json" } }))));
    const registry = new WorkerRegistry([{ environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "secret" }]);

    await expect(registry.route("only", "webrtc")).rejects.toMatchObject({ code: "transport_unknown" });
    await expect(registry.route("only", "grpc")).rejects.toMatchObject({ code: "transport_not_enabled" });
  });

  it("marks a Worker offline when its claimed environment identity differs", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL | string) => Promise.resolve(new Response(JSON.stringify(String(url).includes("/v1/hello") ? hello("attacker") : state("attacker")), { status: 200, headers: { "content-type": "application/json" } }))));
    const registry = new WorkerRegistry([{ environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "secret" }]);
    await expect(registry.listEnvironments()).resolves.toEqual([{ environmentId: "windows", online: false, workspaces: [] }]);
    await expect(registry.route("shared")).rejects.toThrow(/not available/);
  });

  it("audits transport selection and failures without persisting Worker credentials or tool input", async () => {
    let failInvoke = false;
    const events: unknown[] = [];
    const runtime = {
      execute: vi.fn(async (request: { operation: string }) => {
        if (request.operation === "hello") return hello("windows");
        if (request.operation === "list-workspaces") return state("windows", "only");
        if (request.operation === "invoke-tool") {
          if (failInvoke) throw Object.assign(new Error("transport failed"), { code: "transport_failure" });
          return { result: { path: "fixture.txt", startLine: 1, endLine: 1, totalLines: 1, text: "ok" } };
        }
        throw new Error(`unexpected operation: ${request.operation}`);
      }),
    };
    const registry = new WorkerRegistry([
      { environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576" }, token: "must-not-be-audited", runtimeTransport: runtime },
    ], { append: async (event) => { events.push(event); } });

    await registry.readFile({ workspaceId: "only", path: "fixture.txt", offset: 0, limit: 10 });
    failInvoke = true;
    await expect(registry.readFile({ workspaceId: "only", path: "private-input.txt", offset: 0, limit: 10 })).rejects.toThrow("transport failed");

    expect(events).toMatchObject([
      { component: "gateway", category: "transport", action: "transport.select", outcome: "success", subject: { workspaceId: "only", environmentId: "windows" }, detail: { requestedTransport: null, selectedTransport: "http", selectionReason: "configured_order" } },
      { component: "gateway", category: "transport", action: "transport.select", outcome: "success", subject: { workspaceId: "only", environmentId: "windows" }, detail: { requestedTransport: null, selectedTransport: "http", selectionReason: "configured_order" } },
      { component: "gateway", category: "transport", action: "transport.execute", outcome: "failed", subject: { workspaceId: "only", environmentId: "windows" }, detail: { selectedTransport: "http", errorCode: "transport_failure" } },
    ]);
    expect(JSON.stringify(events)).not.toContain("must-not-be-audited");
    expect(JSON.stringify(events)).not.toContain("private-input.txt");
  });
});
