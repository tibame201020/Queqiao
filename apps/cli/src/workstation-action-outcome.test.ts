import { describe, expect, it, vi } from "vitest";
import { executeWorkstationDirectAction, executeWorkstationFlowAction } from "./workstation.js";
import { encodeJoinCode } from "./enrollment-cli.js";
import type { WorkstationPromptDriver } from "./workstation-ui.js";

const prompts = (overrides: Partial<WorkstationPromptDriver> = {}): WorkstationPromptDriver => ({
  choose: async (_message, choices) => choices[0]!.value,
  multi: async (_message, _choices, initial = []) => initial,
  text: async (_message, initial = "") => initial,
  secret: async (_message, initial = "") => initial,
  confirm: async () => true,
  ...overrides,
});

describe("Workstation typed action outcomes", () => {
  it("reports runtime stop no-op as warning instead of success", async () => {
    const outcome = await executeWorkstationDirectAction(
      { type: "role-stop", role: "gateway", name: "stable" },
      { stopRuntime: async () => ({ stopped: false, role: "gateway", name: "stable" }) },
    );
    expect(outcome).toMatchObject({ status: "warning", title: "Gateway was not stopped" });
    expect("body" in outcome).toBe(false);
  });

  it("reports connector handoff through an explicit clipboard side effect without exposing the secret", async () => {
    const outcome = await executeWorkstationDirectAction(
      { type: "gateway-copy-approval-secret", name: "stable" },
      {
        gatewayInfo: async () => ({
          schemaVersion: "1.0",
          gateway: "stable",
          mcpUrl: "https://example.test/mcp",
          publicBaseUrl: "https://example.test/",
          authentication: "OAuth 2.0 Authorization Code + PKCE",
          approvalSecretAvailable: true,
          copied: "approval-secret",
        }),
      },
    );
    expect(outcome).toMatchObject({
      status: "success",
      title: "Approval secret copied",
      sideEffects: [{ label: "Clipboard", value: "Approval secret copied", tone: "success" }],
    });
    expect(JSON.stringify(outcome)).not.toContain("approvalSecret\":");
  });

  it("reports copied join codes with expiry and clipboard confirmation", async () => {
    const outcome = await executeWorkstationFlowAction(
      { type: "gateway-join-token", name: "stable" },
      prompts({ text: async () => "300" }),
      { createJoinToken: async () => ({ copied: true, expiresAt: "2026-08-31T11:00:00.000Z", joinCodeVersion: 1 }) },
    );
    expect(outcome).toMatchObject({
      status: "success",
      title: "Join code created",
      summary: "Copied to clipboard.",
      sideEffects: [{ label: "Clipboard", value: "Join code copied", tone: "success" }],
    });
    expect(outcome.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Expires" })]));
  });

  it("keeps a join code visible when clipboard copy fails and surfaces the copy error", async () => {
    const joinCode = `qjq1:${"a".repeat(80)}`;
    const outcome = await executeWorkstationFlowAction(
      { type: "gateway-join-token", name: "stable" },
      prompts({ text: async () => "300" }),
      { createJoinToken: async () => ({ copied: false, joinCode, copyError: "Clipboard unavailable", expiresAt: "2026-08-31T11:00:00.000Z" }) },
    );
    expect(outcome).toMatchObject({ status: "warning", title: "Join code created, clipboard copy failed" });
    expect(outcome.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Join code", value: joinCode })]));
    expect(outcome.remediation).toEqual(expect.arrayContaining(["Clipboard unavailable", "Copy the displayed join code manually."]));
  });

  it("maps destructive cancellation to cancelled instead of success", async () => {
    const removeWorkspace = vi.fn();
    const outcome = await executeWorkstationFlowAction(
      { type: "workspace-remove", workerName: "wins-worker", workspaceId: "queqiao", displayName: "Queqiao" },
      prompts({ confirm: async () => false }),
      { removeWorkspace },
    );
    expect(removeWorkspace).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "cancelled", title: "Workspace removal cancelled" });
  });

  it("maps unchanged Extension attachment to noop", async () => {
    const outcome = await executeWorkstationDirectAction(
      { type: "extension-toggle", extensionId: "dev.queqiao.mcp", workerName: "wins-worker", attached: false },
      { attachExtension: async () => ({ changed: false, worker: "wins-worker", attached: "dev.queqiao.mcp" }) },
    );
    expect(outcome).toMatchObject({ status: "noop", title: "Extension already attached" });
  });

  it("maps orphaned Extension package cleanup to warning with remediation", async () => {
    const outcome = await executeWorkstationFlowAction(
      { type: "extension-uninstall", extensionId: "dev.queqiao.mcp", displayName: "MCP", attachedWorkers: 1 },
      prompts({ confirm: async () => true }),
      { uninstallExtension: async () => ({ changed: true, removed: "dev.queqiao.mcp", detachedWorkers: ["wins-worker"], packageCleanup: "orphaned" }) },
    );
    expect(outcome).toMatchObject({ status: "warning", title: "Extension removed, package cleanup incomplete" });
    expect(outcome.remediation).toContain("Remove the orphaned package directory manually.");
  });

  it("distinguishes runtime Start success from already-running no-op", async () => {
    const started = await executeWorkstationDirectAction(
      { type: "role-start", role: "gateway", name: "stable" },
      { startRuntime: async () => ({ started: true, name: "stable", role: "gateway", pid: 1234 }) },
    );
    expect(started).toMatchObject({ status: "success", title: "Gateway started" });
    expect(started.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "PID", value: "1234" })]));

    const noop = await executeWorkstationDirectAction(
      { type: "role-start", role: "gateway", name: "stable" },
      { startRuntime: async () => ({ started: false, alreadyRunning: true, name: "stable", role: "gateway" }) },
    );
    expect(noop).toMatchObject({ status: "noop", title: "Gateway already running" });
  });

  it("reports MCP URL copy and Diagnostics warning with user-facing semantics", async () => {
    const copied = await executeWorkstationDirectAction(
      { type: "gateway-copy-mcp-url", name: "stable" },
      {
        gatewayInfo: async () => ({
          schemaVersion: "1.0",
          gateway: "stable",
          mcpUrl: "https://example.test/mcp",
          publicBaseUrl: "https://example.test/",
          authentication: "OAuth 2.0 Authorization Code + PKCE",
          approvalSecretAvailable: true,
          copied: "mcp-url",
        }),
      },
    );
    expect(copied).toMatchObject({
      status: "success",
      title: "MCP URL copied",
      sideEffects: [{ label: "Clipboard", value: "MCP URL copied", tone: "success" }],
    });

    const diagnostics = await executeWorkstationDirectAction(
      { type: "diagnostics" },
      { doctorQueqiao: async () => ({ ok: false, issues: ["worker unavailable"] }) },
    );
    expect(diagnostics).toMatchObject({ status: "warning", title: "Diagnostics found issues" });
    expect(diagnostics.summary).toMatch(/Review System health/);
  });

  it("reports Gateway membership no-op, endpoint update, and removal cancellation distinctly", async () => {
    const empty = await executeWorkstationFlowAction(
      { type: "gateway-members", name: "stable" },
      prompts(),
      { listJoinedWorkers: async () => ({ workers: [] }) },
    );
    expect(empty).toMatchObject({ status: "noop", title: "No enrolled Workers" });

    const chooseUpdate = vi.fn(async (message: string) => message === "Worker" ? "worker-id" : "update");
    const updateJoinedWorkerTransport = vi.fn(async () => ({ updated: true }));
    const updated = await executeWorkstationFlowAction(
      { type: "gateway-members", name: "stable" },
      prompts({ choose: chooseUpdate, text: async () => "http://127.0.0.1:9001/" }),
      {
        listJoinedWorkers: async () => ({ workers: [{ workerId: "worker-id", environmentId: "windows", transport: { endpoint: "http://127.0.0.1:9000/" } }] }),
        updateJoinedWorkerTransport,
      },
    );
    expect(updated).toMatchObject({ status: "success", title: "Worker endpoint updated" });
    expect(updated.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Endpoint", value: "http://127.0.0.1:9001/" })]));

    const chooseRemove = vi.fn(async (message: string) => message === "Worker" ? "worker-id" : "remove");
    const removeJoinedWorker = vi.fn();
    const cancelled = await executeWorkstationFlowAction(
      { type: "gateway-members", name: "stable" },
      prompts({ choose: chooseRemove, confirm: async () => false }),
      {
        listJoinedWorkers: async () => ({ workers: [{ workerId: "worker-id", environmentId: "windows", transport: { endpoint: "http://127.0.0.1:9000/" } }] }),
        removeJoinedWorker,
      },
    );
    expect(cancelled).toMatchObject({ status: "cancelled", title: "Worker enrollment removal cancelled" });
    expect(removeJoinedWorker).not.toHaveBeenCalled();
  });

  it("reports Worker enrollment without exposing its self-contained join code", async () => {
    const joinCode = encodeJoinCode({ v: 1, gateway: "https://remote.example/gateway/", token: "r".repeat(40) });
    const joinWorker = vi.fn(async () => ({ joined: true }));
    const outcome = await executeWorkstationFlowAction(
      { type: "worker-join", workerName: "wins-worker" },
      prompts({ secret: async () => joinCode }),
      { listRoleInstances: async () => [], joinWorker },
    );
    expect(outcome).toMatchObject({ status: "success", title: "Worker joined Gateway" });
    expect(outcome.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Worker", value: "wins-worker" }),
      expect.objectContaining({ label: "Gateway", value: "https://remote.example/gateway/" }),
    ]));
    expect(JSON.stringify(outcome)).not.toContain(joinCode);
  });

  it("reports Workspace add/edit/remove mutations with object identity instead of generic success", async () => {
    const workspace = { id: "main", displayName: "Main", root: "C:\\main", profile: "coding" };
    const added = await executeWorkstationFlowAction(
      { type: "workspace-add", workerName: "wins-worker" },
      prompts(),
      { addWorkspace: async () => ({ added: true, workspace }) },
    );
    expect(added).toMatchObject({ status: "success", title: "Workspace added" });
    expect(added.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Workspace", value: "Main" })]));

    const edited = await executeWorkstationFlowAction(
      { type: "workspace-edit", workerName: "wins-worker", workspaceId: "main" },
      prompts(),
      { editManagedWorkspace: async () => ({ changed: true, workspace: { ...workspace, displayName: "Main Updated" } }) },
    );
    expect(edited).toMatchObject({ status: "success", title: "Workspace updated" });
    expect(edited.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Workspace", value: "Main Updated" })]));

    const removed = await executeWorkstationFlowAction(
      { type: "workspace-remove", workerName: "wins-worker", workspaceId: "main", displayName: "Main Updated" },
      prompts({ confirm: async () => true }),
      { removeWorkspace: async () => ({ changed: true, removed: "main" }) },
    );
    expect(removed).toMatchObject({ status: "success", title: "Workspace removed" });
    expect(removed.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Worker", value: "wins-worker" })]));
  });

  it("reports Profile create/edit/rename/delete with template-link semantics", async () => {
    const accessPrompts = prompts({
      text: async (message, initial = "") => message === "Profile name" ? "custom" : message === "New profile name" ? "custom-renamed" : initial,
      multi: async () => ["read_file", "edit_file"],
    });
    const created = await executeWorkstationFlowAction(
      { type: "profile-create" },
      accessPrompts,
      { createAccessProfile: async () => ({ created: true, profile: { name: "custom" }, note: "Existing Workspaces are unchanged." }) },
    );
    expect(created).toMatchObject({ status: "success", title: "Access Profile created", summary: "Existing Workspaces are unchanged." });

    const edited = await executeWorkstationFlowAction(
      { type: "profile-edit", name: "custom" },
      accessPrompts,
      { editAccessProfile: async () => ({ changed: true, profile: { name: "custom" }, affectedWorkspaces: 0, note: "Existing Workspaces are unchanged because profiles are templates, not live links." }) },
    );
    expect(edited).toMatchObject({ status: "success", title: "Access Profile updated" });
    expect(edited.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Existing Workspaces affected", value: "0" })]));

    const renamed = await executeWorkstationFlowAction(
      { type: "profile-rename", name: "custom" },
      accessPrompts,
      { renameAccessProfile: async () => ({ changed: true, from: "custom", profile: { name: "custom-renamed" }, affectedWorkspaces: 0 }) },
    );
    expect(renamed).toMatchObject({ status: "success", title: "Access Profile renamed" });
    expect(renamed.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "From", value: "custom" })]));

    const deleted = await executeWorkstationFlowAction(
      { type: "profile-delete", name: "custom-renamed" },
      prompts({ confirm: async () => true }),
      { deleteAccessProfile: async () => ({ deleted: true, profile: "custom-renamed", affectedWorkspaces: 0, note: "Existing Workspaces remain unchanged." }) },
    );
    expect(deleted).toMatchObject({ status: "success", title: "Access Profile deleted" });
  });

  it("reports Extension install and clean uninstall with attachment/package details", async () => {
    const installed = await executeWorkstationFlowAction(
      { type: "extension-install" },
      prompts({ text: async () => "npm:example-extension", choose: async () => "__hub__" }),
      {
        listRoleInstances: async () => [],
        installExtension: async () => ({ changed: true, id: "dev.example", version: "1.2.3", attachments: [] }),
      },
    );
    expect(installed).toMatchObject({ status: "success", title: "Extension installed" });
    expect(installed.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Extension", value: "dev.example" }),
      expect.objectContaining({ label: "Version", value: "1.2.3" }),
      expect.objectContaining({ label: "Attachments", value: "0" }),
    ]));

    const removed = await executeWorkstationFlowAction(
      { type: "extension-uninstall", extensionId: "dev.example", displayName: "Example", attachedWorkers: 0 },
      prompts({ confirm: async () => true }),
      { uninstallExtension: async () => ({ changed: true, removed: "dev.example", detachedWorkers: [], packageCleanup: "removed" }) },
    );
    expect(removed).toMatchObject({ status: "success", title: "Extension uninstalled" });
    expect(removed.details).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Package files", value: "removed" })]));
  });
});
