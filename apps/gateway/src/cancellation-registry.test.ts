import { describe, expect, it, vi } from "vitest";
import { McpCancellationCapacityError, McpCancellationRegistry, extractCancelledRequest, extractToolCallRequestIds } from "./cancellation-registry.js";

describe("McpCancellationRegistry", () => {
  it("binds cancellation to the OAuth principal", () => {
    const registry = new McpCancellationRegistry(8, 4, 10_000);
    const lease = registry.begin("client-a", 7);
    expect(registry.cancel("client-b", 7, "wrong principal")).toBe(false);
    expect(lease.signal.aborted).toBe(false);
    expect(registry.cancel("client-a", 7, "owner cancelled")).toBe(true);
    expect(lease.signal.aborted).toBe(true);
    lease.release();
    expect(registry.size()).toBe(0);
  });

  it("fails closed at per-principal and global capacity", () => {
    const registry = new McpCancellationRegistry(2, 1, 10_000);
    const first = registry.begin("client-a", "a");
    expect(() => registry.begin("client-a", "b")).toThrow(McpCancellationCapacityError);
    const second = registry.begin("client-b", "b");
    expect(() => registry.begin("client-c", "c")).toThrow(McpCancellationCapacityError);
    first.release(); second.release();
  });

  it("expires stale correlation state and aborts its signal", async () => {
    vi.useFakeTimers();
    const registry = new McpCancellationRegistry(2, 2, 50);
    const lease = registry.begin("client-a", 1);
    await vi.advanceTimersByTimeAsync(51);
    expect(lease.signal.aborted).toBe(true);
    expect(registry.size()).toBe(0);
    vi.useRealTimers();
  });

  it("only extracts structurally valid tool-call and cancellation identifiers", () => {
    expect(extractToolCallRequestIds({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run", arguments: {} } })).toEqual([1]);
    expect(extractToolCallRequestIds({ id: 1, method: "tools/call", params: { name: "run" } })).toEqual([]);
    expect(extractCancelledRequest({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1, reason: "stop" } })).toEqual({ requestId: 1, reason: "stop" });
    expect(extractCancelledRequest({ jsonrpc: "2.0", method: "notifications/cancelled", id: 3, params: { requestId: 1 } })).toBeUndefined();
    expect(extractCancelledRequest({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1, _meta: "bad" } })).toBeUndefined();
  });
});
