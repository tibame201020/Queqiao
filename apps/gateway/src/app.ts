import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createMcpExpressApp, originValidation } from "@modelcontextprotocol/express";
import type { GatewayRuntimeConfig } from "./config.js";
import { createMcpNodeAdapter } from "./mcp-adapter.js";
import { McpCancellationRegistry } from "./cancellation-registry.js";
import { OAuthService, type AccessClaims } from "./oauth.js";
import { ReloadableWorkerRegistry } from "./worker-registry-config.js";
import { ClientRequestBudget } from "./request-budget.js";
import { EnrollmentError, EnrollmentService } from "./enrollment-service.js";

export async function createGatewayApp(config: GatewayRuntimeConfig, enrollment?: EnrollmentService): Promise<Express> {
  const oauth = new OAuthService(config); await oauth.initialize();
  const workerSource = new ReloadableWorkerRegistry(config.workersFile ? { file: config.workersFile } : { workers: config.workers });
  await workerSource.initialize();
  const allowedOriginHostnames = [...new Set([config.publicBaseUrl.hostname, "localhost", "127.0.0.1", "[::1]", ...[...config.allowedRedirectOrigins].map((origin) => new URL(origin).hostname)])];
  const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts: [config.publicBaseUrl.hostname, "localhost", "127.0.0.1", "[::1]"], jsonLimit: "6mb" });
  app.set("trust proxy", config.trustProxyHops); app.disable("x-powered-by");
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const rpcMethod = req.path === "/mcp" && typeof req.body?.method === "string" ? req.body.method : undefined;
      const toolName = rpcMethod === "tools/call" && typeof req.body?.params?.name === "string" ? req.body.params.name : undefined;
      console.log(JSON.stringify({ event: "http_request", method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt, ...(rpcMethod ? { rpcMethod } : {}), ...(toolName ? { toolName } : {}) }));
    });
    next();
  });
  const formActionOrigins = [...config.allowedRedirectOrigins].map((origin) => new URL(origin).origin).join(" ");
  app.use((_req, res, next) => { res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formActionOrigins}; frame-ancestors 'none'` }); next(); });
  app.use(["/oauth/authorize", "/oauth/token", "/oauth/register"], rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }));
  app.post("/oauth/authorize", rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: () => "global-approval-secret", standardHeaders: "draft-8", legacyHeaders: false }));
  app.use(oauth.router);

  if (enrollment) {
    const enrollmentLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
    app.post("/enrollment/join/start", enrollmentLimiter, async (req, res) => {
      try { res.status(201).json(await enrollment.startJoin(req.body)); }
      catch (error) { const failure = error instanceof EnrollmentError ? error : new EnrollmentError(400, "invalid_join_request", error instanceof Error ? error.message : "Invalid join request"); res.status(failure.status).json({ error: failure.code, message: failure.message }); }
    });
    app.post("/enrollment/join/confirm", enrollmentLimiter, async (req, res) => {
      try {
        const transactionId = typeof req.body?.transactionId === "string" ? req.body.transactionId : "";
        const credential = req.header("x-queqiao-worker-token") || "";
        if (!transactionId || !credential) throw new EnrollmentError(400, "invalid_confirmation", "transactionId and provisional credential are required");
        const membership = await enrollment.confirmJoin(transactionId, credential);
        res.json({ joined: true, workerId: membership.workerId, environmentId: membership.environmentId });
      } catch (error) { const failure = error instanceof EnrollmentError ? error : new EnrollmentError(400, "join_confirmation_failed", error instanceof Error ? error.message : "Join confirmation failed"); res.status(failure.status).json({ error: failure.code, message: failure.message }); }
    });
  }

  let healthLoading: Promise<Array<{ environmentId: string; online: boolean; workspaceCount: number }>> | undefined;
  let healthCache: { expiresAt: number; environments: Array<{ environmentId: string; online: boolean; workspaceCount: number }> } | undefined;
  const health = async () => {
    if (healthCache && healthCache.expiresAt > Date.now()) return healthCache.environments;
    healthLoading ??= (await workerSource.current()).listEnvironments().then((environments) => environments.map(({ environmentId, online, workspaces }) => ({ environmentId, online, workspaceCount: workspaces.length }))).finally(() => { healthLoading = undefined; });
    const environments = await healthLoading;
    healthCache = { expiresAt: Date.now() + 5000, environments };
    return environments;
  };
  app.get("/health", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }), async (_req, res) => { const environments = await health(); const ok = environments.some((environment) => environment.online); res.status(ok ? 200 : 503).json({ ok, service: "queqiao-gateway", environments }); });
  app.use("/mcp", originValidation(allowedOriginHostnames));
  app.use("/mcp", oauth.authenticate);
  const clientBudget = new ClientRequestBudget();
  const cancellationRegistry = new McpCancellationRegistry();
  app.use("/mcp", (_req, res, next) => {
    const clientId = String((res.locals.oauth as AccessClaims).client_id || "");
    const decision = clientBudget.acquire(clientId);
    if (!decision.allowed) return res.status(429).json({ error: decision.reason === "rate" ? "rate_limit_exceeded" : "concurrency_limit_exceeded" });
    res.once("finish", decision.release); res.once("close", decision.release);
    next();
  });
  app.post("/mcp", async (req: Request, res: Response) => {
    const claims = res.locals.oauth as AccessClaims;
    const adapter = createMcpNodeAdapter(await workerSource.current(), claims.scope.split(" ").filter(Boolean), { principalId: claims.client_id, registry: cancellationRegistry }, config.extensions);
    res.on("close", () => { void adapter.close(); });
    try { await adapter.handle(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }); }
  });
  const methodNotAllowed = (_req: Request, res: Response) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  app.get("/mcp", methodNotAllowed); app.delete("/mcp", methodNotAllowed);
  return app;
}
