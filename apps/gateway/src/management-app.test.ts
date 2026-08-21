import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { EnrollmentService } from "./enrollment-service.js";
import { createGatewayManagementApp } from "./management-app.js";
import { gatewayOperationsDiagnostics } from "./operations.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

function managementOptions(
  directory: string,
  secret: string,
  memberships: WorkerMembershipStore,
  enrollment: EnrollmentService,
  workers = { current: async () => ({ listEnvironments: async () => [], livenessSnapshot: () => [] }) },
) {
  return { secret, enrollment, memberships, workers, stateDirectory: directory, operations: gatewayOperationsDiagnostics([]) };
}

describe("Gateway management listener", () => {
  it("requires the local management secret and never exposes join-token creation unauthenticated", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-management-"));
    const memberships = new WorkerMembershipStore(directory);
    const enrollment = new EnrollmentService(memberships, directory);
    const secret = "s".repeat(43);
    const app = createGatewayManagementApp(managementOptions(directory, secret, memberships, enrollment));
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
    const app = createGatewayManagementApp(managementOptions(directory, secret, memberships, enrollment));
    const first = (await request(app).post("/join-tokens").set("x-queqiao-management-secret", secret).send({}).expect(201)).body.token;
    const second = (await request(app).post("/join-tokens").set("x-queqiao-management-secret", secret).send({}).expect(201)).body.token;
    expect(first).not.toBe(second);
    await expect(enrollment.startJoin({ token: first, workerId: crypto.randomUUID(), environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576/" } })).resolves.toHaveProperty("transactionId");
    await expect(enrollment.startJoin({ token: second, workerId: crypto.randomUUID(), environmentId: "linux", transport: { type: "http", endpoint: "http://127.0.0.1:7577/" } })).resolves.toHaveProperty("transactionId");
  });

  it("exposes a versioned redacted control-plane snapshot only to authenticated local management callers", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-management-"));
    const memberships = new WorkerMembershipStore(directory);
    const enrollment = new EnrollmentService(memberships, directory);
    const secret = "o".repeat(43);
    const credentialPath = path.join(directory, "worker-credentials", "windows.secret");
    const workerId = crypto.randomUUID();
    await memberships.add({
      workerId,
      environmentId: "windows",
      transport: { type: "http", endpoint: "http://127.0.0.1:7576/" },
      credentialRefs: [{ kind: "secret-file", path: credentialPath }],
    });
    const checkedAt = "2026-08-21T13:00:00.000Z";
    const workers = {
      current: async () => ({
        listEnvironments: async () => [{
          environmentId: "windows",
          online: true,
          defaultWorkspaceId: "main",
          workspaces: [{
            environmentId: "windows",
            workspaceId: "main",
            displayName: "Main workspace",
            root: "C:\\workspace",
            profile: "coding" as const,
            tools: { allow: ["run", "read_file"], deny: ["shell"], explicit: ["run"] },
            commands: { allow: ["npm", "git"] },
            online: true as const,
          }],
        }],
        livenessSnapshot: () => [{ environmentId: "windows", reachable: true, checkedAt, lastSuccessAt: checkedAt }],
      }),
    };
    const app = createGatewayManagementApp(managementOptions(directory, secret, memberships, enrollment, workers));

    await request(app).get("/v1/operations").expect(401);
    const response = await request(app).get("/v1/operations").set("x-queqiao-management-secret", secret).expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.apiVersion).toBe(1);
    expect(response.body.deployment).toMatchObject({ ok: true, coreManifestRevision: 6, workerProtocolVersion: "3.0" });
    expect(response.body.workers).toEqual([{
      workerId,
      environmentId: "windows",
      transport: { type: "http", endpoint: "http://127.0.0.1:7576/" },
      liveness: { reachable: true, checkedAt, lastSuccessAt: checkedAt },
      defaultWorkspaceId: "main",
      workspaces: [{
        workspaceId: "main",
        displayName: "Main workspace",
        root: "C:\\workspace",
        profile: "coding",
        tools: { allow: ["read_file", "run"], deny: ["shell"], explicit: ["run"] },
        commands: { allow: ["git", "npm"] },
      }],
    }]);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("credentialRefs");
    expect(serialized).not.toContain(credentialPath);
  });
});
