import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubActionsRuntimeClaimRegistry,
  GitHubActionsRuntimeCoordinator,
  GitHubActionsRuntimeProvider,
  type GitHubActionsApi,
  type GitHubActionsOidcVerifier,
} from "@queqiao/runtime-provider-github-actions";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";
import { EnrollmentService } from "./enrollment-service.js";
import { createGatewayManagementApp } from "./management-app.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

const workerId = "22222222-2222-4222-8222-222222222222";
const instanceId = "33333333-3333-4333-8333-333333333333";
const managementSecret = "management-secret-for-runtime-integration";

async function fakeWorker(environmentId: string): Promise<{ endpoint: string; close: () => Promise<void> }> {
  const app = express();
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/enrollment/identity", (_req, res) => res.json({ workerId, environmentId, protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION }));
  app.get("/v1/hello", (_req, res) => res.json({
    workerId,
    environmentId,
    instanceId,
    platform: "linux",
    capabilities: [],
    protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION,
  }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake Worker address unavailable");
  return {
    endpoint: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("GitHub Actions runtime Gateway integration", () => {
  const temporary: string[] = [];
  const workers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (workers.length) await workers.pop()!();
    while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true });
  });

  it("provisions, authorizes OIDC claim, commits Worker enrollment, becomes ready, and cancels on completion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-runtime-github-"));
    temporary.push(root);
    const memberships = new WorkerMembershipStore(root);
    const enrollment = new EnrollmentService(memberships, root);
    const cancel = vi.fn(async () => undefined);
    const api: GitHubActionsApi = {
      dispatch: vi.fn(async () => ({
        runId: 12345,
        runUrl: "https://api.github.test/runs/12345",
        htmlUrl: "https://github.test/runs/12345",
      })),
      cancel,
    };
    const verifier: GitHubActionsOidcVerifier = {
      verify: vi.fn(async () => ({
        repository: "example/runtime-host",
        runId: 12345,
        workflowRef: "example/runtime-host/.github/workflows/runtime.yml@refs/heads/main",
        ref: "refs/heads/main",
        eventName: "workflow_dispatch",
        subject: "repo:example/runtime-host:ref:refs/heads/main",
      })),
    };
    const claims = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verifier);
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      gatewayUrl: "https://queqiao.example/",
      api,
      claimRegistry: claims,
    });
    const coordinator = new GitHubActionsRuntimeCoordinator(provider, claims);

    const config: GatewayRuntimeConfig = {
      port: 7575,
      managementPort: 7574,
      workerSessionHost: "127.0.0.1",
      workerSessionPort: 7573,
      publicBaseUrl: new URL("https://queqiao.example/"),
      resourceUrl: "https://queqiao.example/mcp",
      stateDir: root,
      approvalSecret: "approval-secret-for-runtime-integration",
      jwtSecret: new TextEncoder().encode("runtime-integration-jwt-secret-at-least-32-bytes"),
      trustProxyHops: 1,
      allowedRedirectOrigins: new Set(["https://chatgpt.com"]),
      extensions: [],
      configDirectory: root,
    };

    const gateway = await createGatewayApp(config, enrollment, undefined, undefined, coordinator);
    const management = createGatewayManagementApp({
      secret: managementSecret,
      enrollment,
      memberships,
      stateDirectory: root,
      githubActionsRuntime: coordinator,
    });
    const auth = { "x-queqiao-management-secret": managementSecret };

    const provision = await request(management)
      .post("/runtimes/github-actions")
      .set(auth)
      .send({ ttlSeconds: 300, metadata: { runtimeKind: "ephemeral" } })
      .expect(201);
    expect(provision.body.state).toBe("provisioning");
    expect(provision.body.providerRef).toBe("github-actions-run:12345");
    expect(JSON.stringify(provision.body)).not.toMatch(/token|authorization|credential/i);

    const leaseId = String(provision.body.leaseId);
    const environmentId = String(provision.body.providerMetadata.environmentId);
    const worker = await fakeWorker(environmentId);
    workers.push(worker.close);

    const claim = await request(gateway)
      .post("/runtime/github-actions/claim")
      .send({ leaseId, oidcToken: "x".repeat(64), workerId })
      .expect(201);
    expect(claim.body).toMatchObject({
      gateway: "https://queqiao.example/",
      environmentId,
      runId: 12345,
    });
    expect(typeof claim.body.token).toBe("string");
    expect(claim.body.token.length).toBeGreaterThanOrEqual(32);

    const start = await request(gateway)
      .post("/enrollment/join/start")
      .send({
        token: claim.body.token,
        workerId,
        environmentId,
        transports: [{ type: "http", endpoint: worker.endpoint }],
      })
      .expect(201);

    const confirmed = await request(gateway)
      .post("/enrollment/join/confirm")
      .set("x-queqiao-worker-token", String(start.body.credential))
      .send({ transactionId: start.body.transactionId })
      .expect(200);
    expect(confirmed.body.runtimeLease).toMatchObject({ leaseId, state: "ready" });

    const ready = await request(management)
      .get(`/runtimes/${leaseId}`)
      .set(auth)
      .expect(200);
    expect(ready.body).toMatchObject({
      state: "ready",
      worker: { workerId, environmentId },
    });

    const complete = await request(management)
      .post(`/runtimes/${leaseId}/complete`)
      .set(auth)
      .expect(200);
    expect(complete.body).toMatchObject({
      state: "disposed",
      terminal: { outcome: "completed" },
    });
    expect(cancel).toHaveBeenCalledWith({ owner: "example", repo: "runtime-host", runId: 12345 });
  });

  it("does not expose runtime routes when the provider is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-runtime-disabled-"));
    temporary.push(root);
    const memberships = new WorkerMembershipStore(root);
    const enrollment = new EnrollmentService(memberships, root);
    const config: GatewayRuntimeConfig = {
      port: 7575,
      managementPort: 7574,
      workerSessionHost: "127.0.0.1",
      workerSessionPort: 7573,
      publicBaseUrl: new URL("https://queqiao.example/"),
      resourceUrl: "https://queqiao.example/mcp",
      stateDir: root,
      approvalSecret: "approval-secret-for-runtime-disabled",
      jwtSecret: new TextEncoder().encode("runtime-disabled-jwt-secret-at-least-32-bytes"),
      trustProxyHops: 1,
      allowedRedirectOrigins: new Set(["https://chatgpt.com"]),
      extensions: [],
      configDirectory: root,
    };
    const gateway = await createGatewayApp(config, enrollment);
    await request(gateway).post("/runtime/github-actions/claim").send({}).expect(404);
  });
});