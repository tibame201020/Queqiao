import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { WorkspaceCatalog, type WorkerWorkspaceConfig, workspaceAllowsTool } from "./workspace-catalog.js";
import { createWorkerToolRuntime, createWorkerToolRuntimeForWorkspace, WorkerToolError, type WorkerToolContext } from "./core-tools.js";
import { WorkerCoreCapabilities, type WorkerProcessExecutor } from "./core-capabilities.js";
import { AtomicConfigStore, runtimeConfigSchema, type RuntimeConfig } from "@queqiao/config";
import { addRuntimeWorkspace, decideRuntimeWorkspaceCommand, decideRuntimeWorkspaceTool, removeRuntimeWorkspace, setRuntimeWorkspaceProfile, WorkspaceMutationError } from "@queqiao/operations";
import { ProcessCapacityError, ProcessRunner } from "@queqiao/process-runtime";
import { QUEQIAO_WORKER_HTTP_API_PREFIX, QUEQIAO_WORKER_LEGACY_CAPABILITIES, QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, QUEQIAO_WORKER_OPTIONAL_CAPABILITIES, QUEQIAO_WORKER_PROTOCOL_VERSION, workerWorkspaceMutationSchema, type WorkerWorkspaceMutation } from "@queqiao/worker-protocol";
import type { ExtensionHost, ToolRuntime } from "@queqiao/tool-runtime";

export type WorkerAppConfig = {
  workerId?: string;
  environmentId: string;
  defaultWorkspaceId: string;
  workspaces?: readonly WorkerWorkspaceConfig[];
  workspacesFile?: string;
  runtimeConfigFile?: string;
  workerToken?: string;
  workerCredential?: { current(): Promise<string> };
  processes?: WorkerProcessExecutor;
  extensionHost?: ExtensionHost<WorkerToolContext>;
};

const readRequestSchema = z.object({ workspaceId: z.string().min(1), path: z.string().min(1).max(4096), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(5000).default(500) });
async function resolveWorkspaceRoot(value: string): Promise<string> {
  const resolved = path.resolve(value);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new WorkspaceMutationError("invalid_workspace_root", `Workspace root is not a directory: ${resolved}`);
  return realpath(resolved);
}

function applyWorkspaceMutation(config: RuntimeConfig, mutation: WorkerWorkspaceMutation): RuntimeConfig {
  switch (mutation.kind) {
    case "workspace.add": return addRuntimeWorkspace(config, mutation.workspace);
    case "workspace.remove": return removeRuntimeWorkspace(config, mutation.workspaceId);
    case "profile.set": return setRuntimeWorkspaceProfile(config, mutation.workspaceId, mutation.profile);
    case "tool.decide": return decideRuntimeWorkspaceTool(config, mutation.workspaceId, mutation.tool, mutation.decision);
    case "command.decide": return decideRuntimeWorkspaceCommand(config, mutation.workspaceId, mutation.command, mutation.decision);
  }
}

function mutationWorkspaceId(mutation: WorkerWorkspaceMutation): string {
  return mutation.kind === "workspace.add" ? mutation.workspace.id : mutation.workspaceId;
}

function safeEqual(left: string, right: string): boolean { return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest()); }

export async function createWorkerApp(config: WorkerAppConfig): Promise<Express> {
  if (Boolean(config.workspaces) === Boolean(config.workspacesFile)) throw new Error("Configure exactly one workspace source");
  if (!config.workerCredential && !config.workerToken) throw new Error("Worker credential source is required");
  if (config.runtimeConfigFile && (!config.workspacesFile || path.resolve(config.runtimeConfigFile) !== path.resolve(config.workspacesFile))) throw new Error("Worker control-plane mutations require the runtime config to be the Workspace source");
  const mutationStore = config.runtimeConfigFile ? new AtomicConfigStore<RuntimeConfig>(config.runtimeConfigFile, (value) => runtimeConfigSchema.parse(value)) : undefined;
  const catalog = new WorkspaceCatalog(config.defaultWorkspaceId, config.workspacesFile ? { file: config.workspacesFile } : { workspaces: config.workspaces! });
  await catalog.initialize();
  const coreTools = createWorkerToolRuntime();
  const toolRuntimes = new Map<string, ToolRuntime<WorkerToolContext>>();
  const toolsFor = (workspaceId: string): ToolRuntime<WorkerToolContext> => {
    if (!config.extensionHost) return coreTools;
    const existing = toolRuntimes.get(workspaceId); if (existing) return existing;
    const runtime = createWorkerToolRuntimeForWorkspace(config.extensionHost, workspaceId); toolRuntimes.set(workspaceId, runtime); return runtime;
  };
  const processes = config.processes ?? new ProcessRunner();
  const instanceId = randomUUID();
  const platform = process.platform === "win32" ? "windows" as const : process.platform === "darwin" ? "darwin" as const : "linux" as const;
  const hello = config.workerId
    ? { protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, workerId: config.workerId, environmentId: config.environmentId, instanceId, platform, capabilities: mutationStore ? [...QUEQIAO_WORKER_OPTIONAL_CAPABILITIES] : [] }
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
  app.use(async (_req, _res, next) => { try { await catalog.refresh(); next(); } catch (error) { console.error("Workspace config reload rejected", error); next(); } });
  const descriptors = () => catalog.list().map(({ config: entry, reader }) => ({ environmentId: config.environmentId, workspaceId: entry.id, displayName: entry.displayName, root: reader.root, profile: entry.profile, tools: entry.tools, commands: entry.commands }));
  const contextFor = (toolName: string, workspaceId: string, signal?: AbortSignal): WorkerToolContext => {
    const contract = toolsFor(workspaceId).definitions().find(({ name }) => name === toolName);
    if (!contract) throw new WorkerToolError(404, "tool_not_found", `Tool is not available: ${toolName}`);
    const workspace = catalog.get(workspaceId);
    if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
    return { workspaceId, capabilities: new WorkerCoreCapabilities({ toolName, grantedCapabilities: contract.requiredCapabilities, workspace, processes, ...(signal ? { signal } : {}) }), ...(signal ? { signal } : {}) };
  };

  app.get("/health", (_req, res) => res.json({ ok: true, service: "queqiao-worker", environmentId: config.environmentId }));
  app.get("/enrollment/identity", (_req, res) => res.json({ workerId: config.workerId, environmentId: config.environmentId, protocolVersion: config.workerId ? QUEQIAO_WORKER_PROTOCOL_VERSION : QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION }));
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/hello`, (_req, res) => res.json(hello));
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces`, (_req, res) => res.json({ environmentId: config.environmentId, defaultWorkspaceId: config.defaultWorkspaceId, workspaces: descriptors() }));
  app.post(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/admin/workspace-mutations`, async (req, res) => {
    if (!mutationStore) return res.status(404).json({ error: "workspace_admin_unavailable" });
    const parsed = workerWorkspaceMutationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_workspace_mutation" });
    try {
      let mutation: WorkerWorkspaceMutation = parsed.data;
      if (mutation.kind === "workspace.add") {
        mutation = { ...mutation, workspace: { ...mutation.workspace, root: await resolveWorkspaceRoot(mutation.workspace.root) } };
      }
      await mutationStore.update((current) => applyWorkspaceMutation(current, mutation));
      await catalog.refresh(true);
      res.json({ changed: true, workspaceId: mutationWorkspaceId(mutation) });
    } catch (error) {
      if (error instanceof WorkspaceMutationError) {
        const status = error.code === "workspace_not_found" ? 404 : error.code === "workspace_exists" || error.code === "default_workspace_remove_forbidden" ? 409 : 400;
        return res.status(status).json({ error: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) return res.status(400).json({ error: "invalid_workspace_mutation" });
      res.status(500).json({ error: "workspace_mutation_failed" });
    }
  });
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
    try { res.json({ result: await toolsFor(workspaceId).execute(req.params.toolName, req.body, contextFor(req.params.toolName, workspaceId, abort.signal)) }); }
    catch (error) {
      if (error instanceof WorkerToolError) return res.status(error.status).json({ error: error.code, message: error.message });
      if (error instanceof ProcessCapacityError) return res.status(429).json({ error: "process_capacity", message: error.message });
      res.status(400).json({ error: "tool_error", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
  app.post(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/read-file`, async (req, res) => {
    const parsed = readRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
    try { res.json(await toolsFor(parsed.data.workspaceId).execute("read_file", parsed.data, contextFor("read_file", parsed.data.workspaceId))); }
    catch (error) {
      if (error instanceof WorkerToolError) return res.status(error.status).json({ error: error.code, message: error.message });
      res.status(400).json({ error: "workspace_error", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
  return app;
}
