import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS } from "./mcp-compat.js";

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

async function issueAccessToken(gateway: Awaited<ReturnType<typeof createGatewayApp>>): Promise<string> {
  const resource = "http://localhost:7575/mcp";
  const redirectUri = "https://chatgpt.com/connector/oauth/callback";
  const registered = await request(gateway).post("/oauth/register").set("Host", "localhost").send({
    client_name: "MCP compatibility test",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    scope: "queqiao:access",
  }).expect(201);
  const verifier = randomBytes(40).toString("base64url");
  const authorization = {
    client_id: registered.body.client_id as string,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "queqiao:access",
    resource,
    state: "compat",
  };
  const approved = await request(gateway).post("/oauth/authorize").set("Host", "localhost").type("form").send({
    ...authorization,
    approval_secret: "correct horse battery staple",
  }).expect(303);
  const code = new URL(approved.headers.location).searchParams.get("code");
  const token = await request(gateway).post("/oauth/token").set("Host", "localhost").type("form").send({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: registered.body.client_id,
    code_verifier: verifier,
    resource,
  }).expect(200);
  return String(token.body.access_token);
}

describe("bounded MCP compatibility window", () => {
  let temporary: string;
  let workerServer: Server;
  let gatewayServer: Server;
  let gateway: Awaited<ReturnType<typeof createGatewayApp>>;
  let token: string;
  let endpoint: URL;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-mcp-compat-"));
    await writeFile(path.join(temporary, "fixture.txt"), "compatibility fixture\n", "utf8");
    const worker = await createWorkerApp({ workerId: TEST_WORKER_ID, environmentId: "windows", defaultWorkspaceId: "fixture", workspaces: [{ id: "fixture", displayName: "Fixture", root: temporary }], workerToken: TEST_WORKER_CREDENTIAL });
    workerServer = await listenOnSafePort(worker);
    const workerAddress = workerServer.address();
    if (!workerAddress || typeof workerAddress === "string") throw new Error("Worker did not listen");
    const base = new URL("http://localhost:7575");
    const stateDir = path.join(temporary, ".state");
    await seedTestWorkerMembership({ stateDirectory: stateDir, environmentId: "windows", endpoint: `http://127.0.0.1:${workerAddress.port}` });
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
    gateway = await createGatewayApp(config);
    token = await issueAccessToken(gateway);
    gatewayServer = await listenOnSafePort(gateway);
    const gatewayAddress = gatewayServer.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") throw new Error("Gateway did not listen");
    endpoint = new URL(`http://127.0.0.1:${gatewayAddress.port}/mcp`);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    await new Promise<void>((resolve) => workerServer.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  });

  it("pins the Queqiao-owned supported revision list", () => {
    expect(QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS).toEqual([
      "2026-07-28",
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
    ]);
  });

  for (const revision of ["2025-03-26", "2025-06-18", "2025-11-25"] as const) {
    it(`serves legacy Streamable HTTP revision ${revision}`, async () => {
      const client = new Client(
        { name: "queqiao-compat", version: "1" },
        { supportedProtocolVersions: [revision], versionNegotiation: { mode: "legacy" } },
      );
      const transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      try {
        await client.connect(transport);
        expect(client.getNegotiatedProtocolVersion()).toBe(revision);
        expect(client.getProtocolEra()).toBe("legacy");
        expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([...QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES]);
        const result = await client.callTool({ name: "workspace_info", arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result.content)).toContain("windows");
      } finally {
        await transport.close();
      }
    });
  }

  for (const revision of ["2024-11-05", "2024-10-07"] as const) {
    it(`rejects deprecated pre-Streamable-HTTP revision ${revision}`, async () => {
      const client = new Client(
        { name: "queqiao-compat-unsupported-legacy", version: "1" },
        { supportedProtocolVersions: [revision], versionNegotiation: { mode: "legacy" } },
      );
      const transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      try {
        await expect(client.connect(transport)).rejects.toThrow(/protocol version is not supported/i);
        expect(client.getNegotiatedProtocolVersion()).toBeUndefined();
      } finally {
        await transport.close();
      }
    });
  }

  it("rejects an unknown future revision instead of inheriting SDK support", async () => {
    const revision = "2099-01-01";
    const client = new Client(
      { name: "queqiao-compat-unsupported-future", version: "1" },
      { supportedProtocolVersions: [revision], versionNegotiation: { mode: { pin: revision } } },
    );
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await expect(client.connect(transport)).rejects.toThrow(/pinned protocol version|version negotiation failed|unsupported protocol version/i);
      expect(client.getNegotiatedProtocolVersion()).toBeUndefined();
    } finally {
      await transport.close();
    }
  });

  it("serves modern Streamable HTTP revision 2026-07-28 without legacy initialize", async () => {
    const revision = "2026-07-28" as const;
    const client = new Client(
      { name: "queqiao-compat-modern", version: "1" },
      { supportedProtocolVersions: [revision], versionNegotiation: { mode: { pin: revision } } },
    );
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await client.connect(transport);
      expect(client.getNegotiatedProtocolVersion()).toBe(revision);
      expect(client.getProtocolEra()).toBe("modern");
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([...QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES]);
      const result = await client.callTool({ name: "workspace_info", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain("windows");
    } finally {
      await transport.close();
    }
  });
});
