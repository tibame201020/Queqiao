import { createHmac, randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";
import type { GitHubActionsRuntimeCoordinator } from "@queqiao/runtime-provider-github-actions";
import type { MembershipWorkerRegistry } from "./worker-membership-registry.js";

const taskIdSchema = z.literal("gateway-vitest");
const sourceRevisionSchema = z.string().regex(/^[0-9a-f]{40}$/);
const idempotencySchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const taskStateSchema = z.enum(["queued", "provisioning", "ready", "running", "cancelling", "completed", "failed", "cancelled"]);
const routingSchema = z.object({
  environmentId: z.string().min(1),
  selectedTransport: z.string().min(1),
}).passthrough();
const recordSchema = z.object({
  id: z.string().uuid(),
  taskId: taskIdSchema,
  ownerDigest: digestSchema,
  idempotencyDigest: digestSchema,
  sourceRevision: sourceRevisionSchema,
  state: taskStateSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  leaseId: z.string().uuid().optional(),
  environmentId: z.string().min(1).optional(),
  runId: z.string().regex(/^\d+$/).optional(),
  exitCode: z.number().int().nullable().optional(),
  stdout: z.string().max(8192).optional(),
  stderr: z.string().max(8192).optional(),
  routing: routingSchema.optional(),
  failureReason: z.enum(["dispatch_failed", "execution_failed", "gateway_restart", "cancel_failed"]).optional(),
});
const snapshotSchema = z.object({ version: z.literal(1), ownerKeyProof: digestSchema.optional(), tasks: z.array(recordSchema).max(256) });
export type ShortTaskRecord = z.infer<typeof recordSchema>;
export type PublicShortTaskRecord = Omit<ShortTaskRecord, "ownerDigest" | "idempotencyDigest">;
type ShortTaskState = z.infer<typeof taskStateSchema>;

const TASK = Object.freeze({
  id: "gateway-vitest" as const, workspaceId: "runtime",
  executable: "node",
  args: Object.freeze(["node_modules/vitest/vitest.mjs", "run", "apps/gateway/src/actions-mcp-poc.test.ts", "--maxWorkers=2"]),
  cwd: ".", mode: "sync" as const, timeoutMs: 45000, ttlSeconds: 180,
});
const ACTIVE = new Set<ShortTaskState>(["queued", "provisioning", "ready", "running", "cancelling"]);

type RuntimePort = Pick<GitHubActionsRuntimeCoordinator, "provision" | "get" | "complete" | "fail">;
type WorkerPort = Pick<MembershipWorkerRegistry, "current">;

/**
 * Single-process, atomic-snapshot task history. The lock belongs in ShortTaskService.
 * No OAuth client ID, idempotency key or secret is serialized.
 */
export class ShortTaskJournal {
  constructor(readonly file: string) {}
  async load(expectedOwnerKeyProof?: string): Promise<ShortTaskRecord[]> {
    try {
      const snapshot = snapshotSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
      if (expectedOwnerKeyProof && snapshot.tasks.length > 0) {
        if (!snapshot.ownerKeyProof) throw new Error("Legacy task journal is unbound to an owner key; explicit migration required");
        if (snapshot.ownerKeyProof !== expectedOwnerKeyProof) throw new Error("Task journal owner key mismatch");
      }
      return snapshot.tasks;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error; // fail closed on corrupt/truncated data
    }
  }
  async save(tasks: readonly ShortTaskRecord[], ownerKeyProof?: string): Promise<void> {
    const serialized = JSON.stringify(snapshotSchema.parse({ version: 1, tasks, ...(ownerKeyProof ? { ownerKeyProof } : {}) })) + "\n";
    const dir = path.dirname(this.file);
    await secureRuntimeDirectory(dir);
    const temp = path.join(dir, `.short-task-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await secureRuntimeFile(temp);
      await rename(temp, this.file);
      await secureRuntimeFile(this.file);
      if (process.platform !== "win32") {
        const directory = await open(dir, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
}

/** Internal task lifecycle only; intentionally NOT registered as a production MCP tool. */
export class ShortTaskService {
  private tasks = new Map<string, ShortTaskRecord>();
  private serialized: Promise<void> = Promise.resolve();
  private readonly runControllers = new Map<string, AbortController>();
  private readonly cancellations = new Map<string, Promise<PublicShortTaskRecord>>();
  private readonly journal: ShortTaskJournal;
  private readonly coordinator: RuntimePort;
  private readonly workers: WorkerPort;
  private readonly ownerSecret: string;
  private readonly ownerKeyProof: string;
  private readonly revision: string;

  constructor(options: { journal: ShortTaskJournal; coordinator: RuntimePort; workers: WorkerPort; ownerSecret: string; sourceRevision: string }) {
    this.journal = options.journal;
    this.coordinator = options.coordinator;
    this.workers = options.workers;
    this.ownerSecret = z.string().min(32).parse(options.ownerSecret);
    this.ownerKeyProof = createHmac("sha256", this.ownerSecret).update("queqiao-task-owner-journal-v1").digest("hex");
    this.revision = sourceRevisionSchema.parse(options.sourceRevision);
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serialized.then(operation);
    this.serialized = result.then(() => undefined, () => undefined);
    return result;
  }

  async restore(): Promise<void> {
    await this.transaction(async () => {
      const tasks = await this.journal.load(this.ownerKeyProof);
      if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Duplicate persisted task ID");
      this.tasks = new Map(tasks.map((task) => [task.id, task]));
    });
  }

  /**
   * Call ONLY after the GitHubActionsRuntimeCoordinator.recoverPending() has
   * cancelled its orphan leases. Never silently re-dispatch incomplete tasks.
   */
  async reconcileAfterRuntimeRecovery(): Promise<void> {
    await this.transaction(async () => {
      const remaining = [...this.tasks.values()].filter((record) => ACTIVE.has(record.state));
      if (!remaining.length) return;
      const now = new Date().toISOString();
      for (const record of remaining) {
        this.tasks.set(record.id, { ...record, state: "failed", updatedAt: now, failureReason: "gateway_restart" });
      }
      await this.save();
    });
  }

  private digest(namespace: string, input: string): string {
    if (!input) throw new Error("Authenticated OAuth client required");
    return createHmac("sha256", this.ownerSecret).update(namespace).update("\0").update(input).digest("hex");
  }
  private owner(clientId: string): string { return this.digest("oauth-owner-v1", clientId); }
  private idem(ownerDigest: string, key: string): string {
    return this.digest("short-task-idempotency-v1", ownerDigest + "\0" + idempotencySchema.parse(key));
  }
  private async save(): Promise<void> { await this.journal.save([...this.tasks.values()], this.ownerKeyProof); }
  private publicResult(record: ShortTaskRecord): PublicShortTaskRecord {
    const { ownerDigest: _ownerDigest, idempotencyDigest: _idempotencyDigest, ...publicTask } = record;
    return structuredClone(publicTask);
  }

  private requireOwner(clientId: string, taskId: string): ShortTaskRecord {
    const record = this.tasks.get(z.string().uuid().parse(taskId));
    if (!record || record.ownerDigest !== this.owner(clientId)) throw new Error("Task not found");
    return record;
  }

  async status(clientId: string, id: string): Promise<PublicShortTaskRecord> {
    return this.transaction(async () => {
      let task = this.requireOwner(clientId, id);
      if (task.state === "provisioning" && task.leaseId && this.coordinator.get(task.leaseId)?.state === "ready") {
        task = { ...task, state: "ready", updatedAt: new Date().toISOString() };
        this.tasks.set(task.id, task);
        await this.save();
      }
      return this.publicResult(task);
    });
  }

  async submit(clientId: string, input: { taskId: string; idempotencyKey: string }): Promise<PublicShortTaskRecord> {
    return this.transaction(async () => {
      const ownerDigest = this.owner(clientId);
      const idempotencyDigest = this.idem(ownerDigest, input.idempotencyKey);
      const existing = [...this.tasks.values()].find((task) => task.ownerDigest === ownerDigest && task.idempotencyDigest === idempotencyDigest);
      if (existing) {
        if (existing.taskId !== input.taskId) throw new Error("Idempotency conflict");
        return this.publicResult(existing);
      }
      if (!taskIdSchema.safeParse(input.taskId).success) throw new Error("Unknown task catalog entry");
      if ([...this.tasks.values()].some((task) => task.ownerDigest === ownerDigest && ACTIVE.has(task.state))) throw new Error("Owner active task quota exceeded");
      if ([...this.tasks.values()].filter((task) => ACTIVE.has(task.state)).length >= 16) throw new Error("Global active task quota exceeded");
      if (this.tasks.size >= 256) throw new Error("Persistent task history capacity exceeded");
      const now = new Date().toISOString();
      const task: ShortTaskRecord = { id: randomUUID(), taskId: TASK.id, ownerDigest, idempotencyDigest,
        sourceRevision: this.revision, state: "queued", createdAt: now, updatedAt: now };
      this.tasks.set(task.id, task);
      // Write-ahead reservation ensures replay and quota survive a crashed dispatch.
      try { await this.save(); } catch (error) { this.tasks.delete(task.id); throw error; }
      try {
        const lease = await this.coordinator.provision({ ttlSeconds: TASK.ttlSeconds,
          metadata: { purpose: "short-task", taskId: task.id, sourceRevision: this.revision } });
        const environmentId = lease.providerMetadata?.["environmentId"];
        const runId = lease.providerMetadata?.["runId"];
        if (!environmentId || !runId) {
          await this.coordinator.fail(lease.leaseId, "Short-task runtime identity missing");
          throw new Error("Provider omitted runtime identity");
        }
        const updated: ShortTaskRecord = { ...task, state: "provisioning", updatedAt: new Date().toISOString(),
          leaseId: lease.leaseId, environmentId, runId };
        this.tasks.set(task.id, updated);
        try { await this.save(); } catch (error) {
          await this.coordinator.fail(lease.leaseId, "Task journal persist failed");
          throw error;
        }
        return this.publicResult(updated);
      } catch (error) {
        const failed: ShortTaskRecord = { ...task, state: "failed", updatedAt: new Date().toISOString(), failureReason: "dispatch_failed" };
        this.tasks.set(task.id, failed);
        await this.save();
        throw error;
      }
    });
  }

  async execute(clientId: string, id: string): Promise<PublicShortTaskRecord> {
    // Only the state transition is serialized. Do not hold the journal
    // transaction while an Actions Worker performs a potentially slow CLI.
    const { task, controller } = await this.transaction(async () => {
      const task = this.requireOwner(clientId, id);
      if ((task.state !== "provisioning" && task.state !== "ready") || !task.environmentId || !task.leaseId) throw new Error("Task not runnable");
      if (this.coordinator.get(task.leaseId)?.state !== "ready") throw new Error("Worker not ready");
      const running: ShortTaskRecord = { ...task, state: "running", updatedAt: new Date().toISOString() };
      this.tasks.set(id, running);
      try { await this.save(); } catch (error) { this.tasks.set(id, task); throw error; }
      const controller = new AbortController();
      this.runControllers.set(id, controller);
      return { task: running, controller };
    });

    // A Worker that ignores the signal must not hold the local execute()
    // promise forever after cancellation. The provider also cancels the run.
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Task cancelled by owner"));
      controller.signal.addEventListener("abort", onAbort!, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try {
      const work = (async () => {
        const worker = await this.workers.current();
        await worker.requireTool(TASK.workspaceId, "run", task.environmentId!);
        controller.signal.throwIfAborted(); // Never launch a CLI after a cancelled preflight.
        return worker.run({
          workspaceId: TASK.workspaceId, environmentId: task.environmentId!, executable: TASK.executable,
          args: [...TASK.args], cwd: TASK.cwd, mode: TASK.mode, timeoutMs: TASK.timeoutMs,
        }, controller.signal);
      })();
      const result = await Promise.race([work, aborted]);
      if (result.routing.environmentId !== task.environmentId) throw new Error("Worker routing environment mismatch");
      const process = result.value;
      if (!("exitCode" in process)) throw new Error("Worker unexpectedly returned asynchronous process handle");
      if (typeof process.exitCode !== "number" || process.timedOut || process.aborted || process.outputLimitExceeded) {
        throw new Error("Remote process did not complete within the bounded task contract");
      }
      return await this.transaction(async () => {
        const current = this.requireOwner(clientId, id);
        // Cancellation wins if its persisted state transition happened first.
        if (current.state !== "running") throw new Error("Task cancelled by owner");
        const disposed = await this.coordinator.complete(task.leaseId!);
        if (disposed.state !== "disposed") throw new Error("Worker lease cleanup was not confirmed");
        const completed: ShortTaskRecord = { ...current, updatedAt: new Date().toISOString(),
          state: process.exitCode === 0 ? "completed" : "failed", exitCode: process.exitCode,
          stdout: process.stdout.slice(0, 8192), stderr: process.stderr.slice(0, 8192),
          routing: result.routing, ...(process.exitCode === 0 ? {} : { failureReason: "execution_failed" }) };
        this.tasks.set(id, completed);
        await this.save();
        return this.publicResult(completed);
      });
    } catch (error) {
      // The remote invocation may reject during a concurrent cancellation.
      // Never run provider cleanup again or overwrite a cancelled task.
      return this.transaction(async () => {
        const current = this.requireOwner(clientId, id);
        if (current.state === "cancelled" || current.state === "cancelling") {
          throw new Error("Task cancelled by owner");
        }
        if (current.state !== "running") throw error;
        try {
          const disposed = await this.coordinator.fail(task.leaseId!, "Short-task remote execution failed");
          if (disposed.state !== "disposed") throw new Error("Worker lease cleanup was not confirmed");
        } catch (cleanupError) {
          this.tasks.set(id, { ...current, failureReason: "cancel_failed", updatedAt: new Date().toISOString() });
          await this.save();
          throw cleanupError;
        }
        this.tasks.set(id, { ...current, state: "failed", updatedAt: new Date().toISOString(), failureReason: "execution_failed" });
        await this.save();
        throw error;
      });
    } finally {
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      this.runControllers.delete(id);
    }
  }
  async cancel(clientId: string, id: string): Promise<PublicShortTaskRecord> {
    type CancelStep =
      | { kind: "terminal"; task: PublicShortTaskRecord }
      | { kind: "pending"; pending: Promise<PublicShortTaskRecord> }
      | { kind: "start"; leaseId: string | undefined;
          resolve: (result: PublicShortTaskRecord) => void; reject: (error: unknown) => void };
    const step = await this.transaction<CancelStep>(async () => {
      const task = this.requireOwner(clientId, id);
      if (!ACTIVE.has(task.state)) return { kind: "terminal", task: this.publicResult(task) };
      const alreadyPending = this.cancellations.get(id);
      if (alreadyPending) return { kind: "pending", pending: alreadyPending };

      // Write-ahead cancellation intent, then abort. A failed journal write
      // cannot silently authorize destruction of a remote run.
      const cancelling: ShortTaskRecord = { ...task, state: "cancelling", updatedAt: new Date().toISOString() };
      this.tasks.set(id, cancelling);
      try { await this.save(); } catch (error) { this.tasks.set(id, task); throw error; }

      let resolve!: (value: PublicShortTaskRecord) => void;
      let reject!: (error: unknown) => void;
      const pending = new Promise<PublicShortTaskRecord>((ok, fail) => { resolve = ok; reject = fail; });
      // The initial cancel request owns the pending promise; a rejected
      // promise must not become an unhandled rejection before a retry.
      void pending.catch(() => undefined);
      this.cancellations.set(id, pending);
      this.runControllers.get(id)?.abort();
      return { kind: "start", leaseId: task.leaseId, resolve, reject };
    });
    if (step.kind === "terminal") return step.task;
    if (step.kind === "pending") return step.pending;

    try {
      // Long network cancellation is OUTSIDE the journal transaction.
      // Status, quota checks and authorization remain responsive.
      if (step.leaseId) {
        const disposed = await this.coordinator.fail(step.leaseId, "Cancelled by task owner");
        if (disposed.state !== "disposed") throw new Error("Worker lease cleanup failed");
      }
      const finished = await this.transaction(async () => {
        const current = this.requireOwner(clientId, id);
        if (current.state !== "cancelling") throw new Error("Task cancellation state changed unexpectedly");
        const cancelled: ShortTaskRecord = { ...current, state: "cancelled", updatedAt: new Date().toISOString() };
        this.tasks.set(id, cancelled);
        try { await this.save(); } catch (error) { this.tasks.set(id, current); throw error; }
        return this.publicResult(cancelled);
      });
      step.resolve(finished);
      return finished;
    } catch (error) {
      try {
        await this.transaction(async () => {
          const current = this.requireOwner(clientId, id);
          if (current.state !== "cancelling") return;
          const failed: ShortTaskRecord = { ...current, failureReason: "cancel_failed", updatedAt: new Date().toISOString() };
          this.tasks.set(id, failed);
          await this.save();
        });
      } catch (journalError) {
        step.reject(journalError);
        throw journalError;
      }
      step.reject(error);
      throw error;
    } finally {
      this.cancellations.delete(id);
    }
  }
}
