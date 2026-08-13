import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;
export const MAX_PROCESS_TIMEOUT_MS = 120_000;
export const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
export const DEFAULT_PROCESS_CONCURRENCY = 2;

export type ProcessRequest = {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
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

export class ProcessCapacityError extends Error {
  constructor() { super("Worker process concurrency limit reached"); }
}

export class ProcessRunner {
  private active = 0;
  private readonly asyncChildren = new Map<number, { child: ChildProcess; timer: NodeJS.Timeout }>();

  constructor(
    private readonly concurrency = DEFAULT_PROCESS_CONCURRENCY,
    private readonly outputLimitBytes = MAX_PROCESS_OUTPUT_BYTES,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Process concurrency must be a positive integer");
  }

  activeCount(): number { return this.active; }
  asyncCount(): number { return this.asyncChildren.size; }

  async run(request: ProcessRequest): Promise<ProcessResult> {
    const prepared = await this.prepare(request);
    this.acquire();
    try { return await this.spawnAndCollect(prepared); }
    finally { this.release(); }
  }

  /**
   * Start a bounded native process and return only after Node confirms the OS
   * process was spawned. Request cancellation is observed until that acceptance
   * point; after acceptance the request signal is deliberately detached.
   */
  async start(request: ProcessRequest): Promise<AsyncProcessResult> {
    const prepared = await this.prepare(request);
    this.acquire();
    let handedOff = false;
    try {
      const result = await this.spawnAndAccept(prepared);
      handedOff = true;
      return result;
    } finally {
      if (!handedOff) this.release();
    }
  }

  /** Terminate tracked async process trees during an orderly Worker shutdown. */
  shutdown(): void {
    for (const { child } of this.asyncChildren.values()) terminateTree(child);
  }

  private async prepare(request: ProcessRequest): Promise<ProcessRequest & { executable: string; timeoutMs: number }> {
    validateExecutable(request.executable);
    if (request.args.length > 256) throw new Error("Too many process arguments");
    for (const argument of request.args) if (argument.includes("\0")) throw new Error("Process arguments must not contain NUL");
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("Process request aborted");
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_PROCESS_TIMEOUT_MS) throw new Error(`timeoutMs must be between 100 and ${MAX_PROCESS_TIMEOUT_MS}`);
    const executable = await resolveExecutable(request.executable);
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("Process request aborted");
    return { ...request, executable, timeoutMs };
  }

  private acquire(): void {
    if (this.active >= this.concurrency) throw new ProcessCapacityError();
    this.active += 1;
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  private spawnAndCollect(request: ProcessRequest & { timeoutMs: number }): Promise<ProcessResult> {
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

  private spawnAndAccept(request: ProcessRequest & { timeoutMs: number }): Promise<AsyncProcessResult> {
    return new Promise((resolve, reject) => {
      const startedAt = new Date();
      const child = spawnNative(request, ["ignore", "ignore", "ignore"]);
      let accepted = false;
      let settled = false;
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
        const timer = setTimeout(() => terminateTree(child), request.timeoutMs);
        this.asyncChildren.set(pid, { child, timer });
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
        const tracked = child.pid ? this.asyncChildren.get(child.pid) : undefined;
        if (tracked) {
          clearTimeout(tracked.timer);
          this.asyncChildren.delete(child.pid!);
        }
        this.release();
      });
    });
  }
}

function spawnNative(request: ProcessRequest & { executable: string }, stdio: ["ignore", "pipe" | "ignore", "pipe" | "ignore"]): ChildProcess {
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
