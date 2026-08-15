import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import { WorkerRegistry } from "./worker-registry.js";
import type { WorkerEndpointConfig } from "./config.js";
import type { MembershipWorkerClientConfig } from "./worker-client.js";
import { WorkerMembershipStore, type WorkerMembershipRegistry } from "./worker-membership-store.js";

export const workerEndpointSchema = z.object({
  environmentId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  }, "Worker URL must be loopback HTTP in the verified baseline"),
  token: z.string().min(32).optional(),
  tokenFile: z.string().min(1).optional(),
}).refine((entry) => Boolean(entry.token) !== Boolean(entry.tokenFile), "Configure exactly one Worker token source");
const workerFileSchema = z.array(workerEndpointSchema);

type LegacyWorkerSource = { file: string } | { workers: readonly WorkerEndpointConfig[] };
type WorkerRegistrySource = LegacyWorkerSource | { memberships: WorkerMembershipStore; legacy?: LegacyWorkerSource };

async function membershipClients(registry: WorkerMembershipRegistry): Promise<MembershipWorkerClientConfig[]> {
  return Promise.all(registry.workers.map(async (worker) => {
    const reference = worker.credentialRefs[0];
    if (!reference || reference.kind !== "secret-file") throw new Error(`Worker credential reference is unavailable: ${worker.workerId}`);
    const token = (await readFile(path.resolve(reference.path), "utf8")).trim();
    if (Buffer.byteLength(token) < 32) throw new Error(`Worker credential is invalid: ${worker.workerId}`);
    return {
      workerId: worker.workerId,
      environmentId: worker.environmentId,
      transport: worker.transport,
      token,
    };
  }));
}

export class ReloadableWorkerRegistry {
  private registry = new WorkerRegistry([]);
  private loadedMtimeMs = -1;
  private loading: Promise<void> | undefined;
  private membershipAuthoritative = false;
  private seenMembershipRevision = -1;

  constructor(private readonly source: WorkerRegistrySource) {}

  async initialize(): Promise<void> {
    if ("memberships" in this.source) {
      this.membershipAuthoritative = await this.source.memberships.exists();
      if (this.membershipAuthoritative) {
        await this.reloadMembership(true);
        return;
      }
      if (!this.source.legacy) return;
      await this.reloadLegacy(this.source.legacy, true);
      return;
    }
    await this.reloadLegacy(this.source, true);
  }

  private async reloadMembership(force: boolean): Promise<void> {
    if (!("memberships" in this.source)) return;
    if (!force && this.seenMembershipRevision === this.source.memberships.revision) return;
    const memberships = await this.source.memberships.current();
    this.registry = new WorkerRegistry(await membershipClients(memberships));
    this.seenMembershipRevision = this.source.memberships.revision;
  }

  private async reloadLegacy(source: LegacyWorkerSource, force: boolean): Promise<void> {
    let endpoints: readonly WorkerEndpointConfig[];
    let mtimeMs = this.loadedMtimeMs;
    if ("file" in source) {
      const info = await stat(source.file);
      if (!force && info.mtimeMs === this.loadedMtimeMs) return;
      mtimeMs = info.mtimeMs;
      const document = parse(await readFile(source.file, "utf8")) as { environments?: unknown };
      endpoints = await Promise.all(workerFileSchema.parse(document.environments ?? []).map(async (entry) => ({ environmentId: entry.environmentId, url: new URL(entry.url), token: entry.token || (await readFile(path.resolve(entry.tokenFile!), "utf8")).trim() })));
    } else {
      if (!force) return;
      endpoints = source.workers;
    }
    if (new Set(endpoints.map((entry) => entry.environmentId)).size !== endpoints.length) throw new Error("Worker environment IDs must be unique");
    this.registry = new WorkerRegistry(endpoints);
    this.loadedMtimeMs = mtimeMs;
  }

  private async refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.doRefresh().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async doRefresh(): Promise<void> {
    if ("memberships" in this.source) {
      if (!this.membershipAuthoritative && await this.source.memberships.exists()) {
        this.membershipAuthoritative = true;
        await this.reloadMembership(true);
        return;
      }
      if (this.membershipAuthoritative) {
        await this.reloadMembership(false);
        return;
      }
      if (this.source.legacy) await this.reloadLegacy(this.source.legacy, false);
      return;
    }
    await this.reloadLegacy(this.source, false);
  }

  async current(): Promise<WorkerRegistry> {
    try { await this.refresh(); } catch (error) { console.error("Worker registry reload rejected", error); }
    return this.registry;
  }

  isMembershipAuthoritative(): boolean { return this.membershipAuthoritative; }
}
