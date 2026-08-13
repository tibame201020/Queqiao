import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerApp } from "../../worker/src/app.js";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";

const publicBaseUrl = new URL("https://queqiao.example/");
const redirectUri = "https://chatgpt.com/connector/oauth/callback";
const jwtSecret = new TextEncoder().encode("security-gate-signing-secret-at-least-32-bytes");

describe("Security Baseline v1 adversarial gate", () => {
  let temporary: string;
  let app: Awaited<ReturnType<typeof createGatewayApp>>;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-security-"));
    const config: GatewayRuntimeConfig = {
      port: 7575,
      publicBaseUrl,
      resourceUrl: new URL("mcp", publicBaseUrl).href,
      stateDir: path.join(temporary, "state"),
      approvalSecret: "correct horse battery staple",
      jwtSecret,
      trustProxyHops: 1,
      allowedRedirectOrigins: new Set(["https://chatgpt.com", "http://127.0.0.1", "http://[::1]"]),
      workers: [{ environmentId: "windows", url: new URL("http://127.0.0.1:65534"), token: "worker-secret" }],
    };
    app = await createGatewayApp(config);
  });

  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  async function register() {
    return (await request(app).post("/oauth/register").send({ client_name: "Security gate", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", scope: "queqiao:access" }).expect(201)).body as { client_id: string };
  }

  async function authorize(clientId: string) {
    const verifier = randomBytes(40).toString("base64url");
    const authorization = { client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope: "queqiao:access", resource: new URL("mcp", publicBaseUrl).href, state: randomBytes(16).toString("base64url") };
    const approved = await request(app).post("/oauth/authorize").type("form").send({ ...authorization, approval_secret: "correct horse battery staple" }).expect(303);
    return { verifier, code: new URL(approved.headers.location).searchParams.get("code")!, authorization };
  }

  async function exchange(clientId: string, value: Awaited<ReturnType<typeof authorize>>) {
    return (await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: value.code, redirect_uri: redirectUri, client_id: clientId, code_verifier: value.verifier, resource: value.authorization.resource }).expect(200)).body as { access_token: string; refresh_token: string };
  }

  it("rejects unregistered redirects, PKCE downgrade, wrong resource, and wrong approval secret", async () => {
    await request(app).post("/oauth/register").send({ redirect_uris: ["https://attacker.example/callback"] }).expect(400);
    await request(app).post("/oauth/register").send({ redirect_uris: [`${redirectUri}#fragment`] }).expect(400);
    const client = await register();
    const valid = await authorize(client.client_id);
    const authorizationPage = await request(app).get("/oauth/authorize").query(valid.authorization).expect(200);
    expect(authorizationPage.headers["content-security-policy"]).toContain("form-action 'self' https://chatgpt.com");
    expect(authorizationPage.headers["content-security-policy"]).not.toContain("attacker.example");
    await request(app).get("/oauth/authorize").query({ ...valid.authorization, code_challenge_method: "plain" }).expect(400);
    await request(app).get("/oauth/authorize").query({ ...valid.authorization, code_challenge: "short" }).expect(400);
    await request(app).get("/oauth/authorize").query({ ...valid.authorization, resource: "https://attacker.example/mcp" }).expect(400);
    await request(app).post("/oauth/authorize").type("form").send({ ...valid.authorization, approval_secret: "wrong" }).expect(403);
  });

  it("allows arbitrary ports only for explicitly allowed loopback IP redirect origins", async () => {
    const loopback = "http://127.0.0.1:6276/oauth/callback";
    const ipv6Loopback = "http://[::1]:6276/oauth/callback";
    const registered = await request(app).post("/oauth/register").send({ client_name: "Native MCP client", redirect_uris: [loopback, ipv6Loopback], scope: "queqiao:access" }).expect(201);
    expect(registered.body.redirect_uris).toEqual([loopback, ipv6Loopback]);
    await request(app).post("/oauth/register").send({ redirect_uris: ["http://localhost:6276/oauth/callback"] }).expect(400);
    await request(app).post("/oauth/register").send({ redirect_uris: ["http://127.0.0.2:6276/oauth/callback"] }).expect(400);

    const verifier = randomBytes(40).toString("base64url");
    const authorization = {
      client_id: registered.body.client_id as string,
      redirect_uri: loopback,
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "queqiao:access",
      resource: new URL("mcp", publicBaseUrl).href,
      state: "native-loopback",
    };
    await request(app).get("/oauth/authorize").query(authorization).expect(200);
    await request(app).get("/oauth/authorize").query({ ...authorization, redirect_uri: "http://127.0.0.1:6277/oauth/callback" }).expect(400);
  });

  it("requires the authorized MCP resource again at authorization-code token exchange", async () => {
    const client = await register();
    const missing = await authorize(client.client_id);
    const missingResponse = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: missing.code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: missing.verifier }).expect(400);
    expect(missingResponse.body.error).toBe("invalid_target");
    await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: missing.code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: missing.verifier, resource: missing.authorization.resource }).expect(400).expect(({ body }) => expect(body.error).toBe("invalid_grant"));

    const wrong = await authorize(client.client_id);
    const wrongResponse = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: wrong.code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: wrong.verifier, resource: "https://attacker.example/mcp" }).expect(400);
    expect(wrongResponse.body.error).toBe("invalid_target");
  });

  it("scopes Origin validation to MCP while allowing OAuth browser navigation", async () => {
    const client = await register();
    const valid = await authorize(client.client_id);
    await request(app).get("/oauth/authorize").set("Origin", "null").query(valid.authorization).expect(200);
    await request(app).post("/mcp").set("Origin", "null").send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(403);
    await request(app).post("/mcp").set("Origin", "https://attacker.example").send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(403);
    await request(app).post("/mcp").set("Origin", "https://chatgpt.com").send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(401);
  });

  it("keeps public health free of workspace roots and policy details", async () => {
    const health = await request(app).get("/health").expect(503);
    expect(JSON.stringify(health.body)).not.toContain("root");
    expect(JSON.stringify(health.body)).not.toContain("tools");
    expect(JSON.stringify(health.body)).not.toContain("commands");
  });

  it("globally throttles approval-secret guesses independent of proxy identity", async () => {
    const client = await register();
    const valid = await authorize(client.client_id);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await request(app).post("/oauth/authorize").set("X-Forwarded-For", `203.0.113.${attempt + 1}`).type("form").send({ ...valid.authorization, approval_secret: "wrong" }).expect(403);
    }
    await request(app).post("/oauth/authorize").set("X-Forwarded-For", "198.51.100.200").type("form").send({ ...valid.authorization, approval_secret: "wrong" }).expect(429);
  });

  it("serializes concurrent dynamic-client registry writes", async () => {
    const registrations = await Promise.all(Array.from({ length: 12 }, (_, index) => request(app).post("/oauth/register").send({ client_name: `Concurrent ${index}`, redirect_uris: [redirectUri], scope: "queqiao:access" }).expect(201)));
    expect(new Set(registrations.map((response) => response.body.client_id)).size).toBe(12);
    const stored = JSON.parse(await readFile(path.join(temporary, "state", "oauth-clients.json"), "utf8")) as unknown[];
    expect(stored).toHaveLength(12);
  });

  it("makes authorization codes single-use and binds them to the PKCE verifier", async () => {
    const client = await register();
    const valid = await authorize(client.client_id);
    await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: valid.code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: "wrong" }).expect(400);
    await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: valid.code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: valid.verifier }).expect(400);
  });

  it("rotates refresh tokens and revokes the authorization on replay", async () => {
    const client = await register();
    const initial = await exchange(client.client_id, await authorize(client.client_id));
    const rotated = (await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: initial.refresh_token, client_id: client.client_id }).expect(200)).body as { access_token: string; refresh_token: string };
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: initial.refresh_token, client_id: client.client_id }).expect(400);
    await request(app).post("/mcp").set("Authorization", `Bearer ${rotated.access_token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(401);
    await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: rotated.refresh_token, client_id: client.client_id }).expect(400);
  });

  it("atomically consumes a refresh token under concurrent replay", async () => {
    const client = await register();
    const initial = await exchange(client.client_id, await authorize(client.client_id));
    const attempts = await Promise.all([
      request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: initial.refresh_token, client_id: client.client_id }),
      request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: initial.refresh_token, client_id: client.client_id }),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 400]);
    const issuedAccess = attempts.find((response) => response.status === 200)!.body.access_token as string;
    await request(app).post("/mcp").set("Authorization", `Bearer ${issuedAccess}`).send({}).expect(401);
  });

  it("upgrades one legacy refresh token into the rotated family", async () => {
    const client = await register();
    await authorize(client.client_id);
    const legacy = await new SignJWT({ client_id: client.client_id, scope: "queqiao:access", authorization_revision: 3, token_use: "refresh" }).setProtectedHeader({ alg: "HS256" }).setIssuer(publicBaseUrl.href).setAudience(new URL("mcp", publicBaseUrl).href).setExpirationTime("30d").sign(jwtSecret);
    const upgraded = (await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: legacy, client_id: client.client_id }).expect(200)).body as { refresh_token: string };
    expect(upgraded.refresh_token).not.toBe(legacy);
    await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: legacy, client_id: client.client_id }).expect(400);
  });

  it("rejects access tokens with the wrong audience or token use", async () => {
    const client = await register();
    const wrongAudience = await new SignJWT({ client_id: client.client_id, scope: "queqiao:access", authorization_revision: 3, token_use: "access" }).setProtectedHeader({ alg: "HS256" }).setIssuer(publicBaseUrl.href).setAudience("https://attacker.example/mcp").setExpirationTime("1h").sign(jwtSecret);
    const refreshAsAccess = (await exchange(client.client_id, await authorize(client.client_id))).refresh_token;
    await request(app).post("/mcp").set("Authorization", `Bearer ${wrongAudience}`).send({}).expect(401);
    await request(app).post("/mcp").set("Authorization", `Bearer ${refreshAsAccess}`).send({}).expect(401);
  });

  it("requires the Worker credential using a timing-safe comparison path", async () => {
    const worker = await createWorkerApp({ environmentId: "windows", defaultWorkspaceId: "fixture", workspaces: [{ id: "fixture", displayName: "Fixture", root: temporary }], workerToken: "worker-secret" });
    await request(worker).get("/v1/workspaces").expect(401);
    await request(worker).get("/v1/workspaces").set("x-queqiao-worker-token", "wrong").expect(401);
    await request(worker).get("/v1/workspaces").set("x-queqiao-worker-token", "worker-secret").expect(200);
  });
});
