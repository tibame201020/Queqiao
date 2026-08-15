import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayLivenessMonitor } from "./liveness-monitor.js";
import type { ReloadableWorkerRegistry } from "./worker-registry-config.js";

afterEach(() => vi.useRealTimers());

describe("GatewayLivenessMonitor", () => {
  it("keeps health snapshots read-only and probes only on the configured low-frequency schedule", async () => {
    vi.useFakeTimers();
    const probeLiveness = vi.fn(async () => [{ environmentId: "windows", reachable: true }]);
    const livenessSnapshot = vi.fn(() => [{ environmentId: "windows", reachable: true, checkedAt: "2026-08-15T00:00:00.000Z" }]);
    const source = { current: vi.fn(async () => ({ probeLiveness, livenessSnapshot })) } as unknown as ReloadableWorkerRegistry;
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

  it("coalesces overlapping probes instead of starting one loop per Worker or request", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const probeLiveness = vi.fn(async () => pending);
    const source = { current: vi.fn(async () => ({ probeLiveness, livenessSnapshot: () => [] })) } as unknown as ReloadableWorkerRegistry;
    const monitor = new GatewayLivenessMonitor(source, 30_000);

    const first = monitor.probeNow();
    const second = monitor.probeNow();
    await Promise.resolve();
    expect(probeLiveness).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
  });
});
