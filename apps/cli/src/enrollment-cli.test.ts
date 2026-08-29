import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { createGatewayApp } from "../../gateway/src/app.js";
import { EnrollmentService } from "../../gateway/src/enrollment-service.js";
import { WorkerMembershipStore } from "../../gateway/src/worker-membership-store.js";
import { createWorkerApp } from "../../worker/src/app.js";
import { WorkerCredentialSource } from "../../worker/src/worker-credential-source.js";
import { copyTextToClipboard, createJoinToken, decodeJoinCode, encodeJoinCode, joinWorker, setupGateway, setupWorker, updateWorkerPort } from "./enrollment-cli.js";
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

describe("gateway join-token UX", () => {
  it("copies a self-contained join code by default and does not expose the raw token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-join-token-"));
    const configFile = path.join(root, "config", "config.yaml");
    const stateDirectory = path.join(root, "gateway-state");
    const secretsDirectory = path.join(root, "secrets");
    await setupGateway(configFile, ["gateway", "setup", "--public-base-url", "https://gateway.example/stable/"], stateDirectory, secretsDirectory);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "one-time-token", expiresAt: "2026-08-28T14:30:00.000Z", bindings: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    let copied = "";
    try {
      const result: any = await createJoinToken(configFile, ["gateway", "join-token"], async (value) => { copied = value; });
      expect(decodeJoinCode(copied)).toEqual({ v: 1, gateway: "https://gateway.example/stable/", token: "one-time-token", expiresAt: "2026-08-28T14:30:00.000Z" });
      expect(result).toMatchObject({ copied: true, joinCodeVersion: 1, expiresAt: "2026-08-28T14:30:00.000Z", bindings: [] });
      expect(result).not.toHaveProperty("token");
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("rejects hidden token binding flags", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-join-token-options-"));
    const configFile = path.join(root, "config", "config.yaml");
    const stateDirectory = path.join(root, "gateway-state");
    const secretsDirectory = path.join(root, "secrets");
    await setupGateway(configFile, ["gateway", "setup", "--public-base-url", "https://gateway.example/stable/"], stateDirectory, secretsDirectory);
    await expect(createJoinToken(configFile, ["gateway", "join-token", "--worker-id", crypto.randomUUID()])).rejects.toThrow(/Unknown option "--worker-id"/);
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
  await writeFile(configFile, serializeRuntimeConfig({ version: 1, environments: [], workspaces: [{ id: "default", displayName: "default", root: workerRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }], worker: { workerId, environmentId, listen: { host: "127.0.0.1", port: 7576 }, tokenFile } }), "utf8");
  const credential = new WorkerCredentialSource(tokenFile);
  const workerApp = await createWorkerApp({ workerId: serverWorkerId || workerId, environmentId, workerCredential: credential, workspaces: [{ id: "default", displayName: "default", root: workerRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }] });
  const worker = await listen(workerApp);
  const workerPort = Number(new URL(worker.url).port);
  await writeFile(configFile, serializeRuntimeConfig({ version: 1, environments: [], workspaces: [{ id: "default", displayName: "default", root: workerRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }], worker: { workerId, environmentId, listen: { host: "127.0.0.1", port: workerPort }, tokenFile } }), "utf8");
  const memberships = new WorkerMembershipStore(stateDir);
  const enrollment = new EnrollmentService(memberships, stateDir);
  const gatewayConfig = { host: "127.0.0.1" as const, port: 7575, managementPort: 7574, publicBaseUrl: new URL("http://127.0.0.1/"), resourceUrl: "http://127.0.0.1/mcp", stateDir, approvalSecret: "a".repeat(32), jwtSecret: new TextEncoder().encode("j".repeat(48)), trustProxyHops: 0, allowedRedirectOrigins: new Set(["http://127.0.0.1"]), workers: [], extensions: [], configDirectory: root };
  const gateway = await listen(await createGatewayApp(gatewayConfig, enrollment));
  return { root, tokenFile, bootstrap, workerId, environmentId, configFile, memberships, enrollment, workerUrl: worker.url, workerServer: worker.server, gatewayUrl: gateway.url };
}

function setupWorkspace(root: string, id = "workspace") {
  return { initialWorkspace: { id, displayName: id, root, profile: "read-only" as const, tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } } };
}

describe("role setup CLI", () => {
  it("sets up Gateway and Worker independently without creating Gateway membership", async () => {
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
    const setup: any = await setupWorker(configFile, ["worker", "setup", "--port", "7576"], secretsDirectory, undefined, setupWorkspace(workspaceRoot));
    runtime = await readRuntimeConfig(configFile);
    expect(runtime.worker?.workerId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(runtime.worker?.listen.port).toBe(7576);
    expect(setup.port).toBe(7576);
    expect(runtime).not.toHaveProperty("environments");
    expect((await readFile(runtime.worker!.tokenFile, "utf8")).trim().length).toBeGreaterThanOrEqual(32);
  });

  it("refuses to persist a new Worker without an initial authorized Workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-no-workspace-"));
    const configFile = path.join(root, "config", "config.yaml");
    const secretsDirectory = path.join(root, "secrets");
    await expect(setupWorker(configFile, ["worker", "setup", "--port", "7576"], secretsDirectory)).rejects.toThrow(/initial authorized Workspace/);
    await expect(readFile(configFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(secretsDirectory, "worker-windows.secret"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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
    }, {
      initialWorkspace: { id: "my-project", displayName: "My Project", root: workspaceRoot, profile: "coding", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } },
    });

    const runtime = await readRuntimeConfig(configFile);
    expect(workerPrompts).toEqual(["port:Worker port:7576"]);
    expect(runtime.gateway?.publicBaseUrl).toBe("https://gateway.example/shadow/");
    expect(runtime.worker).toMatchObject({ listen: { host: "127.0.0.1", port: 8765 } });
    expect(runtime.workspaces).toEqual([
      expect.objectContaining({ id: "my-project", displayName: "My Project", root: canonicalWorkspaceRoot, profile: "coding" }),
    ]);
  });
  it("prompts for the public Gateway URL when the flag is omitted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-gateway-setup-url-"));
    const configFile = path.join(root, "config", "config.yaml");
    const stateDirectory = path.join(root, "gateway-state");
    const secretsDirectory = path.join(root, "secrets");
    const prompted: string[] = [];
    await setupGateway(configFile, ["gateway", "setup"], stateDirectory, secretsDirectory, async (field, message) => {
      prompted.push(`${field}:${message}`);
      return "https://gateway.example/stable/";
    });
    const runtime = await readRuntimeConfig(configFile);
    expect(prompted).toEqual(["public-base-url:Public Gateway URL"]);
    expect(runtime.gateway?.publicBaseUrl).toBe("https://gateway.example/stable/");
  });

  it("rejects a non-http public Gateway URL even when provided by a prompt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-gateway-setup-url-invalid-"));
    await expect(setupGateway(
      path.join(root, "config", "config.yaml"),
      ["gateway", "setup"],
      path.join(root, "gateway-state"),
      path.join(root, "secrets"),
      async () => "ftp://gateway.example/",
    )).rejects.toThrow("Public Gateway URL must use http or https");
  });

  it("prompts for Worker port when --port is omitted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-setup-port-"));
    const configFile = path.join(root, "config", "config.yaml");
    const secretsDirectory = path.join(root, "secrets");
    const prompted: string[] = [];
    const result: any = await setupWorker(configFile, ["worker", "setup"], secretsDirectory, async (field, message, initialValue) => {
      prompted.push(`${field}:${message}:${initialValue}`);
      return "8765";
    }, setupWorkspace(root));
    const runtime = await readRuntimeConfig(configFile);
    expect(prompted).toEqual(["port:Worker port:7576"]);
    expect(result.port).toBe(8765);
    expect(runtime.worker?.listen.port).toBe(8765);
  });

  it("updates an existing Worker listener port without changing Worker identity or workspaces", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-port-update-"));
    const configFile = path.join(root, "config", "config.yaml");
    const secretsDirectory = path.join(root, "secrets");
    const setup: any = await setupWorker(configFile, ["worker", "setup", "--port", "7576"], secretsDirectory, undefined, setupWorkspace(root));
    const before = await readRuntimeConfig(configFile);
    const result: any = await updateWorkerPort(configFile, ["worker", "port", "--port", "7577"]);
    const after = await readRuntimeConfig(configFile);
    expect(result).toMatchObject({ changed: true, previousPort: 7576, port: 7577, workerId: setup.workerId });
    expect(after.worker?.workerId).toBe(before.worker?.workerId);
    expect(after.worker?.listen.port).toBe(7577);
    expect(after.workspaces).toEqual(before.workspaces);
  });

  it("edits an existing Gateway without rotating secret paths or resetting untouched listener settings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-gateway-edit-"));
    const configFile = path.join(root, "config", "config.yaml");
    const stateDirectory = path.join(root, "gateway-state");
    const secretsDirectory = path.join(root, "secrets");
    await setupGateway(configFile, ["gateway", "setup", "--public-base-url", "https://old.example/", "--port", "7654", "--management-port", "7653"], stateDirectory, secretsDirectory);
    const before = await readRuntimeConfig(configFile);
    const result: any = await setupGateway(configFile, ["gateway", "setup"], stateDirectory, secretsDirectory, async (_field, _message, initialValue) => {
      expect(initialValue).toBe("https://old.example/");
      return "https://new.example/";
    });
    const after = await readRuntimeConfig(configFile);
    expect(result.mode).toBe("edit");
    expect(after.gateway?.publicBaseUrl).toBe("https://new.example/");
    expect(after.gateway?.approvalSecretFile).toBe(before.gateway?.approvalSecretFile);
    expect(after.gateway?.jwtSigningSecretFile).toBe(before.gateway?.jwtSigningSecretFile);
    expect(after.gateway?.listen.port).toBe(7654);
    expect(after.gateway?.managementListen.port).toBe(7653);
  });

  it("edits an existing Worker without rotating identity, credential path, or workspaces", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-edit-"));
    const configFile = path.join(root, "config", "config.yaml");
    const secretsDirectory = path.join(root, "secrets");
    await setupWorker(configFile, ["worker", "setup", "--port", "7576"], secretsDirectory, undefined, setupWorkspace(root));
    const before = await readRuntimeConfig(configFile);
    const result: any = await setupWorker(configFile, ["worker", "setup"], secretsDirectory, async (_field, _message, initialValue) => {
      expect(initialValue).toBe("7576");
      return "7676";
    });
    const after = await readRuntimeConfig(configFile);
    expect(result.mode).toBe("edit");
    expect(after.worker?.workerId).toBe(before.worker?.workerId);
    expect(after.worker?.tokenFile).toBe(before.worker?.tokenFile);
    expect(after.worker?.listen.port).toBe(7676);
    expect(after.workspaces).toEqual(before.workspaces);
  });

  it("atomically repairs a legacy Worker config that has no Workspace without rotating identity or credential", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-repair-"));
    const configFile = path.join(root, "config", "config.yaml");
    const secretsDirectory = path.join(root, "secrets");
    await setupWorker(configFile, ["worker", "setup", "--port", "7576"], secretsDirectory, undefined, setupWorkspace(root, "old-workspace"));
    const before = await readRuntimeConfig(configFile);
    await writeFile(configFile, stringify({ ...before, workspaces: [] }), "utf8");

    const repairWorkspace = setupWorkspace(root, "repaired-workspace");
    const result: any = await setupWorker(configFile, ["worker", "setup", "--port", "8076"], secretsDirectory, undefined, repairWorkspace);
    const after = await readRuntimeConfig(configFile);

    expect(result).toMatchObject({ mode: "edit", port: 8076, workspaceCount: 1 });
    expect(after.worker?.workerId).toBe(before.worker?.workerId);
    expect(after.worker?.tokenFile).toBe(before.worker?.tokenFile);
    expect(after.worker?.listen.port).toBe(8076);
    expect(after.workspaces).toHaveLength(1);
    expect(after.workspaces[0]?.root).toBe(await realpath(root));
    expect(after.workspaces[0]?.displayName).toBe("repaired-workspace");
    expect(after.workspaces[0]?.id).not.toBe("repaired-workspace");
  });
});
describe("worker join CLI transaction", () => {
  it("replaces the bootstrap credential only after Gateway confirmation commits membership", async () => {
    const f = await fixture();
    const joinToken = f.enrollment.createJoinToken().token;
    const joinCode = encodeJoinCode({ v: 1, gateway: f.gatewayUrl, token: joinToken });
    const result: any = await joinWorker(f.configFile, ["worker", "join", "--join-code", joinCode]);
    expect(result).toMatchObject({ joined: true, workerId: f.workerId, environmentId: f.environmentId });
    expect((await f.memberships.read()).workers).toHaveLength(1);
    expect((await readFile(f.tokenFile, "utf8")).trim()).not.toBe(f.bootstrap);
    await expect(readFile(`${f.tokenFile}.join-provisional.json`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preflights the named Worker before prompting or consuming the one-time join token", async () => {
    const f = await fixture();
    const joinToken = f.enrollment.createJoinToken().token;
    const joinCode = encodeJoinCode({ v: 1, gateway: f.gatewayUrl, token: joinToken });
    await new Promise<void>((resolve) => f.workerServer.close(() => resolve()));
    const prompted: string[] = [];
    await expect(joinWorker(f.configFile, ["worker", "join", "--worker", "wins-worker"], async (field) => { prompted.push(field); return joinCode; })).rejects.toThrow(/Worker wins-worker is not ready for enrollment.*queqiao worker serve --bg --worker wins-worker/);
    expect(prompted).toEqual([]);
    expect((await f.memberships.read()).workers).toEqual([]);
    expect((await readFile(f.tokenFile, "utf8")).trim()).toBe(f.bootstrap);
  });
  it("rejects legacy raw gateway/token enrollment inputs", async () => {
    const f = await fixture();
    await expect(joinWorker(f.configFile, ["worker", "join", "--token", "raw-token", "--gateway", f.gatewayUrl])).rejects.toThrow(/Unknown option "--token"/);
  });
  it("rejects hidden endpoint overrides", async () => {
    const f = await fixture();
    await expect(joinWorker(f.configFile, ["worker", "join", "--endpoint", f.workerUrl])).rejects.toThrow(/Unknown option "--endpoint"/);
  });

  it("prompts once for a join code and derives the Worker endpoint from named config", async () => {
    const f = await fixture();
    const joinToken = f.enrollment.createJoinToken().token;
    const joinCode = encodeJoinCode({ v: 1, gateway: f.gatewayUrl, token: joinToken });
    const prompted: string[] = [];
    const result: any = await joinWorker(
      f.configFile,
      ["worker", "join"],
      async (field) => {
        prompted.push(field);
        return joinCode;
      },
    );
    expect(prompted).toEqual(["code"]);
    expect(result).toMatchObject({ joined: true, workerId: f.workerId, environmentId: f.environmentId });
    expect((await f.memberships.read()).workers).toHaveLength(1);
  });

  it("rejects a mismatched local Worker identity before consuming the join token", async () => {
    const f = await fixture(crypto.randomUUID());
    const joinToken = f.enrollment.createJoinToken().token;
    const joinCode = encodeJoinCode({ v: 1, gateway: f.gatewayUrl, token: joinToken });
    await expect(joinWorker(f.configFile, ["worker", "join", "--join-code", joinCode])).rejects.toThrow(/Worker identity does not match the named Worker configuration/);
    expect((await f.memberships.read()).workers).toEqual([]);
    expect((await readFile(f.tokenFile, "utf8")).trim()).toBe(f.bootstrap);
    await expect(readFile(`${f.tokenFile}.join-provisional.json`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
