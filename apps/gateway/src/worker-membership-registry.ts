import { readFile } from "node:fs/promises";
import path from "node:path";
import { WorkerRegistry } from "./worker-registry.js";
import type { MembershipWorkerClientConfig } from "./worker-client.js";
import { WorkerMembershipStore, type WorkerMembershipRegistry } from "./worker-membership-store.js";
import { WorkerSessionRegistry } from "./worker-session-registry.js";
import { SessionRegistryWorkerTransport } from "./session-registry-worker-transport.js";

async function membershipClients(registry: WorkerMembershipRegistry, sessions?: WorkerSessionRegistry): Promise<MembershipWorkerClientConfig[]> {
  const clients: MembershipWorkerClientConfig[] = [];
  for (const worker of registry.workers) {
    const reference = worker.credentialRefs[0];
    if (!reference || reference.kind !== "secret-file") throw new Error(`Worker credential reference is unavailable: ${worker.workerId}`);
    const token = (await readFile(path.resolve(reference.path), "utf8")).trim();
    if (Buffer.byteLength(token) < 32) throw new Error(`Worker credential is invalid: ${worker.workerId}`);
    for (const transport of worker.transports) {
      const runtimeTransport = transport.type === "grpc"
        ? sessions ? new SessionRegistryWorkerTransport(sessions, worker.workerId) : (() => { throw new Error("Worker reverse session registry is required for gRPC membership"); })()
        : undefined;
      clients.push({ workerId: worker.workerId, environmentId: worker.environmentId, transport, token, ...(runtimeTransport ? { runtimeTransport } : {}) });
    }
  }
  return clients;
}

export class MembershipWorkerRegistry {
  private registry = new WorkerRegistry([]);
  private loading: Promise<void> | undefined;
  private seenMembershipRevision = -1;

  constructor(
    private readonly memberships: WorkerMembershipStore,
    private readonly sessions?: WorkerSessionRegistry,
  ) {}

  async initialize(): Promise<void> {
    await this.reload(true);
  }

  private async reload(force: boolean): Promise<void> {
    if (!force && this.seenMembershipRevision === this.memberships.revision) return;
    const current = await this.memberships.current();
    this.registry = new WorkerRegistry(await membershipClients(current, this.sessions));
    this.seenMembershipRevision = this.memberships.revision;
  }

  private async refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.reload(false).finally(() => { this.loading = undefined; });
    return this.loading;
  }

  async current(): Promise<WorkerRegistry> {
    try { await this.refresh(); } catch (error) { console.error("Worker membership reload rejected", error); }
    return this.registry;
  }
}
