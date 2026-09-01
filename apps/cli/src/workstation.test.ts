import { describe, expect, it, vi } from "vitest";
import type { RoleInstanceInventory } from "./instance-selector.js";
import {
  collectWorkstationSnapshot,
  executeWorkstationDirectAction,
  executeWorkstationFlowAction,
  renderWorkstationSummary,
  runWorkstation,
} from "./workstation.js";
import { encodeJoinCode } from "./enrollment-cli.js";
import type { WorkstationPromptDriver } from "./workstation-ui.js";

const gateway = (name: string, running = true): RoleInstanceInventory => ({
  name,
  configured: true,
  running,
  managed: running,
  publicUrl: `https://example.test/${name}/`,
  servicePort: 8000,
  managementPort: 7999,
});

const worker = (name: string, running = true, workspaceCount = 0): RoleInstanceInventory => ({
  name,
  configured: true,
  running,
  managed: running,
  endpoint: `http://127.0.0.1:${running ? 9000 : 9001}/`,
  workspaceCount,
});

const profiles = async () => ({
  schemaVersion: "1.0",
  profiles: [
    { name: "Reader", builtin: true, tools: ["read_file"], allowedExecutables: [] },
    { name: "coding-safe", builtin: false, tools: ["read_file", "run"], allowedExecutables: ["git"] },
  ],
});

const promptDriver = (overrides: Partial<WorkstationPromptDriver> = {}): WorkstationPromptDriver => ({
  choose: async (_message, choices) => choices[0]!.value,
  multi: async (_message, _choices, initial = []) => initial,
  text: async (_message, initial = "") => initial,
  secret: async (_message, initial = "") => initial,
  confirm: async () => true,
  ...overrides,
});

describe("Queqiao Workstation", () => {
  it("aggregates runtime, Workspace, Access Profile, and Extension inventories without parallel state", async () => {
    const snapshot = await collectWorkstationSnapshot({
      listRoleInstances: async (role) => role === "gateway"
        ? [gateway("stable")]
        : [worker("wins-worker", true, 1), worker("wsl", false, 1)],
      listManagedWorkspaces: async (configFile) => ({
        schemaVersion: "1.0",
        workspaces: [{
          id: configFile.includes("wins-worker") ? "queqiao" : "ai-stack",
          displayName: configFile.includes("wins-worker") ? "Queqiao" : "AI Stack",
          root: configFile.includes("wins-worker") ? "C:\\codes\\Queqiao" : "/workspace/ai-stack",
          access: { capabilityCeiling: "coding" },
        }],
      }),
      listAccessProfiles: profiles,
      listExtensions: async () => ({
        hub: "test",
        extensions: [
          { id: "dev.queqiao.git", displayName: "Git", version: "1.0.0", package: "git", workers: [{ name: "wins-worker", attached: true }, { name: "wsl", attached: false }] },
          { id: "dev.queqiao.mcp", displayName: "MCP", version: "0.1.1", package: "mcp", workers: [{ name: "wins-worker", attached: true }, { name: "wsl", attached: true }] },
        ],
      }),
    });

    expect(snapshot).toMatchObject({
      gatewayCount: 1,
      runningGatewayCount: 1,
      workerCount: 2,
      runningWorkerCount: 1,
      workspaceCount: 2,
      profileCount: 2,
      customProfileCount: 1,
      extensionCount: 2,
      attachmentCount: 3,
      gettingStarted: [],
    });
    expect(snapshot.workspaces).toHaveLength(2);
    expect(snapshot.profiles.map((entry) => entry.name)).toEqual(["Reader", "coding-safe"]);
    expect(snapshot.workspaces.map((entry) => entry.workerName).sort()).toEqual(["wins-worker", "wsl"]);
  });

  it("derives getting-started gaps from inventory instead of a one-shot wizard state machine", async () => {
    const snapshot = await collectWorkstationSnapshot({
      listRoleInstances: async () => [],
      listExtensions: async () => ({ hub: "test", extensions: [] }),
      listAccessProfiles: async () => ({ schemaVersion: "1.0", profiles: [] }),
      listManagedWorkspaces: async () => ({ schemaVersion: "1.0", workspaces: [] }),
    });
    expect(snapshot.gettingStarted).toEqual(["gateway", "worker", "workspace"]);
    expect(renderWorkstationSummary(snapshot, false)).toContain("Getting started");
  });

  it("dispatches direct runtime actions through existing lifecycle handlers", async () => {
    const stopRuntime = vi.fn(async () => ({ stopped: true }));
    const result = await executeWorkstationDirectAction(
      { type: "role-stop", role: "worker", name: "wins-worker" },
      { stopRuntime },
    );
    expect(stopRuntime).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "success", title: "Worker stopped" });
    expect(result.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Worker", value: "wins-worker" })]));
  });

  it("runs Diagnostics through one authoritative doctor query without duplicating Extension Hub checks", async () => {
    const doctorQueqiao = vi.fn(async () => ({ ok: true, gateways: [], workers: [], extensions: { ok: true, issues: [] } }));
    const result = await executeWorkstationDirectAction({ type: "diagnostics" }, { doctorQueqiao });
    expect(doctorQueqiao).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "success", title: "Diagnostics complete", summary: "No health issues were reported." });
  });

  it("dispatches Extension attachment toggles through existing Extension handlers", async () => {
    const detachExtension = vi.fn(async () => ({ detached: true }));
    const result = await executeWorkstationDirectAction(
      { type: "extension-toggle", extensionId: "dev.queqiao.mcp", workerName: "wins-worker", attached: true },
      { detachExtension },
    );
    expect(detachExtension).toHaveBeenCalledWith("dev.queqiao.mcp", "wins-worker");
    expect(result).toMatchObject({ status: "success", title: "Extension detached" });
  });

  it("runs role setup through the canonical setup wizard with Ink prompts injected", async () => {
    const setupRole = vi.fn(async (_role, _args, dependencies) => ({
      name: await dependencies.prompts!.text("Gateway name", "stable"),
    }));
    const result = await executeWorkstationFlowAction(
      { type: "setup-role", role: "gateway", name: "stable" },
      promptDriver(),
      { setupRole },
    );
    expect(setupRole).toHaveBeenCalledWith("gateway", ["gateway", "setup"], expect.objectContaining({ interactive: true, prompts: expect.any(Object) }));
    expect(result).toMatchObject({ status: "success", title: "Gateway configured" });
    expect(result.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Gateway", value: "stable" })]));
  });

  it("injects the same Ink access prompts into Workspace add instead of opening Clack", async () => {
    const addWorkspace = vi.fn(async (_configFile, _args, _legacyPrompt, injected) => ({
      injected: Boolean(injected?.prompts && injected?.pathPrompt),
    }));
    const result = await executeWorkstationFlowAction(
      { type: "workspace-add", workerName: "wins-worker" },
      promptDriver(),
      { addWorkspace },
    );
    expect(addWorkspace).toHaveBeenCalledTimes(1);
    expect(addWorkspace.mock.calls[0]![3]).toMatchObject({ prompts: expect.any(Object), pathPrompt: expect.any(Function) });
    expect(result).toMatchObject({ status: "success", title: "Workspace added" });
  });

  it("creates Access Profiles through the existing scripted application API after Ink collection", async () => {
    const createAccessProfile = vi.fn(async (args: readonly string[]) => ({ created: true, args }));
    const prompts = promptDriver({
      text: async (message) => message === "Profile name" ? "coding-safe" : "git,npm",
      multi: async () => ["read_file", "run"],
    });
    const result = await executeWorkstationFlowAction({ type: "profile-create" }, prompts, { createAccessProfile });
    expect(createAccessProfile).toHaveBeenCalledWith(["--name", "coding-safe", "--tools", "read_file,run", "--commands", "git,npm"]);
    expect(result).toMatchObject({ status: "success", title: "Access Profile created" });
  });

  it("passes destructive review metadata before Workspace mutation and cancellation commits nothing", async () => {
    const removeWorkspace = vi.fn(async () => ({ removed: true }));
    const confirm = vi.fn(async () => false);
    const result = await executeWorkstationFlowAction(
      { type: "workspace-remove", workerName: "wins-worker", workspaceId: "queqiao", displayName: "Queqiao" },
      promptDriver({ confirm }),
      { removeWorkspace },
    );
    expect(confirm).toHaveBeenCalledWith("Remove Workspace Queqiao?", false, {
      tone: "destructive",
      title: "Remove Workspace",
      details: ["Workspace: Queqiao", "Worker: wins-worker", "Effect: remove this authorized root"],
    });
    expect(removeWorkspace).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "cancelled", title: "Workspace removal cancelled" });
  });

  it("injects destructive target/effect review into canonical role removal", async () => {
    const confirm = vi.fn(async () => false);
    const removeRole = vi.fn(async (_role, _args, injected) => ({
      approved: await injected.prompts!.confirm("Remove configured Gateway stable?"),
    }));
    await executeWorkstationFlowAction(
      { type: "remove-role", role: "gateway", name: "stable" },
      promptDriver({ confirm }),
      { removeRole },
    );
    expect(confirm).toHaveBeenCalledWith("Remove configured Gateway stable?", false, {
      tone: "destructive",
      title: "Remove Gateway",
      details: [
        "Gateway: stable",
        "Effect: remove Queqiao-owned local configuration, state, data, and runtime files",
      ],
    });
  });

  it("reviews Gateway enrollment identity before removal and cancellation commits nothing", async () => {
    const confirm = vi.fn(async () => false);
    const removeJoinedWorker = vi.fn(async () => ({ removed: true }));
    const choose = vi.fn(async (message: string) => message === "Worker" ? "worker-id" : "remove");
    const result = await executeWorkstationFlowAction(
      { type: "gateway-members", name: "stable" },
      promptDriver({ choose, confirm }),
      {
        listJoinedWorkers: async () => ({ workers: [{ workerId: "worker-id", environmentId: "windows", transport: { endpoint: "http://127.0.0.1:8076/" } }] }),
        removeJoinedWorker,
      },
    );
    expect(confirm).toHaveBeenCalledWith("Remove enrolled Worker windows?", false, {
      tone: "destructive",
      title: "Remove Gateway enrollment",
      details: [
        "Environment: windows",
        "Worker ID: worker-id",
        "Endpoint: http://127.0.0.1:8076/",
        "Effect: remove this Worker from the Gateway membership registry",
      ],
    });
    expect(removeJoinedWorker).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "cancelled", title: "Worker enrollment removal cancelled" });
  });

  it("reviews Access Profile deletion and Extension uninstall before mutation", async () => {
    const profileConfirm = vi.fn(async () => false);
    const deleteAccessProfile = vi.fn(async () => ({ deleted: true }));
    const profileResult = await executeWorkstationFlowAction(
      { type: "profile-delete", name: "coding-safe" },
      promptDriver({ confirm: profileConfirm }),
      { deleteAccessProfile },
    );
    expect(profileConfirm).toHaveBeenCalledWith("Delete Access Profile coding-safe? Existing Workspaces remain unchanged.", false, {
      tone: "destructive",
      title: "Delete Access Profile",
      details: ["Profile: coding-safe", "Effect: delete this reusable template", "Existing Workspaces remain unchanged"],
    });
    expect(deleteAccessProfile).not.toHaveBeenCalled();
    expect(profileResult).toMatchObject({ status: "cancelled", title: "Access Profile deletion cancelled" });

    const extensionConfirm = vi.fn(async () => false);
    const uninstallExtension = vi.fn(async () => ({ uninstalled: true }));
    const extensionResult = await executeWorkstationFlowAction(
      { type: "extension-uninstall", extensionId: "dev.queqiao.mcp", displayName: "MCP", attachedWorkers: 2 },
      promptDriver({ confirm: extensionConfirm }),
      { uninstallExtension },
    );
    expect(extensionConfirm).toHaveBeenCalledWith("Uninstall MCP and detach it from 2 Worker(s)?", false, {
      tone: "destructive",
      title: "Uninstall Extension",
      details: [
        "Extension: MCP",
        "Extension ID: dev.queqiao.mcp",
        "Worker attachments to detach: 2",
        "Effect: remove the installed Extension from the local Hub",
      ],
    });
    expect(uninstallExtension).not.toHaveBeenCalled();
    expect(extensionResult).toMatchObject({ status: "cancelled", title: "Extension uninstall cancelled" });
  });

  it("enrolls a Worker from a masked self-contained join code even when local Gateways exist", async () => {
    const joinCode = encodeJoinCode({ v: 1, gateway: "https://remote.example/gateway/", token: "r".repeat(40) });
    const choose = vi.fn(async (message: string, choices: Array<{ value: string }>) => message === "Enrollment source" ? "__join_code__" : choices[0]!.value);
    const secret = vi.fn(async () => joinCode);
    const joinWorker = vi.fn(async () => ({ joined: true }));
    const result = await executeWorkstationFlowAction(
      { type: "worker-join", workerName: "wins-worker" },
      promptDriver({ choose, secret }),
      {
        listRoleInstances: async (role) => role === "gateway" ? [gateway("stable")] : [worker("wins-worker")],
        joinWorker,
      },
    );
    expect(choose).toHaveBeenCalledWith("Enrollment source", expect.arrayContaining([
      expect.objectContaining({ value: "local:stable" }),
      expect.objectContaining({ value: "__join_code__" }),
    ]));
    expect(secret).toHaveBeenCalledWith("Join code", "", expect.any(Function));
    expect(joinWorker).toHaveBeenCalledWith(expect.any(String), ["worker", "join", "--worker", "wins-worker", "--join-code", joinCode]);
    expect(result).toMatchObject({ status: "success", title: "Worker joined Gateway" });
    expect(JSON.stringify(result)).not.toContain(joinCode);
  });

  it("uses the canonical Gateway info API for connector handoff without returning the approval secret", async () => {
    const gatewayInfo = vi.fn(async (_configFile: string, _layout: unknown, gatewayName: string, args: readonly string[]) => ({
      schemaVersion: "1.0",
      gateway: gatewayName,
      mcpUrl: "https://example.test/stable/mcp",
      publicBaseUrl: "https://example.test/stable/",
      authentication: "OAuth 2.0 Authorization Code + PKCE" as const,
      approvalSecretAvailable: true,
      copied: args.includes("--copy-secret") ? "approval-secret" as const : "mcp-url" as const,
    }));
    const secretResult = await executeWorkstationDirectAction(
      { type: "gateway-copy-approval-secret", name: "stable" } as never,
      { gatewayInfo, doctorQueqiao: async () => { throw new Error("unexpected diagnostics fallback"); } } as never,
    );
    const urlResult = await executeWorkstationDirectAction(
      { type: "gateway-copy-mcp-url", name: "stable" } as never,
      { gatewayInfo, doctorQueqiao: async () => { throw new Error("unexpected diagnostics fallback"); } } as never,
    );
    expect(gatewayInfo).toHaveBeenNthCalledWith(1, expect.any(String), expect.any(Object), "stable", ["--copy-secret"]);
    expect(gatewayInfo).toHaveBeenNthCalledWith(2, expect.any(String), expect.any(Object), "stable", ["--copy-url"]);
    expect(secretResult).toMatchObject({ status: "success", title: "Approval secret copied" });
    expect(secretResult.sideEffects).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Clipboard", value: "Approval secret copied" })]));
    expect(JSON.stringify(secretResult)).not.toContain("approvalSecret\":");
    expect(urlResult).toMatchObject({ status: "success", title: "MCP URL copied" });
  });

  it("uses the Ink shell as the only Workstation presentation path", async () => {
    const runShell = vi.fn(async () => ({ type: "exit" as const }));
    await runWorkstation([], {
      interactive: true,
      runShell,
      listRoleInstances: async () => [],
      listExtensions: async () => ({ hub: "test", extensions: [] }),
      listAccessProfiles: async () => ({ schemaVersion: "1.0", profiles: [] }),
      listManagedWorkspaces: async () => ({ schemaVersion: "1.0", workspaces: [] }),
    });
    expect(runShell).toHaveBeenCalledTimes(1);
    expect(runShell.mock.calls[0]![0]).toMatchObject({ gatewayCount: 0, workerCount: 0, workspaceCount: 0 });
    expect(runShell.mock.calls[0]!.slice(1)).toHaveLength(4);
  });

  it("rejects non-interactive use because leaf CLI commands remain the automation API", async () => {
    await expect(runWorkstation([], { interactive: false })).rejects.toThrow(/interactive terminal/i);
  });
});