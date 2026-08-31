import { describe, expect, it, vi } from "vitest";
import type { WorkerTransport } from "./worker-transport.js";
import { WorkerSessionRegistry } from "./worker-session-registry.js";

function hello(workerId: string, environmentId: string, instanceId: string) {
  return { protocolVersion: "3.0" as const, workerId, environmentId, instanceId, platform: "linux" as const, capabilities: [] };
}

function sessionTransport() {
  return {
    execute: vi.fn<WorkerTransport["execute"]>(),
    close: vi.fn(),
  };
}

describe("Worker reverse-session registry", () => {
  it("attaches one authenticated active session to a stable workerId", () => {
    const registry = new WorkerSessionRegistry();
    const transport = sessionTransport();
    const attached = registry.attach(
      hello("11111111-1111-4111-8111-111111111111", "linux", "22222222-2222-4222-8222-222222222222"),
      transport,
      { kind: "membership" },
    );

    expect(registry.require(attached.workerId)).toMatchObject({ sessionId: attached.sessionId, environmentId: "linux", transport, authentication: { kind: "membership" } });
    expect(registry.snapshot()).toEqual([{ workerId: attached.workerId, environmentId: "linux", instanceId: "22222222-2222-4222-8222-222222222222", sessionId: attached.sessionId }]);
  });

  it("fails closed on duplicate active workerId or environmentId", () => {
    const registry = new WorkerSessionRegistry();
    const original = sessionTransport();
    registry.attach(hello("11111111-1111-4111-8111-111111111111", "linux", "22222222-2222-4222-8222-222222222222"), original, { kind: "membership" });

    expect(() => registry.attach(hello("11111111-1111-4111-8111-111111111111", "windows", "33333333-3333-4333-8333-333333333333"), sessionTransport(), { kind: "membership" })).toThrow(/workerId.*already active/i);
    expect(() => registry.attach(hello("44444444-4444-4444-8444-444444444444", "linux", "55555555-5555-4555-8555-555555555555"), sessionTransport(), { kind: "membership" })).toThrow(/environmentId.*already active/i);
    expect(registry.require("11111111-1111-4111-8111-111111111111").transport).toBe(original);
  });

  it("binds provisional sessions to one join transaction and promotes only the matching transaction", () => {
    const registry = new WorkerSessionRegistry();
    const workerId = "11111111-1111-4111-8111-111111111111";
    registry.attach(hello(workerId, "linux", "22222222-2222-4222-8222-222222222222"), sessionTransport(), { kind: "provisional", transactionId: "txn-1" });

    expect(() => registry.promote(workerId, "txn-wrong")).toThrow(/transaction/i);
    expect(registry.require(workerId).authentication).toEqual({ kind: "provisional", transactionId: "txn-1" });
    expect(registry.promote(workerId, "txn-1").authentication).toEqual({ kind: "membership" });
  });

  it("detaches only the matching session and closes its pending transport", () => {
    const registry = new WorkerSessionRegistry();
    const transport = sessionTransport();
    const attached = registry.attach(hello("11111111-1111-4111-8111-111111111111", "linux", "22222222-2222-4222-8222-222222222222"), transport, { kind: "membership" });

    expect(registry.detach("not-the-session", new Error("wrong"))).toBe(false);
    expect(registry.detach(attached.sessionId, new Error("connection closed"))).toBe(true);
    expect(transport.close).toHaveBeenCalledWith(expect.objectContaining({ message: "connection closed" }));
    expect(() => registry.require(attached.workerId)).toThrow(/no active reverse Worker session/i);
  });

  it("can revoke only the provisional session bound to a failed transaction", () => {
    const registry = new WorkerSessionRegistry();
    const transport = sessionTransport();
    const workerId = "11111111-1111-4111-8111-111111111111";
    registry.attach(hello(workerId, "linux", "22222222-2222-4222-8222-222222222222"), transport, { kind: "provisional", transactionId: "txn-1" });

    expect(registry.detachProvisional("txn-wrong", new Error("wrong transaction"))).toBe(false);
    expect(registry.detachProvisional("txn-1", new Error("join failed"))).toBe(true);
    expect(transport.close).toHaveBeenCalledWith(expect.objectContaining({ message: "join failed" }));
  });
});
