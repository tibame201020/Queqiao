import { createHash, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { EnrollmentError, EnrollmentService } from "./enrollment-service.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

function contained(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function createGatewayManagementApp(options: { secret: string; enrollment: EnrollmentService; memberships: WorkerMembershipStore; stateDirectory: string }): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use((req, res, next) => {
    if (!safeEqual(req.header("x-queqiao-management-secret") || "", options.secret)) return res.status(401).json({ error: "unauthorized" });
    next();
  });
  app.post("/join-tokens", (req, res) => {
    try {
      const result = options.enrollment.createJoinToken({
        ...(req.body?.expiresSeconds !== undefined ? { expiresSeconds: Number(req.body.expiresSeconds) } : {}),
        ...(typeof req.body?.workerId === "string" ? { workerId: req.body.workerId } : {}),
        ...(typeof req.body?.environmentId === "string" ? { environmentId: req.body.environmentId } : {}),
      });
      res.status(201).json(result);
    } catch (error) {
      const failure = error instanceof EnrollmentError ? error : new EnrollmentError(400, "invalid_join_token_request", error instanceof Error ? error.message : "Invalid request");
      res.status(failure.status).json({ error: failure.code, message: failure.message });
    }
  });
  app.get("/workers", async (_req, res) => res.json(await options.memberships.read()));
  app.patch("/workers/:workerId/transport", async (req, res) => {
    try {
      const membership = await options.enrollment.updateTransport(req.params.workerId, req.body?.transport);
      res.json({ updated: true, workerId: membership.workerId, environmentId: membership.environmentId, transport: membership.transport });
    } catch (error) {
      const failure = error instanceof EnrollmentError ? error : new EnrollmentError(400, "worker_transport_update_failed", error instanceof Error ? error.message : "Worker transport update failed");
      res.status(failure.status).json({ error: failure.code, message: failure.message });
    }
  });
  app.delete("/workers/:workerId", async (req, res) => {
    try {
      const before = await options.memberships.read();
      const existing = before.workers.find((worker) => worker.workerId === req.params.workerId);
      if (!existing) return res.status(404).json({ error: "worker_not_found" });
      await options.memberships.remove(existing.workerId);
      const managedDirectory = path.join(options.stateDirectory, "worker-credentials");
      for (const reference of existing.credentialRefs) {
        if (reference.kind === "secret-file" && contained(managedDirectory, reference.path)) await rm(reference.path, { force: true }).catch(() => undefined);
      }
      res.json({ removed: true, workerId: existing.workerId, environmentId: existing.environmentId });
    } catch (error) {
      res.status(500).json({ error: "worker_remove_failed", message: error instanceof Error ? error.message : "Worker removal failed" });
    }
  });
  return app;
}
