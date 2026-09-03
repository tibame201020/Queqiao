import { describe, expect, it, vi } from "vitest";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import { WorkerRegistry } from "./worker-registry.js";

const workerId = "11111111-1111-4111-8111-111111111111";
const http = { type: "http", endpoint: "http://127.0.0.1:7576/" } as const;
const grpc = { type: "grpc", mode: "reverse" } as const;

function runtimeTransport() {
  return {
    execute: vi.fn(async (request: { operation: string }) => {
      if (request.operation === "health") return { ok: true };
      if (request.operation === "hello") return {
        protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION,
        workerId,
        environmentId: "linux",
        instanceId: "22222222-2222-4222-8222-222222222222",
        platform: "linux",
        capabilities: [],
      };
      if (request.operation === "list-workspaces") return {
        environmentId: "linux",
        workspaces: [
          { workspaceId: "ai-stack", displayName: "ai-stack", root: "/home/user/ai-stack", profile: "coding", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } },
          { workspaceId: "models", displayName: "models", root: "/home/user/models", profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } },
        ],
      };
      throw new Error(`unexpected operation: ${request.operation}`);
    }),
  };
}

describe("Workspace transport projection contract", () => {
  it("projects objective HTTP/gRPC traits and health onto every Workspace without making them Workspace configuration", async () => {
    const registry = new WorkerRegistry([
      { workerId, environmentId: "linux", transport: http, token: "membership-token", runtimeTransport: runtimeTransport() },
      { workerId, environmentId: "linux", transport: grpc, token: "membership-token", runtimeTransport: runtimeTransport() },
    ]);

    await registry.probeLiveness();
    const listed: any = await registry.listWorkspaces();
    const expected = [
      {
        type: "http", status: "healthy", mode: "direct",
        traits: { requestResponse: true, streaming: "none", connection: "stateless", topology: "direct" },
      },
      {
        type: "grpc", status: "healthy", mode: "reverse",
        traits: { requestResponse: true, streaming: "bidirectional", connection: "persistent", topology: "reverse" },
      },
    ];
    expect(listed.workspaces).toHaveLength(2);
    expect(listed.workspaces[0].transports).toEqual(expected);
    expect(listed.workspaces[1].transports).toEqual(expected);
  });
});
