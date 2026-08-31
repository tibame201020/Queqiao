import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import selfsigned from "selfsigned";
import { createWorkerProtocolService, type WorkerProtocolService } from "../../worker/src/worker-protocol-service.js";
import { WorkerGrpcReverseClient } from "../../worker/src/grpc-reverse-worker-client.js";
import { WorkerGrpcSessionServer } from "./grpc-worker-session-server.js";
import { WorkerSessionRegistry } from "./worker-session-registry.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import { EnrollmentService } from "./enrollment-service.js";

let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("loopback gRPC Worker session binding", () => {
  it("routes real Worker Protocol operations over one bidirectional gRPC stream", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-grpc-worker-"));
    await writeFile(path.join(temporary, "fixture.txt"), "hello grpc\n", "utf8");
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "g".repeat(48);
    const service = await createWorkerProtocolService({
      workerId,
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
    });
    const sessions = new WorkerSessionRegistry();
    const server = new WorkerGrpcSessionServer({
      sessions,
      authenticate: async (hello, presented) => {
        if (hello.workerId !== workerId || presented !== credential) throw new Error("unauthorized Worker session");
        return { kind: "membership" };
      },
    });
    const target = await server.listenLoopback();
    const client = new WorkerGrpcReverseClient({ target, credential, service });

    try {
      await client.connectLoopback();
      await vi.waitFor(() => expect(sessions.snapshot()).toHaveLength(1));
      const transport = sessions.require(workerId).transport;
      await expect(transport.execute({ operation: "health" })).resolves.toMatchObject({ ok: true, environmentId: "linux" });
      await expect(transport.execute({ operation: "hello" })).resolves.toMatchObject({ workerId, protocolVersion: "3.0" });
      await expect(transport.execute({ operation: "list-workspaces" })).resolves.toMatchObject({ environmentId: "linux", workspaces: [{ workspaceId: "one" }] });
      await expect(transport.execute({ operation: "invoke-tool", toolName: "read_file", input: { workspaceId: "one", path: "fixture.txt", offset: 0, limit: 10 } })).resolves.toMatchObject({ result: { text: "hello grpc\n" } });
    } finally {
      client.close();
      await server.close();
    }
  });

  it("routes Worker Protocol over TLS using the pinned Gateway certificate", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-grpc-tls-"));
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "t".repeat(48);
    const pems = await selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: true },
        { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] },
      ],
    });
    const service = await createWorkerProtocolService({
      workerId,
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
    });
    const sessions = new WorkerSessionRegistry();
    const server = new WorkerGrpcSessionServer({ sessions, authenticate: async (_hello, presented) => {
      if (presented !== credential) throw new Error("unauthorized");
      return { kind: "membership" };
    } });
    const target = await server.listenTls("127.0.0.1", 0, Buffer.from(pems.cert), Buffer.from(pems.private));
    const client = new WorkerGrpcReverseClient({ target, credential, service });

    try {
      await client.connectTls(pems.cert);
      await expect(sessions.require(workerId).transport.execute({ operation: "health" })).resolves.toMatchObject({ ok: true });
    } finally {
      client.close();
      await server.close();
    }
  });

  it("does not report connected until Gateway authentication and session attach acknowledge ready", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-grpc-ready-"));
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "r".repeat(48);
    const service = await createWorkerProtocolService({
      workerId,
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
    });
    const sessions = new WorkerSessionRegistry();
    let releaseAuthentication!: () => void;
    const authenticationGate = new Promise<void>((resolve) => { releaseAuthentication = resolve; });
    const server = new WorkerGrpcSessionServer({
      sessions,
      authenticate: async () => {
        await authenticationGate;
        return { kind: "membership" };
      },
    });
    const target = await server.listenLoopback();
    const client = new WorkerGrpcReverseClient({ target, credential, service });

    try {
      let connected = false;
      const pending = client.connectLoopback().then(() => { connected = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(connected).toBe(false);
      expect(sessions.snapshot()).toEqual([]);
      releaseAuthentication();
      await pending;
      expect(sessions.snapshot()).toHaveLength(1);
    } finally {
      releaseAuthentication?.();
      client.close();
      await server.close();
    }
  });

  it("does not attach a session when Worker credential authentication fails", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-grpc-auth-"));
    const service = await createWorkerProtocolService({
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
    });
    const sessions = new WorkerSessionRegistry();
    const server = new WorkerGrpcSessionServer({ sessions, authenticate: async () => { throw new Error("unauthorized Worker session"); } });
    const target = await server.listenLoopback();
    const client = new WorkerGrpcReverseClient({ target, credential: "x".repeat(48), service, readyTimeoutMs: 250 });

    try {
      await expect(client.connectLoopback()).rejects.toThrow(/ready acknowledgment timed out|authentication/i);
      expect(sessions.snapshot()).toEqual([]);
    } finally {
      client.close();
      await server.close();
    }
  });

  it("binds a real provisional gRPC session to enrollment before committing membership", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-grpc-enrollment-integration-"));
    const workerId = "11111111-1111-4111-8111-111111111111";
    const sessions = new WorkerSessionRegistry();
    const memberships = new WorkerMembershipStore(path.join(temporary, "state"));
    const enrollment = new EnrollmentService(memberships, path.join(temporary, "state"), sessions);
    const started = await enrollment.startJoin({
      token: enrollment.createJoinToken().token,
      workerId,
      environmentId: "linux",
      transport: { type: "grpc", mode: "reverse" },
    });
    const service = await createWorkerProtocolService({
      workerId,
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
    });
    const server = new WorkerGrpcSessionServer({
      sessions,
      authenticate: (hello, credential) => enrollment.authenticateWorkerSession(hello, credential),
    });
    const target = await server.listenLoopback();
    const client = new WorkerGrpcReverseClient({ target, credential: started.credential, service });

    try {
      await client.connectLoopback();
      await vi.waitFor(() => expect(sessions.require(workerId).authentication).toEqual({ kind: "provisional", transactionId: started.transactionId }));
      await expect(enrollment.confirmJoin(started.transactionId, started.credential)).resolves.toMatchObject({ workerId, transport: { type: "grpc", mode: "reverse" } });
      expect(sessions.require(workerId).authentication).toEqual({ kind: "membership" });
      expect((await memberships.read()).workers).toHaveLength(1);
    } finally {
      client.close();
      await server.close();
    }
  });

  it("propagates Gateway cancellation across the gRPC stream into Worker execution", async () => {
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "c".repeat(48);
    let workerSignal: AbortSignal | undefined;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const hello = { protocolVersion: "3.0" as const, workerId, environmentId: "linux", instanceId: "22222222-2222-4222-8222-222222222222", platform: "linux" as const, capabilities: [] };
    const service: WorkerProtocolService = {
      async execute(request, signal) {
        if (request.operation === "hello") return hello as never;
        workerSignal = signal;
        await blocked;
        if (signal?.aborted) throw signal.reason;
        return { ok: true } as never;
      },
    };
    const sessions = new WorkerSessionRegistry();
    const server = new WorkerGrpcSessionServer({ sessions, authenticate: async (_hello, presented) => { if (presented !== credential) throw new Error("unauthorized"); return { kind: "membership" }; } });
    const target = await server.listenLoopback();
    const client = new WorkerGrpcReverseClient({ target, credential, service });

    try {
      await client.connectLoopback();
      await vi.waitFor(() => expect(sessions.snapshot()).toHaveLength(1));
      const controller = new AbortController();
      const pending = sessions.require(workerId).transport.execute({ operation: "health" }, controller.signal);
      await vi.waitFor(() => expect(workerSignal).toBeDefined());
      controller.abort(new Error("cancel from Gateway"));
      await expect(pending).rejects.toThrow(/cancel from Gateway/);
      await vi.waitFor(() => expect(workerSignal?.aborted).toBe(true));
      release();
    } finally {
      release?.();
      client.close();
      await server.close();
    }
  });
});
