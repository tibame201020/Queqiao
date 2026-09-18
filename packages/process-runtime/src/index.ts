import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;
export const MAX_PROCESS_TIMEOUT_MS = 120_000;
export const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
export const MAX_PROCESS_INPUT_CHUNK_BYTES = 1024 * 1024;
export const DEFAULT_PROCESS_CONCURRENCY = 2;

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

export type ProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
};

/**
 * Async execution intentionally exposes only native process start metadata.
 * It is not a durable Queqiao Job identity and stdout/stderr are not retained.
 */
export type AsyncProcessResult = {
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
};

export type ManagedStdioSession = {
  pid: number;
  write(data: string): Promise<void>;
  next(): Promise<ProcessStreamEvent>;
  close(): Promise<void>;
  readonly closed: Promise<ManagedProcessClose>;
};

export type ProcessCapacityClass = "foreground" | "background";
export type TrackedProcessKind = "async" | "stdio";

export type ProcessCapacitySnapshot = {
  foreground: { active: number; limit: number };
  background: { active: number; limit: number };
  asyncChildren: number;
  stdioSessions: number;
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
    readonly active = 0,
    readonly limit = 0,
  ) {
    super(capacityClass === "foreground" ? "Worker process concurrency limit reached" : "Worker background process concurrency limit reached");
  }
}

export class ProcessRunner {
  private foregroundActive = 0;
  private backgroundActive = 0;
  private readonly asyncChildren = new Map<string, { child: ChildProcess; timer: NodeJS.Timeout; info: TrackedProcessInfo }>();
  private readonly stdioChildren = new Map<string, { child: ChildProcess; info: TrackedProcessInfo }>();

  constructor(
    private readonly foregroundConcurrency = DEFAULT_PROCESS_CONCURRENCY,
    private readonly outputLimitBytes = MAX_PROCESS_OUTPUT_BYTES,
    private readonly backgroundConcurrency = foregroundConcurrency,
  ) {
    if (!Number.isInteger(foregroundConcurrency) || foregroundConcurrency < 1) throw new Error("Foreground process concurrency must be a positive integer");
    if (!Number.isInteger(backgroundConcurrency) || backgroundConcurrency < 1) throw new Error("Background process concurrency must be a positive integer");
  }

  activeCount(): number { return this.foregroundActive + this.backgroundActive; }
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
    };
  }

  listTracked(workspaceId?: string): TrackedProcessInfo[] {
    return [...this.asyncChildren.values(), ...this.stdioChildren.values()]
      .map(({ info }) => ({ ...info }))
      .filter((info) => !workspaceId || info.workspaceId === workspaceId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  stopTracked(handle: string, workspaceId?: string): boolean {
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
   * explicit close/cancellation, output bounds, concurrency and Worker shutdown
   * remain authoritative for the entire session lifetime.
   */
  async openStdio(request: StdioSessionRequest): Promise<ManagedStdioSession> {
    const prepared = await this.prepareStdio(request);
    this.acquireForeground();
    let handedOff = false;
    try {
      const session = await this.spawnStdioSession(prepared);
      handedOff = true;
      return session;
    } finally {
      if (!handedOff) this.releaseForeground();
    }
  }

  /** Terminate tracked process trees during an orderly Worker shutdown. */
  shutdown(): void {
    for (const { child } of this.asyncChildren.values()) terminateTree(child);
    for (const { child } of this.stdioChildren.values()) terminateTree(child);
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

  private acquireBackground(): void {
    if (this.backgroundActive >= this.backgroundConcurrency) {
      throw new ProcessCapacityError("background", this.backgroundActive, this.backgroundConcurrency);
    }
    this.backgroundActive += 1;
  }

  private releaseBackground(): void {
    this.backgroundActive = Math.max(0, this.backgroundActive - 1);
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
      const child = spawnNative(request, ["ignore", "pipe", "pipe"]);

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), durationMs: Date.now() - startedAt, timedOut, aborted, outputLimitExceeded });
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
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", onAbort);
          reject(error);
        }
      });
      child.once("close", finish);
      const timer = setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
      const onAbort = () => { aborted = true; terminate(); };
      request.signal?.addEventListener("abort", onAbort, { once: true });
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
        resolve({ pid, startedAt: startedAt.toISOString(), timeoutMs: request.timeoutMs, stdout: "discarded", stderr: "discarded" });
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
        this.releaseForeground();
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
          capacityClass: "foreground",
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
  const directories = String(process.env["PATH"] || "").split(path.delimiter).filter(Boolean);
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

function minimalEnvironment(): NodeJS.ProcessEnv {
  const names = process.platform === "win32"
    ? ["PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
    : ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"];
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) as NodeJS.ProcessEnv;
}

function terminateTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    killer.unref();
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}
