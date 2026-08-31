import { describe, expect, it, vi } from "vitest";
import { WorkerClient } from "./worker-client.js";
import { SessionRegistryWorkerTransport } from "./session-registry-worker-transport.js";
import { WorkerSessionRegistry } from "./worker-session-registry.js";

const workerId = "11111111-1111-4111-8111-111111111111";
const config = {
  workerId,
  environmentId: "linux",
  transport: { type: "grpc" as const, mode: "reverse" as const },
  token: "x".repeat(32),
};

function hello(instanceId: string) {
  return { protocolVersion: "3.0" as const, workerId, environmentId: "linux", instanceId, platform: "linux" as const, capabilities: [] };
}

function sessionTransport(instanceId: string, workspaceId: string) {
  return {
    execute: vi.fn(async (request: { operation: string }) => {
      if (request.operation === "hello") return hello(instanceId);
      if (request.operation === "list-workspaces") return {
        environmentId: "linux",
        workspaces: [{ environmentId: "linux", workspaceId, displayName: workspaceId, root: "/tmp", profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
      };
      if (request.operation === "health") return { ok: true };
      throw new Error(`unexpected operation: ${request.operation}`);
    }),
    close: vi.fn(),
  };
}

describe("SessionRegistryWorkerTransport", () => {
  it("routes each invocation through the currently active session", async () => {
    const sessions = new WorkerSessionRegistry();
    const first = sessionTransport("22222222-2222-4222-8222-222222222222", "first");
    const attached = sessions.attach(hello("22222222-2222-4222-8222-222222222222"), first, { kind: "membership" });
    const transport = new SessionRegistryWorkerTransport(sessions, workerId);
    const client = new WorkerClient(config, transport);

    await expect(client.listWorkspaces()).resolves.toMatchObject({ workspaces: [{ workspaceId: "first" }] });
    expect(first.execute).toHaveBeenCalledWith({ operation: "hello" }, undefined);

    sessions.detach(attached.sessionId, new Error("reconnect"));
    const second = sessionTransport("33333333-3333-4333-8333-333333333333", "second");
    sessions.attach(hello("33333333-3333-4333-8333-333333333333"), second, { kind: "membership" });

    await expect(client.listWorkspaces()).resolves.toMatchObject({ workspaces: [{ workspaceId: "second" }] });
    expect(second.execute).toHaveBeenCalledWith({ operation: "hello" }, undefined);
  });

  it("fails when no live session exists", async () => {
    const transport = new SessionRegistryWorkerTransport(new WorkerSessionRegistry(), workerId);
    await expect(transport.execute({ operation: "health" })).rejects.toThrow(/no active reverse Worker session/i);
  });
});
