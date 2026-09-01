import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { WorkstationSnapshot } from "./workstation.js";
import type { WorkstationInspectorDetail, WorkstationInspectorTarget } from "./workstation-inspector.js";
import { WorkstationApp } from "./workstation-ui.js";

const delay = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for Diagnostics UI");
}

function snapshot(): WorkstationSnapshot {
  return {
    gateways: [{ name: "stable", configured: true, running: true, managed: true, publicUrl: "https://example.test/stable/", servicePort: 8075, managementPort: 8074 }],
    workers: [{ name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: 1 }],
    workspaces: [{ workerName: "wins-worker", id: "queqiao", displayName: "Queqiao", root: "C:\\codes\\Queqiao", profile: "coding" }],
    profiles: [],
    extensions: [],
    gatewayCount: 1,
    runningGatewayCount: 1,
    workerCount: 1,
    runningWorkerCount: 1,
    workspaceCount: 1,
    profileCount: 0,
    customProfileCount: 0,
    extensionCount: 0,
    attachmentCount: 0,
    gettingStarted: [],
  };
}

function diagnosticsDetail(): WorkstationInspectorDetail {
  return {
    kind: "diagnostics",
    key: "diagnostics",
    diagnostics: {
      ok: false,
      core: [
        { key: "gateway:stable", label: "Gateway stable", state: "warning", summary: "degraded · HTTP 503", remediation: "Inspect Gateway health and downstream routing." },
        { key: "worker:wins-worker", label: "Worker wins-worker", state: "healthy", summary: "healthy · HTTP 200" },
      ],
      routing: [{ key: "route:stable:linux", label: "stable → linux", state: "warning", summary: "unreachable", remediation: "Check the Worker runtime and Gateway membership transport." }],
      extensions: { state: "healthy", summary: "healthy", extensionCount: 1, workerCount: 1, issues: [] },
      warnings: [
        { key: "gateway:stable", source: "Gateway stable", summary: "degraded · HTTP 503", remediation: "Inspect Gateway health and downstream routing." },
        { key: "route:stable:linux", source: "stable → linux", summary: "unreachable", remediation: "Check the Worker runtime and Gateway membership transport." },
      ],
    },
  };
}

describe("Workstation structured Diagnostics UI", () => {
  it("renders Core, Routing, Extension Hub, and Warnings from lazy Diagnostics detail", async () => {
    const loadInspectorDetail = vi.fn(async (target): Promise<WorkstationInspectorDetail> => {
      if (target.kind !== "diagnostics") throw new Error("unexpected target");
      return diagnosticsDetail();
    });
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      executeDirect={async () => ({ title: "ok", body: "ok" })}
      executeFlow={async () => ({ title: "ok", body: "ok" })}
      loadInspectorDetail={loadInspectorDetail}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={100}
      terminalHeight={28}
    />);
    ui.stdin.write("6");
    await waitFor(() => (ui.lastFrame() || "").includes("2 ISSUES"));
    const frame = ui.lastFrame() || "";
    expect(frame).toMatch(/Core checks\s+2/);
    expect(frame).toMatch(/Routes\s+1/);
    expect(frame).toMatch(/Warnings\s+2/);
    expect(frame).toContain("! 2 health issues · 2/2 runtimes");
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("i"); await delay();
    expect(ui.lastFrame()).toContain("[Summary]");
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Core]");
    expect(ui.lastFrame()).toContain("Gateway stable · degraded");
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Routing]");
    expect(ui.lastFrame()).toContain("stable → linux · unreachable");
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Extensions]");
    expect(ui.lastFrame()).toContain("✓ healthy");
    expect(ui.lastFrame()).toMatch(/Extensions\s+1/);
    expect(ui.lastFrame()).toMatch(/Workers\s+1/);
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Warnings]");
    expect(loadInspectorDetail.mock.calls.filter(([target]) => target.kind === "diagnostics")).toHaveLength(1);
  });

  it("reloads Diagnostics detail from the single-layer Inspector action without invoking the generic direct action", async () => {
    const loadInspectorDetail = vi.fn(async (_target: WorkstationInspectorTarget): Promise<WorkstationInspectorDetail> => diagnosticsDetail());
    const executeDirect = vi.fn(async () => ({ title: "Diagnostics", body: "{}" }));
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      executeDirect={executeDirect}
      executeFlow={async () => ({ title: "ok", body: "ok" })}
      loadInspectorDetail={loadInspectorDetail}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={100}
      terminalHeight={28}
    />);
    ui.stdin.write("6");
    await waitFor(() => loadInspectorDetail.mock.calls.filter(([target]) => target.kind === "diagnostics").length === 1);
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("Run diagnostics");
    ui.stdin.write("\r");
    await waitFor(() => loadInspectorDetail.mock.calls.filter(([target]) => target.kind === "diagnostics").length === 2);
    expect(executeDirect).not.toHaveBeenCalled();
  });

  it("does not fan out Diagnostics queries during periodic inventory refresh", async () => {
    const loadInspectorDetail = vi.fn(async (_target: WorkstationInspectorTarget): Promise<WorkstationInspectorDetail> => diagnosticsDetail());
    const refresh = vi.fn(async () => snapshot());
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      refresh={refresh}
      executeDirect={async () => ({ title: "ok", body: "ok" })}
      executeFlow={async () => ({ title: "ok", body: "ok" })}
      loadInspectorDetail={loadInspectorDetail}
      onExit={() => undefined}
      refreshIntervalMs={20}
      terminalWidth={100}
      terminalHeight={28}
    />);
    ui.stdin.write("6");
    await waitFor(() => loadInspectorDetail.mock.calls.filter(([target]) => target.kind === "diagnostics").length === 1);
    await waitFor(() => refresh.mock.calls.length >= 2);
    expect(loadInspectorDetail.mock.calls.filter(([target]) => target.kind === "diagnostics")).toHaveLength(1);
  });
});
