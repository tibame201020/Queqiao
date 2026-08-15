import { describe, expect, it } from "vitest";
import {
  QUEQIAO_WORKER_HTTP_API_PREFIX,
  QUEQIAO_WORKER_LEGACY_CAPABILITIES,
  QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION,
  QUEQIAO_WORKER_PROTOCOL_VERSION,
  workerAsyncProcessResultSchema,
  workerHelloSchema,
  workerHelloV3Schema,
  workerRunResultSchema,
  workerShellResultSchema,
  workerSyncProcessResultSchema,
} from "./index.js";

describe("Worker protocol contract", () => {
  it("owns Worker protocol 3.0 while preserving the existing HTTP route family and legacy 2.0 parser", () => {
    expect(QUEQIAO_WORKER_PROTOCOL_VERSION).toBe("3.0");
    expect(QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION).toBe("2.0");
    expect(QUEQIAO_WORKER_HTTP_API_PREFIX).toBe("/v1");
    expect(QUEQIAO_WORKER_LEGACY_CAPABILITIES).toContain("async-process-v1");
  });

  it("requires stable worker identity in 3.0 and keeps capabilities optional", () => {
    const hello = {
      protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION,
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "windows",
      instanceId: "22222222-2222-4222-8222-222222222222",
      platform: "windows",
      capabilities: [],
    };
    expect(workerHelloV3Schema.parse(hello).workerId).toBe(hello.workerId);
    expect(workerHelloSchema.parse(hello).protocolVersion).toBe(QUEQIAO_WORKER_PROTOCOL_VERSION);
    expect(workerHelloSchema.safeParse({ ...hello, workerId: undefined }).success).toBe(false);
    expect(workerHelloSchema.safeParse({ ...hello, protocolVersion: "1.0" }).success).toBe(false);
  });

  it("accepts legacy 2.0 hello during the rolling-upgrade compatibility window", () => {
    expect(workerHelloSchema.parse({
      protocolVersion: QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION,
      environmentId: "windows",
      instanceId: "11111111-1111-4111-8111-111111111111",
      platform: "windows",
      capabilities: [...QUEQIAO_WORKER_LEGACY_CAPABILITIES],
    }).protocolVersion).toBe(QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION);
  });

  it("defines distinct sync/async process result contracts without adding a Queqiao job identity", () => {
    const sync = { exitCode: 0, signal: null, stdout: "ok", stderr: "", durationMs: 10, timedOut: false, aborted: false, outputLimitExceeded: false };
    const asyncResult = { pid: 123, startedAt: "2026-08-13T01:00:00.000Z", timeoutMs: 30_000, stdout: "discarded", stderr: "discarded" };
    expect(workerSyncProcessResultSchema.parse(sync)).toEqual(sync);
    expect(workerAsyncProcessResultSchema.parse(asyncResult)).toEqual(asyncResult);
    expect(workerRunResultSchema.parse(asyncResult)).toEqual(asyncResult);
    expect(workerShellResultSchema.parse({ shell: "bash", ...asyncResult })).toMatchObject({ shell: "bash", pid: 123 });
    expect(JSON.stringify(asyncResult)).not.toMatch(/job|executionId|sessionId/i);
  });
});
