import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { EnrollmentService } from "./enrollment-service.js";
import { createGatewayManagementApp } from "./management-app.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

describe("Gateway management listener", () => {
  it("requires the local management secret and never exposes join-token creation unauthenticated", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-management-"));
    const memberships = new WorkerMembershipStore(directory);
    const enrollment = new EnrollmentService(memberships, directory);
    const secret = "s".repeat(43);
    const app = createGatewayManagementApp({ secret, enrollment, memberships, stateDirectory: directory });
    await request(app).post("/join-tokens").send({}).expect(401);
    const created = await request(app).post("/join-tokens").set("x-queqiao-management-secret", secret).send({ expiresSeconds: 60 }).expect(201);
    expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(created.body).not.toHaveProperty("credential");
  });

  it("supports multiple independent unused join tokens", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-management-"));
    const memberships = new WorkerMembershipStore(directory);
    const enrollment = new EnrollmentService(memberships, directory);
    const secret = "m".repeat(43);
    const app = createGatewayManagementApp({ secret, enrollment, memberships, stateDirectory: directory });
    const first = (await request(app).post("/join-tokens").set("x-queqiao-management-secret", secret).send({}).expect(201)).body.token;
    const second = (await request(app).post("/join-tokens").set("x-queqiao-management-secret", secret).send({}).expect(201)).body.token;
    expect(first).not.toBe(second);
    await expect(enrollment.startJoin({ token: first, workerId: crypto.randomUUID(), environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576/" } })).resolves.toHaveProperty("transactionId");
    await expect(enrollment.startJoin({ token: second, workerId: crypto.randomUUID(), environmentId: "linux", transport: { type: "http", endpoint: "http://127.0.0.1:7577/" } })).resolves.toHaveProperty("transactionId");
  });
});
