import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerApp } from "../../worker/src/app.js";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";
import { QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES } from "./mcp.js";

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
    const worker = await createWorkerApp({ environmentId: "windows", defaultWorkspaceId: "fixture", workspaces: [{ id: "fixture", displayName: "Fixture", root: temporary }, { id: "secondary", displayName: "Secondary", root: secondary, profile: "coding", commands: { allow: [path.basename(process.execPath).toLowerCase()] } }], workerToken: "worker-secret" });
    workerServer = worker.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => workerServer.once("listening", resolve));
    const address = workerServer.address(); if (!address || typeof address === "string") throw new Error("Worker did not listen");
    const config: GatewayRuntimeConfig = { port: 7575, publicBaseUrl: base, resourceUrl: "http://localhost:7575/mcp", stateDir: path.join(temporary, ".state"), approvalSecret: "correct horse battery staple", jwtSecret: new TextEncoder().encode("test-signing-secret-with-at-least-thirty-two-bytes"), trustProxyHops: 1, allowedRedirectOrigins: new Set(["https://chatgpt.com"]), workers: [{ environmentId: "windows", url: new URL(`http://127.0.0.1:${address.port}`), token: "worker-secret" }] };
    gateway = await createGatewayApp(config);
  });

  afterEach(async () => {
    if (gatewayServer) await new Promise<void>((resolve) => gatewayServer!.close(() => resolve()));
    await new Promise<void>((resolve) => workerServer.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  });

  it("reports worker health and challenges unauthenticated MCP", async () => {
    const health = await request(gateway).get("/health").set("Host", "localhost").expect(200);
    expect(health.body.environments[0]).toEqual({ online: true, environmentId: "windows", workspaceCount: 2 });
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
    const approved = await request(gateway).post("/oauth/authorize").set("Host", "localhost").type("form").send({ ...authorization, approval_secret: "correct horse battery staple" }).expect(303);
    const code = new URL(approved.headers.location).searchParams.get("code");
    const token = await request(gateway).post("/oauth/token").set("Host", "localhost").type("form").send({ grant_type: "authorization_code", code, redirect_uri: authorization.redirect_uri, client_id: authorization.client_id, code_verifier: verifier, resource: authorization.resource }).expect(200);
    expect(token.body.scope).toBe("queqiao:access");

    gatewayServer = gateway.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => gatewayServer!.once("listening", resolve));
    const address = gatewayServer.address(); if (!address || typeof address === "string") throw new Error("Gateway did not listen");
    const client = new Client({ name: "queqiao-contract", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token.body.access_token}` } } });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([...QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES]);
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
      const listed = await client.callTool({ name: "list_workspaces", arguments: {} });
      expect(JSON.stringify(listed.content)).toContain("secondary");
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
      const missing = await client.callTool({ name: "read_file", arguments: { workspaceId: "missing", path: "fixture.txt" } });
      expect(missing.isError).toBe(true);
    } finally { await transport.close(); }
  });
});
