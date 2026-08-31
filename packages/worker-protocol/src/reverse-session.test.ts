import { describe, expect, it } from "vitest";
import { decodeWorkerSessionFrame, encodeWorkerSessionFrame, MAX_WORKER_SESSION_FRAME_BYTES, workerProtocolRequestSchema, workerSessionFrameSchema } from "./index.js";

const hello = {
  protocolVersion: "3.0",
  workerId: "11111111-1111-4111-8111-111111111111",
  environmentId: "linux",
  instanceId: "22222222-2222-4222-8222-222222222222",
  platform: "linux",
  capabilities: [],
} as const;

describe("reverse Worker session protocol", () => {
  it("validates transport-neutral Worker Protocol requests", () => {
    expect(workerProtocolRequestSchema.parse({ operation: "health" })).toEqual({ operation: "health" });
    expect(workerProtocolRequestSchema.parse({ operation: "workspace-info", workspaceId: "one", tool: "open_workspace" })).toMatchObject({ workspaceId: "one" });
    expect(workerProtocolRequestSchema.parse({ operation: "invoke-tool", toolName: "read_file", input: { workspaceId: "one", path: "a.txt" } })).toMatchObject({ toolName: "read_file" });
    expect(() => workerProtocolRequestSchema.parse({ operation: "unknown" })).toThrow();
  });

  it("accepts only bounded reverse-session frame shapes", () => {
    expect(workerSessionFrameSchema.parse({ kind: "connect", hello })).toMatchObject({ kind: "connect", hello: { workerId: hello.workerId } });
    expect(workerSessionFrameSchema.parse({ kind: "request", requestId: "req_1", request: { operation: "health" } })).toMatchObject({ kind: "request", requestId: "req_1" });
    expect(workerSessionFrameSchema.parse({ kind: "response", requestId: "req_1", result: { ok: true } })).toMatchObject({ kind: "response" });
    expect(workerSessionFrameSchema.parse({ kind: "error", requestId: "req_1", error: { code: "tool_denied", message: "denied", status: 403 } })).toMatchObject({ kind: "error" });
    expect(workerSessionFrameSchema.parse({ kind: "cancel", requestId: "req_1" })).toMatchObject({ kind: "cancel" });
    expect(() => workerSessionFrameSchema.parse({ kind: "request", requestId: "x".repeat(129), request: { operation: "health" } })).toThrow();
    expect(() => workerSessionFrameSchema.parse({ kind: "error", requestId: "req_1", error: { code: "x", message: "x".repeat(4097) } })).toThrow();
  });

  it("encodes and decodes bounded gRPC frame payloads", () => {
    const frame = { kind: "request", requestId: "req_1", request: { operation: "health" } } as const;
    expect(decodeWorkerSessionFrame(encodeWorkerSessionFrame(frame))).toEqual(frame);
    expect(() => decodeWorkerSessionFrame(Buffer.alloc(MAX_WORKER_SESSION_FRAME_BYTES + 1))).toThrow(/frame.*too large/i);
  });
});
