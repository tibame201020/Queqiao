import { randomUUID } from "node:crypto";
import { createAuditEvent, type AuditSink } from "@queqiao/audit";
import { extensionRuntimePolicyFor } from "@queqiao/config";
import { ProcessRunner, type ManagedStdioSession, type StdioSessionRequest } from "@queqiao/process-runtime";
import {
  QUEQIAO_WORKER_LEGACY_CAPABILITIES,
  QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION,
  QUEQIAO_WORKER_OPTIONAL_CAPABILITIES,
  QUEQIAO_WORKER_PROTOCOL_VERSION,
  type WorkerProtocolRequest,
} from "@queqiao/worker-protocol";
import type { ExtensionHost, ToolRuntime } from "@queqiao/tool-runtime";
import { createWorkerToolRuntime, createWorkerToolRuntimeForWorkspace, WorkerToolError, type WorkerToolContext } from "./core-tools.js";
import { WorkerCoreCapabilities, type WorkerProcessExecutor } from "./core-capabilities.js";
import { WorkerExtensionRuntimeServices } from "./extension-runtime-services.js";
import type { ReloadableExtensionHost } from "./reloadable-extension-host.js";
import { WorkspaceCatalog, type WorkerWorkspaceConfig, workspaceAllowsTool } from "./workspace-catalog.js";

export type WorkerProtocolServiceConfig = {
  workerId?: string;
  environmentId: string;
  workspaces?: readonly WorkerWorkspaceConfig[];
  workspacesFile?: string;
  processes?: WorkerProcessExecutor;
  extensionHost?: ExtensionHost<WorkerToolContext>;
  extensionRuntime?: ReloadableExtensionHost;
  audit?: AuditSink;
};

type RequestExtensionState = { host: ExtensionHost<WorkerToolContext> | undefined; generation: number };
type ExtensionLeaseState = RequestExtensionState & { release?: () => Promise<void> };

function auditOutcome(error: unknown, signal?: AbortSignal): "denied" | "failed" | "cancelled" {
  if (signal?.aborted) return "cancelled";
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
  return status === 401 || status === 403 ? "denied" : "failed";
}

function auditErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length <= 96 ? code : undefined;
}

async function recordToolAudit(audit: AuditSink | undefined, input: { workspaceId: string; tool: string; authority: "core" | "extension"; outcome: "success" | "denied" | "failed" | "cancelled"; errorCode?: string }): Promise<void> {
  if (!audit) return;
  try {
    await audit.append(createAuditEvent({
      component: "worker",
      category: "tool",
      action: "tool.execute",
      outcome: input.outcome,
      subject: { workspaceId: input.workspaceId, tool: input.tool },
      detail: { authority: input.authority, ...(input.errorCode ? { errorCode: input.errorCode } : {}) },
    }));
  } catch (error) {
    console.error("Audit append failed", error);
  }
}

type ExtensionCallIdentity = { workspaceId: string; extensionId: string; capability: string };

function extensionCallIdentity(toolName: string, workspaceId: string, input: unknown): ExtensionCallIdentity | undefined {
  if (toolName !== "extension" || !input || typeof input !== "object") return undefined;
  const candidate = input as { operation?: unknown; extensionId?: unknown; capability?: unknown };
  if (candidate.operation !== "call" || typeof candidate.extensionId !== "string" || typeof candidate.capability !== "string") return undefined;
  return { workspaceId, extensionId: candidate.extensionId, capability: candidate.capability };
}

async function recordExtensionCallAudit(audit: AuditSink | undefined, identity: ExtensionCallIdentity | undefined, outcome: "success" | "denied" | "failed" | "cancelled", errorCode?: string): Promise<void> {
  if (!audit || !identity) return;
  try {
    await audit.append(createAuditEvent({
      component: "worker",
      category: "extension",
      action: "extension.call",
      outcome,
      subject: identity,
      ...(errorCode ? { detail: { errorCode } } : {}),
    }));
  } catch (error) {
    console.error("Audit append failed", error);
  }
}

export interface WorkerProtocolService {
  execute<T = unknown>(request: WorkerProtocolRequest, signal?: AbortSignal): Promise<T>;
}

export async function createWorkerProtocolService(config: WorkerProtocolServiceConfig): Promise<WorkerProtocolService> {
  if (Boolean(config.workspaces) === Boolean(config.workspacesFile)) throw new Error("Configure exactly one workspace source");

  const catalog = new WorkspaceCatalog(config.workspacesFile ? { file: config.workspacesFile } : { workspaces: config.workspaces! });
  await catalog.initialize();
  const coreTools = createWorkerToolRuntime();
  const coreToolNames = new Set(coreTools.definitions().map(({ name }) => name));
  const toolRuntimes = new Map<string, { generation: number; runtime: ToolRuntime<WorkerToolContext> }>();
  const processes = config.processes ?? new ProcessRunner();
  const stdioProcesses = {
    openStdio: (request: StdioSessionRequest): Promise<ManagedStdioSession> => {
      const candidate = processes as WorkerProcessExecutor & { openStdio?: (request: StdioSessionRequest) => Promise<ManagedStdioSession> };
      if (typeof candidate.openStdio !== "function") throw new WorkerToolError(503, "extension_runtime_unavailable", "Managed stdio runtime is unavailable");
      return candidate.openStdio.call(processes, request);
    },
  };
  const instanceId = randomUUID();
  const platform = process.platform === "win32" ? "windows" as const : process.platform === "darwin" ? "darwin" as const : "linux" as const;
  const hello = config.workerId
    ? { protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, workerId: config.workerId, environmentId: config.environmentId, instanceId, platform, capabilities: [...QUEQIAO_WORKER_OPTIONAL_CAPABILITIES] }
    : { protocolVersion: QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, environmentId: config.environmentId, instanceId, platform, capabilities: [...QUEQIAO_WORKER_LEGACY_CAPABILITIES] };

  const toolsFor = (workspaceId: string, state: RequestExtensionState): ToolRuntime<WorkerToolContext> => {
    if (!state.host) return coreTools;
    const existing = toolRuntimes.get(workspaceId);
    if (existing?.generation === state.generation) return existing.runtime;
    const runtime = createWorkerToolRuntimeForWorkspace(state.host, workspaceId);
    toolRuntimes.set(workspaceId, { generation: state.generation, runtime });
    return runtime;
  };

  const extensionPolicyFor = (toolName: string, workspaceId: string, state: RequestExtensionState) => {
    const owner = state.host?.activeManifests(workspaceId).find((manifest) => manifest.contributions.some((contribution) => contribution.operation === "register" && contribution.tool === toolName));
    return extensionRuntimePolicyFor(owner?.runtime ? { runtime: owner.runtime } : {});
  };

  const contextFor = (toolName: string, workspaceId: string, state: RequestExtensionState, signal?: AbortSignal, authority: "core" | "extension" = "core"): WorkerToolContext => {
    const runtime = toolsFor(workspaceId, state);
    const contract = runtime.definitions().find(({ name }) => name === toolName);
    if (!contract) throw new WorkerToolError(404, "tool_not_found", `Tool is not available: ${toolName}`);
    const workspace = catalog.get(workspaceId);
    if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
    const extensionContext = state.host ? {
      extensionHost: state.host,
      invokeExtensionTool: async (targetTool: string, input: Record<string, unknown>) => runtime.execute(
        targetTool,
        { ...input, workspaceId },
        contextFor(targetTool, workspaceId, state, signal, "extension"),
      ),
    } : {};
    const extensionRuntimeContext = authority === "extension" ? {
      runtime: new WorkerExtensionRuntimeServices({ workspace, processes: stdioProcesses, policy: extensionPolicyFor(toolName, workspaceId, state), ...(signal ? { signal } : {}) }),
    } : {};
    return {
      workspaceId,
      capabilities: new WorkerCoreCapabilities({ toolName, grantedCapabilities: contract.requiredCapabilities, workspace, processes, authority, ...(signal ? { signal } : {}) }),
      ...extensionContext,
      ...extensionRuntimeContext,
      ...(signal ? { signal } : {}),
    } as WorkerToolContext;
  };

  const descriptors = () => catalog.list().map(({ config: entry, reader }) => ({
    environmentId: config.environmentId,
    workspaceId: entry.id,
    displayName: entry.displayName,
    root: reader.root,
    profile: entry.profile,
    tools: entry.tools,
    commands: entry.commands,
  }));

  const acquireState = async (): Promise<ExtensionLeaseState> => {
    if (config.extensionRuntime) {
      try {
        const reload = await config.extensionRuntime.refresh();
        if ("rejected" in reload) console.error("Extension config reload rejected", reload.rejected);
      } catch (error) {
        console.error("Extension config reload check failed", error);
      }
      const lease = config.extensionRuntime.acquire();
      return { host: lease.host, generation: lease.generation, release: () => lease.release() };
    }
    return { host: config.extensionHost, generation: 0 };
  };

  const refreshCatalog = async (): Promise<void> => {
    try { await catalog.refresh(); }
    catch (error) { console.error("Workspace config reload rejected", error); }
  };

  return {
    async execute<T = unknown>(request: WorkerProtocolRequest, signal?: AbortSignal): Promise<T> {
      const state = await acquireState();
      try {
        await refreshCatalog();
        switch (request.operation) {
          case "health":
            return { ok: true, service: "queqiao-worker", environmentId: config.environmentId } as T;
          case "hello":
            return hello as T;
          case "list-workspaces":
            return { environmentId: config.environmentId, workspaces: descriptors() } as T;
          case "workspace-info": {
            const workspace = catalog.get(request.workspaceId);
            if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${request.workspaceId}`);
            if (!workspaceAllowsTool(workspace.config, request.tool)) throw new WorkerToolError(403, "tool_denied", `${request.tool} is denied by workspace policy`);
            return {
              environmentId: config.environmentId,
              workspaceId: workspace.config.id,
              displayName: workspace.config.displayName,
              root: workspace.reader.root,
              profile: workspace.config.profile,
              tools: workspace.config.tools,
              commands: workspace.config.commands,
            } as T;
          }
          case "invoke-tool": {
            const workspaceId = request.input && typeof request.input === "object" ? (request.input as { workspaceId?: unknown }).workspaceId : undefined;
            if (typeof workspaceId !== "string") throw new WorkerToolError(400, "invalid_request", "workspaceId is required");
            const runtime = toolsFor(workspaceId, state);
            const authority = coreToolNames.has(request.toolName) ? "core" : "extension";
            const extensionCall = extensionCallIdentity(request.toolName, workspaceId, request.input);
            try {
              const result = await runtime.execute(request.toolName, request.input, contextFor(request.toolName, workspaceId, state, signal, authority));
              await recordToolAudit(config.audit, { workspaceId, tool: request.toolName, authority, outcome: "success" });
              await recordExtensionCallAudit(config.audit, extensionCall, "success");
              return { result } as T;
            } catch (error) {
              const errorCode = auditErrorCode(error);
              const outcome = auditOutcome(error, signal);
              await recordToolAudit(config.audit, { workspaceId, tool: request.toolName, authority, outcome, ...(errorCode ? { errorCode } : {}) });
              await recordExtensionCallAudit(config.audit, extensionCall, outcome, errorCode);
              throw error;
            }
          }
        }
      } finally {
        await state.release?.().catch((error) => console.error("ExtensionHost dispose failed", error));
      }
    },
  };
}
