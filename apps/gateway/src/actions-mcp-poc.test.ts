import { describe, expect, it, vi } from "vitest";
import { ActionsMcpPoc, type RuntimeCoordinatorPort, type RuntimeWorkerPort } from "./actions-mcp-poc.js";

function fixture() {
  const lease = {
    leaseId: "11111111-1111-4111-8111-111111111111",
    state: "provisioning",
    providerMetadata: { runId: "12345", environmentId: "gha_111111111111411181111111" },
  };
  const coordinator = {
    provision: vi.fn(async () => ({ ...lease })),
    get: vi.fn(() => ({ ...lease })),
    complete: vi.fn(async () => ({ ...lease, state: "disposed" })),
    fail: vi.fn(async () => ({ ...lease, state: "disposed" })),
  };
  const reader = {
    requireTool: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ({
      value: {
        path: "poc-marker.txt",
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        text: "QUEQIAO-GITHUB-CONNECTOR-OK\n",
      },
      routing: { environmentId: lease.providerMetadata.environmentId, selectedTransport: "websocket", requestedTransport: null, selectionReason: "configured_order" },
    })),
  };
  const workers = { current: vi.fn(async () => reader) };
  const service = new ActionsMcpPoc(coordinator as unknown as RuntimeCoordinatorPort, workers as unknown as RuntimeWorkerPort);
  return { lease, coordinator, reader, workers, service };
}

describe("opt-in Actions MCP POC control", () => {
  it("provisions for the OAuth principal, reads only the fixed marker from the enrolled environment and disposes", async () => {
    const { service, lease, coordinator, reader } = fixture();
    expect(await service.start("client-a")).toMatchObject({ state: "provisioning", environmentId: lease.providerMetadata.environmentId, runId: "12345" });
    expect(coordinator.provision).toHaveBeenCalledWith({ ttlSeconds: 180, metadata: { purpose: "chatgpt-gate-c-poc" } });
    lease.state = "ready";
    expect(await service.status("client-a")).toMatchObject({ state: "ready" });
    expect(await service.readMarker("client-a")).toMatchObject({
      marker: "QUEQIAO-GITHUB-CONNECTOR-OK", state: "disposed", environmentId: lease.providerMetadata.environmentId,
    });
    expect(reader.requireTool).toHaveBeenCalledWith("runtime", "read_file", lease.providerMetadata.environmentId);
    expect(reader.readFile).toHaveBeenCalledWith({
      workspaceId: "runtime", environmentId: lease.providerMetadata.environmentId, path: "poc-marker.txt", offset: 0, limit: 1,
    });
    expect(coordinator.complete).toHaveBeenCalledWith(lease.leaseId);
    expect(coordinator.fail).not.toHaveBeenCalled();
  });

  it("does not dispatch two overlapping workers, including concurrent start requests", async () => {
    const { service, coordinator } = fixture();
    const pending = service.start("client-a");
    await expect(service.start("client-b")).rejects.toThrow(/active|progress/i);
    await pending;
    await expect(service.start("client-a")).rejects.toThrow(/active|progress/i);
    expect(coordinator.provision).toHaveBeenCalledTimes(1);
  });

  it("does not expose leases across OAuth clients", async () => {
    const { service, coordinator } = fixture();
    await service.start("client-a");
    expect(() => service.status("client-b")).toThrow(/not found/i);
    await expect(service.readMarker("client-b")).rejects.toThrow(/not found/i);
    await expect(service.cancel("client-b")).rejects.toThrow(/not found/i);
    expect(coordinator.fail).not.toHaveBeenCalled();
  });

  it("waits for readiness instead of trying to read before the Worker joins", async () => {
    const { service, reader } = fixture();
    await service.start("client-a");
    expect(await service.readMarker("client-a")).toEqual({ state: "provisioning", ready: false });
    expect(reader.readFile).not.toHaveBeenCalled();
  });

  it("cancels the Worker when its routing receipt is for the wrong environment", async () => {
    const { service, lease, reader, coordinator } = fixture();
    await service.start("client-a");
    lease.state = "ready";
    reader.readFile.mockResolvedValueOnce({
      value: { path: "poc-marker.txt", startLine: 1, endLine: 1, totalLines: 1, text: "QUEQIAO-GITHUB-CONNECTOR-OK\n" },
      routing: { environmentId: "windows", selectedTransport: "websocket", requestedTransport: null, selectionReason: "configured_order" },
    });
    await expect(service.readMarker("client-a")).rejects.toThrow(/mismatch/i);
    expect(coordinator.fail).toHaveBeenCalledWith(lease.leaseId, expect.any(String));
    expect(coordinator.complete).not.toHaveBeenCalled();
  });

  it("rejects marker spoofing and cancels the provisioned Worker", async () => {
    const { service, lease, reader, coordinator } = fixture();
    await service.start("client-a");
    lease.state = "ready";
    reader.readFile.mockResolvedValueOnce({
      value: { path: "poc-marker.txt", startLine: 1, endLine: 1, totalLines: 1, text: "spoofed\n" },
      routing: { environmentId: lease.providerMetadata.environmentId, selectedTransport: "websocket", requestedTransport: null, selectionReason: "configured_order" },
    });
    await expect(service.readMarker("client-a")).rejects.toThrow(/marker/i);
    expect(coordinator.fail).toHaveBeenCalled();
  });

  it("allows cancellation without reading, and bounds new provisioning attempts", async () => {
    const { service, coordinator } = fixture();
    await service.start("client-a");
    expect(await service.cancel("client-a")).toEqual({ state: "disposed" });
    await service.start("client-a");
    await service.cancel("client-a");
    await service.start("client-a");
    await service.cancel("client-a");
    await expect(service.start("client-a")).rejects.toThrow(/limit/i);
    expect(coordinator.provision).toHaveBeenCalledTimes(3);
  });

  it("recovers from a failed provider dispatch without retaining the in-flight lock", async () => {
    const { service, coordinator } = fixture();
    coordinator.provision.mockRejectedValueOnce(new Error("GitHub unreachable"));
    await expect(service.start("client-a")).rejects.toThrow(/GitHub unreachable/);
    await expect(service.start("client-a")).resolves.toMatchObject({ state: "provisioning" });
  });
});
