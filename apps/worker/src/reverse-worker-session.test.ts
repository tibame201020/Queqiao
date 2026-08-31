import { describe, expect, it, vi } from "vitest";
import type { WorkerProtocolRequest, WorkerSessionFrame } from "@queqiao/worker-protocol";
import { ReverseWorkerSession } from "./reverse-worker-session.js";

const hello = {
  protocolVersion: "3.0" as const,
  workerId: "11111111-1111-4111-8111-111111111111",
  environmentId: "linux",
  instanceId: "22222222-2222-4222-8222-222222222222",
  platform: "linux" as const,
  capabilities: [],
};

function service(execute: (request: WorkerProtocolRequest, signal?: AbortSignal) => Promise<unknown>) {
  return { execute: vi.fn(execute) };
}

describe("Worker reverse session", () => {
  it("opens with an authenticated stable Worker hello and dispatches protocol requests", async () => {
    const sent: WorkerSessionFrame[] = [];
    const runtime = service(async (request) => request.operation === "hello" ? hello : { ok: true });
    const session = new ReverseWorkerSession({ service: runtime, send: (frame) => sent.push(frame) });

    await session.open();
    expect(sent[0]).toEqual({ kind: "connect", hello });

    await session.receive({ kind: "request", requestId: "req-1", request: { operation: "health" } });
    expect(sent[1]).toEqual({ kind: "response", requestId: "req-1", result: { ok: true } });
  });

  it("propagates cancel frames into the request AbortSignal", async () => {
    const sent: WorkerSessionFrame[] = [];
    let observed: AbortSignal | undefined;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const runtime = service(async (request, signal) => {
      if (request.operation === "hello") return hello;
      observed = signal;
      await blocked;
      if (signal?.aborted) throw signal.reason;
      return { ok: true };
    });
    const session = new ReverseWorkerSession({ service: runtime, send: (frame) => sent.push(frame) });
    await session.open();

    const pending = session.receive({ kind: "request", requestId: "req-2", request: { operation: "health" } });
    await vi.waitFor(() => expect(observed).toBeDefined());
    await session.receive({ kind: "cancel", requestId: "req-2" });
    expect(observed?.aborted).toBe(true);
    release();
    await pending;
    expect(sent.some((frame) => frame.kind === "response" && frame.requestId === "req-2")).toBe(false);
  });

  it("fails closed on duplicate request ids and bounds in-flight work", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const runtime = service(async (request) => request.operation === "hello" ? hello : blocked.then(() => ({ ok: true })));
    const session = new ReverseWorkerSession({ service: runtime, send: () => {}, maxInFlight: 1 });
    await session.open();

    const first = session.receive({ kind: "request", requestId: "req-3", request: { operation: "health" } });
    await expect(session.receive({ kind: "request", requestId: "req-3", request: { operation: "health" } })).rejects.toThrow(/request id.*already active/i);
    await expect(session.receive({ kind: "request", requestId: "req-4", request: { operation: "health" } })).rejects.toThrow(/capacity/i);
    release();
    await first;
  });

  it("rejects legacy Worker hello for reverse remote sessions", async () => {
    const runtime = service(async (request) => request.operation === "hello" ? ({ ...hello, protocolVersion: "2.0", workerId: undefined } as never) : { ok: true });
    const session = new ReverseWorkerSession({ service: runtime, send: () => {} });
    await expect(session.open()).rejects.toThrow(/Protocol 3.0/i);
  });
});
