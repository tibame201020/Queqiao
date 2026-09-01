import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { WorkstationSnapshot } from "./workstation.js";
import { WorkstationApp } from "./workstation-ui.js";
import type { WorkstationInspectorDetail, WorkstationInspectorTarget } from "./workstation-inspector.js";

const delay = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for Workstation UI condition");
}
const snapshot = (overrides: Partial<WorkstationSnapshot> = {}): WorkstationSnapshot => ({
  gateways: [{ name: "stable", configured: true, running: true, managed: true, publicUrl: "https://example.test/stable/", servicePort: 8075, managementPort: 8074 }],
  workers: [
    { name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: 1 },
    { name: "wsl", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:12976/", workspaceCount: 1 },
  ],
  workspaces: [
    { workerName: "wins-worker", id: "queqiao", displayName: "Queqiao", root: "C:\\codes\\Queqiao", profile: "coding-safe" },
    { workerName: "wsl", id: "linux", displayName: "Linux", root: "/workspace/codes", profile: "Reader" },
  ],
  profiles: [
    { name: "Reader", builtin: true, tools: ["read_file"], allowedExecutables: [] },
    { name: "coding-safe", builtin: false, tools: ["read_file", "edit_file", "run"], allowedExecutables: ["git", "npm"] },
  ],
  extensions: [{ id: "dev.queqiao.mcp", displayName: "MCP", version: "0.1.1", package: "@tibame201020/queqiao-mcp", workers: [{ name: "wins-worker", attached: true }, { name: "wsl", attached: false }] }],
  gatewayCount: 1, runningGatewayCount: 1, workerCount: 2, runningWorkerCount: 2, workspaceCount: 2,
  profileCount: 2, customProfileCount: 1, extensionCount: 1, attachmentCount: 1, gettingStarted: [],
  ...overrides,
});

function readyDetail(target: WorkstationInspectorTarget, marker: string): WorkstationInspectorDetail {
  if (target.kind === "gateway") return {
    kind: "gateway", key: `gateway:${target.name}`,
    runtime: { state: "ready", active: true, managed: true, health: { reachable: true, healthy: true, identityMatches: true, status: 200 } },
    workers: { state: "ready", items: [{ workerId: `id-${marker}`, environmentId: marker, endpoint: `http://${marker}.test/` }] },
  };
  if (target.kind === "worker") return {
    kind: "worker", key: `worker:${target.name}`,
    runtime: { state: "ready", active: true, managed: true, health: { reachable: true, healthy: true, identityMatches: true, status: 200 } },
    gateways: { state: "ready", items: [{ name: marker, endpoint: `http://${marker}.test/` }] },
  };
  throw new Error("static targets do not require lazy detail");
}

function app(overrides: Partial<React.ComponentProps<typeof WorkstationApp>> = {}) {
  return render(<WorkstationApp snapshot={snapshot()} executeDirect={async () => ({ title: "ok", body: "ok" })} executeFlow={async () => ({ title: "ok", body: "ok" })} onExit={() => undefined} refreshIntervalMs={0} terminalWidth={140} terminalHeight={35} {...overrides} />);
}

describe("Workstation lazy Inspector detail", () => {
  it("loads detail for only the selected entity and reloads when the selection changes", async () => {
    const loadInspectorDetail = vi.fn(async (target: WorkstationInspectorTarget) => readyDetail(target, target.kind === "gateway" ? "windows" : target.kind === "worker" ? target.name : "static"));
    const ui = app({ loadInspectorDetail });
    await delay();
    expect(loadInspectorDetail).toHaveBeenCalledTimes(1);
    expect(loadInspectorDetail.mock.calls[0]?.[0]).toEqual({ kind: "gateway", name: "stable" });
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("i"); await delay();
    ui.stdin.write("\u001b[C"); await delay();
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("windows");
    ui.stdin.write("i"); await delay();

    ui.stdin.write("2");
    await delay();
    expect(loadInspectorDetail).toHaveBeenCalledTimes(2);
    expect(loadInspectorDetail.mock.calls[1]?.[0]).toEqual({ kind: "worker", name: "wins-worker" });
    ui.stdin.write("i"); await delay();
    for (let index = 0; index < 4; index += 1) { ui.stdin.write("\u001b[C"); await delay(); }
    expect(ui.lastFrame()).toContain("wins-worker.test");
    ui.stdin.write("i"); await delay();

    ui.stdin.write("\u001b[D"); await delay();
    ui.stdin.write("j"); await delay();
    expect(loadInspectorDetail).toHaveBeenCalledTimes(3);
    expect(loadInspectorDetail.mock.calls[2]?.[0]).toEqual({ kind: "worker", name: "wsl" });
    ui.stdin.write("\u001b[C"); await delay();
    ui.stdin.write("i"); await delay();
    for (let index = 0; index < 4; index += 1) { ui.stdin.write("\u001b[C"); await delay(); }
    expect(ui.lastFrame()).toContain("wsl.test");
  });

  it("does not re-run heavy Inspector detail during periodic inventory refresh", async () => {
    const refresh = vi.fn(async () => snapshot());
    const loadInspectorDetail = vi.fn(async (target: WorkstationInspectorTarget) => readyDetail(target, "periodic"));
    app({ refresh, refreshIntervalMs: 20, loadInspectorDetail });
    await delay(120);
    expect(refresh.mock.calls.length).toBeGreaterThan(1);
    expect(loadInspectorDetail).toHaveBeenCalledTimes(1);
  });

  it("keeps an unchanged periodic refresh visually stable instead of pulsing the full TUI", async () => {
    const stableSnapshot = snapshot();
    const refresh = vi.fn(async () => structuredClone(stableSnapshot));
    const loadInspectorDetail = vi.fn(async (target: WorkstationInspectorTarget) => readyDetail(target, "stable"));
    const ui = render(<WorkstationApp snapshot={stableSnapshot} executeDirect={async () => ({ title: "ok", body: "ok" })} executeFlow={async () => ({ title: "ok", body: "ok" })} onExit={() => undefined} refresh={refresh} loadInspectorDetail={loadInspectorDetail} refreshIntervalMs={20} terminalWidth={140} terminalHeight={35} />);
    await delay(80);
    const frame = ui.lastFrame();
    const frameCount = ui.frames.length;
    expect(frame).toContain("Ready");
    expect(frame).not.toContain("Working…");
    await delay(100);
    expect(refresh.mock.calls.length).toBeGreaterThan(3);
    expect(ui.lastFrame()).toBe(frame);
    expect(ui.frames.length).toBe(frameCount);
  });

  it("commits changed periodic inventory atomically without a busy or blank-state pulse", async () => {
    const initial = snapshot();
    const changed = snapshot({
      gateways: [
        ...initial.gateways,
        { name: "backup", configured: true, running: false, managed: false, publicUrl: "https://example.test/backup/", servicePort: 8175, managementPort: 8174 },
      ],
      gatewayCount: 2,
    });
    let calls = 0;
    const refresh = vi.fn(async () => (++calls >= 2 ? structuredClone(changed) : structuredClone(initial)));
    const loadInspectorDetail = vi.fn(async (target: WorkstationInspectorTarget) => readyDetail(target, "stable"));
    const ui = render(<WorkstationApp snapshot={initial} executeDirect={async () => ({ title: "ok", body: "ok" })} executeFlow={async () => ({ title: "ok", body: "ok" })} onExit={() => undefined} refresh={refresh} loadInspectorDetail={loadInspectorDetail} refreshIntervalMs={20} terminalWidth={140} terminalHeight={35} />);
    await waitFor(() => (ui.lastFrame() || "").includes("backup"), 500);
    expect(ui.lastFrame()).toContain("Gateways 2");
    expect(ui.frames.every((frame) => !frame.includes("Working…"))).toBe(true);
    expect(ui.frames.every((frame) => !frame.includes("No Gateways configured"))).toBe(true);
    expect(ui.frames.every((frame) => !frame.includes("Nothing selected"))).toBe(true);
  });

  it("renders an intentionally stopped runtime as stopped instead of an unreachable health failure", async () => {
    const stoppedSnapshot = snapshot({
      gateways: [{ name: "stable", configured: true, running: false, managed: true, publicUrl: "https://example.test/stable/", servicePort: 8075, managementPort: 8074 }],
      runningGatewayCount: 0,
    });
    const loadInspectorDetail = vi.fn(async (): Promise<WorkstationInspectorDetail> => ({
      kind: "gateway",
      key: "gateway:stable",
      runtime: { state: "ready", active: false, managed: true, health: { reachable: false, healthy: false, identityMatches: true, error: "runtime stopped" } },
      workers: { state: "unavailable", message: "Gateway is stopped; membership detail is unavailable." },
    }));
    const ui = render(<WorkstationApp snapshot={stoppedSnapshot} executeDirect={async () => ({ title: "ok", body: "ok" })} executeFlow={async () => ({ title: "ok", body: "ok" })} onExit={() => undefined} loadInspectorDetail={loadInspectorDetail} refreshIntervalMs={0} terminalWidth={140} terminalHeight={35} />);
    await delay();
    expect(ui.lastFrame()).toContain("○ STOPPED");
    expect(ui.lastFrame()).toContain("Probe       ○ stopped");
    expect(ui.lastFrame()).not.toContain("! unreachable");
    expect(ui.lastFrame()).not.toContain("runtime stopped");
  });

  it("manual refresh reloads the visible Inspector detail", async () => {
    const refresh = vi.fn(async () => snapshot());
    const loadInspectorDetail = vi.fn(async (target: WorkstationInspectorTarget) => readyDetail(target, `load-${loadInspectorDetail.mock.calls.length}`));
    const ui = app({ refresh, loadInspectorDetail });
    await delay();
    expect(loadInspectorDetail).toHaveBeenCalledTimes(1);
    ui.stdin.write("r");
    await delay(80);
    expect(refresh).toHaveBeenCalled();
    expect(loadInspectorDetail).toHaveBeenCalledTimes(2);
  });

  it("reloads selected runtime detail after a related action", async () => {
    const refresh = vi.fn(async () => snapshot());
    const executeDirect = vi.fn(async () => ({ title: "Gateway stable", body: "{}" }));
    const loadInspectorDetail = vi.fn(async (target: WorkstationInspectorTarget) => readyDetail(target, "after-action"));
    const ui = app({ refresh, executeDirect, loadInspectorDetail });
    await delay();
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("s");
    await delay(100);
    expect(executeDirect).toHaveBeenCalledWith({ type: "role-stop", role: "gateway", name: "stable" });
    expect(loadInspectorDetail).toHaveBeenCalledTimes(2);
  });

  it("never renders late detail from a previously selected entity", async () => {
    let resolveWsl!: (value: WorkstationInspectorDetail) => void;
    const wslPromise = new Promise<WorkstationInspectorDetail>((resolve) => { resolveWsl = resolve; });
    const loadInspectorDetail = vi.fn((target: WorkstationInspectorTarget) => {
      if (target.kind === "worker" && target.name === "wsl") return wslPromise;
      return Promise.resolve(readyDetail(target, target.kind === "worker" ? "worker-current" : "gateway-initial"));
    });
    const ui = app({ loadInspectorDetail });
    await delay();

    ui.stdin.write("2");
    await waitFor(() => loadInspectorDetail.mock.calls.some((call) => call[0]?.kind === "worker" && call[0].name === "wins-worker"));
    await delay(20);
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("i"); await delay();
    for (let index = 0; index < 4; index += 1) { ui.stdin.write("\u001b[C"); await delay(); }
    expect(ui.lastFrame()).toContain("worker-current");
    ui.stdin.write("i"); await delay();
    ui.stdin.write("\u001b[D"); await delay();
    ui.stdin.write("j");
    await waitFor(() => loadInspectorDetail.mock.calls.some((call) => call[0]?.kind === "worker" && call[0].name === "wsl"));
    ui.stdin.write("k");
    await waitFor(() => loadInspectorDetail.mock.calls.filter((call) => call[0]?.kind === "worker" && call[0].name === "wins-worker").length >= 2);
    await delay(20);
    ui.stdin.write("\u001b[C"); await delay();
    ui.stdin.write("i"); await delay();
    for (let index = 0; index < 4; index += 1) { ui.stdin.write("\u001b[C"); await delay(); }
    expect(ui.lastFrame()).toContain("worker-current");

    resolveWsl(readyDetail({ kind: "worker", name: "wsl" }, "STALE-WSL"));
    await delay();
    expect(ui.lastFrame()).toContain("worker-current");
    expect(ui.lastFrame()).not.toContain("STALE-WSL");
  });
});
