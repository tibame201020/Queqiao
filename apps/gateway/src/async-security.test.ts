import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import request from "supertest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ProcessRunner } from "@queqiao/process-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerApp } from "../../worker/src/app.js";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";
import { seedTestWorkerMembership, TEST_WORKER_CREDENTIAL, TEST_WORKER_ID } from "./test-worker-membership.js";

const forbiddenFetchPorts = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
async function listenOnSafePort(app: { listen(port: number, host: string): Server }): Promise<Server> {
  for (;;) {
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not listen");
    if (!forbiddenFetchPorts.has(address.port)) return server;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitForFile(file: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await access(file); return; } catch { /* keep waiting */ }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path.basename(file)}`);
    await delay(20);
  }
}
async function expectMissing(file: string): Promise<void> { await expect(access(file)).rejects.toBeTruthy(); }

async function issueAccessToken(gateway: Awaited<ReturnType<typeof createGatewayApp>>): Promise<string> {
  const registered = await request(gateway).post("/oauth/register").set("Host", "localhost").send({ client_name: "Async Security", redirect_uris: ["https://chatgpt.com/connector/oauth/callback"], token_endpoint_auth_method: "none", scope: "workspace:read" }).expect(201);
  const verifier = randomBytes(40).toString("base64url");
  const authorization = {
    client_id: registered.body.client_id as string,
    redirect_uri: "https://chatgpt.com/connector/oauth/callback",
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "workspace:read",
    resource: "http://localhost:7575/mcp",
    state: "async-security",
  };
  const approved = await request(gateway).post("/oauth/authorize").set("Host", "localhost").type("form").send({ ...authorization, approval_secret: "correct horse battery staple" }).expect(303);
  const code = new URL(approved.headers.location).searchParams.get("code");
  const token = await request(gateway).post("/oauth/token").set("Host", "localhost").type("form").send({ grant_type: "authorization_code", code, redirect_uri: authorization.redirect_uri, client_id: authorization.client_id, code_verifier: verifier, resource: authorization.resource }).expect(200);
  return token.body.access_token as string;
}

type Harness = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  processes: ProcessRunner;
};

describe("async disconnect and resource security", () => {
  let temporary: string;
  let workerServer: Server | undefined;
  let gatewayServer: Server | undefined;
  let harness: Harness | undefined;

  beforeEach(async () => { temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-async-security-")); });
  afterEach(async () => {
    harness?.processes.shutdown();
    if (harness) { const deadline = Date.now() + 3000; while (harness.processes.activeCount() !== 0 && Date.now() < deadline) await delay(25); }
    if (harness) await harness.transport.close();
    if (gatewayServer) await new Promise<void>((resolve) => gatewayServer!.close(() => resolve()));
    if (workerServer) await new Promise<void>((resolve) => workerServer!.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
    harness = undefined; gatewayServer = undefined; workerServer = undefined;
  });

  async function startHarness(processes: ProcessRunner): Promise<Harness> {
    const executable = path.basename(process.execPath).toLowerCase();
    const worker = await createWorkerApp({
      workerId: TEST_WORKER_ID,
      environmentId: process.platform === "win32" ? "windows" : "linux",
      defaultWorkspaceId: "coding",
      workerToken: TEST_WORKER_CREDENTIAL,
      processes,
      workspaces: [{ id: "coding", displayName: "Coding", root: temporary, profile: "coding", tools: { allow: [], deny: [], explicit: ["shell"] }, commands: { allow: [executable] } }],
    });
    workerServer = await listenOnSafePort(worker);
    const workerAddress = workerServer.address(); if (!workerAddress || typeof workerAddress === "string") throw new Error("Worker did not listen");
    const base = new URL("http://localhost:7575");
    const environmentId = process.platform === "win32" ? "windows" : "linux";
    const stateDir = path.join(temporary, ".state");
    await seedTestWorkerMembership({ stateDirectory: stateDir, environmentId, endpoint: `http://127.0.0.1:${workerAddress.port}` });
    const config: GatewayRuntimeConfig = {
      port: 7575,
      publicBaseUrl: base,
      resourceUrl: "http://localhost:7575/mcp",
      stateDir,
      approvalSecret: "correct horse battery staple",
      jwtSecret: new TextEncoder().encode("test-signing-secret-with-at-least-thirty-two-bytes"),
      trustProxyHops: 1,
      allowedRedirectOrigins: new Set(["https://chatgpt.com"]),
      extensions: [],
      configDirectory: temporary,
    };
    const gateway = await createGatewayApp(config);
    const accessToken = await issueAccessToken(gateway);
    gatewayServer = await listenOnSafePort(gateway);
    const gatewayAddress = gatewayServer.address(); if (!gatewayAddress || typeof gatewayAddress === "string") throw new Error("Gateway did not listen");
    const client = new Client({ name: "queqiao-async-security", version: "1" }, { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${gatewayAddress.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } });
    await client.connect(transport);
    harness = { client, transport, processes };
    return harness;
  }

  it("propagates official MCP sync cancellation through Gateway and Worker to terminate the native process tree", async () => {
    const { client } = await startHarness(new ProcessRunner());
    const started = path.join(temporary, "sync-started.txt");
    const leaked = path.join(temporary, "sync-tree-leak.txt");
    const childScript = `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(leaked)},'leak'),700)`;
    const parentScript = `require('fs').writeFileSync(${JSON.stringify(started)},'started');require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
    const abort = new AbortController();
    const call = client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", parentScript], timeoutMs: 5000 } }, { signal: abort.signal, timeout: 5000 });
    await waitForFile(started);
    abort.abort(new Error("client cancelled sync tool"));
    await expect(call).rejects.toThrow();
    await delay(900);
    await expectMissing(leaked);
  }, 10_000);

  it("detaches request cancellation after successful async acceptance", async () => {
    const { client, processes } = await startHarness(new ProcessRunner());
    const completed = path.join(temporary, "async-completed.txt");
    const abort = new AbortController();
    const result = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(completed)},'accepted'),250)`], timeoutMs: 1500, mode: "async" } }, { signal: abort.signal, timeout: 5000 });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("discarded");
    expect(processes.activeCount()).toBe(1);
    abort.abort(new Error("request cancelled after acceptance"));
    await waitForFile(completed);
    expect(await readFile(completed, "utf8")).toBe("accepted");
  });

  it("shares concurrency capacity between accepted async and synchronous execution", async () => {
    const { client, processes } = await startHarness(new ProcessRunner(1));
    const asyncResult = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", "setTimeout(()=>{},450)"], timeoutMs: 1200, mode: "async" } });
    expect(asyncResult.isError).not.toBe(true);
    expect(processes.activeCount()).toBe(1);

    const denied = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", "process.stdout.write('should-not-run')"], timeoutMs: 1000 } });
    expect(denied.isError).toBe(true);
    const capacityError = JSON.parse((denied.content[0] as { type: "text"; text: string }).text) as { code: string; message: string; layer: string; retryable: boolean };
    expect(capacityError).toMatchObject({ code: "process_capacity", layer: "worker", retryable: true });
    expect(capacityError.message).toContain("concurrency limit");

    const deadline = Date.now() + 2500;
    while (processes.activeCount() !== 0 && Date.now() < deadline) await delay(25);
    expect(processes.activeCount()).toBe(0);
    const later = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", "process.stdout.write('capacity-restored')"], timeoutMs: 1000 } });
    expect(later.isError).not.toBe(true);
    expect(JSON.stringify(later.content)).toContain("capacity-restored");
  });

  it("keeps synchronous output bounded and async output discarded", async () => {
    const { client } = await startHarness(new ProcessRunner(2, 1024));
    const syncResult = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", "process.stdout.write('x'.repeat(8192))"], timeoutMs: 2000 } });
    expect(syncResult.isError).not.toBe(true);
    const syncText = JSON.stringify(syncResult.content);
    expect(syncText).toContain("outputLimitExceeded");
    expect(syncText).toContain("true");
    expect(syncText.length).toBeLessThan(2500);

    const asyncResult = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", "process.stdout.write('x'.repeat(100000));setTimeout(()=>{},100)"], timeoutMs: 1000, mode: "async" } });
    expect(asyncResult.isError).not.toBe(true);
    const asyncText = JSON.stringify(asyncResult.content);
    expect(asyncText).toContain("discarded");
    expect(asyncText).not.toContain("xxxxxxxxxxxxxxxx");
  }, 10_000);

  it("enforces async lifetime and orderly Worker shutdown without durable recovery state", async () => {
    const processes = new ProcessRunner();
    const { client } = await startHarness(processes);
    const late = path.join(temporary, "late-side-effect.txt");
    const result = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(late)},'late'),700);setInterval(()=>{},1000)`], timeoutMs: 150, mode: "async" } });
    expect(result.isError).not.toBe(true);
    await delay(900);
    await expectMissing(late);
    expect(processes.activeCount()).toBe(0);
    expect(processes.asyncCount()).toBe(0);

    const shutdownLeak = path.join(temporary, "shutdown-leak.txt");
    const accepted = await client.callTool({ name: "run", arguments: { workspaceId: "coding", executable: path.basename(process.execPath), args: ["-e", `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(shutdownLeak)},'leak'),700);setInterval(()=>{},1000)`], timeoutMs: 2000, mode: "async" } });
    expect(accepted.isError).not.toBe(true);
    expect(processes.asyncCount()).toBe(1);
    processes.shutdown();
    const deadline = Date.now() + 2500;
    while (processes.activeCount() !== 0 && Date.now() < deadline) await delay(25);
    await delay(800);
    await expectMissing(shutdownLeak);
    const restartedRuntime = new ProcessRunner();
    expect(restartedRuntime.activeCount()).toBe(0);
    expect(restartedRuntime.asyncCount()).toBe(0);
  }, 10_000);
});
