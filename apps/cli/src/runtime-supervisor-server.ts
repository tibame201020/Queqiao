import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { QUEQIAO_RUNTIME_SUPERVISOR_DEFAULT_PORT, QUEQIAO_RUNTIME_SUPERVISOR_SECRET_HEADER, sanitizeRuntimeLifecycleProjection, type RuntimeLifecycleRole, type RuntimeLifecycleSupervisor } from "@queqiao/operations";
import { resolveRuntimeLayout, resolveRuntimeLayoutForNamedRole, secureRuntimeDirectory, secureRuntimeFile, type RuntimeLayout } from "@queqiao/platform-paths";
import { LocalRuntimeSupervisor } from "./service-lifecycle.js";

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function runtimeSupervisorSecretFile(layout: RuntimeLayout = resolveRuntimeLayout()): string {
  return path.join(layout.stateDir, "supervisor.secret");
}

export async function ensureRuntimeSupervisorSecret(layout: RuntimeLayout = resolveRuntimeLayout()): Promise<{ file: string; secret: string }> {
  await secureRuntimeDirectory(layout.stateDir);
  const file = runtimeSupervisorSecretFile(layout);
  try {
    const secret = (await readFile(file, "utf8")).trim();
    if (Buffer.byteLength(secret) < 32) throw new Error("Runtime supervisor secret is too short");
    await secureRuntimeFile(file);
    return { file, secret };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32).toString("base64url");
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${secret}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await secureRuntimeFile(file);
  return { file, secret };
}

type SupervisorResolver = (role: RuntimeLifecycleRole, name: string) => RuntimeLifecycleSupervisor;

export function createRuntimeSupervisorApp(options: { secret: string; resolveSupervisor?: SupervisorResolver }): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use((_req, res, next) => { res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); next(); });
  app.use((req, res, next) => {
    if (!safeEqual(req.header(QUEQIAO_RUNTIME_SUPERVISOR_SECRET_HEADER) || "", options.secret)) return res.status(401).json({ error: "unauthorized" });
    next();
  });
  const resolveSupervisor: SupervisorResolver = options.resolveSupervisor ?? ((role, name) => {
    const layout = resolveRuntimeLayoutForNamedRole(role, name);
    return new LocalRuntimeSupervisor(layout.configFile, layout);
  });
  app.get("/v1/runtime-lifecycle/:role/:name", async (req, res) => {
    const role = req.params.role;
    const name = req.params.name;
    if (role !== "gateway" && role !== "worker") return res.status(400).json({ error: "invalid_runtime_role" });
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return res.status(400).json({ error: "invalid_runtime_name" });
    try {
      const projection = await resolveSupervisor(role, name).status(role, name);
      res.json(sanitizeRuntimeLifecycleProjection(projection));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return res.status(404).json({ error: "runtime_not_configured" });
      res.status(500).json({ error: "runtime_lifecycle_failed" });
    }
  });
  return app;
}

export async function serveRuntimeSupervisor(port = QUEQIAO_RUNTIME_SUPERVISOR_DEFAULT_PORT): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Supervisor port must be an integer between 1024 and 65535");
  const { secret } = await ensureRuntimeSupervisorSecret();
  const app = createRuntimeSupervisorApp({ secret });
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      console.log(`Queqiao runtime supervisor listening on http://127.0.0.1:${port}`);
    });
    server.once("error", reject);
    server.once("close", resolve);
  });
}
