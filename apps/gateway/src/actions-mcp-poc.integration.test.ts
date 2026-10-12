import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import request from "supertest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubActionsRuntimeCoordinator } from "@queqiao/runtime-provider-github-actions";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";

async function accessToken(app: Awaited<ReturnType<typeof createGatewayApp>>) {
  const redirect = "https://chatgpt.com/connector/oauth/callback";
  const reg = await request(app).post("/oauth/register").send({
    client_name: "Actions Gate C contract test",
    redirect_uris: [redirect],
    token_endpoint_auth_method: "none",
    scope: "queqiao:access",
  }).expect(201);
  const verifier = randomBytes(40).toString("base64url");
  const approved = await request(app).post("/oauth/authorize").type("form").send({
    client_id: reg.body.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "queqiao:access",
    resource: "http://localhost:7575/mcp",
    state: "gate-c-test",
    approval_secret: "test-approval",
  }).expect(303);
  const code = new URL(approved.headers.location).searchParams.get("code");
  const token = await request(app).post("/oauth/token").type("form").send({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: reg.body.client_id,
    code_verifier: verifier,
    resource: "http://localhost:7575/mcp",
  }).expect(200);
  return String(token.body.access_token);
}

describe("Gate C opt-in MCP endpoint", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

  async function gateway(enabled: boolean, preview = false) {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-actions-gate-c-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const lease = {
      leaseId: "11111111-1111-4111-8111-111111111111",
      state: "provisioning",
      providerMetadata: { environmentId: "gha_111111111111411181111111", runId: "54321" },
    };
    const fake = {
      provision: vi.fn(async () => ({ ...lease })),
      get: vi.fn(() => ({ ...lease })),
      complete: vi.fn(async () => ({ ...lease, state: "disposed" })),
      fail: vi.fn(async () => ({ ...lease, state: "disposed" })),
    };
    const config: GatewayRuntimeConfig = {
      port: 7575,
      managementPort: 7574,
      workerSessionHost: "127.0.0.1",
      workerSessionPort: 7573,
      publicBaseUrl: new URL("http://localhost:7575/"),
      resourceUrl: "http://localhost:7575/mcp",
      stateDir: root,
      approvalSecret: "test-approval",
      jwtSecret: new TextEncoder().encode("test-jwt-signing-secret-at-least-32-characters"),
      trustProxyHops: 1,
      allowedRedirectOrigins: new Set(["https://chatgpt.com"]),
      extensions: [],
      configDirectory: root,
      githubActionsRuntime: { owner: "example", repo: "runtime-host", workflowId: "runtime-provider-poc-worker.yml", ref: "main", token: "never-live", audience: "urn:test", mcpPocEnabled: enabled, ...(preview ? { shortTasksPreview: { enabled: true, sourceRevision: "a".repeat(40), ownerKey: "stable-preview-owner-secret-key-at-least-32-bytes" } } : {}) },
    };
    const app = await createGatewayApp(config, undefined, undefined, undefined, fake as unknown as GitHubActionsRuntimeCoordinator);
    const server = await new Promise<Server>((resolve) => {
      const socket = app.listen(0, "127.0.0.1", () => resolve(socket));
    });
    cleanup.push(() => new Promise((resolve) => server.close(() => resolve())));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Test listener missing");
    return { app, fake, endpoint: new URL(`http://127.0.0.1:${addr.port}/mcp`) };
  }

  async function connect(app: Awaited<ReturnType<typeof createGatewayApp>>, endpoint: URL) {
    const token = await accessToken(app);
    const client = new Client({ name: "gate-c-test", version: "1" }, {
      supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" },
    });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    cleanup.push(() => client.close());
    return client;
  }

  it("hides all Actions controls unless provider opt-in is enabled", async () => {
    const { app, endpoint } = await gateway(false);
    const client = await connect(app, endpoint);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).not.toContain("actions_worker_start");
    expect(tools).not.toContain("actions_worker_read_marker");
    // Issue #115 internal ledger must not accidentally expose unreviewed task controls.
    for (const name of ["short_task_submit", "short_task_status", "short_task_execute", "short_task_cancel"]) {
      expect(tools).not.toContain(name);
    }
  });

  it("exposes separately opted-in short tasks only to authenticated OAuth clients with ownership isolation", async () => {
    const { app, endpoint, fake } = await gateway(false, true);
    const owner = await connect(app, endpoint);
    const stranger = await connect(app, endpoint);
    const tools = (await owner.listTools()).tools.map((tool) => tool.name);
    for (const name of ["short_task_submit", "short_task_status", "short_task_execute", "short_task_cancel"]) {
      expect(tools).toContain(name);
    }
    expect(tools).not.toContain("actions_worker_start");
    const submitted = await owner.callTool({ name: "short_task_submit", arguments: {
      taskId: "gateway-vitest", idempotencyKey: "owner-job-1",
    } });
    expect(submitted.isError).not.toBe(true);
    const value = JSON.parse(submitted.content.filter((item) => item.type === "text").map((item) => item.text).join(""));
    expect(value).toMatchObject({ taskId: "gateway-vitest", runId: "54321" });
    expect(JSON.stringify(value)).not.toMatch(/ownerDigest|idempotencyDigest|test-jwt-signing-secret/);
    const repeat = await owner.callTool({ name: "short_task_submit", arguments: {
      taskId: "gateway-vitest", idempotencyKey: "owner-job-1",
    } });
    expect(JSON.stringify(repeat)).toContain(value.id);
    expect(fake.provision).toHaveBeenCalledTimes(1);
    const lookup = await stranger.callTool({ name: "short_task_status", arguments: { id: value.id } });
    expect(lookup.isError).toBe(true);
    expect(JSON.stringify(lookup)).not.toContain("54321");
    const cancel = await stranger.callTool({ name: "short_task_cancel", arguments: { id: value.id } });
    expect(cancel.isError).toBe(true);
    expect(fake.fail).not.toHaveBeenCalled();
    const ownerCancel = await owner.callTool({ name: "short_task_cancel", arguments: { id: value.id } });
    expect(ownerCancel.isError).not.toBe(true);
    expect(JSON.stringify(ownerCancel)).toContain("cancelled");
  });
  it("authenticated MCP client can initiate and cancel an ephemeral runtime without management credentials", async () => {
    const { app, endpoint, fake } = await gateway(true);
    const client = await connect(app, endpoint);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of ["actions_worker_start", "actions_worker_status", "actions_worker_read_marker", "actions_worker_cancel"]) {
      expect(names).toContain(name);
    }
    const started = await client.callTool({ name: "actions_worker_start", arguments: {} });
    expect(started.isError).not.toBe(true);
    expect(JSON.stringify(started)).toContain("54321");
    expect(JSON.stringify(started)).not.toMatch(/never-live|test-approval/i);
    const status = await client.callTool({ name: "actions_worker_status", arguments: {} });
    expect(status.isError).not.toBe(true);
    expect(JSON.stringify(status)).toContain("provisioning");
    const cancelled = await client.callTool({ name: "actions_worker_cancel", arguments: {} });
    expect(cancelled.isError).not.toBe(true);
    expect(JSON.stringify(cancelled)).toContain("disposed");
    expect(fake.provision).toHaveBeenCalledTimes(1);
    expect(fake.fail).toHaveBeenCalledTimes(1);
  });

  it("a distinct OAuth client cannot observe or cancel another client's Worker", async () => {
    const { app, endpoint, fake } = await gateway(true);
    const owner = await connect(app, endpoint);
    const stranger = await connect(app, endpoint);
    await owner.callTool({ name: "actions_worker_start", arguments: {} });
    const status = await stranger.callTool({ name: "actions_worker_status", arguments: {} });
    expect(status.isError).toBe(true);
    expect(JSON.stringify(status)).not.toContain("54321");
    const cancel = await stranger.callTool({ name: "actions_worker_cancel", arguments: {} });
    expect(cancel.isError).toBe(true);
    expect(fake.fail).not.toHaveBeenCalled();
    await owner.callTool({ name: "actions_worker_cancel", arguments: {} });
  });
});
