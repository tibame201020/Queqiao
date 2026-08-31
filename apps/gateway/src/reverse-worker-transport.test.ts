import { describe, expect, it, vi } from "vitest";
import type { WorkerSessionFrame } from "@queqiao/worker-protocol";
import { ReverseWorkerTransport } from "./reverse-worker-transport.js";

function requestFrames(frames: WorkerSessionFrame[]) {
  return frames.filter((frame): frame is Extract<WorkerSessionFrame, { kind: "request" }> => frame.kind === "request");
}

describe("reverse Worker session transport", () => {
  it("multiplexes responses by request id and maps remote errors", async () => {
    const sent: WorkerSessionFrame[] = [];
    const transport = new ReverseWorkerTransport({ send: (frame) => sent.push(frame), maxPending: 4, requestTimeoutMs: 1_000 });

    const first = transport.execute<{ ok: boolean }>({ operation: "health" });
    const second = transport.execute<{ value: number }>({ operation: "list-workspaces" });
    const requests = requestFrames(sent);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.requestId).not.toBe(requests[1]?.requestId);

    transport.receive({ kind: "response", requestId: requests[1]!.requestId, result: { value: 2 } });
    await expect(second).resolves.toEqual({ value: 2 });

    const firstExpectation = expect(first).rejects.toMatchObject({ code: "tool_denied", status: 403, layer: "worker" });
    transport.receive({ kind: "error", requestId: requests[0]!.requestId, error: { code: "tool_denied", message: "denied", status: 403 } });
    await firstExpectation;
    expect(transport.pendingCount).toBe(0);
  });

  it("propagates AbortSignal cancellation as a cancel frame", async () => {
    const sent: WorkerSessionFrame[] = [];
    const transport = new ReverseWorkerTransport({ send: (frame) => sent.push(frame), requestTimeoutMs: 1_000 });
    const controller = new AbortController();
    const pending = transport.execute({ operation: "health" }, controller.signal);
    const request = requestFrames(sent)[0]!;
    const expectation = expect(pending).rejects.toThrow("cancelled by test");

    controller.abort(new Error("cancelled by test"));

    await expectation;
    expect(sent).toContainEqual({ kind: "cancel", requestId: request.requestId });
    expect(transport.pendingCount).toBe(0);
  });

  it("bounds pending requests and rejects all pending work on disconnect", async () => {
    const sent: WorkerSessionFrame[] = [];
    const transport = new ReverseWorkerTransport({ send: (frame) => sent.push(frame), maxPending: 1, requestTimeoutMs: 1_000 });
    const first = transport.execute({ operation: "health" });
    const firstExpectation = expect(first).rejects.toThrow("session disconnected");

    await expect(transport.execute({ operation: "hello" })).rejects.toThrow(/capacity/i);
    transport.close(new Error("session disconnected"));

    await firstExpectation;
    expect(transport.pendingCount).toBe(0);
  });

  it("closes the underlying stream when the runtime session is revoked", () => {
    const closeStream = vi.fn();
    const transport = new ReverseWorkerTransport({ send: () => undefined, close: closeStream, requestTimeoutMs: 1_000 });
    transport.close(new Error("revoked"));
    transport.close(new Error("duplicate close"));
    expect(closeStream).toHaveBeenCalledTimes(1);
  });

  it("fails closed on unknown or duplicate response ids", async () => {
    const sent: WorkerSessionFrame[] = [];
    const transport = new ReverseWorkerTransport({ send: (frame) => sent.push(frame), requestTimeoutMs: 1_000 });
    const pending = transport.execute({ operation: "health" });
    const request = requestFrames(sent)[0]!;
    transport.receive({ kind: "response", requestId: request.requestId, result: { ok: true } });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(() => transport.receive({ kind: "response", requestId: request.requestId, result: { ok: true } })).toThrow(/unknown request id/i);
  });
});
