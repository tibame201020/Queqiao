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
    run: vi.fn(async () => ({
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
      cwd: ".", mode: "sync", timeoutMs: 45000 });
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

  it("enforces idempotency conflicts and cancellation ownership", async () => {
    const { service, coordinator } = await fixture();
    const task = await service.submit("owner", { taskId: "gateway-vitest", idempotencyKey: "same" });
    await expect(service.submit("owner", { taskId: "another", idempotencyKey: "same" })).rejects.toThrow(/idempotency/i);
    const cancelled = await service.cancel("owner", task.id);
    expect(cancelled.state).toBe("cancelled");
    expect(coordinator.fail).toHaveBeenCalledTimes(1);
  });
});
