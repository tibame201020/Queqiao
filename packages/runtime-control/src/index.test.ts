import { describe, expect, it, vi } from "vitest";
import {
  bindRuntimeWorker,
  createRuntimeLease,
  expireRuntimeLease,
  recordProviderRuntime,
  runtimeLeaseSchema,
  runtimeProviderMetadataSchema,
  transitionRuntimeLease,
  type RuntimeProvider,
} from "./index.js";

const at = (second: number) => new Date(Date.UTC(2026, 9, 8, 0, 0, second)).toISOString();

function requested() {
  return createRuntimeLease({
    leaseId: "11111111-1111-4111-8111-111111111111",
    providerId: "github-actions",
    ttlSeconds: 60,
    now: at(0),
    metadata: { runtimeKind: "ephemeral" },
  });
}

describe("Runtime Lease lifecycle", () => {
  it("moves through provider-neutral provisioning, Worker registration, readiness, execution, completion, and disposal", () => {
    let lease = requested();
    expect(lease.state).toBe("requested");

    lease = transitionRuntimeLease(lease, { type: "begin-provisioning" }, at(1));
    lease = recordProviderRuntime(lease, {
      providerRef: "workflow-run:123",
      metadata: { runner: "hosted" },
    });
    expect(lease.state).toBe("provisioning");

    lease = bindRuntimeWorker(lease, {
      workerId: "22222222-2222-4222-8222-222222222222",
      environmentId: "github-actions",
    }, at(2));
    expect(lease.state).toBe("registered");

    lease = transitionRuntimeLease(lease, { type: "ready" }, at(3));
    lease = transitionRuntimeLease(lease, { type: "running" }, at(4));
    lease = transitionRuntimeLease(lease, { type: "completed" }, at(5));
    lease = transitionRuntimeLease(lease, { type: "disposed" }, at(6));

    expect(lease).toMatchObject({
      state: "disposed",
      providerId: "github-actions",
      providerRef: "workflow-run:123",
      worker: {
        workerId: "22222222-2222-4222-8222-222222222222",
        environmentId: "github-actions",
      },
      terminal: { outcome: "completed", at: at(5) },
      disposedAt: at(6),
    });
    expect(runtimeLeaseSchema.parse(lease)).toEqual(lease);
  });

  it("expires an active lease only after its TTL and requires explicit disposal", () => {
    let lease = transitionRuntimeLease(requested(), { type: "begin-provisioning" }, at(1));
    expect(expireRuntimeLease(lease, at(59))).toEqual(lease);

    lease = expireRuntimeLease(lease, at(60));
    expect(lease).toMatchObject({
      state: "expired",
      terminal: { outcome: "expired", at: at(60) },
    });

    lease = transitionRuntimeLease(lease, { type: "disposed" }, at(61));
    expect(lease.state).toBe("disposed");
  });

  it("makes duplicate terminal transitions idempotent and rejects conflicting outcomes", () => {
    let lease = transitionRuntimeLease(requested(), { type: "begin-provisioning" }, at(1));
    lease = bindRuntimeWorker(lease, {
      workerId: "22222222-2222-4222-8222-222222222222",
      environmentId: "github-actions",
    }, at(2));
    lease = transitionRuntimeLease(lease, { type: "ready" }, at(3));
    lease = transitionRuntimeLease(lease, { type: "running" }, at(4));
    const completed = transitionRuntimeLease(lease, { type: "completed" }, at(5));

    expect(transitionRuntimeLease(completed, { type: "completed" }, at(9))).toEqual(completed);
    expect(() => transitionRuntimeLease(completed, { type: "failed", detail: "late failure" }, at(9))).toThrow(/terminal outcome/i);

    const disposed = transitionRuntimeLease(completed, { type: "disposed" }, at(10));
    expect(transitionRuntimeLease(disposed, { type: "disposed" }, at(11))).toEqual(disposed);
  });

  it("binds one Worker identity idempotently and rejects replacement", () => {
    let lease = transitionRuntimeLease(requested(), { type: "begin-provisioning" }, at(1));
    const worker = {
      workerId: "22222222-2222-4222-8222-222222222222",
      environmentId: "github-actions",
    };
    lease = bindRuntimeWorker(lease, worker, at(2));
    expect(bindRuntimeWorker(lease, worker, at(3))).toEqual(lease);

    expect(() => bindRuntimeWorker(lease, {
      workerId: "33333333-3333-4333-8333-333333333333",
      environmentId: "other-runtime",
    }, at(3))).toThrow(/already bound/i);
  });

  it("rejects secret-like provider metadata", () => {
    expect(() => runtimeProviderMetadataSchema.parse({ token: "must-not-persist" })).toThrow();
    expect(() => runtimeProviderMetadataSchema.parse({ authorizationHeader: "must-not-persist" })).toThrow();
    expect(runtimeProviderMetadataSchema.parse({ workflowRun: "123", region: "test" })).toEqual({
      workflowRun: "123",
      region: "test",
    });
  });
});

describe("Runtime Provider boundary", () => {
  it("lets a GitHub Actions-shaped provider keep provider API and credentials behind the interface", async () => {
    const provision = vi.fn(async (request) => {
      expect(request).toEqual({
        leaseId: "11111111-1111-4111-8111-111111111111",
        ttlSeconds: 60,
        metadata: { runtimeKind: "ephemeral" },
      });
      return {
        providerRef: "workflow-run:123",
        metadata: { runner: "hosted" },
      };
    });
    const dispose = vi.fn(async () => undefined);
    const provider: RuntimeProvider = {
      id: "github-actions",
      provision,
      dispose,
    };

    const lease = requested();
    const result = await provider.provision({
      leaseId: lease.leaseId,
      ttlSeconds: 60,
      metadata: lease.metadata,
    });

    expect(result.providerRef).toBe("workflow-run:123");
    expect(provision).toHaveBeenCalledOnce();
    await provider.dispose({
      leaseId: lease.leaseId,
      providerRef: result.providerRef,
      reason: "completed",
    });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
