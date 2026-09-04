import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessCapacityError, ProcessRunner } from "./index.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });
const nodeExecutable = path.basename(process.execPath);

type StdioInput = { args: string[]; signal?: AbortSignal; timeoutMs?: number | null };
const openStdio = (runner: ProcessRunner, input: StdioInput) =>
  (runner as unknown as { openStdio(request: { executable: string; args: string[]; cwd: string; signal?: AbortSignal; timeoutMs?: number | null }): Promise<any> }).openStdio({
    executable: nodeExecutable,
    args: input.args,
    cwd: temporary!,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });

describe("ProcessRunner managed stdio sessions", () => {
  it("provides bounded bidirectional stdio without a shell", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-stdio-"));
    const runner = new ProcessRunner(1, 4096);
    const session = await openStdio(runner, {
      args: ["-e", "process.stdin.setEncoding('utf8');process.stdin.once('data',d=>{process.stdout.write(d.toUpperCase());process.exit(0)})"],
      timeoutMs: 2000,
    });
    expect(runner.activeCount()).toBe(1);
    await session.write("hello mcp\n");
    await expect(session.next()).resolves.toEqual({ type: "stdout", data: "HELLO MCP\n" });
    await expect(session.closed).resolves.toMatchObject({ exitCode: 0, timedOut: false, aborted: false, outputLimitExceeded: false });
    expect(runner.activeCount()).toBe(0);
  });

  it("keeps explicit session cancellation authoritative and releases capacity", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-stdio-abort-"));
    const runner = new ProcessRunner(1);
    const abort = new AbortController();
    const session = await openStdio(runner, { args: ["-e", "setInterval(()=>{},1000)"], signal: abort.signal, timeoutMs: 2000 });
    expect(runner.activeCount()).toBe(1);
    await expect(openStdio(runner, { args: ["-e", "0"] })).rejects.toBeInstanceOf(ProcessCapacityError);
    abort.abort(new Error("session cancelled"));
    await expect(session.closed).resolves.toMatchObject({ aborted: true });
    expect(runner.activeCount()).toBe(0);
  });

  it("supports lifecycle-bound sessions without an arbitrary request timeout", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-stdio-managed-"));
    const runner = new ProcessRunner(1);
    const session = await openStdio(runner, { args: ["-e", "setInterval(()=>{},1000)"], timeoutMs: null });
    expect(runner.activeCount()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(runner.activeCount()).toBe(1);
    await session.close();
    await expect(session.closed).resolves.toMatchObject({ timedOut: false, aborted: false });
    expect(runner.activeCount()).toBe(0);
  });

  it("enforces an explicit session timeout and output bound", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-stdio-bounds-"));
    const runner = new ProcessRunner(1, 32);
    const noisy = await openStdio(runner, { args: ["-e", "process.stdout.write('x'.repeat(128));setInterval(()=>{},1000)"], timeoutMs: 2000 });
    await expect(noisy.closed).resolves.toMatchObject({ outputLimitExceeded: true });
    expect(runner.activeCount()).toBe(0);

    const timed = await openStdio(runner, { args: ["-e", "setInterval(()=>{},1000)"], timeoutMs: 100 });
    await expect(timed.closed).resolves.toMatchObject({ timedOut: true });
    expect(runner.activeCount()).toBe(0);
  });
});
