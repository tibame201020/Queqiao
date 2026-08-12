import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WorkerRegistry } from "./worker-registry.js";
import type { WorkerEndpointConfig } from "./config.js";

export const workerEndpointSchema = z.object({
  environmentId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  }, "Worker URL must be loopback HTTP in the verified baseline"),
  token: z.string().min(32).optional(),
  tokenFile: z.string().min(1).optional(),
}).refine((entry) => Boolean(entry.token) !== Boolean(entry.tokenFile), "Configure exactly one Worker token source");
const workerFileSchema = z.array(workerEndpointSchema).min(1);

export class ReloadableWorkerRegistry {
  private registry: WorkerRegistry;
  private loadedMtimeMs = -1;
  private loading: Promise<void> | undefined;

  constructor(private readonly source: { file: string } | { workers: readonly WorkerEndpointConfig[] }) {
    this.registry = new WorkerRegistry("workers" in source ? source.workers : []);
  }

  async initialize(): Promise<void> { await this.reload(true); }
  async refresh(): Promise<void> { if ("file" in this.source) await this.reload(false); }

  private async reload(force: boolean): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.doReload(force).finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async doReload(force: boolean): Promise<void> {
    let endpoints: readonly WorkerEndpointConfig[];
    let mtimeMs = this.loadedMtimeMs;
    if ("file" in this.source) {
      const info = await stat(this.source.file);
      if (!force && info.mtimeMs === this.loadedMtimeMs) return;
      mtimeMs = info.mtimeMs;
      endpoints = await Promise.all(workerFileSchema.parse(JSON.parse(await readFile(this.source.file, "utf8"))).map(async (entry) => ({ environmentId: entry.environmentId, url: new URL(entry.url), token: entry.token || (await readFile(path.resolve(entry.tokenFile!), "utf8")).trim() })));
    } else {
      if (!force) return;
      endpoints = this.source.workers;
    }
    if (new Set(endpoints.map((entry) => entry.environmentId)).size !== endpoints.length) throw new Error("Worker environment IDs must be unique");
    this.registry = new WorkerRegistry(endpoints);
    this.loadedMtimeMs = mtimeMs;
  }

  async current(): Promise<WorkerRegistry> {
    try { await this.refresh(); } catch (error) { console.error("Worker registry reload rejected", error); }
    return this.registry;
  }
}
