import { describe, expect, it, vi } from "vitest";
import { WorkerReverseSessionManager } from "./reverse-session-manager.js";

function fakeClientFactory(outcomes: Array<"ok" | "fail">, events: Array<{ target: string; credential: string; ca: string }>, clients: any[] = []) {
  return (config: any) => {
    const client = {
      connectTls: vi.fn(async (ca: string) => {
        events.push({ target: config.target, credential: config.credential, ca });
        if (outcomes.shift() === "fail") throw new Error("gateway offline");
      }),
      close: vi.fn(),
      triggerDisconnect: () => config.onDisconnect?.(new Error("stream lost")),
    };
    clients.push(client);
    return client;
  };
}

describe("WorkerReverseSessionManager", () => {
  it("activates a provisional TLS session once without reconnecting when no durable reverse config exists", async () => {
    vi.useFakeTimers();
    const events: Array<{ target: string; credential: string; ca: string }> = [];
    const clients: any[] = [];
    const manager = new WorkerReverseSessionManager({
      service: { execute: vi.fn() } as any,
      credential: { current: async () => "c".repeat(48) },
      loadPersistent: async () => undefined,
      createClient: fakeClientFactory(["ok"], events, clients) as any,
      random: () => 0.5,
    });

    await manager.activate({ target: "gateway.local:7573", credential: "p".repeat(48), caCertificate: "CERT" });
    clients[0].triggerDisconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toHaveLength(1);
    manager.close();
    vi.useRealTimers();
  });

  it("keeps Worker startup available and retries durable sessions with bounded exponential backoff", async () => {
    vi.useFakeTimers();
    const events: Array<{ target: string; credential: string; ca: string }> = [];
    const manager = new WorkerReverseSessionManager({
      service: { execute: vi.fn() } as any,
      credential: { current: async () => "m".repeat(48) },
      loadPersistent: async () => ({ target: "gateway.local:7573", caCertificate: "CERT" }),
      createClient: fakeClientFactory(["fail", "fail", "ok"], events) as any,
      random: () => 0.5,
    });

    await expect(manager.startPersistent()).resolves.toBeUndefined();
    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(events).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(3);
    expect(manager.connected).toBe(true);
    manager.close();
    vi.useRealTimers();
  });
});