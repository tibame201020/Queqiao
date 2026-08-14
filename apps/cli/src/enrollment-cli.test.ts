import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { createGatewayApp } from "../../gateway/src/app.js";
import { EnrollmentService } from "../../gateway/src/enrollment-service.js";
import { WorkerMembershipStore } from "../../gateway/src/worker-membership-store.js";
import { createWorkerApp } from "../../worker/src/app.js";
import { WorkerCredentialSource } from "../../worker/src/worker-credential-source.js";
import { joinWorker, setupGateway, setupWorker } from "./enrollment-cli.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

async function listen(app: any): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve) => { const current = app.listen(0, "127.0.0.1", () => resolve(current)); });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not expose a port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function fixture(serverWorkerId?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-cli-join-"));
  const stateDir = path.join(root, "gateway-state");
  const workerRoot = path.join(root, "workspace");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(workerRoot, { recursive: true }));
  const tokenFile = path.join(root, "worker.secret");
  const bootstrap = "b".repeat(43);
  await writeFile(tokenFile, `${bootstrap}\n`, { mode: 0o600 });
  const workerId = crypto.randomUUID();
  const environmentId = "windows";
  const configFile = path.join(root, "config.yaml");
  await writeFile(configFile, serializeRuntimeConfig({ version: 1, environments: [], workspaces: [{ id: "default", displayName: "default", root: workerRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }], worker: { workerId, environmentId, listen: { host: "127.0.0.1", port: 7576 }, tokenFile, defaultWorkspaceId: "default" } }), "utf8");
  const credential = new WorkerCredentialSource(tokenFile);
  const workerApp = await createWorkerApp({ workerId: serverWorkerId || workerId, environmentId, defaultWorkspaceId: "default", workerCredential: credential, workspaces: [{ id: "default", displayName: "default", root: workerRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }] });
  const worker = await listen(workerApp);
  const memberships = new WorkerMembershipStore(stateDir);
  const enrollment = new EnrollmentService(memberships, stateDir);
  const gatewayConfig = { host: "127.0.0.1" as const, port: 7575, managementPort: 7574, publicBaseUrl: new URL("http://127.0.0.1/"), resourceUrl: "http://127.0.0.1/mcp", stateDir, approvalSecret: "a".repeat(32), jwtSecret: new TextEncoder().encode("j".repeat(48)), trustProxyHops: 0, allowedRedirectOrigins: new Set(["http://127.0.0.1"]), workers: [], extensions: [], configDirectory: root };
  const gateway = await listen(await createGatewayApp(gatewayConfig, enrollment));
  return { root, tokenFile, bootstrap, workerId, environmentId, configFile, memberships, enrollment, workerUrl: worker.url, gatewayUrl: gateway.url };
}

describe("role setup CLI", () => {
  it("sets up Gateway and Worker independently without creating cluster membership", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-role-setup-"));
    const configFile = path.join(root, "config", "config.yaml");
    const stateDirectory = path.join(root, "gateway-state");
    const secretsDirectory = path.join(root, "secrets");
    const workspaceRoot = path.join(root, "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspaceRoot, { recursive: true }));
    await setupGateway(configFile, ["gateway", "setup", "--public-base-url", "http://127.0.0.1:7575/"], stateDirectory, secretsDirectory);
    let runtime = await readRuntimeConfig(configFile);
    expect(runtime.gateway).toBeDefined();
    expect(runtime.worker).toBeUndefined();
    expect(runtime.environments).toEqual([]);
    expect((await readFile(path.join(stateDirectory, "management.secret"), "utf8")).trim().length).toBeGreaterThanOrEqual(32);
    await setupWorker(configFile, ["worker", "setup", "--workspace-id", "default", "--workspace-root", workspaceRoot], secretsDirectory);
    runtime = await readRuntimeConfig(configFile);
    expect(runtime.worker?.workerId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(runtime.environments).toEqual([]);
    expect((await readFile(runtime.worker!.tokenFile, "utf8")).trim().length).toBeGreaterThanOrEqual(32);
  });
});

describe("worker join CLI transaction", () => {
  it("replaces the bootstrap credential only after Gateway confirmation commits membership", async () => {
    const f = await fixture();
    const joinToken = f.enrollment.createJoinToken().token;
    const result: any = await joinWorker(f.configFile, ["worker", "join", "--token", joinToken, "--gateway", f.gatewayUrl, "--endpoint", f.workerUrl]);
    expect(result).toMatchObject({ joined: true, workerId: f.workerId, environmentId: f.environmentId });
    expect((await f.memberships.read()).workers).toHaveLength(1);
    expect((await readFile(f.tokenFile, "utf8")).trim()).not.toBe(f.bootstrap);
    await expect(readFile(`${f.tokenFile}.join-provisional.json`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores the previous credential when authenticated identity verification fails", async () => {
    const f = await fixture(crypto.randomUUID());
    const joinToken = f.enrollment.createJoinToken().token;
    await expect(joinWorker(f.configFile, ["worker", "join", "--token", joinToken, "--gateway", f.gatewayUrl, "--endpoint", f.workerUrl])).rejects.toThrow(/worker_identity_mismatch/);
    expect((await f.memberships.read()).workers).toEqual([]);
    expect((await readFile(f.tokenFile, "utf8")).trim()).toBe(f.bootstrap);
    await expect(readFile(`${f.tokenFile}.join-provisional.json`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
