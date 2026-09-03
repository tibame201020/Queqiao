import { describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { createGatewayApp } from "./app.js";
import { EnrollmentService } from "./enrollment-service.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import type { GatewayRuntimeConfig } from "./config.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-protocol-discovery-")); roots.push(root);
  const stateDir = path.join(root, "state"); await mkdir(stateDir, { recursive: true });
  const memberships = new WorkerMembershipStore(stateDir);
  const enrollment = new EnrollmentService(memberships, stateDir);
  const config: GatewayRuntimeConfig = {
    port: 7575,
    publicBaseUrl: new URL("https://gateway.example/"),
    resourceUrl: "https://gateway.example/mcp",
    stateDir,
    approvalSecret: "correct horse battery staple",
    jwtSecret: new TextEncoder().encode("test-signing-secret-with-at-least-thirty-two-bytes"),
    trustProxyHops: 1,
    allowedRedirectOrigins: new Set(["https://chatgpt.com"]),
    extensions: [],
    configDirectory: root,
    workerSessionHost: "127.0.0.1",
    workerSessionPort: 7573,
  };
  return { root, stateDir, memberships, enrollment, app: await createGatewayApp(config, enrollment) };
}

describe("protocol capability authentication contract", () => {
  it("allows protocol discovery with a valid one-time join token before membership exists", async () => {
    const h = await harness();
    const joinToken = h.enrollment.createJoinToken().token;
    const response = await request(h.app).get("/enrollment/protocols").set("Authorization", `Bearer ${joinToken}`);
    expect(response.status).toBe(200);
    expect(response.body.protocols).toEqual(expect.any(Array));
  });

  it("requires the persistent membership credential, not workerId alone, after enrollment", async () => {
    const h = await harness();
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "m".repeat(48);
    const credentialFile = path.join(h.stateDir, "worker.secret");
    await writeFile(credentialFile, `${credential}\n`, "utf8");
    await h.memberships.add({
      workerId,
      environmentId: "windows",
      transport: { type: "http", endpoint: "http://127.0.0.1:7576/" },
      credentialRefs: [{ kind: "secret-file", path: credentialFile }],
    });

    const unauthenticated = await request(h.app).get(`/enrollment/protocols?workerId=${workerId}`);
    expect(unauthenticated.status).toBe(401);

    const authenticated = await request(h.app)
      .get(`/enrollment/protocols?workerId=${workerId}`)
      .set("x-queqiao-worker-token", credential);
    expect(authenticated.status).toBe(200);
    expect(authenticated.body.protocols).toEqual(expect.any(Array));
  });

  it("requires the persistent membership credential to change enabled protocols", async () => {
    const h = await harness();
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "m".repeat(48);
    const credentialFile = path.join(h.stateDir, "worker-update.secret");
    await writeFile(credentialFile, `${credential}
`, "utf8");
    await h.memberships.add({
      workerId,
      environmentId: "windows",
      transports: [{ type: "http", endpoint: "http://127.0.0.1:7576/" }],
      credentialRefs: [{ kind: "secret-file", path: credentialFile }],
    });

    const unauthenticated = await request(h.app)
      .put("/enrollment/protocols")
      .send({ workerId, transports: [{ type: "http", endpoint: "http://127.0.0.1:7576/" }] });
    expect(unauthenticated.status).toBe(401);
  });
});
