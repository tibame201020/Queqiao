import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import request from "supertest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerApp } from "../../worker/src/app.js";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";
import { seedTestWorkerMembership, TEST_WORKER_CREDENTIAL, TEST_WORKER_ID } from "./test-worker-membership.js";
import { QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES } from "./mcp.js";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { buildDeploymentManifest, canonicalJson, deploymentManifestFingerprint } from "@queqiao/operations";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";

const forbiddenFetchPorts = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
async function listenOnSafePort(app: { listen(port: number, host: string): Server }): Promise<Server> { for (;;) { const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not listen"); if (!forbiddenFetchPorts.has(address.port)) return server; await new Promise<void>((resolve) => server.close(() => resolve())); } }

describe("Queqiao v0 vertical slice", () => {
  let temporary: string;
  let workerServer: Server;
  let gatewayServer: Server | undefined;
  let gateway: Awaited<ReturnType<typeof createGatewayApp>>;
  const base = new URL("http://localhost:7575");

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-v0-"));
    await writeFile(path.join(temporary, "fixture.txt"), "hello from native worker\nsecond line\n", "utf8");
    const secondary = path.join(temporary, "secondary");
    await mkdir(secondary);
    await writeFile(path.join(secondary, "fixture.txt"), "hello from secondary workspace\n", "utf8");
    const worker = await createWorkerApp({ workerId: TEST_WORKER_ID, environmentId: "windows", defaultWorkspaceId: "fixture", workspaces: [{ id: "fixture", displayName: "Fixture", root: temporary }, { id: "secondary", displayName: "Secondary", root: secondary, profile: "coding", commands: { allow: [path.basename(process.execPath).toLowerCase()] } }], workerToken: TEST_WORKER_CREDENTIAL });
    workerServer = await listenOnSafePort(worker);
    const address = workerServer.address(); if (!address || typeof address === "string") throw new Error("Worker did not listen");
    const stateDir = path.join(temporary, ".state");
    await seedTestWorkerMembership({ stateDirectory: stateDir, environmentId: "windows", endpoint: `http://127.0.0.1:${address.port}` });
    const config: GatewayRuntimeConfig = { port: 7575, publicBaseUrl: base, resourceUrl: "http://localhost:7575/mcp", stateDir, approvalSecret: "correct horse battery staple", jwtSecret: new TextEncoder().encode("test-signing-secret-with-at-least-thirty-two-bytes"), trustProxyHops: 1, allowedRedirectOrigins: new Set(["https://chatgpt.com"]), extensions: [], configDirectory: temporary };
    gateway = await createGatewayApp(config);
  });

  afterEach(async () => {
    if (gatewayServer) await new Promise<void>((resolve) => gatewayServer!.close(() => resolve()));
    await new Promise<void>((resolve) => workerServer.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  });

  it("reports worker health and challenges unauthenticated MCP", async () => {
    const health = await request(gateway).get("/health").set("Host", "localhost").expect(200);
    expect(health.body.environments[0]).toMatchObject({ reachable: true, environmentId: "windows" });
    expect(health.body.environments[0].checkedAt).toEqual(expect.any(String));
    expect(health.body.environments[0].lastSuccessAt).toEqual(expect.any(String));
    expect(health.body.environments[0]).not.toHaveProperty("workspaceCount");
    expect(JSON.stringify(health.body)).not.toContain(temporary);
    const challenge = await request(gateway).post("/mcp").set("Host", "localhost").send({}).expect(401);
    expect(challenge.headers["www-authenticate"]).toContain("resource_metadata=");
  });

  it("completes OAuth, lists the stable v0 tools, and reads through the worker", async () => {
    const registered = await request(gateway).post("/oauth/register").set("Host", "localhost").send({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector/oauth/callback"], token_endpoint_auth_method: "none", scope: "workspace:read" }).expect(201);
    const verifier = randomBytes(40).toString("base64url");
    const authorization = { client_id: registered.body.client_id as string, redirect_uri: "https://chatgpt.com/connector/oauth/callback", response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope: "workspace:read", resource: "http://localhost:7575/mcp", state: "v0" };
    const authorizationPage = await request(gateway).get("/oauth/authorize").set("Host", "localhost").query(authorization).expect(200);
    expect(authorizationPage.text).toContain("Scopes: queqiao:access");
    expect(authorizationPage.headers["content-security-policy"]).toContain("form-action 'self' https://chatgpt.com");
    const approved = await request(gateway).post("/oauth/authorize").set("Host", "localhost").type("form").send({ ...authorization, approval_secret: "correct horse battery staple" }).expect(303);
    const code = new URL(approved.headers.location).searchParams.get("code");
    const token = await request(gateway).post("/oauth/token").set("Host", "localhost").type("form").send({ grant_type: "authorization_code", code, redirect_uri: authorization.redirect_uri, client_id: authorization.client_id, code_verifier: verifier, resource: authorization.resource }).expect(200);
    expect(token.body.scope).toBe("queqiao:access");

    gatewayServer = await listenOnSafePort(gateway);
    const address = gatewayServer.address(); if (!address || typeof address === "string") throw new Error("Gateway did not listen");
    const client = new Client({ name: "queqiao-contract", version: "1" }, { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token.body.access_token}` } } });
    try {
      await client.connect(transport);
      expect(client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
      expect(client.getProtocolEra()).toBe("legacy");
      const listedTools = (await client.listTools()).tools;
      expect(listedTools.map((tool) => tool.name)).toEqual([...QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES]);
      const expectedManifest = buildDeploymentManifest({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, coreTools: CORE_PUBLIC_TOOLS, extensions: [] });
      const actualManifestTools = listedTools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }));
      expect(canonicalJson(actualManifestTools.sort((left, right) => left.name.localeCompare(right.name)))).toBe(canonicalJson(expectedManifest.tools));
      expect(JSON.stringify((await client.callTool({ name: "workspace_info", arguments: {} })).content)).toContain("windows");
      const read = await client.callTool({ name: "read_file", arguments: { path: "fixture.txt", offset: 0, limit: 1 } });
      expect(read.isError).not.toBe(true);
      expect(JSON.stringify(read.content)).toContain("hello from native worker");
      const directory = await client.callTool({ name: "list_directory", arguments: { path: ".", limit: 10 } });
      expect(directory.isError).not.toBe(true);
      expect(JSON.stringify(directory.content)).toContain("fixture.txt");
      const search = await client.callTool({ name: "search_text", arguments: { query: "native worker", globs: ["**/*.txt"] } });
      expect(search.isError).not.toBe(true);
      expect(JSON.stringify(search.content)).toContain("fixture.txt");
      const extensionList = await client.callTool({ name: "extension", arguments: { operation: "list" } });
      expect(extensionList.isError).not.toBe(true);
      const extensionPayload = JSON.parse((extensionList.content[0] as { type: "text"; text: string }).text) as { capabilities: unknown[] };
      expect(extensionPayload.capabilities).toEqual([]);
      const listed = await client.callTool({ name: "list_workspaces", arguments: {} });
      const listedPayload = JSON.parse((listed.content[0] as { type: "text"; text: string }).text) as { deployment: { coreManifestRevision: number; deploymentManifestFingerprint: string; publicToolCount: number; workerProtocolVersion: string; supportedMcpProtocolVersions: string[] }; workspaces: Array<{ workspaceId: string }> };
      expect(listedPayload.workspaces.map((entry) => entry.workspaceId)).toContain("secondary");
      expect(listedPayload.deployment.coreManifestRevision).toBe(QUEQIAO_CORE_MANIFEST_REVISION);
      expect(listedPayload.deployment.deploymentManifestFingerprint).toBe(deploymentManifestFingerprint(expectedManifest));
      expect(listedPayload.deployment.publicToolCount).toBe(11);
      expect(listedPayload.deployment.workerProtocolVersion).toBe(QUEQIAO_WORKER_PROTOCOL_VERSION);
      expect(listedPayload.deployment.supportedMcpProtocolVersions).toContain("2026-07-28");
      const explicitInfo = await client.callTool({ name: "workspace_info", arguments: { workspaceId: "secondary" } });
      expect(explicitInfo.isError).not.toBe(true);
      expect(JSON.stringify(explicitInfo.content)).toContain("secondary");
      const opened = await client.callTool({ name: "open_workspace", arguments: { workspaceId: "secondary" } });
      expect(opened.isError).not.toBe(true);
      const secondaryRead = await client.callTool({ name: "read_file", arguments: { workspaceId: "secondary", path: "fixture.txt" } });
      expect(JSON.stringify(secondaryRead.content)).toContain("hello from secondary workspace");
      const write = await client.callTool({ name: "write_file", arguments: { workspaceId: "secondary", path: "created.txt", content: "before\n" } });
      expect(write.isError).not.toBe(true);
      const edit = await client.callTool({ name: "edit_file", arguments: { workspaceId: "secondary", path: "created.txt", oldText: "before", newText: "after" } });
      expect(edit.isError).not.toBe(true);
      const editedRead = await client.callTool({ name: "read_file", arguments: { workspaceId: "secondary", path: "created.txt" } });
      expect(JSON.stringify(editedRead.content)).toContain("after");
      const executed = await client.callTool({ name: "run", arguments: { workspaceId: "secondary", executable: path.basename(process.execPath), args: ["-e", "process.stdout.write('gateway-worker-ok')"], timeoutMs: 5000 } });
      expect(executed.isError).not.toBe(true);
      expect(JSON.stringify(executed.content)).toContain("gateway-worker-ok");
      const deniedWrite = await client.callTool({ name: "write_file", arguments: { workspaceId: "fixture", path: "denied.txt", content: "no" } });
      expect(deniedWrite.isError).toBe(true);
      expect(JSON.parse((deniedWrite.content[0] as { type: "text"; text: string }).text)).toMatchObject({ code: "tool_denied", layer: "worker", retryable: false });
      const missing = await client.callTool({ name: "read_file", arguments: { workspaceId: "missing", path: "fixture.txt" } });
      expect(missing.isError).toBe(true);
      expect(JSON.parse((missing.content[0] as { type: "text"; text: string }).text)).toMatchObject({ code: "workspace_not_found", layer: "gateway", retryable: false });
    } finally { await transport.close(); }
  });
});
