import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PROCESS_OUTPUT_BYTES, ProcessCapacityError, ProcessRunner } from "./index.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });
const nodeExecutable = path.basename(process.execPath);

describe("ProcessRunner", () => {
  it("runs argv without a shell in the requested directory", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const result = await new ProcessRunner().run({ executable: nodeExecutable, args: ["-e", "process.stdout.write(process.cwd())"], cwd: temporary });
    expect(result.exitCode).toBe(0);
    expect(path.resolve(result.stdout)).toBe(path.resolve(temporary));
  });

  it("terminates timeout and bounded-output processes", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const runner = new ProcessRunner(2, 1024);
    const timeout = await runner.run({ executable: nodeExecutable, args: ["-e", "setInterval(()=>{},1000)"], cwd: temporary, timeoutMs: 100 });
    expect(timeout.timedOut).toBe(true);
    const output = await runner.run({ executable: nodeExecutable, args: ["-e", `process.stdout.write('x'.repeat(${MAX_PROCESS_OUTPUT_BYTES}))`], cwd: temporary });
    expect(output.outputLimitExceeded).toBe(true);
    expect(Buffer.byteLength(output.stdout)).toBe(1024);
    const abort = new AbortController();
    const aborted = runner.run({ executable: nodeExecutable, args: ["-e", "setInterval(()=>{},1000)"], cwd: temporary, signal: abort.signal });
    setTimeout(() => abort.abort(), 50);
    await expect(aborted).resolves.toMatchObject({ aborted: true });
  });

  it("rejects shell syntax and excess concurrency", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const runner = new ProcessRunner(1);
    await expect(runner.run({ executable: "node && calc", args: [], cwd: temporary })).rejects.toThrow(/basename/);
    if (process.platform === "win32") await expect(runner.run({ executable: "npm.cmd", args: [], cwd: temporary })).rejects.toThrow(/native/);
    const active = runner.run({ executable: nodeExecutable, args: ["-e", "setTimeout(()=>{},300)"], cwd: temporary });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(runner.run({ executable: nodeExecutable, args: [], cwd: temporary })).rejects.toBeInstanceOf(ProcessCapacityError);
    await active;
  });
});
