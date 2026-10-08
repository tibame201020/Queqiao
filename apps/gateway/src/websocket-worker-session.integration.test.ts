import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerProtocolService } from "../../worker/src/worker-protocol-service.js";
import { WorkerWebSocketReverseClient } from "../../worker/src/websocket-reverse-worker-client.js";
import { EnrollmentService } from "./enrollment-service.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import { WorkerSessionRegistry } from "./worker-session-registry.js";
import { WorkerWebSocketSessionServer } from "./websocket-worker-session-server.js";

let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP test server did not bind");
  return address.port;
}

describe("WebSocket reverse Worker session", () => {
  it("routes real Worker Protocol operations over one HTTPS-compatible WebSocket stream", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-ws-worker-"));
    await writeFile(path.join(temporary, "fixture.txt"), "hello websocket\n", "utf8");
    const workerId = "11111111-1111-4111-8111-111111111111";
    const credential = "w".repeat(48);
    const service = await createWorkerProtocolService({
      workerId,
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
    });
    const sessions = new WorkerSessionRegistry();
    const events: unknown[] = [];
    const http = createServer((_req, res) => { res.statusCode = 404; res.end(); });
    const websocket = new WorkerWebSocketSessionServer({
      sessions,
      authenticate: async (hello, presented) => {
        if (hello.workerId !== workerId || presented !== credential) throw new Error("unauthorized Worker session");
        return { kind: "membership" };
      },
      audit: { append: async (event) => { events.push(event); } },
    });
    websocket.attach(http);
    const port = await listen(http);
    const client = new WorkerWebSocketReverseClient({
      url: `ws://127.0.0.1:${port}/worker-session`,
      credential,
      service,
    });

    try {
      await client.connect();
      await vi.waitFor(() => expect(sessions.snapshot()).toHaveLength(1));
      await expect(sessions.require(workerId).transport.execute({ operation: "health" })).resolves.toMatchObject({ ok: true, environmentId: "linux" });
      await expect(sessions.require(workerId).transport.execute({ operation: "invoke-tool", toolName: "read_file", input: { workspaceId: "one", path: "fixture.txt", offset: 0, limit: 10 } })).resolves.toMatchObject({ result: { text: "hello websocket\n" } });
      expect(JSON.stringify(events)).not.toContain(credential);
    } finally {
      client.close();
      await websocket.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });

  it("binds a provisional WebSocket session before membership commit", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-ws-enrollment-"));
    const workerId = "11111111-1111-4111-8111-111111111111";
    const sessions = new WorkerSessionRegistry();
    const memberships = new WorkerMembershipStore(path.join(temporary, "state"));
    const enrollment = new EnrollmentService(memberships, path.join(temporary, "state"), sessions);
    const started = await enrollment.startJoin({
      token: enrollment.createJoinToken().token,
      workerId,
      environmentId: "linux",
      transports: [{ type: "websocket", mode: "reverse" }],
    });
    const service = await createWorkerProtocolService({
      workerId,
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
    });
    const http = createServer((_req, res) => { res.statusCode = 404; res.end(); });
    const websocket = new WorkerWebSocketSessionServer({
      sessions,
      authenticate: (hello, credential) => enrollment.authenticateWorkerSession(hello, credential),
    });
    websocket.attach(http);
    const port = await listen(http);
    const client = new WorkerWebSocketReverseClient({
      url: `ws://127.0.0.1:${port}/worker-session`,
      credential: started.credential,
      service,
    });

    try {
      await client.connect();
      await vi.waitFor(() => expect(sessions.require(workerId).authentication).toEqual({ kind: "provisional", transactionId: started.transactionId }));
      await expect(enrollment.confirmJoin(started.transactionId, started.credential)).resolves.toMatchObject({
        workerId,
        transports: [{ type: "websocket", mode: "reverse" }],
      });
      expect(sessions.require(workerId).authentication).toEqual({ kind: "membership" });
    } finally {
      client.close();
      await websocket.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});