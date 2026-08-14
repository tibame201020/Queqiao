import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
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
]);

export const workerCredentialReferenceSchema = z.object({
  kind: z.literal("secret-file"),
  path: z.string().min(1).max(4096),
});

export const workerMembershipSchema = z.object({
  workerId: workerIdSchema,
  environmentId: environmentIdSchema,
  transport: workerTransportDescriptorSchema,
  credentialRefs: z.array(workerCredentialReferenceSchema).min(1).max(2),
});

export const workerMembershipRegistrySchema = z.object({
  version: z.literal(1),
  workers: z.array(workerMembershipSchema),
}).superRefine((registry, ctx) => {
  const workerIds = new Set<string>();
  const environmentIds = new Set<string>();
  for (const [index, worker] of registry.workers.entries()) {
    if (workerIds.has(worker.workerId)) ctx.addIssue({ code: "custom", path: ["workers", index, "workerId"], message: "workerId must be unique" });
    if (environmentIds.has(worker.environmentId)) ctx.addIssue({ code: "custom", path: ["workers", index, "environmentId"], message: "environmentId must be unique within a Gateway cluster" });
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

  constructor(readonly directory: string, filename = "worker-memberships.json") {
    this.file = path.join(directory, filename);
  }

  async read(): Promise<WorkerMembershipRegistry> {
    try {
      return workerMembershipRegistrySchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_REGISTRY, workers: [] };
      throw error;
    }
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

  updateTransport(workerId: string, transport: WorkerTransportDescriptor): Promise<WorkerMembershipRegistry> {
    return this.serialize(async () => {
      const current = await this.read();
      let found = false;
      const workers = current.workers.map((worker) => {
        if (worker.workerId !== workerId) return worker;
        found = true;
        return workerMembershipSchema.parse({ ...worker, transport });
      });
      if (!found) throw new Error(`Worker membership not found: ${workerId}`);
      return this.writeValidated({ ...current, workers });
    });
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
