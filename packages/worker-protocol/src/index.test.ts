import { describe, expect, it } from "vitest";
import {
  QUEQIAO_WORKER_CAPABILITIES,
  QUEQIAO_WORKER_HTTP_API_PREFIX,
  QUEQIAO_WORKER_PROTOCOL_VERSION,
  workerAsyncProcessResultSchema,
  workerHelloSchema,
  workerRunResultSchema,
  workerShellResultSchema,
  workerSyncProcessResultSchema,
} from "./index.js";

describe("Worker protocol contract", () => {
  it("owns Worker protocol 2.0 while preserving the existing HTTP route family", () => {
    expect(QUEQIAO_WORKER_PROTOCOL_VERSION).toBe("2.0");
    expect(QUEQIAO_WORKER_HTTP_API_PREFIX).toBe("/v1");
    expect(QUEQIAO_WORKER_CAPABILITIES).toContain("async-process-v1");
  });

  it("accepts the current hello and rejects Worker protocol 1.0", () => {
    const hello = {
      protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION,
      environmentId: "windows",
      instanceId: "11111111-1111-4111-8111-111111111111",
      platform: "windows",
      capabilities: [...QUEQIAO_WORKER_CAPABILITIES],
    };
    expect(workerHelloSchema.parse(hello).protocolVersion).toBe(QUEQIAO_WORKER_PROTOCOL_VERSION);
    expect(workerHelloSchema.safeParse({ ...hello, protocolVersion: "1.0" }).success).toBe(false);
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
