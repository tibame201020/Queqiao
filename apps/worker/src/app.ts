import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { ProcessCapacityError } from "@queqiao/process-runtime";
import { QUEQIAO_WORKER_HTTP_API_PREFIX, QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import { WorkerToolError } from "./core-tools.js";
import { createWorkerProtocolService, type WorkerProtocolService, type WorkerProtocolServiceConfig } from "./worker-protocol-service.js";

export type WorkerAppConfig = WorkerProtocolServiceConfig & {
  workerToken?: string;
  workerCredential?: { current(): Promise<string> };
  protocolService?: WorkerProtocolService;
  reverseSessionControl?: { activate(input: { target: string; credential: string; caCertificate: string }): Promise<void> };
};

const readRequestSchema = z.object({ workspaceId: z.string().min(1), path: z.string().min(1).max(4096), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(5000).default(500) });
function safeEqual(left: string, right: string): boolean { return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest()); }

function sendWorkerError(res: Response, error: unknown, fallbackCode = "tool_error") {
  if (error instanceof WorkerToolError) return res.status(error.status).json({ error: error.code, message: error.message });
  if (error instanceof ProcessCapacityError) return res.status(429).json({ error: "process_capacity", message: error.message });
  return res.status(400).json({ error: fallbackCode, message: error instanceof Error ? error.message : "Unknown error" });
}

export async function createWorkerApp(config: WorkerAppConfig): Promise<Express> {
  if (!config.workerCredential && !config.workerToken) throw new Error("Worker credential source is required");
  const service = config.protocolService ?? await createWorkerProtocolService(config);
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

  app.get("/health", async (_req, res) => {
    try { res.json(await service.execute({ operation: "health" })); }
    catch (error) { sendWorkerError(res, error, "worker_error"); }
  });
  app.get("/enrollment/identity", (_req, res) => res.json({ workerId: config.workerId, environmentId: config.environmentId, protocolVersion: config.workerId ? QUEQIAO_WORKER_PROTOCOL_VERSION : QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION }));
  if (config.reverseSessionControl) {
    app.post("/enrollment/reverse-session/connect", async (req, res) => {
      const parsed = z.object({ target: z.string().min(1).max(512), caCertificate: z.string().min(64).max(32_768) }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request", message: "target is required" });
      try {
        const credential = config.workerCredential ? await config.workerCredential.current() : config.workerToken || "";
        await config.reverseSessionControl!.activate({ target: parsed.data.target, credential, caCertificate: parsed.data.caCertificate });
        res.status(204).end();
      } catch (error) {
        res.status(502).json({ error: "worker_session_connect_failed", message: error instanceof Error ? error.message : "Worker reverse session activation failed" });
      }
    });
  }
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/hello`, async (_req, res) => {
    try { res.json(await service.execute({ operation: "hello" })); }
    catch (error) { sendWorkerError(res, error, "worker_error"); }
  });
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces`, async (_req, res) => {
    try { res.json(await service.execute({ operation: "list-workspaces" })); }
    catch (error) { sendWorkerError(res, error, "worker_error"); }
  });
  app.get(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces/:workspaceId`, async (req, res) => {
    const requestedTool = req.query.tool === "workspace_info" ? "workspace_info" as const : "open_workspace" as const;
    try { res.json(await service.execute({ operation: "workspace-info", workspaceId: req.params.workspaceId, tool: requestedTool })); }
    catch (error) { sendWorkerError(res, error, "workspace_error"); }
  });
  app.post(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/tools/:toolName`, async (req, res) => {
    const abort = new AbortController();
    req.once("aborted", () => abort.abort(new Error("Worker request aborted")));
    res.once("close", () => { if (!res.writableEnded) abort.abort(new Error("Worker response connection closed")); });
    try { res.json(await service.execute({ operation: "invoke-tool", toolName: req.params.toolName, input: req.body }, abort.signal)); }
    catch (error) { sendWorkerError(res, error); }
  });
  app.post(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/read-file`, async (req, res) => {
    const parsed = readRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
    try {
      const response = await service.execute<{ result: unknown }>({ operation: "invoke-tool", toolName: "read_file", input: parsed.data });
      res.json(response.result);
    } catch (error) {
      sendWorkerError(res, error, "workspace_error");
    }
  });
  return app;
}
