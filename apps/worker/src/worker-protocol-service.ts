import { randomUUID } from "node:crypto";
import { ProcessRunner } from "@queqiao/process-runtime";
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
};

type RequestExtensionState = { host: ExtensionHost<WorkerToolContext> | undefined; generation: number };
type ExtensionLeaseState = RequestExtensionState & { release?: () => Promise<void> };

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
    return {
      workspaceId,
      capabilities: new WorkerCoreCapabilities({ toolName, grantedCapabilities: contract.requiredCapabilities, workspace, processes, authority, ...(signal ? { signal } : {}) }),
      ...extensionContext,
      ...(signal ? { signal } : {}),
    };
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
            const result = await runtime.execute(request.toolName, request.input, contextFor(request.toolName, workspaceId, state, signal, authority));
            return { result } as T;
          }
        }
      } finally {
        await state.release?.().catch((error) => console.error("ExtensionHost dispose failed", error));
      }
    },
  };
}
