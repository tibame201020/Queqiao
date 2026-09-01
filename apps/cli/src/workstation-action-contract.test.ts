import { describe, expect, it } from "vitest";
import type { WorkstationSnapshot } from "./workstation.js";
import { workstationUiInternals } from "./workstation-ui.js";
import type { WorkstationInspectorTarget } from "./workstation-inspector.js";

function snapshot(overrides: Partial<WorkstationSnapshot> = {}): WorkstationSnapshot {
  return {
    gateways: [
      { name: "running-gateway", configured: true, running: true, managed: true, publicUrl: "https://example.test/running/", servicePort: 8000, managementPort: 8001 },
      { name: "stopped-gateway", configured: true, running: false, managed: false, publicUrl: "https://example.test/stopped/", servicePort: 8010, managementPort: 8011 },
    ],
    workers: [
      { name: "running-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:9000/", workspaceCount: 2 },
      { name: "stopped-worker", configured: true, running: false, managed: false, endpoint: "http://127.0.0.1:9010/", workspaceCount: 1 },
    ],
    workspaces: [
      { workerName: "running-worker", id: "main", displayName: "Main", root: "C:\\main", profile: "coding" },
      { workerName: "running-worker", id: "aux", displayName: "Aux", root: "C:\\aux", profile: "read-only" },
      { workerName: "stopped-worker", id: "only", displayName: "Only", root: "C:\\only", profile: "read-only" },
    ],
    profiles: [
      { name: "Reader", builtin: true, tools: ["read_file"], allowedExecutables: [] },
      { name: "custom", builtin: false, tools: ["read_file", "edit_file"], allowedExecutables: ["git"] },
    ],
    extensions: [{
      id: "dev.example.extension",
      displayName: "Example Extension",
      version: "1.0.0",
      package: "example-extension",
      workers: [
        { name: "running-worker", attached: true },
        { name: "stopped-worker", attached: false },
      ],
    }],
    gatewayCount: 2,
    runningGatewayCount: 1,
    workerCount: 2,
    runningWorkerCount: 1,
    workspaceCount: 3,
    profileCount: 2,
    customProfileCount: 1,
    extensionCount: 1,
    attachmentCount: 1,
    gettingStarted: [],
    ...overrides,
  };
}

function actions(target: WorkstationInspectorTarget, source = snapshot()) {
  return workstationUiInternals.actionItems(source, target);
}

function action(target: WorkstationInspectorTarget, key: string, source = snapshot()) {
  const found = actions(target, source).find((entry) => entry.key === key);
  expect(found, `${target.kind}:${key}`).toBeDefined();
  return found!;
}

describe("Workstation action contract matrix", () => {
  it("covers every Gateway operation and moves runtime preconditions into availability", () => {
    const running = { kind: "gateway", name: "running-gateway" } as const;
    expect(actions(running).map((entry) => entry.key)).toEqual([
      "lifecycle", "configure", "copy-mcp-url", "copy-approval-secret", "members", "join-code", "remove",
    ]);
    expect(action(running, "lifecycle")).toMatchObject({ label: "Stop", direct: { type: "role-stop" } });
    expect(action(running, "members").disabledReason).toBeUndefined();
    expect(action(running, "join-code").disabledReason).toBeUndefined();
    expect(action(running, "remove").disabledReason).toBe("Stop the Gateway first.");

    const stopped = { kind: "gateway", name: "stopped-gateway" } as const;
    expect(action(stopped, "lifecycle")).toMatchObject({ label: "Start", direct: { type: "role-start" } });
    expect(action(stopped, "members").disabledReason).toBe("Start the Gateway first.");
    expect(action(stopped, "join-code").disabledReason).toBe("Start the Gateway first.");
    expect(action(stopped, "remove").disabledReason).toBeUndefined();
  });

  it("covers every Worker operation and blocks enrollment/removal at the correct lifecycle boundary", () => {
    const running = { kind: "worker", name: "running-worker" } as const;
    expect(actions(running).map((entry) => entry.key)).toEqual(["lifecycle", "configure", "workspace", "join", "remove"]);
    expect(action(running, "join").disabledReason).toBeUndefined();
    expect(action(running, "remove").disabledReason).toBe("Stop the Worker first.");

    const stopped = { kind: "worker", name: "stopped-worker" } as const;
    expect(action(stopped, "join").disabledReason).toBe("Start the Worker first.");
    expect(action(stopped, "remove").disabledReason).toBeUndefined();
  });

  it("covers Workspace edit/remove and blocks removal of the last authorized Workspace", () => {
    const multiple = { kind: "workspace", workerName: "running-worker", workspaceId: "main" } as const;
    expect(actions(multiple).map((entry) => entry.key)).toEqual(["edit", "remove"]);
    expect(action(multiple, "remove").disabledReason).toBeUndefined();

    const only = { kind: "workspace", workerName: "stopped-worker", workspaceId: "only" } as const;
    expect(action(only, "remove").disabledReason).toBe("A Worker must retain at least one Workspace.");
  });

  it("keeps built-in Profiles immutable and exposes all custom Profile mutations", () => {
    expect(actions({ kind: "profile", name: "Reader" })).toEqual([]);
    expect(actions({ kind: "profile", name: "custom" }).map((entry) => entry.key)).toEqual(["edit", "rename", "delete"]);
  });

  it("covers per-Worker Extension attach/detach plus uninstall", () => {
    const extensionActions = actions({ kind: "extension", extensionId: "dev.example.extension" });
    expect(extensionActions.map((entry) => entry.key)).toEqual([
      "attachment:running-worker", "attachment:stopped-worker", "uninstall",
    ]);
    expect(extensionActions[0]).toMatchObject({ label: "Detach · running-worker", direct: { type: "extension-toggle", attached: true } });
    expect(extensionActions[1]).toMatchObject({ label: "Attach · stopped-worker", direct: { type: "extension-toggle", attached: false } });
    expect(extensionActions[2]).toMatchObject({ label: "Uninstall Extension", flow: { type: "extension-uninstall", attachedWorkers: 1 } });
  });

  it("keeps Diagnostics as one authoritative operation", () => {
    expect(actions({ kind: "diagnostics" })).toEqual([
      expect.objectContaining({ key: "diagnostics", label: "Run diagnostics", direct: { type: "diagnostics" } }),
    ]);
  });

  it("covers domain-level create actions in the same contextual action surface", () => {
    const source = snapshot();
    expect(workstationUiInternals.contextActionItems(source, "gateways", { kind: "gateway", name: "running-gateway" }).at(-1)).toMatchObject({ key: "create", label: "Set up Gateway", shortcut: "n" });
    expect(workstationUiInternals.contextActionItems(source, "workers", { kind: "worker", name: "running-worker" }).at(-1)).toMatchObject({ key: "create", label: "Set up Worker", shortcut: "n" });
    expect(workstationUiInternals.contextActionItems(source, "workspaces", { kind: "workspace", workerName: "running-worker", workspaceId: "main" }).at(-1)).toMatchObject({ key: "create", label: "Add Workspace", shortcut: "n" });
    expect(workstationUiInternals.contextActionItems(source, "profiles", { kind: "profile", name: "custom" }).at(-1)).toMatchObject({ key: "create", label: "Create Profile", shortcut: "n" });
    expect(workstationUiInternals.contextActionItems(source, "extensions", { kind: "extension", extensionId: "dev.example.extension" }).at(-1)).toMatchObject({ key: "create", label: "Install Extension", shortcut: "n" });
    expect(workstationUiInternals.contextActionItems(source, "diagnostics", { kind: "diagnostics" })).toHaveLength(1);
  });
});
