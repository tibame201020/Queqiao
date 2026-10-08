import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;
export const PROCESS_STDIO_DRAIN_GRACE_MS = 250;
export const MAX_PROCESS_TIMEOUT_MS = 120_000;
export const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
export const MAX_PROCESS_INPUT_CHUNK_BYTES = 1024 * 1024;
export const DEFAULT_PROCESS_CONCURRENCY = 2;
export const MAX_JOB_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_JOB_QUEUE_LIMIT = 32;
export const DEFAULT_JOB_RETENTION_MS = 15 * 60_000;

type ProcessBaseRequest = {
  executable: string;
  args: readonly string[];
  cwd: string;
  workspaceId?: string;
  signal?: AbortSignal;
};

export type ProcessRequest = ProcessBaseRequest & {
  timeoutMs?: number;
};

export type StdioSessionRequest = ProcessBaseRequest & {
  stdoutEncoding?: "utf8" | "base64";
  /** null keeps the managed session alive until close(), cancellation, output failure, or Worker shutdown. */
  timeoutMs?: number | null;
};

export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
export type JobRequest = Omit<ProcessBaseRequest, "signal"> & { timeoutMs?: number; idempotencyKey?: string };
export type JobStartResult = { jobId: string; state: JobState; deduplicated: boolean };
export type JobStatus = {
  jobId: string; state: JobState; workspaceId?: string; executable: string; createdAt: string;
  startedAt?: string; finishedAt?: string; timeoutMs: number; pid?: number; exitCode?: number | null;
  signal?: NodeJS.Signals | null; durationMs?: number; truncated: boolean;
};
export type JobLogs = { jobId: string; stdout: string; stderr: string; truncated: boolean };
type JobEntry = {
  jobId: string; request: JobRequest & { executable: string; timeoutMs: number }; state: JobState; createdAt: string;
  startedAt?: string; finishedAt?: string; pid?: number; child?: ChildProcess; timer?: NodeJS.Timeout; retentionTimer?: NodeJS.Timeout;
  exitCode?: number | null; signal?: NodeJS.Signals | null; durationMs?: number; stdout: Buffer; stderr: Buffer;
  truncated: boolean; timedOut: boolean; cancelRequested: boolean;
};

export type ProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
  stdioDrainTimedOut?: boolean;
};

/**
 * Async execution intentionally exposes only native process start metadata.
 * It is not a durable Queqiao Job identity and stdout/stderr are not retained.
 */
export type AsyncProcessResult = {
  handle: string;
  pid: number;
  startedAt: string;
  timeoutMs: number;
  stdout: "discarded";
  stderr: "discarded";
};

export type ProcessStreamEvent = {
  type: "stdout" | "stderr";
  data: string;
};

export type ManagedProcessClose = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
  stdioDrainTimedOut?: boolean;
};

export type ManagedStdioSession = {
  pid: number;
  write(data: string): Promise<void>;
  next(): Promise<ProcessStreamEvent>;
  close(): Promise<void>;
  readonly closed: Promise<ManagedProcessClose>;
};

export type ProcessCapacityClass = "foreground" | "background" | "session";
export type TrackedProcessKind = "sync" | "async" | "stdio";

export type ProcessCapacitySnapshot = {
  foreground: { active: number; limit: number };
  background: { active: number; limit: number };
  asyncChildren: number;
  stdioSessions: number;
  sessions?: { active: number; limit: number };
  jobs: { queued: number; queueLimit: number; retained: number };
};

export type TrackedProcessInfo = {
  handle: string;
  kind: TrackedProcessKind;
  pid: number;
  executable: string;
  workspaceId?: string;
  startedAt: string;
  timeoutMs: number | null;
  capacityClass: ProcessCapacityClass;
};

export class ProcessCapacityError extends Error {
  constructor(
    readonly capacityClass: ProcessCapacityClass = "foreground",
    readonly active?: number,
    readonly limit?: number,
  ) {
    super(capacityClass === "foreground" ? "Worker process concurrency limit reached" : `Worker ${capacityClass} process concurrency limit reached`);
  }
}

export class ProcessRunner {
  private foregroundActive = 0;
  private backgroundActive = 0;
  private sessionActive = 0;
  private readonly syncChildren = new Map<string, { child: ChildProcess; info: TrackedProcessInfo; stop(): void }>();
  private readonly asyncChildren = new Map<string, { child: ChildProcess; timer: NodeJS.Timeout; info: TrackedProcessInfo }>();
  private readonly stdioChildren = new Map<string, { child: ChildProcess; info: TrackedProcessInfo }>();
  private readonly jobs = new Map<string, JobEntry>();
  private readonly jobQueue: string[] = [];
  private readonly jobIdempotency = new Map<string, string>();

  constructor(
    private readonly foregroundConcurrency = DEFAULT_PROCESS_CONCURRENCY,
    private readonly outputLimitBytes = MAX_PROCESS_OUTPUT_BYTES,
    private readonly backgroundConcurrency = foregroundConcurrency,
    private readonly jobQueueLimit = DEFAULT_JOB_QUEUE_LIMIT,
    private readonly jobRetentionMs = DEFAULT_JOB_RETENTION_MS,
    private readonly sessionConcurrency = foregroundConcurrency,
  ) {
    if (!Number.isInteger(foregroundConcurrency) || foregroundConcurrency < 1) throw new Error("Foreground process concurrency must be a positive integer");
    if (!Number.isInteger(backgroundConcurrency) || backgroundConcurrency < 1) throw new Error("Background process concurrency must be a positive integer");
    if (!Number.isInteger(sessionConcurrency) || sessionConcurrency < 1) throw new Error("Session process concurrency must be a positive integer");
    if (!Number.isInteger(jobQueueLimit) || jobQueueLimit < 0) throw new Error("Job queue limit must be a non-negative integer");
    if (!Number.isInteger(jobRetentionMs) || jobRetentionMs < 1) throw new Error("Job retention must be a positive integer");
  }

  activeCount(): number { return this.foregroundActive + this.backgroundActive + this.sessionActive; }
  foregroundActiveCount(): number { return this.foregroundActive; }
  backgroundActiveCount(): number { return this.backgroundActive; }
  asyncCount(): number { return this.asyncChildren.size; }
  stdioCount(): number { return this.stdioChildren.size; }

  capacity(): ProcessCapacitySnapshot {
    return {
      foreground: { active: this.foregroundActive, limit: this.foregroundConcurrency },
      background: { active: this.backgroundActive, limit: this.backgroundConcurrency },
      asyncChildren: this.asyncChildren.size,
      stdioSessions: this.stdioChildren.size,
      sessions: { active: this.sessionActive, limit: this.sessionConcurrency },
      jobs: { queued: this.jobQueue.length, queueLimit: this.jobQueueLimit, retained: this.jobs.size },
    };
  }

  jobQueueDepth(): number { return this.jobQueue.length; }
  retainedJobCount(): number { return this.jobs.size; }

  async startJob(request: JobRequest): Promise<JobStartResult> {
    if (request.idempotencyKey) {
      const key = this.jobIdempotencyKey(request.workspaceId, request.idempotencyKey);
      const existing = this.jobIdempotency.get(key);
      if (existing && this.jobs.has(existing)) {
        const state = this.jobs.get(existing)!.state;
        return { jobId: existing, state, deduplicated: true };
      }
    }
    const preparedBase = await this.prepareBase(request);
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    validateJobTimeout(timeoutMs);
    if (this.backgroundActive >= this.backgroundConcurrency && this.jobQueue.length >= this.jobQueueLimit) {
      throw new ProcessCapacityError("background", this.backgroundActive, this.backgroundConcurrency);
    }
    const jobId = randomUUID();
    const entry: JobEntry = {
      jobId, request: { ...preparedBase, timeoutMs }, state: "queued", createdAt: new Date().toISOString(),
      stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), truncated: false, timedOut: false, cancelRequested: false,
    };
    this.jobs.set(jobId, entry);
    if (request.idempotencyKey) this.jobIdempotency.set(this.jobIdempotencyKey(request.workspaceId, request.idempotencyKey), jobId);
    if (this.backgroundActive < this.backgroundConcurrency) this.startJobEntry(entry); else this.jobQueue.push(jobId);
    return { jobId, state: entry.state as "queued" | "running", deduplicated: false };
  }

  jobStatus(jobId: string, workspaceId?: string): JobStatus {
    const entry = this.requireJob(jobId, workspaceId);
    return {
      jobId: entry.jobId, state: entry.state, ...(entry.request.workspaceId ? { workspaceId: entry.request.workspaceId } : {}),
      executable: path.basename(entry.request.executable), createdAt: entry.createdAt,
      ...(entry.startedAt ? { startedAt: entry.startedAt } : {}), ...(entry.finishedAt ? { finishedAt: entry.finishedAt } : {}),
      timeoutMs: entry.request.timeoutMs, ...(entry.pid ? { pid: entry.pid } : {}),
      ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
      ...(entry.signal !== undefined ? { signal: entry.signal } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}), truncated: entry.truncated,
    };
  }

  jobLogs(jobId: string, workspaceId?: string): JobLogs {
    const entry = this.requireJob(jobId, workspaceId);
    return { jobId, stdout: entry.stdout.toString("utf8"), stderr: entry.stderr.toString("utf8"), truncated: entry.truncated };
  }

  cancelJob(jobId: string, workspaceId?: string): boolean {
    const entry = this.jobs.get(jobId);
    if (!entry || (workspaceId && entry.request.workspaceId !== workspaceId)) return false;
    if (entry.state === "queued") {
      const index = this.jobQueue.indexOf(jobId);
      if (index >= 0) this.jobQueue.splice(index, 1);
      entry.cancelRequested = true;
      this.finishJob(entry, "cancelled", null, null);
      return true;
    }
    if (entry.state !== "running" || !entry.child) return false;
    entry.cancelRequested = true;
    terminateTree(entry.child);
    return true;
  }

  listTracked(workspaceId?: string): TrackedProcessInfo[] {
    return [...this.syncChildren.values(), ...this.asyncChildren.values(), ...this.stdioChildren.values()]
      .map(({ info }) => ({ ...info }))
      .filter((info) => !workspaceId || info.workspaceId === workspaceId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  stopTracked(handle: string, workspaceId?: string): boolean {
    const synchronous = this.syncChildren.get(handle);
    if (synchronous) {
      if (workspaceId && synchronous.info.workspaceId !== workspaceId) return false;
      synchronous.stop();
      return true;
    }
    const tracked = this.asyncChildren.get(handle) ?? this.stdioChildren.get(handle);
    if (!tracked) return false;
    if (workspaceId && tracked.info.workspaceId !== workspaceId) return false;
    terminateTree(tracked.child);
    return true;
  }

  async run(request: ProcessRequest): Promise<ProcessResult> {
    const prepared = await this.prepare(request);
    this.acquireForeground();
    try { return await this.spawnAndCollect(prepared); }
    finally { this.releaseForeground(); }
  }

  /**
   * Start a bounded native process and return only after Node confirms the OS
   * process was spawned. Request cancellation is observed until that acceptance
   * point; after acceptance the request signal is deliberately detached.
   */
  async start(request: ProcessRequest): Promise<AsyncProcessResult> {
    const prepared = await this.prepare(request);
    this.acquireBackground();
    let handedOff = false;
    try {
      const result = await this.spawnAndAccept(prepared);
      handedOff = true;
      return result;
    } finally {
      if (!handedOff) this.releaseBackground();
    }
  }

  /**
   * Open a managed native stdio session. Numeric timeoutMs applies an explicit
   * lifetime bound. timeoutMs:null makes the session lifecycle-bound instead:
   * explicit close/cancellation, output bounds, independent session concurrency and Worker shutdown
   * remain authoritative for the entire session lifetime.
   */
  async openStdio(request: StdioSessionRequest): Promise<ManagedStdioSession> {
    const prepared = await this.prepareStdio(request);
    this.acquireSession();
    let handedOff = false;
    try {
      const session = await this.spawnStdioSession(prepared);
      handedOff = true;
      return session;
    } finally {
      if (!handedOff) this.releaseSession();
    }
  }

  /** Terminate tracked process trees during an orderly Worker shutdown. */
  shutdown(): void {
    for (const tracked of this.syncChildren.values()) tracked.stop();
    for (const { child } of this.asyncChildren.values()) terminateTree(child);
    for (const { child } of this.stdioChildren.values()) terminateTree(child);
    for (const entry of this.jobs.values()) {
      if (entry.state === "running" && entry.child) { entry.cancelRequested = true; terminateTree(entry.child); }
      else if (entry.state === "queued") this.finishJob(entry, "cancelled", null, null);
    }
  }

  private async prepareBase<T extends ProcessBaseRequest>(request: T): Promise<T & { executable: string }> {
    validateExecutable(request.executable);
    if (request.args.length > 256) throw new Error("Too many process arguments");
    for (const argument of request.args) if (argument.includes("\0")) throw new Error("Process arguments must not contain NUL");
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("Process request aborted");
    const executable = await resolveExecutable(request.executable);
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("Process request aborted");
    return { ...request, executable };
  }

  private async prepare(request: ProcessRequest): Promise<ProcessRequest & { executable: string; timeoutMs: number }> {
    const prepared = await this.prepareBase(request);
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    validateTimeout(timeoutMs);
    return { ...prepared, timeoutMs };
  }

  private async prepareStdio(request: StdioSessionRequest): Promise<StdioSessionRequest & { executable: string; timeoutMs: number | null }> {
    const prepared = await this.prepareBase(request);
    if (request.timeoutMs === null) return { ...prepared, timeoutMs: null };
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    validateTimeout(timeoutMs);
    return { ...prepared, timeoutMs };
  }

  private acquireForeground(): void {
    if (this.foregroundActive >= this.foregroundConcurrency) {
      throw new ProcessCapacityError("foreground", this.foregroundActive, this.foregroundConcurrency);
    }
    this.foregroundActive += 1;
  }

  private releaseForeground(): void {
    this.foregroundActive = Math.max(0, this.foregroundActive - 1);
  }

  private acquireSession(): void {
    if (this.sessionActive >= this.sessionConcurrency) throw new ProcessCapacityError("session", this.sessionActive, this.sessionConcurrency);
    this.sessionActive += 1;
  }

  private releaseSession(): void {
    this.sessionActive = Math.max(0, this.sessionActive - 1);
  }

  private acquireBackground(): void {
    if (this.backgroundActive >= this.backgroundConcurrency) {
      throw new ProcessCapacityError("background", this.backgroundActive, this.backgroundConcurrency);
    }
    this.backgroundActive += 1;
  }

  private releaseBackground(): void {
    this.backgroundActive = Math.max(0, this.backgroundActive - 1);
    this.drainJobs();
  }

  private jobIdempotencyKey(workspaceId: string | undefined, key: string): string {
    return `${workspaceId ?? ""}\u0000${key}`;
  }
  private requireJob(jobId: string, workspaceId?: string): JobEntry {
    const entry = this.jobs.get(jobId);
    if (!entry || (workspaceId && entry.request.workspaceId !== workspaceId)) throw new Error("Job is not available");
    return entry;
  }
  private appendJobLog(entry: JobEntry, stream: "stdout" | "stderr", chunk: Buffer): void {
    const current = stream === "stdout" ? entry.stdout : entry.stderr;
    const remaining = Math.max(0, this.outputLimitBytes - current.length);
    if (remaining > 0) {
      const accepted = chunk.subarray(0, remaining);
      if (stream === "stdout") entry.stdout = Buffer.concat([entry.stdout, accepted]); else entry.stderr = Buffer.concat([entry.stderr, accepted]);
    }
    if (chunk.length > remaining) entry.truncated = true;
  }
  private startJobEntry(entry: JobEntry): void {
    if (entry.state !== "queued" || this.backgroundActive >= this.backgroundConcurrency) return;
    this.backgroundActive += 1;
    entry.state = "running";
    entry.startedAt = new Date().toISOString();
    const child = spawnNative(entry.request, ["ignore", "pipe", "pipe"]);
    entry.child = child;
    child.stdout!.on("data", (chunk: Buffer) => this.appendJobLog(entry, "stdout", chunk));
    child.stderr!.on("data", (chunk: Buffer) => this.appendJobLog(entry, "stderr", chunk));
    child.once("spawn", () => {
      if (child.pid) entry.pid = child.pid;
      entry.timer = setTimeout(() => { entry.timedOut = true; terminateTree(child); }, entry.request.timeoutMs);
      entry.timer.unref?.();
    });
    child.once("error", () => { if (entry.state === "running") this.finishJob(entry, "failed", null, null); });
    child.once("close", (exitCode, signal) => {
      if (entry.state !== "running") return;
      const state: JobState = entry.cancelRequested ? "cancelled" : entry.timedOut ? "timed_out" : exitCode === 0 ? "completed" : "failed";
      this.finishJob(entry, state, exitCode, signal as NodeJS.Signals | null);
    });
  }
  private finishJob(entry: JobEntry, state: JobState, exitCode: number | null, signal: NodeJS.Signals | null): void {
    const wasRunning = entry.state === "running";
    if (entry.timer) clearTimeout(entry.timer);
    entry.state = state; entry.exitCode = exitCode; entry.signal = signal; entry.finishedAt = new Date().toISOString();
    if (entry.startedAt) entry.durationMs = Math.max(0, Date.parse(entry.finishedAt) - Date.parse(entry.startedAt));
    delete entry.child; delete entry.timer;
    if (wasRunning) this.releaseBackground();
    entry.retentionTimer = setTimeout(() => {
      this.jobs.delete(entry.jobId);
      if (entry.request.idempotencyKey) {
        const key = this.jobIdempotencyKey(entry.request.workspaceId, entry.request.idempotencyKey);
        if (this.jobIdempotency.get(key) === entry.jobId) this.jobIdempotency.delete(key);
      }
    }, this.jobRetentionMs);
    entry.retentionTimer.unref?.();
  }
  private drainJobs(): void {
    while (this.backgroundActive < this.backgroundConcurrency && this.jobQueue.length > 0) {
      const entry = this.jobs.get(this.jobQueue.shift()!);
      if (entry?.state === "queued") this.startJobEntry(entry);
    }
  }

  private spawnAndCollect(request: ProcessRequest & { executable: string; timeoutMs: number }): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let timedOut = false;
      let aborted = false;
      let outputLimitExceeded = false;
      let settled = false;
      let stdioDrainTimedOut = false;
      let drainTimer: NodeJS.Timeout | undefined;
      const child = spawnNative(request, ["ignore", "pipe", "pipe"]);

      const handle = randomUUID();
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        this.syncChildren.delete(handle);
        clearTimeout(timer);
        if (drainTimer) clearTimeout(drainTimer);
        request.signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), durationMs: Date.now() - startedAt, timedOut, aborted, outputLimitExceeded, ...(stdioDrainTimedOut ? { stdioDrainTimedOut: true } : {}) });
      };
      const terminate = () => terminateTree(child);
      const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
        const current = stream === "stdout" ? stdout : stderr;
        if (current.length + chunk.length > this.outputLimitBytes) {
          outputLimitExceeded = true;
          const bounded = Buffer.concat([current, chunk.subarray(0, Math.max(0, this.outputLimitBytes - current.length))]);
          if (stream === "stdout") stdout = bounded; else stderr = bounded;
          terminate();
          return;
        }
        if (stream === "stdout") stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
      };
      child.stdout!.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr!.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          this.syncChildren.delete(handle);
          clearTimeout(timer);
        if (drainTimer) clearTimeout(drainTimer);
          request.signal?.removeEventListener("abort", onAbort);
          reject(error);
        }
      });
      child.once("close", finish);
      child.once("exit", (exitCode, signal) => {
        // Native execution is over. Inherited pipes must not turn it into an
        // unbounded foreground request when an independently launched child
        // (for example PowerShell Start-Process -NoNewWindow) keeps them open.
        clearTimeout(timer);
        drainTimer = setTimeout(() => {
          stdioDrainTimedOut = true;
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(exitCode, signal);
        }, PROCESS_STDIO_DRAIN_GRACE_MS);
      });
      const timer = setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
      const onAbort = () => { aborted = true; terminate(); };
      if (child.pid) this.syncChildren.set(handle, { child, stop: onAbort, info: {
        handle, kind: "sync", pid: child.pid, executable: path.basename(request.executable),
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
        startedAt: new Date(startedAt).toISOString(), timeoutMs: request.timeoutMs, capacityClass: "foreground",
      } });
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) onAbort();
    });
  }

  private spawnAndAccept(request: ProcessRequest & { executable: string; timeoutMs: number }): Promise<AsyncProcessResult> {
    return new Promise((resolve, reject) => {
      const startedAt = new Date();
      const child = spawnNative(request, ["ignore", "ignore", "ignore"]);
      let accepted = false;
      let settled = false;
      let handle: string | undefined;
      let preAcceptanceFailure: unknown;

      const cleanupPreAcceptance = () => request.signal?.removeEventListener("abort", onAbort);
      const failWithoutProcess = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanupPreAcceptance();
        reject(error);
      };
      const cancelBeforeAcceptance = (error: unknown) => {
        if (settled || accepted) return;
        preAcceptanceFailure = error;
        cleanupPreAcceptance();
        terminateTree(child);
      };
      const onAbort = () => cancelBeforeAcceptance(request.signal?.reason ?? new Error("Process request aborted"));
      request.signal?.addEventListener("abort", onAbort, { once: true });

      child.once("error", failWithoutProcess);
      child.once("spawn", () => {
        if (settled) return;
        if (preAcceptanceFailure || request.signal?.aborted) {
          cancelBeforeAcceptance(preAcceptanceFailure ?? request.signal?.reason ?? new Error("Process request aborted"));
          return;
        }
        if (!child.pid) return cancelBeforeAcceptance(new Error("Native process started without a process id"));
        accepted = true;
        settled = true;
        cleanupPreAcceptance();
        const pid = child.pid;
        handle = randomUUID();
        const timer = setTimeout(() => terminateTree(child), request.timeoutMs);
        const info: TrackedProcessInfo = {
          handle,
          kind: "async",
          pid,
          executable: path.basename(request.executable),
          ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
          startedAt: startedAt.toISOString(),
          timeoutMs: request.timeoutMs,
          capacityClass: "background",
        };
        this.asyncChildren.set(handle, { child, timer, info });
        resolve({ handle, pid, startedAt: startedAt.toISOString(), timeoutMs: request.timeoutMs, stdout: "discarded", stderr: "discarded" });
      });
      child.once("close", () => {
        if (!accepted) {
          if (!settled) {
            settled = true;
            cleanupPreAcceptance();
            reject(preAcceptanceFailure ?? new Error("Native process exited before successful acceptance"));
          }
          return;
        }
        const tracked = handle ? this.asyncChildren.get(handle) : undefined;
        if (tracked) {
          clearTimeout(tracked.timer);
          this.asyncChildren.delete(handle!);
        }
        this.releaseBackground();
      });
    });
  }

  private spawnStdioSession(request: StdioSessionRequest & { executable: string; timeoutMs: number | null }): Promise<ManagedStdioSession> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawnNative(request, ["pipe", "pipe", "pipe"]);
      const stdoutDecoder = request.stdoutEncoding === "base64" ? undefined : new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      const events: ProcessStreamEvent[] = [];
      const waiters: Array<{ resolve(event: ProcessStreamEvent): void; reject(error: Error): void }> = [];
      let outputBytes = 0;
      let accepted = false;
      let handle: string | undefined;
      let openSettled = false;
      let closeSettled = false;
      let timedOut = false;
      let aborted = false;
      let outputLimitExceeded = false;
      let preAcceptanceFailure: unknown;
      let timer: NodeJS.Timeout | undefined;
      let resolveClosed!: (value: ManagedProcessClose) => void;
      const closed = new Promise<ManagedProcessClose>((resolveClose) => { resolveClosed = resolveClose; });

      const enqueue = (event: ProcessStreamEvent) => {
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(event);
        else events.push(event);
      };
      const rejectWaiters = () => {
        const error = new Error("Managed stdio session is closed");
        while (waiters.length) waiters.shift()!.reject(error);
      };
      const terminate = () => terminateTree(child);
      const append = (type: "stdout" | "stderr", chunk: Buffer) => {
        if (closeSettled) return;
        const remaining = Math.max(0, this.outputLimitBytes - outputBytes);
        const acceptedChunk = chunk.subarray(0, remaining);
        outputBytes += acceptedChunk.length;
        if (acceptedChunk.length) {
          if (type === "stdout" && request.stdoutEncoding === "base64") {
            enqueue({ type, data: acceptedChunk.toString("base64") });
          } else {
            const decoder = type === "stdout" ? stdoutDecoder! : stderrDecoder;
            const data = decoder.write(acceptedChunk);
            if (data) enqueue({ type, data });
          }
        }
        if (acceptedChunk.length < chunk.length) {
          outputLimitExceeded = true;
          terminate();
        }
      };
      const onAbort = () => {
        aborted = true;
        if (!accepted) preAcceptanceFailure = request.signal?.reason ?? new Error("Process request aborted");
        terminate();
      };
      const releaseTracked = () => {
        if (handle) this.stdioChildren.delete(handle);
        this.releaseSession();
      };
      const settleClose = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (closeSettled) return;
        closeSettled = true;
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        const stdoutTail = stdoutDecoder?.end() ?? "";
        const stderrTail = stderrDecoder.end();
        if (stdoutTail) enqueue({ type: "stdout", data: stdoutTail });
        if (stderrTail) enqueue({ type: "stderr", data: stderrTail });
        rejectWaiters();
        if (accepted) releaseTracked();
        resolveClosed({ exitCode, signal, durationMs: Date.now() - startedAt, timedOut, aborted, outputLimitExceeded });
      };

      request.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout!.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr!.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", (error) => {
        if (!accepted && !openSettled) {
          openSettled = true;
          request.signal?.removeEventListener("abort", onAbort);
          reject(error);
        }
      });
      child.once("spawn", () => {
        if (openSettled) return;
        if (preAcceptanceFailure || request.signal?.aborted) {
          preAcceptanceFailure = preAcceptanceFailure ?? request.signal?.reason ?? new Error("Process request aborted");
          terminate();
          return;
        }
        if (!child.pid) {
          preAcceptanceFailure = new Error("Native process started without a process id");
          terminate();
          return;
        }
        accepted = true;
        openSettled = true;
        handle = randomUUID();
        const info: TrackedProcessInfo = {
          handle,
          kind: "stdio",
          pid: child.pid,
          executable: path.basename(request.executable),
          ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
          startedAt: new Date(startedAt).toISOString(),
          timeoutMs: request.timeoutMs,
          capacityClass: "session",
        };
        this.stdioChildren.set(handle, { child, info });
        if (request.timeoutMs !== null) timer = setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
        const session: ManagedStdioSession = {
          pid: child.pid,
          closed,
          async write(data: string) {
            if (Buffer.byteLength(data, "utf8") > MAX_PROCESS_INPUT_CHUNK_BYTES) throw new Error(`Managed stdio write exceeds ${MAX_PROCESS_INPUT_CHUNK_BYTES} bytes`);
            const stdin = child.stdin;
            if (!stdin || stdin.destroyed || !stdin.writable) throw new Error("Managed stdio session stdin is closed");
            await new Promise<void>((resolveWrite, rejectWrite) => stdin.write(data, "utf8", (error) => error ? rejectWrite(error) : resolveWrite()));
          },
          next() {
            const event = events.shift();
            if (event) return Promise.resolve(event);
            if (closeSettled) return Promise.reject(new Error("Managed stdio session is closed"));
            return new Promise<ProcessStreamEvent>((resolveEvent, rejectEvent) => waiters.push({ resolve: resolveEvent, reject: rejectEvent }));
          },
          async close() {
            terminate();
            await closed;
          },
        };
        resolve(session);
      });
      child.once("close", (exitCode, signal) => {
        if (!accepted) {
          if (!openSettled) {
            openSettled = true;
            request.signal?.removeEventListener("abort", onAbort);
            reject(preAcceptanceFailure ?? new Error("Native process exited before successful stdio acceptance"));
          }
          return;
        }
        settleClose(exitCode, signal as NodeJS.Signals | null);
      });
    });
  }
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_PROCESS_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be between 100 and ${MAX_PROCESS_TIMEOUT_MS}`);
  }
}
function validateJobTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_JOB_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be between 100 and ${MAX_JOB_TIMEOUT_MS}`);
  }
}

function spawnNative(request: ProcessBaseRequest & { executable: string }, stdio: ["ignore" | "pipe", "pipe" | "ignore", "pipe" | "ignore"]): ChildProcess {
  return spawn(request.executable, [...request.args], {
    cwd: request.cwd,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio,
    env: minimalEnvironment(),
  });
}

function validateExecutable(executable: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(executable)) throw new Error("Executable must be a basename without path or shell syntax");
}

async function resolveExecutable(executable: string): Promise<string> {
  const directories = String(environmentValue("PATH") || "").split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === "win32"
    ? (path.extname(executable) ? [""] : [".exe", ".com"])
    : [""];
  if (process.platform === "win32" && path.extname(executable) && ![".exe", ".com"].includes(path.extname(executable).toLowerCase())) {
    throw new Error("Windows commands must be native .exe or .com executables");
  }
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(directory, `${executable}${suffix}`);
      try {
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        const canonical = await realpath(candidate);
        if ((await stat(canonical)).isFile()) return canonical;
      } catch { /* try the next trusted PATH candidate */ }
    }
  }
  throw new Error(`Executable was not found on the Worker PATH: ${executable}`);
}

function environmentValue(name: string): string | undefined {
  if (process.env[name] !== undefined) return process.env[name];
  if (process.platform !== "win32") return undefined;
  const key = Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : process.env[key];
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const names = process.platform === "win32"
    ? ["PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
    : ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"];
  return Object.fromEntries(names.flatMap((name) => {
    const value = environmentValue(name);
    return value === undefined ? [] : [[name, value]];
  })) as NodeJS.ProcessEnv;
}

function terminateTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  if (process.platform === "win32") {
    const taskkill = path.join(environmentValue("SystemRoot") || "C:/Windows", "System32", "taskkill.exe");
    const fallback = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    const killer = spawn(taskkill, ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", fallback);
    killer.once("exit", (code) => { if (code !== 0) fallback(); });
    killer.unref();
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}
