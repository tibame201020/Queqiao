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
  membershipCredentials?: {
    accepts(credential: string): boolean | Promise<boolean>;
    stage(input: { transactionId: string; gateway: string; credential: string }): void | Promise<void>;
    commit(transactionId: string): void | Promise<void>;
    revoke(transactionId: string): void | Promise<void>;
  };
  reverseSessionControl?: {
    activate(input: { gateway?: string; target: string; credential: string; security?: "tls" | "loopback"; caCertificate?: string }): Promise<void>;
    deactivate?(gateway: string): void | Promise<void>;
  };
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
  const localCredential = async () => config.workerCredential ? config.workerCredential.current() : Promise.resolve(config.workerToken || "");
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") return next();
    try {
      const presented = req.header("x-queqiao-worker-token") || "";
      const local = await localCredential();
      const localAuthorized = safeEqual(presented, local);
      const membershipAuthorized = config.membershipCredentials ? await config.membershipCredentials.accepts(presented) : localAuthorized;
      const controlOnly = req.path.startsWith("/enrollment/reverse-session/") || req.path.startsWith("/enrollment/membership/");
      const identity = req.path === "/enrollment/identity";
      if (controlOnly ? !localAuthorized : identity ? !(localAuthorized || membershipAuthorized) : !membershipAuthorized) {
        return res.status(401).json({ error: "unauthorized" });
      }
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
  if (config.membershipCredentials) {
    app.post("/enrollment/membership/stage", async (req, res) => {
      const parsed = z.object({ transactionId: z.string().min(1).max(128), gateway: z.url(), credential: z.string().min(32).max(256) }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try { await config.membershipCredentials!.stage(parsed.data); res.status(204).end(); }
      catch (error) { res.status(409).json({ error: "membership_stage_failed", message: error instanceof Error ? error.message : "Membership staging failed" }); }
    });
    app.post("/enrollment/membership/commit", async (req, res) => {
      const parsed = z.object({ transactionId: z.string().min(1).max(128) }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try { await config.membershipCredentials!.commit(parsed.data.transactionId); res.status(204).end(); }
      catch (error) { res.status(409).json({ error: "membership_commit_failed", message: error instanceof Error ? error.message : "Membership commit failed" }); }
    });
    app.post("/enrollment/membership/revoke", async (req, res) => {
      const parsed = z.object({ transactionId: z.string().min(1).max(128) }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      await config.membershipCredentials!.revoke(parsed.data.transactionId); res.status(204).end();
    });
  }
  if (config.reverseSessionControl) {
    app.post("/enrollment/reverse-session/disconnect", async (req, res) => {
      const parsed = z.object({ gateway: z.url() }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request", message: "gateway is required" });
      try { await config.reverseSessionControl!.deactivate?.(parsed.data.gateway); res.status(204).end(); }
      catch (error) { res.status(502).json({ error: "worker_session_disconnect_failed", message: error instanceof Error ? error.message : "Worker reverse session disconnect failed" }); }
    });
    app.post("/enrollment/reverse-session/connect", async (req, res) => {
      const parsed = z.object({ gateway: z.url().optional(), target: z.string().min(1).max(512), credential: z.string().min(32).max(256).optional(), security: z.enum(["tls", "loopback"]).optional(), caCertificate: z.string().min(64).max(32_768).optional() }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request", message: "target is required" });
      try {
        const credential = parsed.data.credential ?? await localCredential();
        await config.reverseSessionControl!.activate({ ...(parsed.data.gateway ? { gateway: parsed.data.gateway } : {}), target: parsed.data.target, credential, ...(parsed.data.security ? { security: parsed.data.security } : {}), ...(parsed.data.caCertificate ? { caCertificate: parsed.data.caCertificate } : {}) });
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
