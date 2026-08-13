import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";

describe("path-prefixed public Gateway base", () => {
  let temporary: string;

  beforeEach(async () => { temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-path-base-")); });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it("advertises path-scoped OAuth endpoints and preserves the path in the approval form", async () => {
    const publicBaseUrl = new URL("https://queqiao.example/shadow-r5/");
    const config: GatewayRuntimeConfig = {
      port: 7675,
      publicBaseUrl,
      resourceUrl: new URL("mcp", publicBaseUrl).href,
      stateDir: temporary,
      approvalSecret: "test-approval-secret-long-enough",
      jwtSecret: new TextEncoder().encode("test-signing-secret-with-at-least-thirty-two-bytes"),
      trustProxyHops: 1,
      allowedRedirectOrigins: new Set(["https://chatgpt.com"]),
      workers: [{ environmentId: "windows", url: new URL("http://127.0.0.1:65534"), token: "test-worker-token-with-at-least-thirty-two-bytes" }],
      extensions: [],
      configDirectory: temporary,
    };
    const gateway = await createGatewayApp(config);

    const protectedResource = await request(gateway).get("/.well-known/oauth-protected-resource/mcp").expect(200);
    expect(protectedResource.body).toMatchObject({
      resource: "https://queqiao.example/shadow-r5/mcp",
      authorization_servers: ["https://queqiao.example/shadow-r5/"],
    });

    const authorizationServer = await request(gateway).get("/.well-known/oauth-authorization-server").expect(200);
    expect(authorizationServer.body).toMatchObject({
      issuer: "https://queqiao.example/shadow-r5/",
      authorization_endpoint: "https://queqiao.example/shadow-r5/oauth/authorize",
      token_endpoint: "https://queqiao.example/shadow-r5/oauth/token",
      registration_endpoint: "https://queqiao.example/shadow-r5/oauth/register",
    });

    const challenge = await request(gateway).post("/mcp").send({}).expect(401);
    expect(challenge.headers["www-authenticate"]).toContain('resource_metadata="https://queqiao.example/shadow-r5/.well-known/oauth-protected-resource/mcp"');

    const registration = await request(gateway).post("/oauth/register").send({
      client_name: "Path base test",
      redirect_uris: ["https://chatgpt.com/connector/oauth/callback"],
      token_endpoint_auth_method: "none",
      scope: "queqiao:access",
    }).expect(201);
    const verifier = "a".repeat(43);
    const authorization = {
      client_id: registration.body.client_id,
      redirect_uri: "https://chatgpt.com/connector/oauth/callback",
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "queqiao:access",
      resource: "https://queqiao.example/shadow-r5/mcp",
      state: "path-base",
    };
    const page = await request(gateway).get("/oauth/authorize").query(authorization).expect(200);
    expect(page.text).toContain('action="/shadow-r5/oauth/authorize"');
  });
});
