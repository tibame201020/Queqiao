import {
  workerHelloV3Schema,
  workerSessionCancelFrameSchema,
  workerSessionRequestFrameSchema,
  type WorkerSessionFrame,
} from "@queqiao/worker-protocol";
import { ProcessCapacityError } from "@queqiao/process-runtime";
import { WorkerToolError } from "./core-tools.js";
import type { WorkerProtocolService } from "./worker-protocol-service.js";

export type ReverseWorkerSessionConfig = {
  service: WorkerProtocolService;
  send(frame: WorkerSessionFrame): void;
  maxInFlight?: number;
};

type InFlightRequest = {
  controller: AbortController;
  cancelled: boolean;
};

function errorFrame(requestId: string, error: unknown): WorkerSessionFrame {
  if (error instanceof WorkerToolError) {
    return { kind: "error", requestId, error: { code: error.code, message: error.message, status: error.status, retryable: error.status === 429 || error.status >= 500 } };
  }
  if (error instanceof ProcessCapacityError) {
    return { kind: "error", requestId, error: { code: "process_capacity", message: error.message, status: 429, retryable: true } };
  }
  return {
    kind: "error",
    requestId,
    error: {
      code: "tool_error",
      message: error instanceof Error ? error.message : "Unknown Worker error",
      status: 400,
      retryable: false,
    },
  };
}

export class ReverseWorkerSession {
  private readonly inFlight = new Map<string, InFlightRequest>();
  private readonly maxInFlight: number;
  private opened = false;
  private closed = false;

  constructor(private readonly config: ReverseWorkerSessionConfig) {
    this.maxInFlight = config.maxInFlight ?? 32;
    if (!Number.isInteger(this.maxInFlight) || this.maxInFlight < 1 || this.maxInFlight > 1024) {
      throw new Error("Reverse Worker maxInFlight must be between 1 and 1024");
    }
  }

  get inFlightCount(): number { return this.inFlight.size; }

  async open(): Promise<void> {
    if (this.closed) throw new Error("Reverse Worker session is closed");
    if (this.opened) throw new Error("Reverse Worker session is already open");
    const rawHello = await this.config.service.execute({ operation: "hello" });
    const parsed = workerHelloV3Schema.safeParse(rawHello);
    if (!parsed.success) throw new Error("Reverse Worker sessions require Worker Protocol 3.0 with a stable workerId");
    this.config.send({ kind: "connect", hello: parsed.data });
    this.opened = true;
  }

  async receive(raw: unknown): Promise<void> {
    if (!this.opened || this.closed) throw new Error("Reverse Worker session is not active");

    const cancel = workerSessionCancelFrameSchema.safeParse(raw);
    if (cancel.success) {
      const active = this.inFlight.get(cancel.data.requestId);
      if (!active) throw new Error(`Reverse Worker session received cancel for unknown request id: ${cancel.data.requestId}`);
      active.cancelled = true;
      active.controller.abort(new Error("Gateway cancelled Worker request"));
      return;
    }

    const request = workerSessionRequestFrameSchema.safeParse(raw);
    if (!request.success) throw new Error("Reverse Worker session received an invalid request frame");
    if (this.inFlight.has(request.data.requestId)) throw new Error(`Reverse Worker request id is already active: ${request.data.requestId}`);
    if (this.inFlight.size >= this.maxInFlight) throw new Error("Reverse Worker session request capacity exceeded");

    const active: InFlightRequest = { controller: new AbortController(), cancelled: false };
    this.inFlight.set(request.data.requestId, active);
    try {
      let result: unknown;
      try {
        result = await this.config.service.execute(request.data.request, active.controller.signal);
      } catch (error) {
        if (!active.cancelled && !this.closed) this.config.send(errorFrame(request.data.requestId, error));
        return;
      }
      if (!active.cancelled && !this.closed) this.config.send({ kind: "response", requestId: request.data.requestId, result });
    } finally {
      this.inFlight.delete(request.data.requestId);
    }
  }

  close(reason = new Error("Reverse Worker session closed")): void {
    if (this.closed) return;
    this.closed = true;
    for (const active of this.inFlight.values()) {
      active.cancelled = true;
      active.controller.abort(reason);
    }
  }
}
