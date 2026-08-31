import type { WorkerTransport, WorkerTransportRequest } from "./worker-transport.js";
import { WorkerSessionRegistry } from "./worker-session-registry.js";

export class SessionRegistryWorkerTransport implements WorkerTransport {
  constructor(
    private readonly sessions: WorkerSessionRegistry,
    private readonly workerId: string,
  ) {}

  revision(): string | undefined {
    try { return this.sessions.require(this.workerId).sessionId; }
    catch { return undefined; }
  }

  async execute<T>(request: WorkerTransportRequest, signal?: AbortSignal): Promise<T> {
    return this.sessions.require(this.workerId).transport.execute<T>(request, signal);
  }
}
