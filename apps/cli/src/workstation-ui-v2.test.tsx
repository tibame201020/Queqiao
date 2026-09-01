import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { WorkstationSnapshot } from "./workstation.js";
import { WorkstationApp } from "./workstation-ui.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
async function waitForFrame(ui: ReturnType<typeof render>, text: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((ui.lastFrame() || "").includes(text)) return;
    await delay();
  }
  throw new Error(`Timed out waiting for Workstation frame: ${text}`);
}
const snapshot = (overrides: Partial<WorkstationSnapshot> = {}): WorkstationSnapshot => ({
  gateways: [{ name: "stable", configured: true, running: true, managed: true, publicUrl: "https://example.test/stable/", servicePort: 8075, managementPort: 8074 }],
  workers: [
    { name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: 2 },
    { name: "wsl", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:12976/", workspaceCount: 1 },
  ],
  workspaces: [
    { workerName: "wins-worker", id: "queqiao", displayName: "Queqiao", root: "C:\\codes\\Queqiao", profile: "coding-safe" },
    { workerName: "wins-worker", id: "sandbox", displayName: "Sandbox", root: "C:\\sandbox", profile: "Reader" },
    { workerName: "wsl", id: "linux", displayName: "Linux", root: "/workspace/codes", profile: "Reader" },
  ],
  profiles: [
    { name: "Reader", builtin: true, tools: ["read_file", "list_directory"], allowedExecutables: [] },
    { name: "coding-safe", builtin: false, tools: ["read_file", "edit_file", "run"], allowedExecutables: ["git", "npm"] },
  ],
  extensions: [{ id: "dev.queqiao.mcp", displayName: "MCP", version: "0.1.1", package: "@tibame201020/queqiao-mcp", workers: [{ name: "wins-worker", attached: true }, { name: "wsl", attached: false }] }],
  gatewayCount: 1, runningGatewayCount: 1, workerCount: 2, runningWorkerCount: 2, workspaceCount: 3,
  profileCount: 2, customProfileCount: 1, extensionCount: 1, attachmentCount: 1, gettingStarted: [],
  ...overrides,
});

function app(width: number, height: number, overrides: Partial<React.ComponentProps<typeof WorkstationApp>> = {}) {
  return render(<WorkstationApp snapshot={snapshot()} executeDirect={async () => ({ title: "ok", body: "ok" })} executeFlow={async () => ({ title: "ok", body: "ok" })} onExit={() => undefined} refreshIntervalMs={0} terminalWidth={width} terminalHeight={height} {...overrides} />);
}

describe("Workstation v2 window hierarchy", () => {
  it("fills the entire terminal viewport at every responsive breakpoint", () => {
    for (const [width, height] of [[140, 35], [100, 28], [70, 24], [59, 24]] as const) {
      const ui = app(width, height);
      const frame = ui.lastFrame() || "";
      const lines = frame.split("\n");
      expect(lines).toHaveLength(height);
      expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(width);
    }
  });

  it("keeps pane boundaries invariant when content length changes at a fixed viewport", () => {
    const contentPressure: Partial<WorkstationSnapshot> = {
      gateways: [{
        name: "gateway-production-east-very-long",
        configured: true,
        running: true,
        managed: true,
        publicUrl: "https://example.test/a/very/long/public/gateway/base/that/must/not/resize/the/workstation",
        servicePort: 65535,
        managementPort: 65534,
      }],
    };
    const borderColumns = (frame: string): number[] => {
      const line = frame.split("\n").find((candidate) => candidate.includes("┌")) ?? "";
      return Array.from(line).flatMap((character, index) => character === "┌" || character === "┐" ? [index] : []);
    };

    for (const [width, height] of [[80, 28], [100, 28], [119, 28], [120, 28], [140, 35]] as const) {
      const shortUi = app(width, height);
      const longUi = app(width, height, { snapshot: snapshot(contentPressure) });
      expect(borderColumns(longUi.lastFrame() || "")).toEqual(borderColumns(shortUi.lastFrame() || ""));
    }
  });

  it("keeps inventory rows single-line under long identity content", () => {
    const longGatewayName = "gateway-production-east-very-long";
    const ui = app(140, 35, {
      snapshot: snapshot({
        gateways: [{ name: longGatewayName, configured: true, running: true, managed: true, publicUrl: "https://example.test/stable/", servicePort: 65535, managementPort: 65534 }],
      }),
    });
    const frame = ui.lastFrame() || "";
    expect(frame).not.toContain("-very-long                       │");
    expect(frame.split("\n").filter((line) => line.includes("▌ ●")).length).toBe(1);
  });

  it("keeps Inspector fields single-line with a stable label/value boundary", () => {
    const ui = app(100, 28, {
      snapshot: snapshot({
        gateways: [{
          name: "stable",
          configured: true,
          running: true,
          managed: true,
          publicUrl: `https://example.test/${"segment/".repeat(20)}TAIL-SHOULD-NOT-WRAP`,
          servicePort: 8075,
          managementPort: 8074,
        }],
      }),
    });
    const frame = ui.lastFrame() || "";
    const publicLine = frame.split("\n").find((line) => line.includes("Public URL")) || "";
    const serviceLine = frame.split("\n").find((line) => line.includes("Service")) || "";
    const tailLine = frame.split("\n").find((line) => line.includes("TAIL-SHOULD-NOT-WRAP")) || "";
    expect(tailLine).toContain("Public URL");
    expect(publicLine.indexOf("https://")).toBe(serviceLine.indexOf(":8075"));
  });

  it("renders grouped control, inventory, and dominant inspector on wide terminals", () => {
    const ui = app(140, 35);
    const frame = ui.lastFrame() || "";
    expect(frame).toContain("RUNTIME");
    expect(frame).toContain("AUTHORITY");
    expect(frame).toContain("CAPABILITIES");
    expect(frame).toContain("SYSTEM");
    expect(frame).toContain("CONTROL");
    expect(frame).toContain("INVENTORY");
    expect(frame).toContain("INSPECTOR");
    expect(frame).toContain("stable");
    expect(frame).toContain("● RUNNING");
    expect(frame).not.toContain("1. Gateways");
  });

  it("collapses control navigation into the inventory header on standard terminals", () => {
    const ui = app(100, 28);
    const frame = ui.lastFrame() || "";
    expect(frame).not.toContain("CONTROL");
    expect(frame).toContain("1 Gateway");
    expect(frame).toContain("2 Worker");
    expect(frame).toContain("INVENTORY");
    expect(frame).toContain("INSPECTOR");
  });

  it("uses one primary window on narrow terminals and Enter opens Inspector", async () => {
    const ui = app(70, 24);
    expect(ui.lastFrame()).toContain("INVENTORY");
    expect(ui.lastFrame()).not.toContain("INSPECTOR");
    ui.stdin.write("2"); await delay();
    expect(ui.lastFrame()).toContain("wins-worker");
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("INSPECTOR");
    expect(ui.lastFrame()).toContain("wins-worker");
    ui.stdin.write("\u001b"); await delay();
    expect(ui.lastFrame()).toContain("INVENTORY");
  });

  it("uses left/right as non-wrapping spatial navigation in wide, standard, and narrow layouts", async () => {
    const wide = app(140, 35);
    expect(wide.lastFrame()).toContain("▸ CONTROL");
    wide.stdin.write("\u001b[D"); await waitForFrame(wide, "▸ CONTROL");
    wide.stdin.write("\u001b[C"); await waitForFrame(wide, "▸ INVENTORY");
    wide.stdin.write("\u001b[C"); await waitForFrame(wide, "▸ INSPECTOR");
    wide.stdin.write("\u001b[C"); await waitForFrame(wide, "▸ INSPECTOR");
    wide.stdin.write("\u001b[D"); await waitForFrame(wide, "▸ INVENTORY");

    const standard = app(100, 28);
    expect(standard.lastFrame()).toContain("▸ INVENTORY");
    standard.stdin.write("\u001b[D"); await waitForFrame(standard, "▸ INVENTORY");
    standard.stdin.write("\u001b[C"); await waitForFrame(standard, "▸ INSPECTOR");
    standard.stdin.write("\u001b[D"); await waitForFrame(standard, "▸ INVENTORY");

    const narrow = app(70, 24);
    expect(narrow.lastFrame()).toContain("INVENTORY");
    narrow.stdin.write("\u001b[C"); await waitForFrame(narrow, "INSPECTOR");
    narrow.stdin.write("\u001b[D"); await waitForFrame(narrow, "INVENTORY");
  }, 12_000);

  it("keeps Inspector Enter semantics consistent across viewports by running the selected action", async () => {
    for (const [width, height, enters] of [[140, 35, 2], [100, 28, 1], [70, 24, 1]] as const) {
      const executeDirect = vi.fn(async () => ({ title: "Gateway stopped", body: "{}" }));
      const ui = app(width, height, { executeDirect });
      for (let index = 0; index < enters; index += 1) { ui.stdin.write("\u001b[C"); await delay(); }
      expect(ui.lastFrame()).toContain("› [s] Stop");
      ui.stdin.write("\r");
      expect(executeDirect).toHaveBeenCalledWith({ type: "role-stop", role: "gateway", name: "stable" });
      for (let attempt = 0; attempt < 20 && !(ui.lastFrame() || "").includes("Gateway stopped"); attempt += 1) await delay();
      expect(ui.lastFrame()).toContain("Gateway stopped");
    }
  });

  it("keeps narrow Inspector navigation hints on one row and advertises global domain shortcuts", async () => {
    const ui = app(70, 24);
    ui.stdin.write("\u001b[C"); await delay();
    const frame = ui.lastFrame() || "";
    const navigationLine = frame.split("\n").at(-1) || "";
    expect(navigationLine).toContain("↑↓ action");
    expect(navigationLine).toContain("Enter run");
    expect(navigationLine).toContain("1-6 domain");
    expect(navigationLine).toContain("q quit");
    expect(navigationLine.length).toBeLessThanOrEqual(70);
  });

  it("keeps every Access Profile authority item individually visible instead of truncating the middle of the policy", async () => {
    const tools = ["read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "list_directory", "search_text", "run", "shell"];
    const executables = ["git", "node", "npm", "python"];
    const ui = app(140, 35, {
      snapshot: snapshot({ profiles: [{ name: "coding-safe", builtin: false, tools, allowedExecutables: executables }], profileCount: 1, customProfileCount: 1 }),
    });
    ui.stdin.write("4"); await delay();
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("Tools         9");
    expect(ui.lastFrame()).toContain("Executables   4");
    ui.stdin.write("i"); await delay();
    ui.stdin.write("\u001b[C"); await delay();
    const toolsFrame = ui.lastFrame() || "";
    expect(toolsFrame).toContain("[Tools]");
    for (const tool of tools) expect(toolsFrame).toContain(`• ${tool}`);
    ui.stdin.write("\u001b[C"); await delay();
    const commandsFrame = ui.lastFrame() || "";
    expect(commandsFrame).toContain("[Commands]");
    for (const executable of executables) expect(commandsFrame).toContain(`• ${executable}`);
  });

  it("uses readable Inventory metadata instead of implementation abbreviations", async () => {
    const ui = app(140, 35);
    ui.stdin.write("2"); await delay();
    expect(ui.lastFrame()).toContain("2 workspaces");
    ui.stdin.write("4"); await delay();
    expect(ui.lastFrame()).toContain("3 tools");
    expect(ui.lastFrame()).not.toContain("3t 2x");
    ui.stdin.write("5"); await delay();
    expect(ui.lastFrame()).toContain("1/2 attached");
  });

  it("renders an intentional too-small state instead of clipping windows", () => {
    const ui = app(59, 24);
    const frame = ui.lastFrame() || "";
    expect(frame).toContain("Terminal too small");
    expect(frame).toContain("60 columns");
    expect(frame).not.toContain("INVENTORY");
  });

  it("preserves the selected worker when focus moves and snapshot refreshes", async () => {
    const refresh = vi.fn(async () => snapshot());
    const ui = app(140, 35, { refresh });
    ui.stdin.write("2"); await delay(); // workers
    ui.stdin.write("\t"); await delay(); // inventory
    ui.stdin.write("j"); await delay(); // wsl
    expect(ui.lastFrame()).toContain("▌ ● wsl");
    ui.stdin.write("\t"); await delay(); // inspector
    expect(ui.lastFrame()).toContain("wsl");
    ui.stdin.write("r"); await delay();
    expect(refresh).toHaveBeenCalled();
    expect(ui.lastFrame()).toContain("▌ ● wsl");
  });

  it("renders operation feedback as a status line instead of a permanent JSON result box", async () => {
    const executeDirect = vi.fn(async () => ({ title: "Worker wins-worker", body: JSON.stringify({ stopped: true }) }));
    const ui = app(140, 35, { executeDirect });
    ui.stdin.write("2"); await delay();
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("s");
    await vi.waitFor(() => expect(ui.lastFrame() || "").toContain("✓ Worker wins-worker"));
    const frame = ui.lastFrame() || "";
    expect(executeDirect).toHaveBeenCalledWith({ type: "role-stop", role: "worker", name: "wins-worker" });
    expect(frame).not.toContain('{\"stopped\":true}');
  });
});
