import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { environmentIdSchema, workerIdSchema } from "@queqiao/contracts";
import { secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";

export const workerTransportDescriptorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    endpoint: z.url().superRefine((value, ctx) => {
      const url = new URL(value);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
        ctx.addIssue({ code: "custom", message: "HTTP Worker transport must remain loopback-only in Security Baseline v2" });
      }
      if (url.username || url.password) ctx.addIssue({ code: "custom", message: "Worker transport endpoint must not contain credentials" });
    }),
  }),
  z.object({
    type: z.literal("grpc"),
    mode: z.literal("reverse"),
  }),
]);

export function gatewayVisibleTransportKey(transport: WorkerTransportDescriptor): string | undefined {
  if (transport.type !== "http") return undefined;
  const url = new URL(transport.endpoint);
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  const port = url.port || "80";
  return `${url.protocol}//${host}:${port}`;
}

export const workerCredentialReferenceSchema = z.object({
  kind: z.literal("secret-file"),
  path: z.string().min(1).max(4096),
});

export const workerMembershipSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const candidate = raw as Record<string, unknown>;
  if (Array.isArray(candidate.transports)) return candidate;
  if (candidate.transport) {
    const { transport, ...rest } = candidate;
    return { ...rest, transports: [transport] };
  }
  return candidate;
}, z.object({
  workerId: workerIdSchema,
  environmentId: environmentIdSchema,
  transports: z.array(workerTransportDescriptorSchema).min(1).max(8),
  credentialRefs: z.array(workerCredentialReferenceSchema).min(1).max(2),
}).superRefine((worker, ctx) => {
  const types = new Set<string>();
  for (const [index, transport] of worker.transports.entries()) {
    if (types.has(transport.type)) ctx.addIssue({ code: "custom", path: ["transports", index, "type"], message: "Worker transport type must be unique within a membership" });
    types.add(transport.type);
  }
}));

export const workerMembershipRegistrySchema = z.object({
  version: z.literal(1),
  workers: z.array(workerMembershipSchema),
}).superRefine((registry, ctx) => {
  const workerIds = new Set<string>();
  const environmentIds = new Set<string>();
  const transportKeys = new Set<string>();
  for (const [index, worker] of registry.workers.entries()) {
    if (workerIds.has(worker.workerId)) ctx.addIssue({ code: "custom", path: ["workers", index, "workerId"], message: "workerId must be unique" });
    if (environmentIds.has(worker.environmentId)) ctx.addIssue({ code: "custom", path: ["workers", index, "environmentId"], message: "environmentId must be unique within a Gateway" });
    for (const [transportIndex, transport] of worker.transports.entries()) {
      const transportKey = gatewayVisibleTransportKey(transport);
      if (transportKey && transportKeys.has(transportKey)) ctx.addIssue({ code: "custom", path: ["workers", index, "transports", transportIndex], message: "Gateway-visible Worker transport endpoint must be unique within a Gateway" });
      if (transportKey) transportKeys.add(transportKey);
    }
    workerIds.add(worker.workerId);
    environmentIds.add(worker.environmentId);
  }
});

export type WorkerMembership = z.infer<typeof workerMembershipSchema>;
export type WorkerMembershipRegistry = z.infer<typeof workerMembershipRegistrySchema>;
export type WorkerTransportDescriptor = z.infer<typeof workerTransportDescriptorSchema>;

const EMPTY_REGISTRY: WorkerMembershipRegistry = { version: 1, workers: [] };

export class WorkerMembershipStore {
  readonly file: string;
  private mutationTail: Promise<void> = Promise.resolve();
  private cached: WorkerMembershipRegistry | undefined;
  private revisionValue = 0;

  constructor(readonly directory: string, filename = "worker-memberships.json") {
    this.file = path.join(directory, filename);
  }

  get revision(): number { return this.revisionValue; }

  async exists(): Promise<boolean> {
    try { await stat(this.file); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }

  async read(): Promise<WorkerMembershipRegistry> {
    try {
      return workerMembershipRegistrySchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_REGISTRY, workers: [] };
      throw error;
    }
  }

  async current(): Promise<WorkerMembershipRegistry> {
    this.cached ??= await this.read();
    return this.cached;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async writeValidated(value: WorkerMembershipRegistry): Promise<WorkerMembershipRegistry> {
    const validated = workerMembershipRegistrySchema.parse(value);
    await secureRuntimeDirectory(this.directory);
    const temporary = path.join(this.directory, `.worker-memberships-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await secureRuntimeFile(temporary);
      await rename(temporary, this.file);
      await secureRuntimeFile(this.file);
      if (process.platform !== "win32") {
        const directoryHandle = await open(this.directory, "r");
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      }
      this.cached = validated;
      this.revisionValue += 1;
      return validated;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  replace(value: WorkerMembershipRegistry): Promise<WorkerMembershipRegistry> {
    return this.serialize(() => this.writeValidated(value));
  }

  add(worker: WorkerMembership): Promise<WorkerMembershipRegistry> {
    return this.serialize(async () => {
      const current = await this.read();
      return this.writeValidated({ ...current, workers: [...current.workers, workerMembershipSchema.parse(worker)] });
    });
  }

  updateTransports(workerId: string, transports: WorkerTransportDescriptor[]): Promise<WorkerMembershipRegistry> {
    return this.serialize(async () => {
      const current = await this.read();
      let found = false;
      const workers = current.workers.map((worker) => {
        if (worker.workerId !== workerId) return worker;
        found = true;
        return workerMembershipSchema.parse({ ...worker, transports });
      });
      if (!found) throw new Error(`Worker membership not found: ${workerId}`);
      return this.writeValidated({ ...current, workers });
    });
  }

  updateTransport(workerId: string, transport: WorkerTransportDescriptor): Promise<WorkerMembershipRegistry> {
    return this.updateTransports(workerId, [transport]);
  }

  remove(workerId: string): Promise<WorkerMembershipRegistry> {
    return this.serialize(async () => {
      const current = await this.read();
      const workers = current.workers.filter((worker) => worker.workerId !== workerId);
      if (workers.length === current.workers.length) throw new Error(`Worker membership not found: ${workerId}`);
      return this.writeValidated({ ...current, workers });
    });
  }
}
