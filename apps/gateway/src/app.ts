import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { GatewayRuntimeConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { OAuthService, type AccessClaims } from "./oauth.js";
import { ReloadableWorkerRegistry } from "./worker-registry-config.js";
import { ClientRequestBudget } from "./request-budget.js";

export async function createGatewayApp(config: GatewayRuntimeConfig): Promise<Express> {
  const oauth = new OAuthService(config); await oauth.initialize();
  const workerSource = new ReloadableWorkerRegistry(config.workersFile ? { file: config.workersFile } : { workers: config.workers });
  await workerSource.initialize();
  const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts: [config.publicBaseUrl.hostname, "localhost", "127.0.0.1", "[::1]"] });
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
  app.use("/mcp", oauth.authenticate);
  const clientBudget = new ClientRequestBudget();
  app.use("/mcp", (_req, res, next) => {
    const clientId = String((res.locals.oauth as AccessClaims).client_id || "");
    const decision = clientBudget.acquire(clientId);
    if (!decision.allowed) return res.status(429).json({ error: decision.reason === "rate" ? "rate_limit_exceeded" : "concurrency_limit_exceeded" });
    res.once("finish", decision.release); res.once("close", decision.release);
    next();
  });
  app.post("/mcp", async (req: Request, res: Response) => {
    const claims = res.locals.oauth as AccessClaims;
    const server = createMcpServer(await workerSource.current(), claims.scope.split(" ").filter(Boolean));
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    try { await server.connect(transport); res.on("close", () => { void transport.close(); void server.close(); }); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }); }
  });
  const methodNotAllowed = (_req: Request, res: Response) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  app.get("/mcp", methodNotAllowed); app.delete("/mcp", methodNotAllowed);
  return app;
}
