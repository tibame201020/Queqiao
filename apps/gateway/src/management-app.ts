import { createHash, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { EnrollmentError, EnrollmentService } from "./enrollment-service.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import type { WorkerSessionRegistry } from "./worker-session-registry.js";
import type { GitHubActionsRuntimeCoordinator } from "@queqiao/runtime-provider-github-actions";

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

function contained(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function createGatewayManagementApp(options: { secret: string; enrollment: EnrollmentService; memberships: WorkerMembershipStore; stateDirectory: string; sessions?: Pick<WorkerSessionRegistry, "detachWorker">; githubActionsRuntime?: GitHubActionsRuntimeCoordinator }): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use((req, res, next) => {
    if (!safeEqual(req.header("x-queqiao-management-secret") || "", options.secret)) return res.status(401).json({ error: "unauthorized" });
    next();
  });
  if (options.githubActionsRuntime) {
    app.post("/runtimes/github-actions", async (req, res) => {
      try {
        const ttlSeconds = Number(req.body?.ttlSeconds ?? 300);
        const metadata = req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
          ? req.body.metadata as Record<string, string>
          : {};
        res.status(201).json(await options.githubActionsRuntime!.provision({ ttlSeconds, metadata }));
      } catch (error) {
        res.status(400).json({ error: "runtime_provision_failed", message: error instanceof Error ? error.message : "Runtime provisioning failed" });
      }
    });
    app.get("/runtimes", (_req, res) => res.json({ runtimes: options.githubActionsRuntime!.list() }));
    app.get("/runtimes/:leaseId", (req, res) => {
      try {
        const lease = options.githubActionsRuntime!.get(req.params.leaseId);
        if (!lease) return res.status(404).json({ error: "runtime_not_found" });
        res.json(lease);
      } catch (error) {
        res.status(400).json({ error: "runtime_invalid", message: error instanceof Error ? error.message : "Invalid runtime lease" });
      }
    });
    app.post("/runtimes/:leaseId/complete", async (req, res) => {
      try { res.json(await options.githubActionsRuntime!.complete(req.params.leaseId)); }
      catch (error) { res.status(409).json({ error: "runtime_complete_failed", message: error instanceof Error ? error.message : "Runtime completion failed" }); }
    });
    app.delete("/runtimes/:leaseId", async (req, res) => {
      try { res.json(await options.githubActionsRuntime!.fail(req.params.leaseId, "Runtime disposed by operator")); }
      catch (error) { res.status(409).json({ error: "runtime_dispose_failed", message: error instanceof Error ? error.message : "Runtime disposal failed" }); }
    });
  }

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
  app.delete("/workers/:workerId", async (req, res) => {
    try {
      const before = await options.memberships.read();
      const existing = before.workers.find((worker) => worker.workerId === req.params.workerId);
      if (!existing) return res.status(404).json({ error: "worker_not_found" });
      await options.memberships.remove(existing.workerId);
      options.sessions?.detachWorker(existing.workerId, new Error("Worker membership removed by Gateway management"));
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