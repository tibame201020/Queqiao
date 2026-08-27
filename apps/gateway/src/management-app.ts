import { createHash, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import express, { type Express, type Response } from "express";
import { z } from "zod";
import { workerIdSchema } from "@queqiao/contracts";
import { workerWorkspaceMutationSchema } from "@queqiao/worker-protocol";
import rateLimit from "express-rate-limit";
import { buildControlPlaneSnapshot, type DeploymentManifest, type GatewayDoctorResult, type OperationsDiagnostics, type RuntimeLifecycleSnapshot } from "@queqiao/operations";
import { EnrollmentError, EnrollmentService } from "./enrollment-service.js";
import { QueqiaoError, WorkerHttpError } from "./errors.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import type { WorkerRegistry } from "./worker-registry.js";
import { DashboardSessionBroker } from "./dashboard-session.js";

type ControlPlaneWorkerSource = { current(): Promise<Pick<WorkerRegistry, "listEnvironments" | "livenessSnapshot" | "mutateWorkspace">> };

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

function contained(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendWorkspaceMutationError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_workspace_mutation" }); return; }
  if (error instanceof WorkerHttpError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
  if (error instanceof QueqiaoError && error.code === "worker_not_found") { res.status(404).json({ error: error.code, message: error.message }); return; }
  res.status(500).json({ error: "workspace_mutation_failed" });
}

export function createGatewayManagementApp(options: {
  secret: string;
  enrollment: EnrollmentService;
  memberships: WorkerMembershipStore;
  workers: ControlPlaneWorkerSource;
  stateDirectory: string;
  operations: OperationsDiagnostics;
  manifest: DeploymentManifest;
  doctor: () => Promise<GatewayDoctorResult>;
  dashboardDirectory?: string;
  dashboardSessions?: DashboardSessionBroker;
  runtimeLifecycle?: () => Promise<RuntimeLifecycleSnapshot>;
}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    next();
  });
  app.post("/dashboard/session", (req, res) => {
    const exchanged = options.dashboardSessions?.exchange(typeof req.body?.code === "string" ? req.body.code : "");
    if (!exchanged) return res.status(401).json({ error: "invalid_dashboard_session_code" });
    res.json(exchanged);
  });
  if (options.dashboardDirectory) {
    app.use("/dashboard", (_req, res, next) => {
      res.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      next();
    });
    app.use("/dashboard", express.static(options.dashboardDirectory, { index: "index.html" }));
    app.use("/dashboard", (_req, res) => res.status(404).type("text/plain").send("Dashboard asset not found"));
  }
  app.use((req, res, next) => {
    const managementSecret = req.header("x-queqiao-management-secret") || "";
    const dashboardSession = req.header("x-queqiao-dashboard-session") || "";
    if (!safeEqual(managementSecret, options.secret) && !options.dashboardSessions?.authenticate(dashboardSession)) return res.status(401).json({ error: "unauthorized" });
    next();
  });
  app.post("/v1/dashboard-sessions", (req, res) => {
    if (!safeEqual(req.header("x-queqiao-management-secret") || "", options.secret)) return res.status(401).json({ error: "unauthorized" });
    if (!options.dashboardSessions) return res.status(404).json({ error: "dashboard_sessions_unavailable" });
    res.status(201).json(options.dashboardSessions.createCode());
  });
  app.delete("/v1/dashboard-session", (req, res) => {
    options.dashboardSessions?.revoke(req.header("x-queqiao-dashboard-session") || "");
    res.json({ revoked: true });
  });
  const mutateWorkspace = async (workerIdInput: unknown, mutationInput: unknown, res: Response) => {
    try {
      const workerId = workerIdSchema.parse(workerIdInput);
      const mutation = workerWorkspaceMutationSchema.parse(mutationInput);
      const registry = await options.workers.current();
      res.json(await registry.mutateWorkspace(workerId, mutation));
    } catch (error) {
      sendWorkspaceMutationError(res, error);
    }
  };

  app.get("/v1/operations", async (_req, res) => {
    try {
      const memberships = await options.memberships.read();
      const registry = await options.workers.current();
      const environments = await registry.listEnvironments();
      const livenessByEnvironment = new Map(registry.livenessSnapshot().map((state) => [state.environmentId, state]));
      const environmentById = new Map(environments.map((environment) => [environment.environmentId, environment]));
      res.json(buildControlPlaneSnapshot(options.operations, memberships.workers.map((worker) => {
        const environment = environmentById.get(worker.environmentId);
        const liveness = livenessByEnvironment.get(worker.environmentId) ?? { environmentId: worker.environmentId, reachable: false };
        return {
          workerId: worker.workerId,
          environmentId: worker.environmentId,
          transport: { type: worker.transport.type, endpoint: worker.transport.endpoint },
          liveness: {
            reachable: liveness.reachable,
            ...(liveness.checkedAt ? { checkedAt: liveness.checkedAt } : {}),
            ...(liveness.lastSuccessAt ? { lastSuccessAt: liveness.lastSuccessAt } : {}),
          },
          ...(environment?.defaultWorkspaceId ? { defaultWorkspaceId: environment.defaultWorkspaceId } : {}),
          workspaces: (environment?.workspaces ?? []).map((workspace) => ({
            workspaceId: workspace.workspaceId,
            displayName: workspace.displayName,
            root: workspace.root,
            profile: workspace.profile,
            tools: workspace.tools,
            commands: workspace.commands,
          })),
        };
      })));
    } catch {
      res.status(500).json({ error: "control_plane_snapshot_failed" });
    }
  });
  app.get("/v1/runtime-lifecycle", async (_req, res) => {
    if (!options.runtimeLifecycle) return res.status(404).json({ error: "runtime_lifecycle_unavailable" });
    try {
      res.json(await options.runtimeLifecycle());
    } catch {
      res.status(500).json({ error: "runtime_lifecycle_failed" });
    }
  });
  app.get("/v1/manifest", (_req, res) => {
    res.json(options.manifest);
  });
  app.get("/v1/doctor", async (_req, res) => {
    try {
      res.json(await options.doctor());
    } catch {
      res.status(500).json({ error: "doctor_failed" });
    }
  });

  app.post("/v1/workers/:workerId/workspaces", async (req, res) => {
    await mutateWorkspace(req.params.workerId, {
      kind: "workspace.add",
      workspace: {
        id: req.body?.id,
        displayName: req.body?.displayName,
        root: req.body?.root,
        profile: req.body?.profile,
      },
    }, res);
  });
  app.delete("/v1/workers/:workerId/workspaces/:workspaceId", async (req, res) => {
    await mutateWorkspace(req.params.workerId, { kind: "workspace.remove", workspaceId: req.params.workspaceId }, res);
  });
  app.patch("/v1/workers/:workerId/workspaces/:workspaceId/profile", async (req, res) => {
    await mutateWorkspace(req.params.workerId, { kind: "profile.set", workspaceId: req.params.workspaceId, profile: req.body?.profile }, res);
  });
  app.patch("/v1/workers/:workerId/workspaces/:workspaceId/tools/:tool", async (req, res) => {
    await mutateWorkspace(req.params.workerId, { kind: "tool.decide", workspaceId: req.params.workspaceId, tool: req.params.tool, decision: req.body?.decision }, res);
  });
  app.patch("/v1/workers/:workerId/workspaces/:workspaceId/commands", async (req, res) => {
    await mutateWorkspace(req.params.workerId, { kind: "command.decide", workspaceId: req.params.workspaceId, command: req.body?.command, decision: req.body?.decision }, res);
  });

  app.post(["/join-tokens", "/v1/join-tokens"], (req, res) => {
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
  app.patch(["/workers/:workerId/transport", "/v1/workers/:workerId/transport"], async (req, res) => {
    try {
      const membership = await options.enrollment.updateTransport(String(req.params.workerId || ""), req.body?.transport);
      res.json({ updated: true, workerId: membership.workerId, environmentId: membership.environmentId, transport: membership.transport });
    } catch (error) {
      const failure = error instanceof EnrollmentError ? error : new EnrollmentError(400, "worker_transport_update_failed", error instanceof Error ? error.message : "Worker transport update failed");
      res.status(failure.status).json({ error: failure.code, message: failure.message });
    }
  });
  app.delete(["/workers/:workerId", "/v1/workers/:workerId"], async (req, res) => {
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
