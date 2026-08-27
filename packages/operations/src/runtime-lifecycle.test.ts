import { describe, expect, it } from "vitest";
import { buildRuntimeLifecycleProjection } from "./runtime-lifecycle.js";

describe("runtime lifecycle projection", () => {
  it("treats a healthy reachable process without a reconciled pid as unmanaged", () => {
    const state = buildRuntimeLifecycleProjection({ role: "gateway", name: "shadow", configured: true, reachable: true, healthy: true, identityMatches: true, endpoint: { url: "http://127.0.0.1:7675/", port: 7675 }, probedAt: "2026-08-27T00:00:00.000Z" });
    expect(state).toMatchObject({ readiness: { state: "ready" }, health: { state: "healthy" }, ownership: { state: "unmanaged" }, actions: { start: false, stop: false, restart: false } });
  });

  it("permits managed lifecycle actions only for a reconciled runtime", () => {
    const state = buildRuntimeLifecycleProjection({ role: "worker", name: "windows", configured: true, workspaceReady: true, reachable: true, healthy: true, identityMatches: true, managedPid: 1234, probedAt: "2026-08-27T00:00:00.000Z" });
    expect(state).toMatchObject({ ownership: { state: "managed", pid: 1234 }, actions: { stop: true, restart: true, start: false } });
  });

  it("distinguishes missing setup, missing Workspace, degraded health, and explicit identity conflict", () => {
    expect(buildRuntimeLifecycleProjection({ role: "gateway", name: "default", configured: false, reachable: false, healthy: false, identityMatches: false }).readiness.state).toBe("needs_setup");
    expect(buildRuntimeLifecycleProjection({ role: "worker", name: "windows", configured: true, workspaceReady: false, reachable: false, healthy: false, identityMatches: false }).readiness.state).toBe("needs_workspace");
    expect(buildRuntimeLifecycleProjection({ role: "worker", name: "windows", configured: true, workspaceReady: true, reachable: true, healthy: false, identityMatches: false }).health.state).toBe("degraded");
    expect(buildRuntimeLifecycleProjection({ role: "worker", name: "windows", configured: true, workspaceReady: true, reachable: true, healthy: false, identityMatches: false, identityConflict: true }).health.state).toBe("identity_conflict");
  });
});
