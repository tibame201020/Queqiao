import { randomUUID } from "node:crypto";
import { workerHelloV3Schema, type WorkerHelloV3 } from "@queqiao/worker-protocol";
import type { WorkerTransport } from "./worker-transport.js";

export type WorkerSessionAuthentication =
  | { kind: "membership" }
  | { kind: "provisional"; transactionId: string };

export type ActiveWorkerSession = {
  workerId: string;
  environmentId: string;
  instanceId: string;
  sessionId: string;
  authentication: WorkerSessionAuthentication;
  transport: WorkerTransport & { close?(reason?: Error): void };
};

export class WorkerSessionRegistry {
  private readonly byWorkerId = new Map<string, ActiveWorkerSession>();
  private readonly byEnvironmentId = new Map<string, ActiveWorkerSession>();
  private readonly bySessionId = new Map<string, ActiveWorkerSession>();
  private readonly changeListeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  attach(
    rawHello: WorkerHelloV3,
    transport: ActiveWorkerSession["transport"],
    authentication: WorkerSessionAuthentication,
  ): ActiveWorkerSession {
    const hello = workerHelloV3Schema.parse(rawHello);
    if (authentication.kind === "provisional" && (!authentication.transactionId || authentication.transactionId.length > 128)) {
      throw new Error("Provisional Worker session transaction id is invalid");
    }
    if (this.byWorkerId.has(hello.workerId)) throw new Error(`workerId is already active: ${hello.workerId}`);
    if (this.byEnvironmentId.has(hello.environmentId)) throw new Error(`environmentId is already active: ${hello.environmentId}`);

    const session: ActiveWorkerSession = {
      workerId: hello.workerId,
      environmentId: hello.environmentId,
      instanceId: hello.instanceId,
      sessionId: randomUUID(),
      authentication,
      transport,
    };
    this.byWorkerId.set(session.workerId, session);
    this.byEnvironmentId.set(session.environmentId, session);
    this.bySessionId.set(session.sessionId, session);
    this.notifyChange();
    return session;
  }

  require(workerId: string): ActiveWorkerSession {
    const session = this.byWorkerId.get(workerId);
    if (!session) throw new Error(`No active reverse Worker session for workerId: ${workerId}`);
    return session;
  }

  promote(workerId: string, transactionId: string): ActiveWorkerSession {
    const session = this.require(workerId);
    if (session.authentication.kind !== "provisional" || session.authentication.transactionId !== transactionId) {
      throw new Error(`Worker session is not bound to join transaction: ${transactionId}`);
    }
    session.authentication = { kind: "membership" };
    return session;
  }

  detachWorker(workerId: string, reason = new Error("Worker membership removed")): boolean {
    const session = this.byWorkerId.get(workerId);
    return session ? this.detach(session.sessionId, reason) : false;
  }

  detachProvisional(transactionId: string, reason = new Error("provisional Worker session revoked")): boolean {
    const session = [...this.bySessionId.values()].find((candidate) => candidate.authentication.kind === "provisional" && candidate.authentication.transactionId === transactionId);
    return session ? this.detach(session.sessionId, reason) : false;
  }

  detach(sessionId: string, reason = new Error("reverse Worker session closed")): boolean {
    const session = this.bySessionId.get(sessionId);
    if (!session) return false;
    this.bySessionId.delete(sessionId);
    this.byWorkerId.delete(session.workerId);
    this.byEnvironmentId.delete(session.environmentId);
    session.transport.close?.(reason);
    this.notifyChange();
    return true;
  }

  snapshot(): Array<{ workerId: string; environmentId: string; instanceId: string; sessionId: string }> {
    return [...this.byWorkerId.values()].map(({ workerId, environmentId, instanceId, sessionId }) => ({ workerId, environmentId, instanceId, sessionId }));
  }
}
