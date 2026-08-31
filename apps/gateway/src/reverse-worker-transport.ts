import { randomUUID } from "node:crypto";
import {
  workerSessionErrorFrameSchema,
  workerSessionResponseFrameSchema,
  type WorkerProtocolRequest,
  type WorkerSessionCancelFrame,
  type WorkerSessionErrorFrame,
  type WorkerSessionRequestFrame,
  type WorkerSessionResponseFrame,
} from "@queqiao/worker-protocol";
import { WorkerRemoteError } from "./errors.js";
import type { WorkerTransport, WorkerTransportRequest } from "./worker-transport.js";

export type ReverseWorkerOutboundFrame = WorkerSessionRequestFrame | WorkerSessionCancelFrame;

export type ReverseWorkerTransportConfig = {
  send(frame: ReverseWorkerOutboundFrame): void;
  close?(): void;
  maxPending?: number;
  requestTimeoutMs?: number;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  cleanup(): void;
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(typeof signal.reason === "string" ? signal.reason : "Worker request aborted");
}

export class ReverseWorkerTransport implements WorkerTransport {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly maxPending: number;
  private readonly requestTimeoutMs: number;
  private closedReason: Error | undefined;

  constructor(private readonly config: ReverseWorkerTransportConfig) {
    this.maxPending = config.maxPending ?? 32;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 125_000;
    if (!Number.isInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > 1024) throw new Error("Reverse Worker maxPending must be between 1 and 1024");
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 100 || this.requestTimeoutMs > 300_000) throw new Error("Reverse Worker requestTimeoutMs must be between 100 and 300000");
  }

  get pendingCount(): number { return this.pending.size; }

  execute<T>(request: WorkerTransportRequest, signal?: AbortSignal): Promise<T> {
    if (request.operation === "legacy-read-file") return Promise.reject(new Error("Legacy Worker HTTP read fallback is unavailable on reverse sessions"));
    if (this.closedReason) return Promise.reject(this.closedReason);
    if (this.pending.size >= this.maxPending) return Promise.reject(new Error("Reverse Worker session request capacity exceeded"));
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        try { this.config.send({ kind: "cancel", requestId }); } catch { /* transport is already failing */ }
        entry.reject(abortReason(signal!));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        try { this.config.send({ kind: "cancel", requestId }); } catch { /* transport is already failing */ }
        entry.reject(new Error(`Reverse Worker session request timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      timer.unref?.();
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(requestId);
      };
      const entry: PendingRequest = {
        resolve: (value) => { cleanup(); resolve(value as T); },
        reject: (reason) => { cleanup(); reject(reason); },
        cleanup,
      };
      this.pending.set(requestId, entry);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this.config.send({ kind: "request", requestId, request: request as WorkerProtocolRequest });
      } catch (error) {
        entry.reject(error);
      }
    });
  }

  receive(raw: unknown): void {
    let frame: WorkerSessionResponseFrame | WorkerSessionErrorFrame;
    const response = workerSessionResponseFrameSchema.safeParse(raw);
    if (response.success) frame = response.data;
    else {
      const remoteError = workerSessionErrorFrameSchema.safeParse(raw);
      if (!remoteError.success) throw new Error("Reverse Worker session received an invalid response frame");
      frame = remoteError.data;
    }

    const pending = this.pending.get(frame.requestId);
    if (!pending) throw new Error(`Reverse Worker session received unknown request id: ${frame.requestId}`);
    if (frame.kind === "response") {
      pending.resolve(frame.result);
      return;
    }
    pending.reject(new WorkerRemoteError(
      frame.error.status ?? 500,
      frame.error.code,
      frame.error.message,
      frame.error.retryable,
    ));
  }

  close(reason = new Error("Reverse Worker session closed")): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const pending of [...this.pending.values()]) pending.reject(this.closedReason);
    this.config.close?.();
  }
}
