import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnrollmentService } from "./enrollment-service.js";
import { createGatewayManagementApp } from "./management-app.js";
import { gatewayOperationsDiagnostics } from "./operations.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

function managementOptions(
  directory: string,
  secret: string,
  memberships: WorkerMembershipStore,
  enrollment: EnrollmentService,
  workers = { current: async () => ({ listEnvironments: async () => [], livenessSnapshot: () => [], mutateWorkspace: async (_workerId: string, mutation: { kind: string; workspaceId?: string; workspace?: { id: string } }) => ({ changed: true as const, workspaceId: mutation.kind === "workspace.add" ? mutation.workspace!.id : mutation.workspaceId! }) }) },
) {
  return { secret, enrollment, memberships, workers, stateDirectory: directory, operations: gatewayOperationsDiagnostics([]) };
}

afterEach(() => vi.unstubAllGlobals());

describe("Gateway management listener", () => {
  it("requires the local management secret and never exposes join-token creation unauthenticated", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-management-"));
    const memberships = new WorkerMembershipStore(directory);
    const enrollment = new EnrollmentService(memberships, directory);
    const secret = "s".repeat(43);
    const app = createGatewayManagementApp(managementOptions(directory, secret, memberships, enrollment));
    await request(app).post("/join-tokens").send({}).expect(401);
    const created = await request(app).post("/v1/join-tokens").set("x-queqiao-management-secret", secret).send({ expiresSeconds: 60 }).expect(201);
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
        mutateWorkspace: async (_workerId: string, mutation: { kind: string; workspaceId?: string; workspace?: { id: string } }) => ({ changed: true as const, workspaceId: mutation.kind === "workspace.add" ? mutation.workspace!.id : mutation.workspaceId! }),
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

  it("delegates versioned Workspace mutations to the enrolled Worker authority", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-management-"));
    const memberships = new WorkerMembershipStore(directory);
    const enrollment = new EnrollmentService(memberships, directory);
    const secret = "w".repeat(43);
    const workerId = "11111111-1111-4111-8111-111111111111";
    const calls: Array<{ workerId: string; mutation: unknown }> = [];
    const workers = {
      current: async () => ({
        listEnvironments: async () => [],
        livenessSnapshot: () => [],
        mutateWorkspace: async (targetWorkerId: string, mutation: { kind: string; workspaceId?: string; workspace?: { id: string } }) => {
          calls.push({ workerId: targetWorkerId, mutation });
          return { changed: true as const, workspaceId: mutation.kind === "workspace.add" ? mutation.workspace!.id : mutation.workspaceId! };
        },
      }),
    };
    const app = createGatewayManagementApp(managementOptions(directory, secret, memberships, enrollment, workers));

    await request(app).patch(`/v1/workers/${workerId}/workspaces/main/profile`).send({ profile: "coding" }).expect(401);
    await request(app).post(`/v1/workers/${workerId}/workspaces`).set("x-queqiao-management-secret", secret).send({ id: "secondary", displayName: "Secondary", root: "C:\\secondary", profile: "editor" }).expect(200);
    await request(app).patch(`/v1/workers/${workerId}/workspaces/main/profile`).set("x-queqiao-management-secret", secret).send({ profile: "coding" }).expect(200);
    await request(app).patch(`/v1/workers/${workerId}/workspaces/main/tools/shell`).set("x-queqiao-management-secret", secret).send({ decision: "allow" }).expect(200);
    await request(app).patch(`/v1/workers/${workerId}/workspaces/main/commands`).set("x-queqiao-management-secret", secret).send({ command: "npm", decision: "allow" }).expect(200);
    await request(app).delete(`/v1/workers/${workerId}/workspaces/secondary`).set("x-queqiao-management-secret", secret).expect(200);
    await request(app).patch(`/v1/workers/${workerId}/workspaces/main/profile`).set("x-queqiao-management-secret", secret).send({ profile: "owner" }).expect(400);

    expect(calls.map(({ mutation }) => mutation)).toEqual([
      { kind: "workspace.add", workspace: { id: "secondary", displayName: "Secondary", root: "C:\\secondary", profile: "editor" } },
      { kind: "profile.set", workspaceId: "main", profile: "coding" },
      { kind: "tool.decide", workspaceId: "main", tool: "shell", decision: "allow" },
      { kind: "command.decide", workspaceId: "main", command: "npm", decision: "allow" },
      { kind: "workspace.remove", workspaceId: "secondary" },
    ]);
  });

  it("exposes versioned Worker transport and removal mutations through the existing enrollment semantics", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-management-"));
    const credentialDirectory = path.join(directory, "worker-credentials");
    await mkdir(credentialDirectory, { recursive: true });
    const credentialPath = path.join(credentialDirectory, "worker.secret");
    const credential = "c".repeat(48);
    await writeFile(credentialPath, credential, "utf8");
    const memberships = new WorkerMembershipStore(directory);
    const enrollment = new EnrollmentService(memberships, directory);
    const secret = "v".repeat(43);
    const workerId = "11111111-1111-4111-8111-111111111111";
    await memberships.add({ workerId, environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576/" }, credentialRefs: [{ kind: "secret-file", path: credentialPath }] });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/enrollment/identity")) return new Response(JSON.stringify({ workerId, environmentId: "windows", protocolVersion: "3.0" }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/v1/hello")) return new Response(JSON.stringify({ protocolVersion: "3.0", workerId, environmentId: "windows", instanceId: "22222222-2222-4222-8222-222222222222", platform: "windows", capabilities: [] }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected URL: ${url}`);
    }));
    const app = createGatewayManagementApp(managementOptions(directory, secret, memberships, enrollment));

    const updated = await request(app).patch(`/v1/workers/${workerId}/transport`).set("x-queqiao-management-secret", secret).send({ transport: { type: "http", endpoint: "http://127.0.0.1:8586/" } }).expect(200);
    expect(updated.body.transport).toEqual({ type: "http", endpoint: "http://127.0.0.1:8586/" });
    expect((await memberships.read()).workers[0]?.transport.endpoint).toBe("http://127.0.0.1:8586/");

    await request(app).delete(`/v1/workers/${workerId}`).set("x-queqiao-management-secret", secret).expect(200);
    expect((await memberships.read()).workers).toEqual([]);
  });
});
