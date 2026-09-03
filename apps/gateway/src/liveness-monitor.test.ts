import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayLivenessMonitor } from "./liveness-monitor.js";
import type { MembershipWorkerRegistry } from "./worker-membership-registry.js";

afterEach(() => vi.useRealTimers());

describe("GatewayLivenessMonitor", () => {
  it("keeps health snapshots read-only and probes only on the configured low-frequency schedule", async () => {
    vi.useFakeTimers();
    const probeLiveness = vi.fn(async () => [{ environmentId: "windows", reachable: true }]);
    const livenessSnapshot = vi.fn(() => [{ environmentId: "windows", reachable: true, checkedAt: "2026-08-15T00:00:00.000Z" }]);
    const source = { current: vi.fn(async () => ({ probeLiveness, livenessSnapshot })) } as unknown as MembershipWorkerRegistry;
    const monitor = new GatewayLivenessMonitor(source, 30_000);

    await monitor.start();
    expect(probeLiveness).toHaveBeenCalledTimes(1);
    await expect(monitor.snapshot()).resolves.toEqual([{ environmentId: "windows", reachable: true, checkedAt: "2026-08-15T00:00:00.000Z" }]);
    expect(probeLiveness).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(probeLiveness).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(probeLiveness).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it("coalesces overlapping probes but preserves one requested reprobe after the active probe finishes", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const probeLiveness = vi.fn()
      .mockImplementationOnce(async () => firstPending)
      .mockResolvedValue([]);
    const source = { current: vi.fn(async () => ({ probeLiveness, livenessSnapshot: () => [] })) } as unknown as MembershipWorkerRegistry;
    const monitor = new GatewayLivenessMonitor(source, 30_000);

    const first = monitor.probeNow();
    const second = monitor.probeNow();
    const third = monitor.probeNow();
    await Promise.resolve();
    expect(probeLiveness).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second, third]);
    expect(probeLiveness).toHaveBeenCalledTimes(2);
  });
});
