import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@queqiao/audit";
import { createGatewayApp } from "./app.js";
import type { GatewayRuntimeConfig } from "./config.js";

describe("Gateway auth audit", () => {
  let temporary: string | undefined;

  afterEach(async () => {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    temporary = undefined;
  });

  it("records OAuth outcomes without persisting secrets, authorization codes, or access tokens", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-auth-audit-"));
    const events: AuditEvent[] = [];
    const config: GatewayRuntimeConfig = {
      port: 7575,
      publicBaseUrl: new URL("http://localhost:7575/"),
      resourceUrl: "http://localhost:7575/mcp",
      stateDir: path.join(temporary, "state"),
      approvalSecret: "audit-approval-secret",
      jwtSecret: new TextEncoder().encode("audit-signing-secret-with-at-least-thirty-two-bytes"),
      trustProxyHops: 1,
      allowedRedirectOrigins: new Set(["https://chatgpt.com"]),
      extensions: [],
      configDirectory: temporary,
    };
    const app = await createGatewayApp(config, undefined, undefined, { append: async (event) => { events.push(event); } });

    const registered = await request(app).post("/oauth/register").set("Host", "localhost").send({
      client_name: "Audit Test",
      redirect_uris: ["https://chatgpt.com/connector/oauth/callback"],
      token_endpoint_auth_method: "none",
      scope: "workspace:read",
    }).expect(201);
    const verifier = randomBytes(40).toString("base64url");
    const authorization = {
      client_id: registered.body.client_id as string,
      redirect_uri: "https://chatgpt.com/connector/oauth/callback",
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "workspace:read",
      resource: "http://localhost:7575/mcp",
      state: "audit",
    };

    await request(app).post("/oauth/authorize").set("Host", "localhost").type("form").send({ ...authorization, approval_secret: "wrong-secret" }).expect(403);
    const approved = await request(app).post("/oauth/authorize").set("Host", "localhost").type("form").send({ ...authorization, approval_secret: config.approvalSecret }).expect(303);
    const code = new URL(approved.headers.location).searchParams.get("code");
    expect(code).toEqual(expect.any(String));
    const token = await request(app).post("/oauth/token").set("Host", "localhost").type("form").send({
      grant_type: "authorization_code",
      code,
      redirect_uri: authorization.redirect_uri,
      client_id: authorization.client_id,
      code_verifier: verifier,
      resource: authorization.resource,
    }).expect(200);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: "gateway", category: "auth", action: "oauth.register", outcome: "success", detail: { method: "POST", status: 201 } }),
      expect.objectContaining({ component: "gateway", category: "auth", action: "oauth.authorize", outcome: "denied", detail: { method: "POST", status: 403 } }),
      expect.objectContaining({ component: "gateway", category: "auth", action: "oauth.authorize", outcome: "success", detail: { method: "POST", status: 303 } }),
      expect.objectContaining({ component: "gateway", category: "auth", action: "oauth.token", outcome: "success", detail: { method: "POST", status: 200 } }),
    ]));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(config.approvalSecret);
    expect(serialized).not.toContain("wrong-secret");
    expect(serialized).not.toContain(code!);
    expect(serialized).not.toContain(token.body.access_token as string);
  });
});
