import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessRunner } from "./index.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });
const nodeExecutable = path.basename(process.execPath);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T, accept: (value: T) => boolean, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for job state");
    await sleep(20);
  }
}

describe("ProcessRunner durable jobs", () => {
  it("retains completion metadata and bounded logs after the request returns", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-job-"));
    const runner = new ProcessRunner(1, 64);
    const started = await runner.startJob({
      executable: nodeExecutable,
      args: ["-e", "process.stdout.write('hello-job'); process.stderr.write('warn-job')"],
      cwd: temporary,
      workspaceId: "one",
      timeoutMs: 2000,
    });

    expect(started.state).toMatch(/queued|running/);
    const final = await waitFor(
      () => runner.jobStatus(started.jobId),
      (value) => value.state === "completed",
    );
    expect(final).toMatchObject({ state: "completed", exitCode: 0, workspaceId: "one" });
    expect(runner.jobLogs(started.jobId)).toMatchObject({ stdout: "hello-job", stderr: "warn-job", truncated: false });
  });

  it("queues work when background capacity is full and drains in order", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-job-"));
    const runner = new ProcessRunner(1, 1024, 1, 4);
    const first = await runner.startJob({
      executable: nodeExecutable,
      args: ["-e", "setTimeout(()=>{},180)"],
      cwd: temporary,
      workspaceId: "one",
      timeoutMs: 2000,
    });
    const second = await runner.startJob({
      executable: nodeExecutable,
      args: ["-e", "process.stdout.write('second')"],
      cwd: temporary,
      workspaceId: "one",
      timeoutMs: 2000,
    });

    expect(runner.jobStatus(first.jobId).state).toBe("running");
    expect(runner.jobStatus(second.jobId).state).toBe("queued");
    await waitFor(() => runner.jobStatus(second.jobId), (value) => value.state === "completed");
    expect(runner.jobLogs(second.jobId).stdout).toBe("second");
  });

  it("deduplicates retries with the same workspace idempotency key", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-job-"));
    const runner = new ProcessRunner();
    const request = {
      executable: nodeExecutable,
      args: ["-e", "setTimeout(()=>{},100)"],
      cwd: temporary,
      workspaceId: "one",
      timeoutMs: 2000,
      idempotencyKey: "same-request",
    };
    const first = await runner.startJob(request);
    const second = await runner.startJob(request);
    expect(second.jobId).toBe(first.jobId);
    await waitFor(() => runner.jobStatus(first.jobId), (value) => value.state === "completed");
  });

  it("cancels queued and running jobs without losing final status", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-job-"));
    const runner = new ProcessRunner(1, 1024, 1, 4);
    const running = await runner.startJob({
      executable: nodeExecutable,
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: temporary,
      workspaceId: "one",
      timeoutMs: 5000,
    });
    const queued = await runner.startJob({
      executable: nodeExecutable,
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: temporary,
      workspaceId: "one",
      timeoutMs: 5000,
    });

    expect(runner.cancelJob(queued.jobId)).toBe(true);
    expect(runner.jobStatus(queued.jobId).state).toBe("cancelled");
    expect(runner.cancelJob(running.jobId)).toBe(true);
    await waitFor(() => runner.jobStatus(running.jobId), (value) => value.state === "cancelled");
  });
});
