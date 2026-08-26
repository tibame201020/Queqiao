import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig, type WorkspaceConfig } from "@queqiao/config";
import { toolNameSchema } from "@queqiao/contracts";

export type WorkspaceMutationErrorCode =
  | "worker_required"
  | "workspace_exists"
  | "workspace_not_found"
  | "default_workspace_remove_forbidden"
  | "invalid_workspace_root"
  | "invalid_command";

export class WorkspaceMutationError extends Error {
  constructor(readonly code: WorkspaceMutationErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceMutationError";
  }
}

export type AddWorkspaceInput = {
  id: string;
  displayName: string;
  root: string;
  profile: WorkspaceConfig["profile"];
};

export type WorkspaceToolDecision = "allow" | "deny" | "inherit";
export type WorkspaceCommandDecision = "allow" | "deny";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function requireWorkspace(config: RuntimeConfig, workspaceId: string): WorkspaceConfig {
  const workspace = config.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) throw new WorkspaceMutationError("workspace_not_found", `Workspace not found: ${workspaceId}`);
  return workspace;
}

function replaceWorkspace(config: RuntimeConfig, workspace: WorkspaceConfig): RuntimeConfig {
  return runtimeConfigSchema.parse({
    ...config,
    workspaces: config.workspaces.map((entry) => entry.id === workspace.id ? workspace : entry),
  });
}

export function addRuntimeWorkspace(config: RuntimeConfig, input: AddWorkspaceInput): RuntimeConfig {
  if (!config.worker) throw new WorkspaceMutationError("worker_required", "Worker setup is required before adding a Workspace");
  if (config.workspaces.some((entry) => entry.id === input.id)) throw new WorkspaceMutationError("workspace_exists", `Workspace already exists: ${input.id}`);
  const workspace = workspaceConfigSchema.parse({
    ...input,
    tools: { allow: [], deny: [], explicit: [] },
    commands: { allow: [] },
    stepUp: [],
  });
  return runtimeConfigSchema.parse({
    ...config,
    worker: { ...config.worker, defaultWorkspaceId: config.worker.defaultWorkspaceId || workspace.id },
    workspaces: [...config.workspaces, workspace],
  });
}

export function removeRuntimeWorkspace(config: RuntimeConfig, workspaceId: string): RuntimeConfig {
  requireWorkspace(config, workspaceId);
  if (config.worker?.defaultWorkspaceId === workspaceId) {
    throw new WorkspaceMutationError("default_workspace_remove_forbidden", `Cannot remove the default Workspace while it is selected: ${workspaceId}`);
  }
  return runtimeConfigSchema.parse({ ...config, workspaces: config.workspaces.filter((entry) => entry.id !== workspaceId) });
}

export function setRuntimeWorkspaceProfile(config: RuntimeConfig, workspaceId: string, profile: WorkspaceConfig["profile"]): RuntimeConfig {
  const workspace = requireWorkspace(config, workspaceId);
  return replaceWorkspace(config, workspaceConfigSchema.parse({ ...workspace, profile }));
}

export function decideRuntimeWorkspaceTool(config: RuntimeConfig, workspaceId: string, toolInput: string, decision: WorkspaceToolDecision): RuntimeConfig {
  const workspace = requireWorkspace(config, workspaceId);
  const tool = toolNameSchema.parse(toolInput);
  const allow = workspace.tools.allow.filter((item) => item !== tool);
  const deny = workspace.tools.deny.filter((item) => item !== tool);
  const explicit = workspace.tools.explicit.filter((item) => item !== tool);
  const tools = decision === "inherit"
    ? { allow, deny, explicit }
    : tool === "shell"
      ? decision === "allow"
        ? { allow, deny, explicit: unique([...explicit, tool]) }
        : { allow, deny: unique([...deny, tool]), explicit }
      : decision === "allow"
        ? { allow: unique([...allow, tool]), deny, explicit }
        : { allow, deny: unique([...deny, tool]), explicit };
  return replaceWorkspace(config, workspaceConfigSchema.parse({ ...workspace, tools }));
}

export function normalizeRuntimeCommand(commandInput: string): string {
  const command = commandInput.trim().toLowerCase();
  if (!/^[a-z0-9._+-]+$/.test(command)) {
    throw new WorkspaceMutationError("invalid_command", "Command must be an executable name without path or shell syntax");
  }
  return command;
}

export function decideRuntimeWorkspaceCommand(config: RuntimeConfig, workspaceId: string, commandInput: string, decision: WorkspaceCommandDecision): RuntimeConfig {
  const workspace = requireWorkspace(config, workspaceId);
  const command = normalizeRuntimeCommand(commandInput);
  const allow = workspace.commands.allow.filter((item) => item !== command);
  return replaceWorkspace(config, workspaceConfigSchema.parse({
    ...workspace,
    commands: { allow: decision === "allow" ? unique([...allow, command]) : allow },
  }));
}
