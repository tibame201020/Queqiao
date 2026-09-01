import { describe, expect, it, vi } from "vitest";
import type { WorkstationSnapshot } from "./workstation.js";
import {
  createWorkstationInspectorViewModel,
  inspectorTargetKey,
  loadWorkstationInspectorDetail,
  type WorkstationInspectorTarget,
} from "./workstation-inspector.js";

const snapshot = (): WorkstationSnapshot => ({
  gateways: [
    { name: "stable", configured: true, running: true, managed: true, publicUrl: "https://example.test/stable/", servicePort: 8075, managementPort: 8074 },
    { name: "lab", configured: true, running: false, managed: false, publicUrl: "https://example.test/lab/", servicePort: 9075, managementPort: 9074 },
  ],
  workers: [
    { name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: 2 },
    { name: "wsl", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:12976/", workspaceCount: 1 },
  ],
  workspaces: [
    { workerName: "wins-worker", id: "queqiao", displayName: "Queqiao", root: "C:\\codes\\Queqiao", profile: "coding-safe" },
    { workerName: "wins-worker", id: "sandbox", displayName: "Sandbox", root: "C:\\sandbox", profile: "Reader" },
    { workerName: "wsl", id: "linux", displayName: "Linux", root: "/workspace/codes", profile: "Reader" },
  ],
  profiles: [
    { name: "Reader", builtin: true, tools: ["read_file", "list_directory"], allowedExecutables: [] },
    { name: "coding-safe", builtin: false, tools: ["read_file", "edit_file", "run"], allowedExecutables: ["git", "npm"] },
  ],
  extensions: [{ id: "dev.queqiao.mcp", displayName: "MCP", version: "0.1.1", package: "@tibame201020/queqiao-mcp", workers: [{ name: "wins-worker", attached: true }, { name: "wsl", attached: false }] }],
  gatewayCount: 2,
  runningGatewayCount: 1,
  workerCount: 2,
  runningWorkerCount: 2,
  workspaceCount: 3,
  profileCount: 2,
  customProfileCount: 1,
  extensionCount: 1,
  attachmentCount: 1,
  gettingStarted: [],
});

describe("Workstation structured Inspector view models", () => {
  it("loads only the selected Gateway runtime and membership detail", async () => {
    const runtimeStatus = vi.fn(async (role: "gateway" | "worker", name: string) => ({
      name,
      role,
      active: true,
      managed: true,
      pid: 1234,
      health: { reachable: true, healthy: true, identityMatches: true, status: 200 },
    }));
    const gatewayMembers = vi.fn(async (name: string) => ({
      workers: name === "stable" ? [{
        workerId: "worker-win",
        environmentId: "windows",
        transport: { type: "http", endpoint: "http://127.0.0.1:8076/" },
      }] : [],
    }));

    const target: WorkstationInspectorTarget = { kind: "gateway", name: "stable" };
    const detail = await loadWorkstationInspectorDetail(snapshot(), target, { runtimeStatus, gatewayMembers });
    const view = createWorkstationInspectorViewModel(snapshot(), target, detail);

    expect(runtimeStatus).toHaveBeenCalledTimes(1);
    expect(runtimeStatus).toHaveBeenCalledWith("gateway", "stable");
    expect(gatewayMembers).toHaveBeenCalledTimes(1);
    expect(gatewayMembers).toHaveBeenCalledWith("stable");
    expect(view).toMatchObject({
      kind: "gateway",
      key: "gateway:stable",
      title: "stable",
      runtime: { state: "ready", active: true, managed: true, pid: 1234, health: { healthy: true, status: 200 } },
      workers: { state: "ready", items: [{ environmentId: "windows", endpoint: "http://127.0.0.1:8076/" }] },
    });
  });

  it("matches a selected Worker to enrolled Gateways only by workerId plus environmentId", async () => {
    const runtimeStatus = vi.fn(async () => ({
      active: true,
      managed: true,
      health: { reachable: true, healthy: true, identityMatches: true, status: 200 },
    }));
    const workerIdentity = vi.fn(async () => ({ workerId: "worker-win", environmentId: "windows" }));
    const gatewayMembers = vi.fn(async (name: string) => ({
      workers: name === "stable"
        ? [{ workerId: "worker-win", environmentId: "windows", transport: { endpoint: "http://127.0.0.1:8076/" } }]
        : [{ workerId: "different-id", environmentId: "windows", transport: { endpoint: "http://127.0.0.1:8076/" } }],
    }));

    const target: WorkstationInspectorTarget = { kind: "worker", name: "wins-worker" };
    const detail = await loadWorkstationInspectorDetail(snapshot(), target, { runtimeStatus, workerIdentity, gatewayMembers });
    const view = createWorkstationInspectorViewModel(snapshot(), target, detail);

    expect(workerIdentity).toHaveBeenCalledWith("wins-worker");
    expect(gatewayMembers).toHaveBeenCalledTimes(1);
    expect(gatewayMembers).toHaveBeenCalledWith("stable");
    expect(view).toMatchObject({
      kind: "worker",
      title: "wins-worker",
      workspaces: [
        { displayName: "Queqiao", profile: "coding-safe" },
        { displayName: "Sandbox", profile: "Reader" },
      ],
      extensions: [{ displayName: "MCP", version: "0.1.1" }],
      gateways: { state: "ready", items: [{ name: "stable", endpoint: "http://127.0.0.1:8076/" }] },
    });
  });

  it("does not call Gateway membership management when the selected Gateway is stopped", async () => {
    const gatewayMembers = vi.fn(async () => ({ workers: [] }));
    const target: WorkstationInspectorTarget = { kind: "gateway", name: "lab" };
    const detail = await loadWorkstationInspectorDetail(snapshot(), target, {
      runtimeStatus: async () => ({ active: false, managed: false, health: { reachable: false, healthy: false, identityMatches: false, error: "fetch failed" } }),
      gatewayMembers,
    });
    const view = createWorkstationInspectorViewModel(snapshot(), target, detail);
    expect(gatewayMembers).not.toHaveBeenCalled();
    expect(view.kind).toBe("gateway");
    if (view.kind !== "gateway") throw new Error("expected gateway inspector");
    expect(view.workers).toEqual({ state: "unavailable", message: "Start the Gateway to inspect enrolled Workers." });
  });

  it("does not claim an enrolled Gateway when the Worker identity is unavailable", async () => {
    const target: WorkstationInspectorTarget = { kind: "worker", name: "wins-worker" };
    const detail = await loadWorkstationInspectorDetail(snapshot(), target, {
      runtimeStatus: async () => ({ active: true, managed: true, health: { reachable: true, healthy: true, identityMatches: true } }),
      workerIdentity: async () => ({ environmentId: "windows" }),
      gatewayMembers: async () => ({ workers: [{ workerId: "worker-win", environmentId: "windows" }] }),
    });
    const view = createWorkstationInspectorViewModel(snapshot(), target, detail);
    expect(view.kind).toBe("worker");
    if (view.kind !== "worker") throw new Error("expected worker inspector");
    expect(view.gateways).toEqual({ state: "unavailable", message: "Worker identity is unavailable; Gateway enrollment was not inferred." });
  });

  it("loads structured Diagnostics lazily through one authoritative doctor query", async () => {
    const diagnostics = vi.fn(async () => ({
      ok: false,
      gateways: [{
        name: "stable", role: "gateway" as const, ok: false, configFile: "gateway.yaml",
        status: { name: "stable", role: "gateway" as const, active: true, managed: true, health: { reachable: true, healthy: false, identityMatches: true, status: 503 } },
        routing: { ok: false, gateway: { reachable: true, status: 503 }, environments: [{ environmentId: "linux", reachable: false }], workerDiagnostics: { supported: false as const, reason: "not advertised" } },
      }],
      workers: [{ name: "wins-worker", role: "worker" as const, ok: true, configFile: "worker.yaml", status: { name: "wins-worker", role: "worker" as const, active: true, managed: true, health: { reachable: true, healthy: true, identityMatches: true, status: 200 } } }],
      extensions: { ok: true, extensionCount: 1, workerCount: 2, issues: [] },
    }));
    const target: WorkstationInspectorTarget = { kind: "diagnostics" };
    const detail = await loadWorkstationInspectorDetail(snapshot(), target, { diagnostics });
    const view = createWorkstationInspectorViewModel(snapshot(), target, detail);
    expect(diagnostics).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({
      kind: "diagnostics",
      diagnostics: {
        ok: false,
        core: [expect.objectContaining({ key: "gateway:stable", state: "warning" }), expect.objectContaining({ key: "worker:wins-worker", state: "healthy" })],
        routing: [expect.objectContaining({ key: "route:stable:linux", state: "warning" })],
        extensions: { state: "healthy" },
      },
    });
  });

  it("builds Workspace, Access Profile, and Extension inspectors from the cheap snapshot without lazy queries", () => {
    const data = snapshot();
    const workspace = createWorkstationInspectorViewModel(data, { kind: "workspace", workerName: "wins-worker", workspaceId: "queqiao" });
    const profile = createWorkstationInspectorViewModel(data, { kind: "profile", name: "coding-safe" });
    const extension = createWorkstationInspectorViewModel(data, { kind: "extension", extensionId: "dev.queqiao.mcp" });

    expect(workspace).toMatchObject({ kind: "workspace", workerName: "wins-worker", root: "C:\\codes\\Queqiao", profile: "coding-safe", profileSemantics: "copy-on-apply" });
    expect(profile).toMatchObject({ kind: "profile", builtin: false, tools: ["read_file", "edit_file", "run"], allowedExecutables: ["git", "npm"], templateSemantics: "detached" });
    expect(extension).toMatchObject({ kind: "extension", extensionId: "dev.queqiao.mcp", package: "@tibame201020/queqiao-mcp", attachments: [{ workerName: "wins-worker", attached: true }, { workerName: "wsl", attached: false }] });
  });

  it("uses stable keys for every Inspector target", () => {
    expect(inspectorTargetKey({ kind: "gateway", name: "stable" })).toBe("gateway:stable");
    expect(inspectorTargetKey({ kind: "worker", name: "wins-worker" })).toBe("worker:wins-worker");
    expect(inspectorTargetKey({ kind: "workspace", workerName: "wins-worker", workspaceId: "queqiao" })).toBe("workspace:wins-worker:queqiao");
    expect(inspectorTargetKey({ kind: "profile", name: "Reader" })).toBe("profile:Reader");
    expect(inspectorTargetKey({ kind: "extension", extensionId: "dev.queqiao.mcp" })).toBe("extension:dev.queqiao.mcp");
  });
});
