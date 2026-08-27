import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PROCESS_OUTPUT_BYTES, ProcessCapacityError, ProcessRunner } from "./index.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });
const nodeExecutable = path.basename(process.execPath);
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await sleep(20);
  }
}

describe("ProcessRunner", () => {
  it("runs argv without a shell in the requested directory", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const result = await new ProcessRunner().run({ executable: nodeExecutable, args: ["-e", "process.stdout.write(process.cwd())"], cwd: temporary });
    expect(result.exitCode).toBe(0);
    expect(path.resolve(result.stdout)).toBe(path.resolve(temporary));
  });

  it("preserves only platform user-location variables and strips arbitrary parent secrets", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const keys = process.platform === "win32"
      ? ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "QUEQIAO_TEST_SECRET"]
      : ["HOME", "QUEQIAO_TEST_SECRET"];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.QUEQIAO_TEST_SECRET = "must-not-reach-child";
      if (process.platform === "win32") {
        process.env.USERPROFILE = "C:\\Users\\queqiao-test";
        process.env.APPDATA = "C:\\Users\\queqiao-test\\AppData\\Roaming";
        process.env.LOCALAPPDATA = "C:\\Users\\queqiao-test\\AppData\\Local";
      } else {
        process.env.HOME = "/home/queqiao-test";
      }
      const probe = "process.stdout.write(JSON.stringify({USERPROFILE:process.env.USERPROFILE??null,APPDATA:process.env.APPDATA??null,LOCALAPPDATA:process.env.LOCALAPPDATA??null,HOME:process.env.HOME??null,SECRET:process.env.QUEQIAO_TEST_SECRET??null}))";
      const result = await new ProcessRunner().run({ executable: nodeExecutable, args: ["-e", probe], cwd: temporary });
      expect(result.exitCode).toBe(0);
      const child = JSON.parse(result.stdout) as Record<string, string | null>;
      expect(child.SECRET).toBeNull();
      if (process.platform === "win32") {
        expect(child.USERPROFILE).toBe("C:\\Users\\queqiao-test");
        expect(child.APPDATA).toBe("C:\\Users\\queqiao-test\\AppData\\Roaming");
        expect(child.LOCALAPPDATA).toBe("C:\\Users\\queqiao-test\\AppData\\Local");
      } else {
        expect(child.HOME).toBe("/home/queqiao-test");
      }
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("terminates timeout and bounded-output synchronous processes", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const runner = new ProcessRunner(2, 1024);
    const timeout = await runner.run({ executable: nodeExecutable, args: ["-e", "setInterval(()=>{},1000)"], cwd: temporary, timeoutMs: 100 });
    expect(timeout.timedOut).toBe(true);
    const output = await runner.run({ executable: nodeExecutable, args: ["-e", `process.stdout.write('x'.repeat(${MAX_PROCESS_OUTPUT_BYTES}))`], cwd: temporary });
    expect(output.outputLimitExceeded).toBe(true);
    expect(Buffer.byteLength(output.stdout)).toBe(1024);
  });

  it("keeps synchronous cancellation request-bound", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const runner = new ProcessRunner();
    const abort = new AbortController();
    const marker = path.join(temporary, "sync-accepted.txt");
    const aborted = runner.run({ executable: nodeExecutable, args: ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'accepted'); setInterval(()=>{},1000)`], cwd: temporary, signal: abort.signal });
    for (let attempts = 0; ; attempts += 1) {
      try { await access(marker); break; }
      catch {
        if (attempts >= 100) throw new Error("Timed out waiting for synchronous process acceptance marker");
        await sleep(20);
      }
    }
    abort.abort();
    await expect(aborted).resolves.toMatchObject({ aborted: true });
    expect(runner.activeCount()).toBe(0);
  });

  it("starts async processes, discards output, and detaches request cancellation after acceptance", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const marker = path.join(temporary, "accepted.txt");
    const abort = new AbortController();
    const runner = new ProcessRunner();
    const result = await runner.start({
      executable: nodeExecutable,
      args: ["-e", `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'accepted'),150)`],
      cwd: temporary,
      timeoutMs: 1000,
      signal: abort.signal,
    });
    expect(result).toMatchObject({ pid: expect.any(Number), timeoutMs: 1000, stdout: "discarded", stderr: "discarded" });
    expect(Number.isNaN(Date.parse(result.startedAt))).toBe(false);
    expect(runner.activeCount()).toBe(1);
    expect(runner.asyncCount()).toBe(1);
    abort.abort(new Error("request disconnected after acceptance"));
    await waitFor(() => runner.activeCount() === 0);
    await expect(readFile(marker, "utf8")).resolves.toBe("accepted");
    expect(runner.asyncCount()).toBe(0);
  });

  it("rejects async start if cancellation exists before acceptance", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const runner = new ProcessRunner();
    const abort = new AbortController();
    abort.abort(new Error("cancelled before start"));
    await expect(runner.start({ executable: nodeExecutable, args: ["-e", "setTimeout(()=>{},100)"], cwd: temporary, signal: abort.signal })).rejects.toThrow(/cancelled before start/);
    expect(runner.activeCount()).toBe(0);
    expect(runner.asyncCount()).toBe(0);
  });

  it("holds concurrency until an accepted async process exits and enforces its lifetime", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const marker = path.join(temporary, "should-not-exist.txt");
    const runner = new ProcessRunner(1);
    const accepted = await runner.start({
      executable: nodeExecutable,
      args: ["-e", `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'late'),600);setInterval(()=>{},1000)`],
      cwd: temporary,
      timeoutMs: 150,
    });
    expect(accepted.pid).toBeGreaterThan(0);
    expect(runner.activeCount()).toBe(1);
    await expect(runner.start({ executable: nodeExecutable, args: ["-e", "0"], cwd: temporary })).rejects.toBeInstanceOf(ProcessCapacityError);
    await waitFor(() => runner.activeCount() === 0);
    await sleep(500);
    await expect(access(marker)).rejects.toBeTruthy();
    expect(runner.asyncCount()).toBe(0);
  });

  it("terminates tracked async processes on orderly shutdown", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const marker = path.join(temporary, "shutdown-leak.txt");
    const runner = new ProcessRunner();
    await runner.start({
      executable: nodeExecutable,
      args: ["-e", `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'leaked'),500);setInterval(()=>{},1000)`],
      cwd: temporary,
      timeoutMs: 2000,
    });
    runner.shutdown();
    await waitFor(() => runner.activeCount() === 0);
    await sleep(550);
    await expect(access(marker)).rejects.toBeTruthy();
  });

  it("rejects shell syntax and excess synchronous concurrency", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-"));
    const runner = new ProcessRunner(1);
    await expect(runner.run({ executable: "node && calc", args: [], cwd: temporary })).rejects.toThrow(/basename/);
    if (process.platform === "win32") await expect(runner.run({ executable: "npm.cmd", args: [], cwd: temporary })).rejects.toThrow(/native/);
    const active = runner.run({ executable: nodeExecutable, args: ["-e", "setTimeout(()=>{},300)"], cwd: temporary });
    await waitFor(() => runner.activeCount() === 1);
    await expect(runner.run({ executable: nodeExecutable, args: [], cwd: temporary })).rejects.toBeInstanceOf(ProcessCapacityError);
    await active;
  });
});
