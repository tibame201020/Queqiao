import { describe, expect, it } from "vitest";
import type { QueqiaoDoctorResult } from "./doctor.js";
import { createWorkstationDiagnosticsViewModel } from "./workstation-diagnostics.js";

function healthyResult(): QueqiaoDoctorResult {
  return {
    ok: true,
    gateways: [{
      name: "stable",
      role: "gateway",
      ok: true,
      configFile: "gateway.yaml",
      status: { name: "stable", role: "gateway", active: true, managed: true, pid: 100, health: { reachable: true, healthy: true, identityMatches: true, status: 200 } },
      routing: { ok: true, gateway: { reachable: true, status: 200 }, environments: [{ environmentId: "windows", reachable: true, checkedAt: "2026-08-31T00:00:00.000Z" }], workerDiagnostics: { supported: false, reason: "not advertised" } },
    }],
    workers: [{ name: "wins-worker", role: "worker", ok: true, configFile: "worker.yaml", status: { name: "wins-worker", role: "worker", active: true, managed: true, pid: 200, health: { reachable: true, healthy: true, identityMatches: true, status: 200 } } }],
    extensions: { ok: true, extensionCount: 2, workerCount: 1, issues: [] },
  };
}

describe("Workstation structured diagnostics", () => {
  it("projects healthy doctor output into Core, Routing, Extension Hub, and zero warnings", () => {
    const view = createWorkstationDiagnosticsViewModel(healthyResult());
    expect(view.ok).toBe(true);
    expect(view.core).toMatchObject([
      { key: "gateway:stable", state: "healthy", label: "Gateway stable" },
      { key: "worker:wins-worker", state: "healthy", label: "Worker wins-worker" },
    ]);
    expect(view.routing).toEqual([expect.objectContaining({ key: "route:stable:windows", state: "healthy", summary: "reachable" })]);
    expect(view.extensions).toMatchObject({ state: "healthy", extensionCount: 2, workerCount: 1, issues: [] });
    expect(view.warnings).toEqual([]);
  });

  it("surfaces stopped runtimes, unreachable routes, and Extension Hub issues with remediation", () => {
    const result = healthyResult();
    result.ok = false;
    result.gateways[0]!.ok = false;
    result.gateways[0]!.routing = { ok: false, gateway: { reachable: true, status: 503 }, environments: [{ environmentId: "linux", reachable: false, lastSuccessAt: "2026-08-30T23:59:00.000Z" }], workerDiagnostics: { supported: false, reason: "not advertised" } };
    result.workers[0]!.ok = false;
    result.workers[0]!.status = { name: "wins-worker", role: "worker", active: false, managed: true, health: { reachable: false, healthy: false, identityMatches: true } };
    result.extensions = { ok: false, extensionCount: 2, workerCount: 1, issues: ["dev.queqiao.mcp: module is missing"] };

    const view = createWorkstationDiagnosticsViewModel(result);
    expect(view.ok).toBe(false);
    expect(view.core).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "worker:wins-worker", state: "stopped", remediation: "Start Worker wins-worker." }),
    ]));
    expect(view.routing).toEqual([expect.objectContaining({ key: "route:stable:linux", state: "warning", remediation: expect.stringContaining("membership transport") })]);
    expect(view.extensions).toMatchObject({ state: "warning", summary: "1 issue" });
    expect(view.warnings.map((entry) => entry.source)).toEqual(expect.arrayContaining(["Gateway stable", "Worker wins-worker", "stable → linux", "Extension Hub"]));
  });
});
