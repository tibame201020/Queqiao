import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerApp } from "../../worker/src/app.js";
import { EnrollmentError, EnrollmentService } from "./enrollment-service.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function tempStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-enrollment-"));
  const store = new WorkerMembershipStore(directory);
  return { directory, store, service: new EnrollmentService(store, directory) };
}

async function workerServer(workerId: string, environmentId: string, credential: { value: string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-enrollment-worker-"));
  const app = await createWorkerApp({ workerId, environmentId, defaultWorkspaceId: "default", workerCredential: { current: async () => credential.value }, workspaces: [{ id: "default", displayName: "default", root, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }] });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Worker test server did not expose a TCP port");
  return `http://127.0.0.1:${address.port}/`;
}

describe("Worker enrollment transaction", () => {
  it("consumes a join token on first transaction attempt, including binding mismatch", async () => {
    const { service } = await tempStore();
    const workerId = crypto.randomUUID();
    const issued = service.createJoinToken({ workerId });
    const request = { token: issued.token, workerId: crypto.randomUUID(), environmentId: "windows", transport: { type: "http" as const, endpoint: "http://127.0.0.1:7576/" } };
    await expect(service.startJoin(request)).rejects.toMatchObject({ code: "worker_binding_mismatch" });
    await expect(service.startJoin({ ...request, workerId })).rejects.toMatchObject({ code: "invalid_join_token" });
  });

  it("expires an unconfirmed provisional transaction after 30 seconds without membership", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
    const { service, store } = await tempStore();
    const workerId = crypto.randomUUID();
    const issued = service.createJoinToken();
    const started = await service.startJoin({ token: issued.token, workerId, environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576/" } });
    vi.setSystemTime(new Date("2026-08-15T00:00:31Z"));
    await expect(service.confirmJoin(started.transactionId, started.credential)).rejects.toMatchObject({ code: "join_transaction_expired" });
    expect((await store.read()).workers).toEqual([]);
  });

  it("does not commit membership when the Worker endpoint cannot be verified", async () => {
    const { service, store } = await tempStore();
    const issued = service.createJoinToken();
    const started = await service.startJoin({ token: issued.token, workerId: crypto.randomUUID(), environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:9/" } });
    await expect(service.confirmJoin(started.transactionId, started.credential)).rejects.toBeInstanceOf(EnrollmentError);
    expect((await store.read()).workers).toEqual([]);
  });

  it("rejects an authenticated Worker whose stable identity differs from the transaction", async () => {
    const { service, store } = await tempStore();
    const requestedWorkerId = crypto.randomUUID();
    const credential = { value: "bootstrap" };
    const endpoint = await workerServer(crypto.randomUUID(), "windows", credential);
    const issued = service.createJoinToken();
    const started = await service.startJoin({ token: issued.token, workerId: requestedWorkerId, environmentId: "windows", transport: { type: "http", endpoint } });
    credential.value = started.credential;
    await expect(service.confirmJoin(started.transactionId, started.credential)).rejects.toMatchObject({ code: "worker_identity_mismatch" });
    expect((await store.read()).workers).toEqual([]);
  });

  it("commits membership only after health, identity, protocol, and authenticated handshake succeed", async () => {
    const { service, store } = await tempStore();
    const workerId = crypto.randomUUID();
    const credential = { value: "bootstrap" };
    const endpoint = await workerServer(workerId, "windows", credential);
    const issued = service.createJoinToken({ environmentId: "windows" });
    const started = await service.startJoin({ token: issued.token, workerId, environmentId: "windows", transport: { type: "http", endpoint } });
    credential.value = started.credential;
    const membership = await service.confirmJoin(started.transactionId, started.credential);
    expect(membership.workerId).toBe(workerId);
    const registry = await store.read();
    expect(registry.workers).toHaveLength(1);
    expect(registry.workers[0]?.transport).toEqual({ type: "http", endpoint });
    const persisted = (await readFile(registry.workers[0]!.credentialRefs[0]!.path, "utf8")).trim();
    expect(persisted).toBe(started.credential);
  });

  it("rolls back the persisted daily credential when membership commit fails", async () => {
    const { directory, service, store } = await tempStore();
    const workerId = crypto.randomUUID();
    const credential = { value: "bootstrap" };
    const endpoint = await workerServer(workerId, "windows", credential);
    const started = await service.startJoin({ token: service.createJoinToken().token, workerId, environmentId: "windows", transport: { type: "http", endpoint } });
    credential.value = started.credential;
    vi.spyOn(store, "add").mockRejectedValueOnce(new Error("injected membership persistence failure"));
    await expect(service.confirmJoin(started.transactionId, started.credential)).rejects.toThrow("injected membership persistence failure");
    expect((await store.read()).workers).toEqual([]);
    expect(await readdir(path.join(directory, "worker-credentials"))).toEqual([]);
    await expect(service.confirmJoin(started.transactionId, started.credential)).rejects.toMatchObject({ code: "join_transaction_expired" });
  });

  it("rejects a second Worker that proposes an already enrolled Gateway-visible transport endpoint", async () => {
    const { service, store } = await tempStore();
    const firstWorkerId = crypto.randomUUID();
    const credential = { value: "bootstrap" };
    const endpoint = await workerServer(firstWorkerId, "windows", credential);
    const first = await service.startJoin({ token: service.createJoinToken().token, workerId: firstWorkerId, environmentId: "windows", transport: { type: "http", endpoint } });
    credential.value = first.credential;
    await service.confirmJoin(first.transactionId, first.credential);

    const secondToken = service.createJoinToken().token;
    await expect(service.startJoin({ token: secondToken, workerId: crypto.randomUUID(), environmentId: "linux", transport: { type: "http", endpoint } })).rejects.toMatchObject({ status: 409, code: "worker_transport_conflict" });
    expect((await store.read()).workers).toHaveLength(1);
  });

  it("invalidates a provisional transaction after a bad confirmation credential", async () => {
    const { service } = await tempStore();
    const issued = service.createJoinToken();
    const started = await service.startJoin({ token: issued.token, workerId: crypto.randomUUID(), environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576/" } });
    await expect(service.confirmJoin(started.transactionId, "wrong-credential".repeat(3))).rejects.toMatchObject({ code: "invalid_provisional_credential" });
    await expect(service.confirmJoin(started.transactionId, started.credential)).rejects.toMatchObject({ code: "join_transaction_expired" });
  });

  it("does not persist unused join tokens across Gateway service restart", async () => {
    const { directory, store, service } = await tempStore();
    const token = service.createJoinToken().token;
    const restarted = new EnrollmentService(store, directory);
    await expect(restarted.startJoin({ token, workerId: crypto.randomUUID(), environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576/" } })).rejects.toMatchObject({ code: "invalid_join_token" });
  });

  it("updates a persisted transport only after the same Worker identity proves the existing daily credential", async () => {
    const { service, store } = await tempStore();
    const workerId = crypto.randomUUID();
    const credential = { value: "bootstrap" };
    const firstEndpoint = await workerServer(workerId, "windows", credential);
    const started = await service.startJoin({ token: service.createJoinToken().token, workerId, environmentId: "windows", transport: { type: "http", endpoint: firstEndpoint } });
    credential.value = started.credential;
    await service.confirmJoin(started.transactionId, started.credential);
    const secondEndpoint = await workerServer(workerId, "windows", credential);
    const updated = await service.updateTransport(workerId, { type: "http", endpoint: secondEndpoint });
    expect(updated.transport).toEqual({ type: "http", endpoint: secondEndpoint });
    expect((await store.read()).workers[0]?.transport).toEqual({ type: "http", endpoint: secondEndpoint });
  });

  it("rejects an explicit transport update that collides with another enrolled Worker", async () => {
    const { service, store } = await tempStore();
    const firstWorkerId = crypto.randomUUID();
    const secondWorkerId = crypto.randomUUID();
    await store.add({ workerId: firstWorkerId, environmentId: "windows", transport: { type: "http", endpoint: "http://127.0.0.1:7576/" }, credentialRefs: [{ kind: "secret-file", path: path.join("secrets", "first.secret") }] });
    await store.add({ workerId: secondWorkerId, environmentId: "linux", transport: { type: "http", endpoint: "http://127.0.0.1:7577/" }, credentialRefs: [{ kind: "secret-file", path: path.join("secrets", "second.secret") }] });
    await expect(service.updateTransport(firstWorkerId, { type: "http", endpoint: "http://localhost:7577/" })).rejects.toMatchObject({ status: 409, code: "worker_transport_conflict" });
    expect((await store.read()).workers.find((worker) => worker.workerId === firstWorkerId)?.transport.endpoint).toBe("http://127.0.0.1:7576/");
  });

  it("keeps the prior transport when an explicit update points at the wrong Worker identity", async () => {
    const { service, store } = await tempStore();
    const workerId = crypto.randomUUID();
    const credential = { value: "bootstrap" };
    const firstEndpoint = await workerServer(workerId, "windows", credential);
    const started = await service.startJoin({ token: service.createJoinToken().token, workerId, environmentId: "windows", transport: { type: "http", endpoint: firstEndpoint } });
    credential.value = started.credential;
    await service.confirmJoin(started.transactionId, started.credential);
    const wrongEndpoint = await workerServer(crypto.randomUUID(), "windows", credential);
    await expect(service.updateTransport(workerId, { type: "http", endpoint: wrongEndpoint })).rejects.toMatchObject({ code: "worker_identity_mismatch" });
    expect((await store.read()).workers[0]?.transport).toEqual({ type: "http", endpoint: firstEndpoint });
  });});
