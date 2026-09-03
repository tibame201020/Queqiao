import { resolveExtensionHubRoot, resolveRuntimeLayoutForNamedRole, type RuntimeRole } from "@queqiao/platform-paths";
import { createJoinToken, decodeJoinCode, describeGatewayProtocolOffer, inspectJoinProtocols, joinWorker, listJoinedWorkers, removeJoinedWorker } from "./enrollment-cli.js";
import { attachExtension, detachExtension, installExtension, listExtensions, uninstallExtension } from "./extension-cli.js";
import { listRoleInstances, type RoleInstanceInventory } from "./instance-selector.js";
import { runRoleSetupWizard } from "./setup-wizard.js";
import { removeRoleInstance } from "./role-remove.js";
import { doctorQueqiao } from "./doctor.js";
import { getGatewayInfo } from "./gateway-info.js";
import { runtimeStatus, startRuntime, stopRuntime } from "./service-lifecycle.js";
import { createAccessProfile, deleteAccessProfile, editAccessProfile, editManagedWorkspace, listAccessProfiles, listManagedWorkspaces, renameAccessProfile } from "./workspace-management.js";
import { addWorkspace, removeWorkspace } from "./workspace-cli.js";
import { collectCustomAccessConfiguration } from "./access-configuration-flow.js";
import { createQueqiaoTheme, shouldUseCliColor } from "./tui-theme.js";
import { loadWorkstationInspectorDetail } from "./workstation-inspector.js";
import { runInkWorkstationShell, type WorkstationDirectAction, type WorkstationDirectResult, type WorkstationFlowAction, type WorkstationPromptDriver } from "./workstation-ui.js";
import { actionOutcome, outcomeRecord, outcomeValue, type WorkstationActionOutcome, type WorkstationActionOutcomeDetail } from "./workstation-action-outcome.js";

export type WorkstationExtension = {
  id: string;
  displayName: string;
  version: string;
  package: string;
  workers: Array<{ name: string; attached: boolean }>;
};

export type WorkstationWorkspace = {
  workerName: string;
  id: string;
  displayName: string;
  root: string;
  profile: string;
};

export type WorkstationAccessProfile = {
  name: string;
  builtin: boolean;
  tools: string[];
  allowedExecutables: string[];
};

export type WorkstationSnapshot = {
  gateways: RoleInstanceInventory[];
  workers: RoleInstanceInventory[];
  workspaces: WorkstationWorkspace[];
  profiles: WorkstationAccessProfile[];
  extensions: WorkstationExtension[];
  gatewayCount: number;
  runningGatewayCount: number;
  workerCount: number;
  runningWorkerCount: number;
  workspaceCount: number;
  profileCount: number;
  customProfileCount: number;
  extensionCount: number;
  attachmentCount: number;
  gettingStarted: Array<"gateway" | "worker" | "workspace">;
};

type ExtensionInventory = { hub: string; extensions: WorkstationExtension[] };

type SnapshotDependencies = {
  listRoleInstances?: (role: RuntimeRole) => Promise<RoleInstanceInventory[]>;
  listExtensions?: () => Promise<ExtensionInventory>;
  listAccessProfiles?: () => Promise<unknown>;
  listManagedWorkspaces?: (configFile: string) => Promise<unknown>;
};

type WorkstationDependencies = SnapshotDependencies & {
  interactive?: boolean;
  runShell?: typeof runInkWorkstationShell;
  setupRole?: typeof runRoleSetupWizard;
  removeRole?: typeof removeRoleInstance;
  addWorkspace?: typeof addWorkspace;
  editManagedWorkspace?: typeof editManagedWorkspace;
  removeWorkspace?: typeof removeWorkspace;
  createAccessProfile?: typeof createAccessProfile;
  editAccessProfile?: typeof editAccessProfile;
  renameAccessProfile?: typeof renameAccessProfile;
  deleteAccessProfile?: typeof deleteAccessProfile;
  startRuntime?: typeof startRuntime;
  stopRuntime?: typeof stopRuntime;
  runtimeStatus?: typeof runtimeStatus;
  createJoinToken?: typeof createJoinToken;
  inspectJoinProtocols?: typeof inspectJoinProtocols;
  joinWorker?: typeof joinWorker;
  listJoinedWorkers?: typeof listJoinedWorkers;
  removeJoinedWorker?: typeof removeJoinedWorker;
  installExtension?: typeof installExtension;
  uninstallExtension?: typeof uninstallExtension;
  attachExtension?: typeof attachExtension;
  detachExtension?: typeof detachExtension;
  doctorQueqiao?: typeof doctorQueqiao;
  gatewayInfo?: typeof getGatewayInfo;
};

function extensionInventory(value: unknown): ExtensionInventory {
  if (!value || typeof value !== "object") return { hub: "", extensions: [] };
  const candidate = value as { hub?: unknown; extensions?: unknown };
  return {
    hub: typeof candidate.hub === "string" ? candidate.hub : "",
    extensions: Array.isArray(candidate.extensions) ? candidate.extensions as WorkstationExtension[] : [],
  };
}

function profileInventory(value: unknown): WorkstationAccessProfile[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { profiles?: unknown };
  if (!Array.isArray(candidate.profiles)) return [];
  return candidate.profiles.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const profile = entry as { name?: unknown; builtin?: unknown; tools?: unknown; allowedExecutables?: unknown };
    if (typeof profile.name !== "string" || typeof profile.builtin !== "boolean") return [];
    return [{
      name: profile.name,
      builtin: profile.builtin,
      tools: Array.isArray(profile.tools) ? profile.tools.filter((value): value is string => typeof value === "string") : [],
      allowedExecutables: Array.isArray(profile.allowedExecutables) ? profile.allowedExecutables.filter((value): value is string => typeof value === "string") : [],
    }];
  });
}

function workspaceInventory(workerName: string, value: unknown): WorkstationWorkspace[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { workspaces?: unknown };
  if (!Array.isArray(candidate.workspaces)) return [];
  return candidate.workspaces.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const workspace = entry as { id?: unknown; displayName?: unknown; root?: unknown; access?: { capabilityCeiling?: unknown } };
    if (typeof workspace.id !== "string" || typeof workspace.displayName !== "string" || typeof workspace.root !== "string") return [];
    return [{
      workerName,
      id: workspace.id,
      displayName: workspace.displayName,
      root: workspace.root,
      profile: typeof workspace.access?.capabilityCeiling === "string" ? workspace.access.capabilityCeiling : "unknown",
    }];
  });
}

export async function collectWorkstationSnapshot(dependencies: SnapshotDependencies = {}): Promise<WorkstationSnapshot> {
  const listRoles = dependencies.listRoleInstances || listRoleInstances;
  const listInstalled = dependencies.listExtensions || (async () => extensionInventory(await listExtensions(resolveExtensionHubRoot())));
  const listProfiles = dependencies.listAccessProfiles || listAccessProfiles;
  const listWorkspaces = dependencies.listManagedWorkspaces || listManagedWorkspaces;
  const [gateways, workers, installed, profileResult] = await Promise.all([
    listRoles("gateway"),
    listRoles("worker"),
    listInstalled(),
    listProfiles(),
  ]);
  const profiles = profileInventory(profileResult);
  const workspaces = (await Promise.all(workers.map(async (worker) => {
    if (!worker.configured) return [];
    const layout = resolveRuntimeLayoutForNamedRole("worker", worker.name);
    try {
      return workspaceInventory(worker.name, await listWorkspaces(layout.configFile));
    } catch {
      return [];
    }
  }))).flat();
  const workspaceCount = workers.reduce((total, worker) => total + (worker.workspaceCount || 0), 0);
  const gettingStarted: WorkstationSnapshot["gettingStarted"] = [];
  if (!gateways.length) gettingStarted.push("gateway");
  if (!workers.length) gettingStarted.push("worker");
  if (!workspaceCount) gettingStarted.push("workspace");
  return {
    gateways,
    workers,
    workspaces,
    profiles,
    extensions: installed.extensions,
    gatewayCount: gateways.length,
    runningGatewayCount: gateways.filter((entry) => entry.running).length,
    workerCount: workers.length,
    runningWorkerCount: workers.filter((entry) => entry.running).length,
    workspaceCount,
    profileCount: profiles.length,
    customProfileCount: profiles.filter((profile) => !profile.builtin).length,
    extensionCount: installed.extensions.length,
    attachmentCount: installed.extensions.reduce((total, extension) => total + extension.workers.filter((worker) => worker.attached).length, 0),
    gettingStarted,
  };
}

function countStatus(running: number, total: number): string {
  if (!total) return "not configured";
  return `${running}/${total} running`;
}

export function renderWorkstationSummary(snapshot: WorkstationSnapshot, color = shouldUseCliColor()): string {
  const theme = createQueqiaoTheme(color);
  const lines = [
    `${theme.strong("Gateway")}     ${theme.value(countStatus(snapshot.runningGatewayCount, snapshot.gatewayCount))}`,
    `${theme.strong("Workers")}     ${theme.value(countStatus(snapshot.runningWorkerCount, snapshot.workerCount))}`,
    `${theme.strong("Workspaces")}  ${theme.value(String(snapshot.workspaceCount))} authorized`,
    `${theme.strong("Profiles")}    ${theme.value(String(snapshot.profileCount))} total · ${theme.value(String(snapshot.customProfileCount))} custom`,
    `${theme.strong("Extensions")}  ${theme.value(String(snapshot.extensionCount))} installed · ${theme.value(String(snapshot.attachmentCount))} attachments`,
  ];
  if (snapshot.gettingStarted.length) {
    const labels = snapshot.gettingStarted.map((entry) => entry[0]!.toUpperCase() + entry.slice(1));
    lines.push("", theme.warning(`Getting started: ${labels.join(" · ")}`));
  }
  return lines.join("\n");
}

function roleDescription(instance: RoleInstanceInventory, role: RuntimeRole): string {
  const state = instance.running ? "Running" : "Stopped";
  if (role === "gateway") return `${state}${instance.publicUrl ? ` · ${instance.publicUrl}` : ""}`;
  return `${state} · ${instance.workspaceCount || 0} workspace${instance.workspaceCount === 1 ? "" : "s"}${instance.endpoint ? ` · ${instance.endpoint}` : ""}`;
}

function runtimeOutcome(action: Extract<WorkstationDirectAction, { type: "role-status" | "role-start" | "role-stop" }>, value: unknown): WorkstationActionOutcome {
  const record = outcomeRecord(value);
  const label = action.role === "gateway" ? "Gateway" : "Worker";
  const details: WorkstationActionOutcomeDetail[] = [{ label, value: action.name }];
  if (record.pid) details.push({ label: "PID", value: outcomeValue(record.pid) });
  if (action.type === "role-status") {
    return actionOutcome("success", `${label} status refreshed`, { details });
  }
  if (action.type === "role-start") {
    if (record.alreadyRunning === true || record.started === false) {
      return actionOutcome("noop", `${label} already running`, { summary: `${action.name} was already active.`, details });
    }
    return actionOutcome("success", `${label} started`, { summary: `${action.name} is now running.`, details });
  }
  if (record.stopped === true) {
    return actionOutcome("success", `${label} stopped`, { summary: `${action.name} was stopped.`, details });
  }
  return actionOutcome("warning", `${label} was not stopped`, {
    summary: "No Queqiao-managed process was stopped.",
    details,
    remediation: [`If ${action.name} is still active, stop the external process that owns it.`],
  });
}

export async function executeWorkstationDirectAction(
  action: WorkstationDirectAction,
  dependencies: WorkstationDependencies = {},
): Promise<WorkstationDirectResult> {
  if (action.type === "role-status" || action.type === "role-start" || action.type === "role-stop") {
    const layout = resolveRuntimeLayoutForNamedRole(action.role, action.name);
    const value = action.type === "role-status"
      ? await (dependencies.runtimeStatus || runtimeStatus)(layout.configFile, layout, action.role, action.name)
      : action.type === "role-start"
        ? await (dependencies.startRuntime || startRuntime)(layout.configFile, layout, action.role, action.name)
        : await (dependencies.stopRuntime || stopRuntime)(layout, action.role, action.name);
    return runtimeOutcome(action, value);
  }
  if (action.type === "gateway-copy-mcp-url" || action.type === "gateway-copy-approval-secret") {
    const layout = resolveRuntimeLayoutForNamedRole("gateway", action.name);
    const flag = action.type === "gateway-copy-mcp-url" ? "--copy-url" : "--copy-secret";
    const value = await (dependencies.gatewayInfo || getGatewayInfo)(layout.configFile, layout, action.name, [flag]);
    const copied = value.copied;
    const approval = copied === "approval-secret";
    return actionOutcome("success", approval ? "Approval secret copied" : "MCP URL copied", {
      summary: "Copied to clipboard.",
      details: [{ label: "Gateway", value: action.name }],
      sideEffects: [{ label: "Clipboard", value: approval ? "Approval secret copied" : "MCP URL copied", tone: "success" }],
    });
  }
  if (action.type === "extension-toggle") {
    const value = action.attached
      ? await (dependencies.detachExtension || detachExtension)(action.extensionId, action.workerName)
      : await (dependencies.attachExtension || attachExtension)(resolveExtensionHubRoot(), action.extensionId, action.workerName);
    const record = outcomeRecord(value);
    const changed = record.changed !== false;
    const operation = action.attached ? "detached" : "attached";
    return actionOutcome(changed ? "success" : "noop", changed ? `Extension ${operation}` : `Extension already ${operation}`, {
      summary: changed ? `${action.extensionId} ${operation} ${action.workerName}.` : "No configuration change was required.",
      details: [
        { label: "Extension", value: action.extensionId },
        { label: "Worker", value: action.workerName },
      ],
    });
  }
  const diagnostics = outcomeRecord(await (dependencies.doctorQueqiao || doctorQueqiao)());
  const ok = diagnostics.ok === true;
  return actionOutcome(ok ? "success" : "warning", ok ? "Diagnostics complete" : "Diagnostics found issues", {
    summary: ok ? "No health issues were reported." : "Review System health for warnings and remediation.",
  });
}

type GatewayMember = { workerId: string; environmentId: string; endpoint?: string };

function gatewayMemberInventory(value: unknown): GatewayMember[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { workers?: unknown };
  if (!Array.isArray(candidate.workers)) return [];
  return candidate.workers.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const worker = entry as { workerId?: unknown; environmentId?: unknown; transport?: { endpoint?: unknown } };
    if (typeof worker.workerId !== "string" || typeof worker.environmentId !== "string") return [];
    return [{
      workerId: worker.workerId,
      environmentId: worker.environmentId,
      ...(typeof worker.transport?.endpoint === "string" ? { endpoint: worker.transport.endpoint } : {}),
    }];
  });
}

function accessPrompts(prompts: WorkstationPromptDriver) {
  return {
    choose: prompts.choose,
    multi: prompts.multi,
    commandText: (message: string) => prompts.text(message),
    text: prompts.text,
  };
}

function setupPrompts(prompts: WorkstationPromptDriver, forcedName?: string) {
  const access = accessPrompts(prompts);
  let selectedInstance = false;
  return {
    ...access,
    protocols: async (message: string, choices: Array<{ value: string; label: string; description?: string; disabled?: boolean }>, initialValues: string[]) => prompts.multi(message, choices, initialValues),
    choose: async (message: string, options: Array<{ value: string; label: string; description?: string }>) => {
      if (forcedName && !selectedInstance && options.some((option) => option.value === forcedName)) {
        selectedInstance = true;
        return forcedName;
      }
      return prompts.choose(message, options);
    },
  };
}

function cancelledOutcome(title: string, summary = "No operation was committed."): WorkstationActionOutcome {
  return actionOutcome("cancelled", title, { summary });
}

function workspaceOutcome(title: string, value: unknown): WorkstationActionOutcome {
  const record = outcomeRecord(value);
  const workspace = outcomeRecord(record.workspace);
  const details: WorkstationActionOutcomeDetail[] = [];
  if (workspace.displayName) details.push({ label: "Workspace", value: outcomeValue(workspace.displayName) });
  if (workspace.root) details.push({ label: "Root", value: outcomeValue(workspace.root) });
  const profile = workspace.profile ?? outcomeRecord(workspace.access).capabilityCeiling;
  if (profile) details.push({ label: "Profile", value: outcomeValue(profile) });
  return actionOutcome("success", title, { ...(details.length ? { details } : {}) });
}

function profileOutcome(title: string, value: unknown): WorkstationActionOutcome {
  const record = outcomeRecord(value);
  const profile = outcomeRecord(record.profile);
  const details: WorkstationActionOutcomeDetail[] = [];
  if (profile.name) details.push({ label: "Profile", value: outcomeValue(profile.name) });
  if (record.from) details.unshift({ label: "From", value: outcomeValue(record.from) });
  if (record.affectedWorkspaces !== undefined) details.push({ label: "Existing Workspaces affected", value: outcomeValue(record.affectedWorkspaces) });
  return actionOutcome("success", title, {
    ...(typeof record.note === "string" ? { summary: record.note } : {}),
    ...(details.length ? { details } : {}),
  });
}

export async function executeWorkstationFlowAction(
  action: WorkstationFlowAction,
  prompts: WorkstationPromptDriver,
  dependencies: WorkstationDependencies = {},
): Promise<WorkstationDirectResult> {
  if (action.type === "setup-role") {
    const value = await (dependencies.setupRole || runRoleSetupWizard)(
      action.role,
      [action.role, "setup"],
      { interactive: true, prompts: setupPrompts(prompts, action.name) },
    );
    const record = outcomeRecord(value);
    const label = action.role === "gateway" ? "Gateway" : "Worker";
    return actionOutcome("success", `${label} configured`, {
      summary: record.mode === "create" ? "Configuration created." : "Configuration updated.",
      details: [
        { label, value: action.name || outcomeValue(record.name) },
        ...(record.mode ? [{ label: "Mode", value: outcomeValue(record.mode) }] : []),
      ],
    });
  }

  if (action.type === "remove-role") {
    const value = await (dependencies.removeRole || removeRoleInstance)(
      action.role,
      [action.role, "remove", `--${action.role}`, action.name],
      {
        interactive: true,
        prompts: {
          choose: prompts.choose,
          confirm: (message) => prompts.confirm(message, false, {
            tone: "destructive",
            title: `Remove ${action.role === "gateway" ? "Gateway" : "Worker"}`,
            details: [
              `${action.role === "gateway" ? "Gateway" : "Worker"}: ${action.name}`,
              "Effect: remove Queqiao-owned local configuration, state, data, and runtime files",
            ],
          }),
        },
      },
    );
    const record = outcomeRecord(value);
    const label = action.role === "gateway" ? "Gateway" : "Worker";
    if (record.cancelled === true || record.removed === false) return cancelledOutcome(`${label} removal cancelled`);
    return actionOutcome("success", `${label} removed`, {
      details: [{ label, value: action.name }],
    });
  }

  if (action.type === "gateway-members") {
    const layout = resolveRuntimeLayoutForNamedRole("gateway", action.name);
    const raw = await (dependencies.listJoinedWorkers || listJoinedWorkers)(layout.configFile);
    const workers = gatewayMemberInventory(raw);
    if (!workers.length) return actionOutcome("noop", "No enrolled Workers", {
      summary: `Gateway ${action.name} has no enrolled Workers.`,
      details: [{ label: "Gateway", value: action.name }],
    });
    const workerId = await prompts.choose("Worker", workers.map((worker) => ({
      value: worker.workerId,
      label: worker.environmentId,
      description: `${worker.workerId}${worker.endpoint ? ` · ${worker.endpoint}` : ""}`,
    })));
    const selected = workers.find((worker) => worker.workerId === workerId)!;
    const next = await prompts.choose("Worker action", [
      { value: "info", label: "Info" },
      { value: "remove", label: "Remove enrollment" },
    ]);
    if (next === "info") return actionOutcome("success", `Worker ${selected.environmentId}`, {
      details: [
        { label: "Environment", value: selected.environmentId },
        { label: "Worker ID", value: selected.workerId },
        ...(selected.endpoint ? [{ label: "Endpoint", value: selected.endpoint }] : []),
      ],
    });
    if (!await prompts.confirm(`Remove enrolled Worker ${selected.environmentId}?`, false, {
      tone: "destructive",
      title: "Remove Gateway enrollment",
      details: [
        `Environment: ${selected.environmentId}`,
        `Worker ID: ${selected.workerId}`,
        ...(selected.endpoint ? [`Endpoint: ${selected.endpoint}`] : []),
        "Effect: remove this Worker from the Gateway membership registry",
      ],
    })) return cancelledOutcome("Worker enrollment removal cancelled");
    await (dependencies.removeJoinedWorker || removeJoinedWorker)(layout.configFile, workerId);
    return actionOutcome("success", "Worker enrollment removed", {
      details: [
        { label: "Environment", value: selected.environmentId },
        { label: "Worker ID", value: selected.workerId },
      ],
    });
  }

  if (action.type === "gateway-join-token") {
    const expires = await prompts.text("Join code expiry (seconds)", "300", (value) => {
      const seconds = Number(value);
      return Number.isInteger(seconds) && seconds >= 30 && seconds <= 3600 ? undefined : "Expiry must be an integer from 30 to 3600 seconds";
    });
    const layout = resolveRuntimeLayoutForNamedRole("gateway", action.name);
    const created = outcomeRecord(await (dependencies.createJoinToken || createJoinToken)(
      layout.configFile,
      ["gateway", "join-token", "--gateway", action.name, "--expires", expires],
    ));
    const details: WorkstationActionOutcomeDetail[] = [
      { label: "Gateway", value: action.name },
      ...(created.expiresAt ? [{ label: "Expires", value: outcomeValue(created.expiresAt) }] : []),
    ];
    if (created.copied === true) {
      return actionOutcome("success", "Join code created", {
        summary: "Copied to clipboard.",
        details,
        sideEffects: [{ label: "Clipboard", value: "Join code copied", tone: "success" }],
      });
    }
    if (typeof created.joinCode === "string" && created.joinCode) {
      details.push({ label: "Join code", value: created.joinCode, tone: "warning" });
    }
    return actionOutcome("warning", "Join code created, clipboard copy failed", {
      summary: "Copy the join code shown below before closing this result.",
      details,
      sideEffects: [{ label: "Clipboard", value: "Copy failed", tone: "warning" }],
      remediation: [
        ...(typeof created.copyError === "string" && created.copyError ? [created.copyError] : []),
        "Copy the displayed join code manually.",
      ],
    });
  }

  if (action.type === "worker-join") {
    const listRoles = dependencies.listRoleInstances || listRoleInstances;
    const gateways = await listRoles("gateway");
    const source = gateways.length
      ? await prompts.choose("Enrollment source", [
          ...gateways.map((entry) => ({ value: `local:${entry.name}`, label: entry.name, description: "Create a join code from this local Gateway" })),
          { value: "__join_code__", label: "Use join code", description: "Paste a self-contained qjq1 code from a local or remote Gateway" },
        ])
      : "__join_code__";
    const workerLayout = resolveRuntimeLayoutForNamedRole("worker", action.workerName);
    let joinCode: string;
    if (source === "__join_code__") {
      joinCode = await prompts.secret("Join code", "", (value) => {
        if (!value.trim()) return "Join code is required";
        try { decodeJoinCode(value); return undefined; } catch { return "Invalid join code"; }
      });
    } else {
      const gatewayName = source.slice("local:".length);
      const gateway = gateways.find((entry) => entry.name === gatewayName);
      if (!gateway) throw new Error("Selected local Gateway is no longer available");
      const gatewayLayout = resolveRuntimeLayoutForNamedRole("gateway", gateway.name);
      const issued = await (dependencies.createJoinToken || createJoinToken)(
        gatewayLayout.configFile,
        ["gateway", "join-token", "--gateway", gateway.name, "--json"],
      ) as { joinCode?: unknown };
      if (typeof issued.joinCode !== "string" || !issued.joinCode) throw new Error("Gateway did not return a self-contained join code");
      joinCode = issued.joinCode;
    }
    const protocolState = await (dependencies.inspectJoinProtocols || inspectJoinProtocols)(joinCode);
    const capable = protocolState.offers.filter((offer) => offer.capable);
    if (!capable.length) throw new Error("Gateway has no available Worker protocols");
    const selectedProtocols = await prompts.multi(
      "Worker protocols",
      protocolState.offers.map((offer) => ({
        value: offer.type,
        label: offer.type === "grpc" ? "gRPC" : "HTTP",
        description: describeGatewayProtocolOffer(offer),
        disabled: !offer.capable,
      })),
      capable.map((offer) => offer.type),
    );
    if (!selectedProtocols.length) throw new Error("Select at least one Worker protocol");
    await (dependencies.joinWorker || joinWorker)(
      workerLayout.configFile,
      ["worker", "join", "--worker", action.workerName, "--join-code", joinCode, "--protocols", selectedProtocols.join(",")],
    );
    const decoded = decodeJoinCode(joinCode);
    return actionOutcome("success", "Worker joined Gateway", {
      details: [
        { label: "Worker", value: action.workerName },
        { label: "Gateway", value: decoded.gateway },
      ],
    });
  }

  if (action.type === "workspace-add") {
    const layout = resolveRuntimeLayoutForNamedRole("worker", action.workerName);
    const value = await (dependencies.addWorkspace || addWorkspace)(
      layout.configFile,
      ["workspace", "add", "--worker", action.workerName],
      undefined,
      {
        prompts: accessPrompts(prompts),
        pathPrompt: (initial) => prompts.text("Workspace path", initial),
      },
    );
    return workspaceOutcome("Workspace added", value);
  }

  if (action.type === "workspace-edit") {
    const layout = resolveRuntimeLayoutForNamedRole("worker", action.workerName);
    const value = await (dependencies.editManagedWorkspace || editManagedWorkspace)(
      layout.configFile,
      ["workspace", "edit", "--worker", action.workerName, "--workspace", action.workspaceId],
      {
        prompts: accessPrompts(prompts),
        pathPrompt: (initial) => prompts.text("Workspace path", initial),
      },
    );
    return workspaceOutcome("Workspace updated", value);
  }

  if (action.type === "workspace-remove") {
    if (!await prompts.confirm(`Remove Workspace ${action.displayName}?`, false, {
      tone: "destructive",
      title: "Remove Workspace",
      details: [`Workspace: ${action.displayName}`, `Worker: ${action.workerName}`, "Effect: remove this authorized root"],
    })) return cancelledOutcome("Workspace removal cancelled");
    const layout = resolveRuntimeLayoutForNamedRole("worker", action.workerName);
    await (dependencies.removeWorkspace || removeWorkspace)(layout.configFile, action.workerName, action.workspaceId);
    return actionOutcome("success", "Workspace removed", {
      details: [
        { label: "Workspace", value: action.displayName },
        { label: "Worker", value: action.workerName },
      ],
    });
  }

  if (action.type === "profile-create") {
    const name = await prompts.text("Profile name");
    const configuration = await collectCustomAccessConfiguration(accessPrompts(prompts));
    const args = ["--name", name, "--tools", configuration.tools.join(",") || " "];
    if (configuration.allowedExecutables.length) args.push("--commands", configuration.allowedExecutables.join(","));
    return profileOutcome("Access Profile created", await (dependencies.createAccessProfile || createAccessProfile)(args));
  }

  if (action.type === "profile-edit") {
    const configuration = await collectCustomAccessConfiguration(accessPrompts(prompts));
    const args = [
      "--profile", action.name,
      "--tools", configuration.tools.join(",") || " ",
      "--commands", configuration.allowedExecutables.join(",") || " ",
    ];
    return profileOutcome("Access Profile updated", await (dependencies.editAccessProfile || editAccessProfile)(args));
  }

  if (action.type === "profile-rename") {
    const nextName = await prompts.text("New profile name", action.name);
    return profileOutcome("Access Profile renamed", await (dependencies.renameAccessProfile || renameAccessProfile)(["--profile", action.name, "--to", nextName]));
  }

  if (action.type === "profile-delete") {
    if (!await prompts.confirm(`Delete Access Profile ${action.name}? Existing Workspaces remain unchanged.`, false, {
      tone: "destructive",
      title: "Delete Access Profile",
      details: [`Profile: ${action.name}`, "Effect: delete this reusable template", "Existing Workspaces remain unchanged"],
    })) return cancelledOutcome("Access Profile deletion cancelled");
    return profileOutcome("Access Profile deleted", await (dependencies.deleteAccessProfile || deleteAccessProfile)(["--profile", action.name, "--force"]));
  }

  if (action.type === "extension-install") {
    const source = await prompts.text("Extension source");
    const workers = await (dependencies.listRoleInstances || listRoleInstances)("worker");
    const target = await prompts.choose("Attach after install", [
      { value: "__hub__", label: "Install only", description: "Keep the Extension in the Hub without attaching it" },
      ...(workers.length ? [{ value: "__all__", label: "All Workers" }] : []),
      ...workers.map((worker) => ({ value: worker.name, label: worker.name, description: roleDescription(worker, "worker") })),
    ]);
    const options = target === "__all__" ? { attachAll: true } : target === "__hub__" ? {} : { workerName: target };
    const installed = outcomeRecord(await (dependencies.installExtension || installExtension)(resolveExtensionHubRoot(), source, options));
    const attachments = Array.isArray(installed.attachments) ? installed.attachments.length : 0;
    return actionOutcome("success", "Extension installed", {
      details: [
        ...(installed.id ? [{ label: "Extension", value: outcomeValue(installed.id) }] : []),
        ...(installed.version ? [{ label: "Version", value: outcomeValue(installed.version) }] : []),
        { label: "Attachments", value: String(attachments) },
      ],
    });
  }

  if (!await prompts.confirm(
    action.attachedWorkers
      ? `Uninstall ${action.displayName} and detach it from ${action.attachedWorkers} Worker(s)?`
      : `Uninstall ${action.displayName}?`,
    false,
    {
      tone: "destructive",
      title: "Uninstall Extension",
      details: [
        `Extension: ${action.displayName}`,
        `Extension ID: ${action.extensionId}`,
        `Worker attachments to detach: ${action.attachedWorkers}`,
        "Effect: remove the installed Extension from the local Hub",
      ],
    },
  )) return cancelledOutcome("Extension uninstall cancelled");
  const removed = outcomeRecord(await (dependencies.uninstallExtension || uninstallExtension)(
    resolveExtensionHubRoot(),
    action.extensionId,
    action.attachedWorkers > 0,
  ));
  const packageCleanup = typeof removed.packageCleanup === "string" ? removed.packageCleanup : undefined;
  const detachedWorkers = Array.isArray(removed.detachedWorkers) ? removed.detachedWorkers : [];
  if (packageCleanup === "orphaned") {
    return actionOutcome("warning", "Extension removed, package cleanup incomplete", {
      details: [
        { label: "Extension", value: action.displayName },
        { label: "Detached Workers", value: String(detachedWorkers.length) },
        { label: "Package files", value: "orphaned", tone: "warning" },
      ],
      remediation: ["Remove the orphaned package directory manually."],
    });
  }
  return actionOutcome("success", "Extension uninstalled", {
    details: [
      { label: "Extension", value: action.displayName },
      { label: "Detached Workers", value: String(detachedWorkers.length) },
      ...(packageCleanup ? [{ label: "Package files", value: packageCleanup }] : []),
    ],
  });
}

export async function runWorkstation(args: string[], dependencies: WorkstationDependencies = {}): Promise<void> {
  const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.includes("--json"));
  if (!interactive) throw new Error('"queqiao workstation" requires an interactive terminal. Existing leaf commands remain the automation API.');

  const snapshot = await collectWorkstationSnapshot(dependencies);
  const runShell = dependencies.runShell || runInkWorkstationShell;
  await runShell(
    snapshot,
    () => collectWorkstationSnapshot(dependencies),
    (directAction) => executeWorkstationDirectAction(directAction, dependencies),
    (flowAction, prompts) => executeWorkstationFlowAction(flowAction, prompts, dependencies),
    (target, currentSnapshot) => loadWorkstationInspectorDetail(currentSnapshot, target),
  );
}

export const workstationInternals = { extensionInventory, countStatus, roleDescription };
