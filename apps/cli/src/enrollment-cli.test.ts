import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
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
import { copyTextToClipboard, decodeJoinCode, encodeJoinCode, joinWorker, setupGateway, setupWorker, updateWorkerPort } from "./enrollment-cli.js";
import { addWorkspace } from "./workspace-cli.js";


describe("join code envelope", () => {
  it("round-trips the Gateway public URL and one-time token", () => {
    const code = encodeJoinCode({ v: 1, gateway: "https://gateway.example/shadow/", token: "one-time-token", expiresAt: "2026-08-19T01:00:00.000Z" });
    expect(code.startsWith("qjq1:")).toBe(true);
    expect(decodeJoinCode(code)).toEqual({ v: 1, gateway: "https://gateway.example/shadow/", token: "one-time-token", expiresAt: "2026-08-19T01:00:00.000Z" });
  });
});
describe("clipboard helper", () => {
  it("copies the exact token through an injected writer", async () => {
    let copied = "";
    await copyTextToClipboard("one-time-token", async (value) => { copied = value; });
    expect(copied).toBe("one-time-token");
  });
});
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
    expect(runtime).not.toHaveProperty("environments");
    expect((await readFile(path.join(stateDirectory, "management.secret"), "utf8")).trim().length).toBeGreaterThanOrEqual(32);
    const setup: any = await setupWorker(configFile, ["worker", "setup", "--port", "7576"], secretsDirectory);
    runtime = await readRuntimeConfig(configFile);
    expect(runtime.worker?.workerId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(runtime.worker?.listen.port).toBe(7576);
    expect(setup.port).toBe(7576);
    expect(runtime).not.toHaveProperty("environments");
    expect((await readFile(runtime.worker!.tokenFile, "utf8")).trim().length).toBeGreaterThanOrEqual(32);
  });

  it("completes the mocked first-time setup flow through Gateway, Worker, and Workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-setup-flow-"));
    const configFile = path.join(root, "config", "config.yaml");
    const stateDirectory = path.join(root, "gateway-state");
    const secretsDirectory = path.join(root, "secrets");
    const workspaceRoot = path.join(root, "My Project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspaceRoot, { recursive: true }));
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);

    await setupGateway(configFile, ["gateway", "setup", "--public-base-url", "https://gateway.example/shadow/"], stateDirectory, secretsDirectory);

    const workerPrompts: string[] = [];
    await setupWorker(configFile, ["worker", "setup"], secretsDirectory, async (field, message, initialValue) => {
      workerPrompts.push(`${field}:${message}:${initialValue}`);
      return "8765";
    });

    const workspacePrompts: string[] = [];
    const workspaceAnswers = [workspaceRoot, "", "My Project", "3"];
    await addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], async (message) => {
      workspacePrompts.push(message);
      return workspaceAnswers.shift() || "";
    });

    const runtime = await readRuntimeConfig(configFile);
    expect(workerPrompts).toEqual(["port:Worker port:7576"]);
    expect(workspacePrompts).toEqual([
      `Workspace path [${process.cwd()}]: `,
      "Workspace id [my-project]: ",
      "Display name [my-project]: ",
      "Profile [1=read-only, 2=editor, 3=coding] (1): ",
    ]);
    expect(runtime.gateway?.publicBaseUrl).toBe("https://gateway.example/shadow/");
    expect(runtime.worker).toMatchObject({ listen: { host: "127.0.0.1", port: 8765 }, defaultWorkspaceId: "my-project" });
    expect(runtime.workspaces).toEqual([
      expect.objectContaining({ id: "my-project", displayName: "My Project", root: canonicalWorkspaceRoot, profile: "coding" }),
    ]);
  });
  it("prompts for Worker port when --port is omitted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-setup-port-"));
    const configFile = path.join(root, "config", "config.yaml");
    const secretsDirectory = path.join(root, "secrets");
    const prompted: string[] = [];
    const result: any = await setupWorker(configFile, ["worker", "setup"], secretsDirectory, async (field, message, initialValue) => {
      prompted.push(`${field}:${message}:${initialValue}`);
      return "8765";
    });
    const runtime = await readRuntimeConfig(configFile);
    expect(prompted).toEqual(["port:Worker port:7576"]);
    expect(result.port).toBe(8765);
    expect(runtime.worker?.listen.port).toBe(8765);
  });

  it("updates an existing Worker listener port without changing Worker identity or workspaces", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-port-update-"));
    const configFile = path.join(root, "config", "config.yaml");
    const secretsDirectory = path.join(root, "secrets");
    const setup: any = await setupWorker(configFile, ["worker", "setup", "--port", "7576"], secretsDirectory);
    const before = await readRuntimeConfig(configFile);
    const result: any = await updateWorkerPort(configFile, ["worker", "port", "--port", "7577"]);
    const after = await readRuntimeConfig(configFile);
    expect(result).toMatchObject({ changed: true, previousPort: 7576, port: 7577, workerId: setup.workerId });
    expect(after.worker?.workerId).toBe(before.worker?.workerId);
    expect(after.worker?.listen.port).toBe(7577);
    expect(after.workspaces).toEqual(before.workspaces);
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

  it("prompts once for a join code and preserves scripted endpoint input", async () => {
    const f = await fixture();
    const joinToken = f.enrollment.createJoinToken().token;
    const joinCode = encodeJoinCode({ v: 1, gateway: f.gatewayUrl, token: joinToken });
    const prompted: string[] = [];
    const result: any = await joinWorker(
      f.configFile,
      ["worker", "join", "--endpoint", f.workerUrl],
      async (field) => {
        prompted.push(field);
        return joinCode;
      },
    );
    expect(prompted).toEqual(["code"]);
    expect(result).toMatchObject({ joined: true, workerId: f.workerId, environmentId: f.environmentId });
    expect((await f.memberships.read()).workers).toHaveLength(1);
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
