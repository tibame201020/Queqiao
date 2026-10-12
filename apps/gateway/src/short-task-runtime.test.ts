import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortTaskJournal, ShortTaskService } from "./short-task-runtime.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "queqiao-short-task-")); dirs.push(dir);
  const file = path.join(dir, "tasks.json");
  const lease = { leaseId: "11111111-1111-4111-8111-111111111111", state: "ready",
    providerMetadata: { runId: "78910", environmentId: "gha_111111111111411181111111" } };
  const coordinator = {
    provision: vi.fn(async () => ({ ...lease, state: "provisioning" })),
    get: vi.fn(() => ({ ...lease })),
    complete: vi.fn(async () => ({ state: "disposed" })),
    fail: vi.fn(async () => ({ state: "disposed" })),
  };
  const worker = {
    requireTool: vi.fn(async () => undefined),
    run: vi.fn(async (_input?: unknown, _signal?: AbortSignal) => ({
      value: { exitCode: 0, stdout: "8 passed", stderr: "", timedOut: false, aborted: false, outputLimitExceeded: false, durationMs: 65 },
      routing: { environmentId: lease.providerMetadata.environmentId, selectedTransport: "websocket" },
    })),
  };
  const workers = { current: vi.fn(async () => worker) };
  const options = { journal: new ShortTaskJournal(file), coordinator, workers,
    ownerSecret: "local-test-secret-at-least-32-bytes-for-hmac", sourceRevision: "a".repeat(40) };
  const service = new ShortTaskService(options);
  await service.restore();
  return { service, file, coordinator, workers, options };
}

describe("durable scoped Actions short-task engine (not exposed over production MCP)", () => {
  it("reserves one fixed task per owner, deduplicates replay and persists no OAuth client ID or secret", async () => {
    const { service, file, coordinator } = await fixture();
    const a = await service.submit("oauth-client-A", { taskId: "gateway-vitest", idempotencyKey: "request-1" });
    const b = await service.submit("oauth-client-A", { taskId: "gateway-vitest", idempotencyKey: "request-1" });
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ taskId: "gateway-vitest", state: "provisioning", runId: "78910" });
    expect(coordinator.provision).toHaveBeenCalledTimes(1);
    const serialized = await readFile(file, "utf8");
    expect(serialized).not.toMatch(/oauth-client-A|request-1|local-test-secret/);
    await expect(service.status("oauth-client-B", a.id)).rejects.toThrow(/not found/i);
    await expect(service.cancel("oauth-client-B", a.id)).rejects.toThrow(/not found/i);
    await expect(service.submit("oauth-client-A", { taskId: "gateway-vitest", idempotencyKey: "request-2" })).rejects.toThrow(/quota/i);
    await expect(service.submit("oauth-client-A", { taskId: "unknown", idempotencyKey: "request-3" })).rejects.toThrow(/catalog/i);
  });

  it("routes an exact approved CLI task to the leased Worker, records stdout/exit and disposes", async () => {
    const { service, workers, coordinator } = await fixture();
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "unique" });
    const done = await service.execute("owner", task.id);
    expect(done).toMatchObject({ state: "completed", exitCode: 0, stdout: "8 passed", runId: "78910",
      routing: { environmentId: "gha_111111111111411181111111", selectedTransport: "websocket" } });
    const w = await workers.current();
    expect(w.run).toHaveBeenCalledWith({ workspaceId: "runtime", environmentId: "gha_111111111111411181111111",
      executable: "node", args: ["node_modules/vitest/vitest.mjs", "run", "apps/gateway/src/actions-mcp-poc.test.ts", "--maxWorkers=2"],
      cwd: ".", mode: "sync", timeoutMs: 45000 }, expect.any(AbortSignal));
    expect(coordinator.complete).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    await expect(service.execute("other", task.id)).rejects.toThrow(/not found/i);
    expect((await service.status("owner", task.id)).state).toBe("completed");
  });

  it("survives process restart, marks interrupted tasks failed after coordinator recovery, and denies cross-owner replay", async () => {
    const { service, options, coordinator } = await fixture();
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "recovery" });
    const restarted = new ShortTaskService(options);
    await restarted.restore();
    expect((await options.journal.load()).find((entry) => entry.id === task.id)?.state).toBe("provisioning");
    await restarted.reconcileAfterRuntimeRecovery();
    expect((await restarted.status("owner", task.id)).state).toBe("failed");
    expect((await restarted.status("owner", task.id)).failureReason).toBe("gateway_restart");
    expect((await restarted.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "recovery" })).id).toBe(task.id);
    await expect(restarted.status("intruder", task.id)).rejects.toThrow(/not found/i);
    expect(coordinator.provision).toHaveBeenCalledTimes(1);
  });

  it("projects readiness and never exposes internal principal or idempotency digests", async () => {
    const { service, options } = await fixture();
    const submitted = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "ready" });
    expect(submitted).not.toHaveProperty("ownerDigest");
    expect(submitted).not.toHaveProperty("idempotencyDigest");
    const current = await service.status("owner", submitted.id);
    expect(current.state).toBe("ready");
    expect(current).not.toHaveProperty("ownerDigest");
    expect((await options.journal.load()).find((entry) => entry.id === submitted.id)?.state).toBe("ready");
  });

  it("serializes concurrent idempotent submits to a single provider dispatch", async () => {
    const { service, coordinator } = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.submit("owner", {
      taskId: "gateway-vitest", idempotencyKey: "same-concurrent-key",
    })));
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(coordinator.provision).toHaveBeenCalledTimes(1);
  });

  it("captures nonzero exit without inventing success and permits a next task", async () => {
    const { service, workers, coordinator } = await fixture();
    const worker = await workers.current();
    worker.run.mockResolvedValueOnce({ value: {
      exitCode: 7, stdout: "failure summary", stderr: "failed", durationMs: 10,
      timedOut: false, aborted: false, outputLimitExceeded: false,
    }, routing: { environmentId: "gha_111111111111411181111111", selectedTransport: "websocket" } });
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "task-fail" });
    const result = await service.execute("owner", task.id);
    expect(result).toMatchObject({ state: "failed", exitCode: 7, stderr: "failed", failureReason: "execution_failed" });
    expect(coordinator.complete).toHaveBeenCalledTimes(1);
    const second = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "task-after-fail" });
    expect(second.id).not.toBe(task.id);
  });

  it("retains active lease correlation when cancellation fails for operator reconciliation", async () => {
    const { service, coordinator, options } = await fixture();
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "cancel-error" });
    coordinator.fail.mockRejectedValueOnce(new Error("GitHub cancel unavailable"));
    await expect(service.cancel("owner", task.id)).rejects.toThrow(/unavailable/);
    const still = await service.status("owner", task.id);
    expect(still).toMatchObject({ leaseId: task.leaseId, runId: task.runId, failureReason: "cancel_failed" });
    expect((await options.journal.load()).find((entry) => entry.id === task.id)?.leaseId).toBe(task.leaseId);
  });
  it("rejects a different owner-HMAC key before loading existing task history", async () => {
    const { service, file, options } = await fixture();
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "persistent-key" });
    const rotated = new ShortTaskService({ ...options, ownerSecret: "different-owner-key-must-have-at-least-32-chars" });
    await expect(rotated.restore()).rejects.toThrow(/owner.*key|mismatch/i);
    const stored = JSON.parse(await readFile(file, "utf8"));
    expect(stored.ownerKeyProof).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(options.ownerSecret);
    expect(stored.tasks[0].id).toBe(task.id);
  });
  it("fails closed on corrupt checkpoint without losing previous good data", async () => {
    const { file, options } = await fixture();
    const fs = await import("node:fs/promises");
    await fs.writeFile(file, '{"version":1,"tasks":[{"unexpected":true}]}');
    const restarted = new ShortTaskService(options);
    await expect(restarted.restore()).rejects.toThrow();
  });

  it("rejects a mismatched routing receipt, cancels the lease and retains durable failure", async () => {
    const { service, workers, coordinator } = await fixture();
    const worker = await workers.current();
    worker.run.mockResolvedValueOnce({
      value: { exitCode: 0, stdout: "fake", stderr: "", timedOut: false, aborted: false, outputLimitExceeded: false, durationMs: 1 },
      routing: { environmentId: "different", selectedTransport: "websocket" },
    });
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "routing" });
    await expect(service.execute("owner", task.id)).rejects.toThrow(/routing/i);
    expect(coordinator.fail).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", expect.any(String));
    expect((await service.status("owner", task.id)).state).toBe("failed");
  });

  it("offers only an explicit, bounded cancellation smoke task in the Preview catalog", async () => {
    const { service, workers } = await fixture();
    const pending = await service.submit("owner", { taskId: "gateway-cancel-smoke", idempotencyKey: "fixed-smoke" });
    expect(pending.taskId).toBe("gateway-cancel-smoke");
    const done = await service.execute("owner", pending.id);
    expect(done.state).toBe("completed");
    const worker = await workers.current();
    expect(worker.run).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "runtime", executable: "node",
      args: ["scripts/runtime-cancel-smoke.mjs"], cwd: ".", mode: "sync",
      timeoutMs: 105000,
    }), expect.any(AbortSignal));
    await expect(service.submit("owner", { taskId: "arbitrary-shell", idempotencyKey: "bad" })).rejects.toThrow(/catalog/i);
  });
  it("keeps status responsive and cancels an in-flight Worker without waiting for run completion", async () => {
    const { service, workers, coordinator } = await fixture();
    const worker = await workers.current();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    let aborted = false;
    worker.run.mockImplementationOnce((_input, signal) => {
      started();
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => { aborted = true; reject(new Error("remote aborted")); }, { once: true });
      });
    });
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "in-flight" });
    const running = service.execute("owner", task.id);
    const rejected = expect(running).rejects.toThrow(/cancelled/i);
    await entered;
    const deadline = <T>(operation: Promise<T>) => Promise.race([
      operation, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("task lifecycle was blocked by the running CLI")), 700)),
    ]);
    expect((await deadline(service.status("owner", task.id))).state).toBe("running");
    await expect(deadline(service.execute("owner", task.id))).rejects.toThrow(/not runnable|already running/i);
    const ended = await deadline(service.cancel("owner", task.id));
    expect(ended.state).toBe("cancelled");
    expect(aborted).toBe(true);
    await rejected;
    expect(coordinator.fail).toHaveBeenCalledTimes(1);
    expect(coordinator.complete).not.toHaveBeenCalled();
    expect((await service.status("owner", task.id)).state).toBe("cancelled");
  });

  it("keeps status and other requests responsive during slow GitHub cancellation, deduplicates cancel", async () => {
    const { service, coordinator } = await fixture();
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "slow-provider-cancel" });
    let release!: () => void;
    coordinator.fail.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ state: "disposed" }); }));
    const cancel1 = service.cancel("owner", task.id);
    await vi.waitFor(() => expect(coordinator.fail).toHaveBeenCalledTimes(1));
    const status = await Promise.race([
      service.status("owner", task.id),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("status blocked by GitHub API cancellation")), 600)),
    ]);
    expect(status.state).toBe("cancelling");
    const cancel2 = service.cancel("owner", task.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(coordinator.fail).toHaveBeenCalledTimes(1);
    release();
    expect((await cancel1).state).toBe("cancelled");
    expect((await cancel2).state).toBe("cancelled");
    expect(coordinator.fail).toHaveBeenCalledTimes(1);
  });

  it("never dispatches a Worker command after cancellation while preflight is still pending", async () => {
    const { service, workers, coordinator } = await fixture();
    const worker = await workers.current();
    let preflightStarted!: () => void;
    let releasePreflight!: () => void;
    const entered = new Promise<void>((resolve) => { preflightStarted = resolve; });
    worker.requireTool.mockImplementationOnce(async () => {
      preflightStarted();
      await new Promise<void>((resolve) => { releasePreflight = resolve; });
    });
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "pending-preflight" });
    const execution = service.execute("owner", task.id);
    const rejected = expect(execution).rejects.toThrow(/cancelled/i);
    await entered;
    await expect(service.cancel("owner", task.id)).resolves.toMatchObject({ state: "cancelled" });
    releasePreflight();
    await rejected;
    await Promise.resolve();
    expect(worker.run).not.toHaveBeenCalled();
    expect(coordinator.complete).not.toHaveBeenCalled();
    expect(coordinator.fail).toHaveBeenCalledTimes(1);
  });
  it("rejects concurrent cross-owner cancellation without stopping the owner process", async () => {
    const { service, workers, coordinator } = await fixture();
    const worker = await workers.current();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    let resolveRun!: (value: Awaited<ReturnType<typeof worker.run>>) => void;
    let abortSeen = false;
    worker.run.mockImplementationOnce((_input, signal) => {
      started();
      signal?.addEventListener("abort", () => { abortSeen = true; });
      return new Promise((resolve) => { resolveRun = resolve; });
    });
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "foreign-denial" });
    const execution = service.execute("owner", task.id);
    await entered;
    await expect(Promise.race([
      service.cancel("intruder", task.id),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("cross-owner check blocked")), 700)),
    ])).rejects.toThrow(/not found/i);
    expect(abortSeen).toBe(false);
    resolveRun({
      value: { exitCode: 0, stdout: "8 passed", stderr: "", durationMs: 1,
        timedOut: false, aborted: false, outputLimitExceeded: false },
      routing: { environmentId: "gha_111111111111411181111111", selectedTransport: "websocket" },
    });
    await expect(execution).resolves.toMatchObject({ state: "completed", exitCode: 0 });
    expect(coordinator.complete).toHaveBeenCalledTimes(1);
    expect(coordinator.fail).not.toHaveBeenCalled();
  });

  it("preserves a retryable cancellation state on provider failure during active execution", async () => {
    const { service, workers, coordinator, options } = await fixture();
    const worker = await workers.current();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    worker.run.mockImplementationOnce((_input, signal) => {
      started();
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "retry-active-cancel" });
    coordinator.fail.mockRejectedValueOnce(new Error("transient cancellation error"));
    const execution = service.execute("owner", task.id);
    const rejected = expect(execution).rejects.toThrow(/cancelled/i);
    await entered;
    await expect(service.cancel("owner", task.id)).rejects.toThrow(/transient cancellation/);
    expect(await service.status("owner", task.id)).toMatchObject({ state: "cancelling", failureReason: "cancel_failed" });
    await expect(service.cancel("owner", task.id)).resolves.toMatchObject({ state: "cancelled" });
    await rejected;
    expect(coordinator.fail).toHaveBeenCalledTimes(2);
    expect((await options.journal.load()).find((entry) => entry.id === task.id)?.state).toBe("cancelled");
  });
  it("enforces idempotency conflicts and cancellation ownership", async () => {
    const { service, coordinator } = await fixture();
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "same" });
    await expect(service.submit("owner", { taskId: "another", idempotencyKey: "same" })).rejects.toThrow(/idempotency/i);
    const cancelled = await service.cancel("owner", task.id);
    expect(cancelled.state).toBe("cancelled");
    expect(coordinator.fail).toHaveBeenCalledTimes(1);
  });
});
