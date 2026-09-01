import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { WorkspaceCatalog, type WorkerWorkspaceConfig, workspaceAllowsTool } from "./workspace-catalog.js";
import { createWorkerToolRuntime, createWorkerToolRuntimeForWorkspace, WorkerToolError, type WorkerToolContext } from "./core-tools.js";
import { WorkerCoreCapabilities, type WorkerProcessExecutor } from "./core-capabilities.js";
import { ProcessCapacityError, ProcessRunner } from "@queqiao/process-runtime";
import { QUEQIAO_WORKER_HTTP_API_PREFIX, QUEQIAO_WORKER_LEGACY_CAPABILITIES, QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, QUEQIAO_WORKER_OPTIONAL_CAPABILITIES, QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import type { ExtensionHost, ToolRuntime } from "@queqiao/tool-runtime";
import type { ReloadableExtensionHost } from "./reloadable-extension-host.js";

export type WorkerAppConfig = {
  workerId?: string;
  environmentId: string;
  workspaces?: readonly WorkerWorkspaceConfig[];
  workspacesFile?: string;
  workerToken?: string;
  workerCredential?: { current(): Promise<string> };
  processes?: WorkerProcessExecutor;
  extensionHost?: ExtensionHost<WorkerToolContext>;
  extensionRuntime?: ReloadableExtensionHost;
};

const readRequestSchema = z.object({ workspaceId: z.string().min(1), path: z.string().min(1).max(4096), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(5000).default(500) });
function safeEqual(left: string, right: string): boolean { return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest()); }

export async function createWorkerApp(config: WorkerAppConfig): Promise<Express> {
  if (Boolean(config.workspaces) === Boolean(config.workspacesFile)) throw new Error("Configure exactly one workspace source");
  if (!config.workerCredential && !config.workerToken) throw new Error("Worker credential source is required");
  const catalog = new WorkspaceCatalog(config.workspacesFile ? { file: config.workspacesFile } : { workspaces: config.workspaces! });
  await catalog.initialize();
  const coreTools = createWorkerToolRuntime();
  const coreToolNames = new Set(coreTools.definitions().map(({ name }) => name));
  type RequestExtensionState = { host: ExtensionHost<WorkerToolContext> | undefined; generation: number };
  const requestExtensions = new WeakMap<Request, RequestExtensionState>();
  const toolRuntimes = new Map<string, { generation: number; runtime: ToolRuntime<WorkerToolContext> }>();
  const toolsFor = (workspaceId: string, state: RequestExtensionState): ToolRuntime<WorkerToolContext> => {
    if (!state.host) return coreTools;
    const existing = toolRuntimes.get(workspaceId);
    if (existing?.generation === state.generation) return existing.runtime;
    const runtime = createWorkerToolRuntimeForWorkspace(state.host, workspaceId);
    toolRuntimes.set(workspaceId, { generation: state.generation, runtime });
    return runtime;
  };
  const processes = config.processes ?? new ProcessRunner();
  const instanceId = randomUUID();
  const platform = process.platform === "win32" ? "windows" as const : process.platform === "darwin" ? "darwin" as const : "linux" as const;
  const hello = config.workerId
    ? { protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, workerId: config.workerId, environmentId: config.environmentId, instanceId, platform, capabilities: [...QUEQIAO_WORKER_OPTIONAL_CAPABILITIES] }
    : { protocolVersion: QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, environmentId: config.environmentId, instanceId, platform, capabilities: [...QUEQIAO_WORKER_LEGACY_CAPABILITIES] };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "6mb" }));
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") return next();
    try {
      const expected = config.workerCredential ? await config.workerCredential.current() : config.workerToken || "";
      if (!safeEqual(req.header("x-queqiao-worker-token") || "", expected)) return res.status(401).json({ error: "unauthorized" });
      next();
    } catch {
      res.status(503).json({ error: "worker_credential_unavailable" });
    }
  });
  app.use(async (req, res, next) => {
    if (config.extensionRuntime) {
      try {
        const reload = await config.extensionRuntime.refresh();
        if ("rejected" in reload) console.error("Extension config reload rejected", reload.rejected);
      } catch (error) {
        console.error("Extension config reload check failed", error);
      }
      const lease = config.extensionRuntime.acquire();
      requestExtensions.set(req, { host: lease.host, generation: lease.generation });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        void lease.release().catch((error) => console.error("ExtensionHost dispose failed", error));
      };
      res.once("finish", release);
      res.once("close", release);
    } else {
      requestExtensions.set(req, { host: config.extensionHost, generation: 0 });
    }
    try { await catalog.refresh(); next(); } catch (error) { console.error("Workspace config reload rejected", error); next(); }
  });
  const descriptors = () => catalog.list().map(({ config: entry, reader }) => ({ environmentId: config.environmentId, workspaceId: entry.id, displayName: entry.displayName, root: reader.root, profile: entry.profile, tools: entry.tools, commands: entry.commands }));
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
  const extensionStateFor = (req: Request): RequestExtensionState => requestExtensions.get(req) ?? { host: config.extensionHost, generation: 0 };
  const executeTool = (req: Request, toolName: string, workspaceId: string, input: unknown, signal?: AbortSignal) => {
    const state = extensionStateFor(req);
    const authority = coreToolNames.has(toolName) ? "core" : "extension";
    return toolsFor(workspaceId, state).execute(toolName, input, contextFor(toolName, workspaceId, state, signal, authority));
  };

  app.get("/health", (_req, res) => res.json({ ok: true, service: "queqiao-worker", environmentId: config.environmentId }));
  app.get("/enrollment/identity", (_req, res) => res.json({ workerId: config.workerId, environmentId: config.environmentId, protocolVersion: config.workerId ? QUEQIAO_WORKER_PROTOCOL_VERSION : QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION }));
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/hello`, (_req, res) => res.json(hello));
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces`, (_req, res) => res.json({ environmentId: config.environmentId, workspaces: descriptors() }));
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces/:workspaceId`, (req, res) => {
    const workspace = catalog.get(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace_not_found" });
    const requestedTool = req.query.tool === "workspace_info" ? "workspace_info" : "open_workspace";
    if (!workspaceAllowsTool(workspace.config, requestedTool)) return res.status(403).json({ error: "tool_denied", message: `${requestedTool} is denied by workspace policy` });
    res.json({ environmentId: config.environmentId, workspaceId: workspace.config.id, displayName: workspace.config.displayName, root: workspace.reader.root, profile: workspace.config.profile, tools: workspace.config.tools, commands: workspace.config.commands });
  });
  app.post(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/tools/:toolName`, async (req, res) => {
    const workspaceId = req.body && typeof req.body === "object" ? (req.body as { workspaceId?: unknown }).workspaceId : undefined;
    if (typeof workspaceId !== "string") return res.status(400).json({ error: "invalid_request", message: "workspaceId is required" });
    const abort = new AbortController();
    req.once("aborted", () => abort.abort(new Error("Worker request aborted")));
    res.once("close", () => { if (!res.writableEnded) abort.abort(new Error("Worker response connection closed")); });
    try { res.json({ result: await executeTool(req, req.params.toolName, workspaceId, req.body, abort.signal) }); }
    catch (error) {
      if (error instanceof WorkerToolError) return res.status(error.status).json({ error: error.code, message: error.message });
      if (error instanceof ProcessCapacityError) return res.status(429).json({ error: "process_capacity", message: error.message });
      res.status(400).json({ error: "tool_error", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
  app.post(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/read-file`, async (req, res) => {
    const parsed = readRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
    try { res.json(await executeTool(req, "read_file", parsed.data.workspaceId, parsed.data)); }
    catch (error) {
      if (error instanceof WorkerToolError) return res.status(error.status).json({ error: error.code, message: error.message });
      res.status(400).json({ error: "workspace_error", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
  return app;
}
