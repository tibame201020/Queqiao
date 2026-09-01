import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { actionOutcome } from "./workstation-action-outcome.js";
import { WorkstationApp } from "./workstation-ui.js";
import type { WorkstationSnapshot } from "./workstation.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, 35));

function snapshot(running = false): WorkstationSnapshot {
  return {
    gateways: [{ name: "verify-gateway", configured: true, running, managed: running, publicUrl: "https://example.test/verify/", servicePort: 5564, managementPort: 5565 }],
    workers: [{ name: "verify-worker", configured: true, running: false, managed: false, endpoint: "http://127.0.0.1:5566/", workspaceCount: 1 }],
    workspaces: [{ workerName: "verify-worker", id: "verify", displayName: "Verification Workspace", root: "C:\\verify", profile: "coding" }],
    profiles: [],
    extensions: [],
    gatewayCount: 1,
    runningGatewayCount: running ? 1 : 0,
    workerCount: 1,
    runningWorkerCount: 0,
    workspaceCount: 1,
    profileCount: 0,
    customProfileCount: 0,
    extensionCount: 0,
    attachmentCount: 0,
    gettingStarted: [],
  };
}

async function focusInspector(ui: ReturnType<typeof render>) {
  ui.stdin.write("\t"); await delay();
  ui.stdin.write("\t"); await delay();
}

describe("Workstation action modal", () => {
  it("executes Start immediately in a root overlay while the three-pane Info background stays mounted", async () => {
    let resolveAction!: (value: ReturnType<typeof actionOutcome>) => void;
    const executeDirect = vi.fn(() => new Promise<ReturnType<typeof actionOutcome>>((resolve) => { resolveAction = resolve; }));
    const ui = render(<WorkstationApp
      snapshot={snapshot(false)}
      executeDirect={executeDirect}
      executeFlow={async () => actionOutcome("success", "ok")}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={140}
      terminalHeight={35}
    />);
    await focusInspector(ui);
    ui.stdin.write("s"); await delay();

    const working = ui.lastFrame() || "";
    expect(executeDirect).toHaveBeenCalledWith({ type: "role-start", role: "gateway", name: "verify-gateway" });
    expect(working).toContain("CONTROL");
    expect(working).toContain("INVENTORY");
    expect(working).toContain("INSPECTOR");
    expect(working).toContain("ACTION · Start");
    expect(working).toContain("… Working");
    expect(working).not.toContain("Enter continue");
    const modalBorder = working.split("\n").find((line) => line.includes("╔")) || "";
    expect(modalBorder.indexOf("╔")).toBeGreaterThan(5);
    expect(modalBorder.indexOf("╔")).toBeLessThan(25);

    resolveAction(actionOutcome("success", "Gateway started", { summary: "verify-gateway is running." }));
    await delay(); await delay();
    expect(ui.lastFrame()).toContain("✓ Gateway started");
    expect(ui.lastFrame()).toContain("verify-gateway is running.");
    ui.stdin.write("i"); await delay();
    expect(ui.lastFrame()).not.toContain("ACTION · Start");
    expect(ui.lastFrame()).toContain("INSPECTOR");
    expect(ui.lastFrame()).toContain("Actions");
  });

  it("shows a blocked join-code action as an unavailable result without calling the flow", async () => {
    const executeFlow = vi.fn(async () => actionOutcome("success", "unexpected"));
    const ui = render(<WorkstationApp
      snapshot={snapshot(false)}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={executeFlow}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={140}
      terminalHeight={35}
    />);
    await focusInspector(ui);
    ui.stdin.write("j"); await delay();
    expect(executeFlow).not.toHaveBeenCalled();
    expect(ui.lastFrame()).toContain("Create join code unavailable");
    expect(ui.lastFrame()).toContain("Start the Gateway first.");
    expect(ui.lastFrame()).not.toContain("Enter continue");
  });

  it("renders an opaque centered modal surface so pane text cannot bleed through its body", async () => {
    const ui = render(<WorkstationApp
      snapshot={snapshot(true)}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={async () => actionOutcome("success", "ok")}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={140}
      terminalHeight={35}
    />);
    await focusInspector(ui);
    ui.stdin.write("d"); await delay();
    const frame = ui.lastFrame() || "";
    const resultLine = frame.split("\n").find((line) => line.includes("Remove Gateway unavailable")) || "";
    expect(resultLine).not.toContain(":5564");
    expect(resultLine).not.toContain("RUNNING");
    expect(frame.match(/Remove Gateway unavailable/g)?.length).toBe(1);
    const modalBorder = frame.split("\n").find((line) => line.includes("╔")) || "";
    expect(modalBorder.indexOf("╔")).toBeGreaterThanOrEqual(20);
    expect(modalBorder.lastIndexOf("╗") - modalBorder.indexOf("╔")).toBeLessThanOrEqual(98);
  });

  it("opens form actions directly inside the modal without an extra generic review step", async () => {
    const executeFlow = vi.fn(async (_action, prompts) => {
      const value = await prompts.text("Gateway name", "verify-gateway");
      return actionOutcome("success", "Gateway configured", { details: [{ label: "Gateway", value }] });
    });
    const ui = render(<WorkstationApp
      snapshot={snapshot(false)}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={executeFlow}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={100}
      terminalHeight={28}
    />);
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("e"); await delay();
    expect(executeFlow).toHaveBeenCalledTimes(1);
    const frame = ui.lastFrame() || "";
    expect(frame).toContain("ACTION · Configure");
    expect(frame).toMatch(/Target\s+verify-gateway/);
    expect(frame).toMatch(/Purpose\s+Edit gateway configuration\./);
    expect(frame).toContain("Gateway name");
    expect(frame).toContain("Enter the value to apply.");
    expect(frame).not.toContain("FORM");
    expect(frame).not.toContain("Enter continue");
    expect(frame.match(/╔/g)?.length).toBe(1);
    const rows = frame.split("\n");
    const bottomBorderRow = rows.findIndex((row) => row.includes("╚"));
    expect(bottomBorderRow).toBeGreaterThan(3);
    expect(bottomBorderRow).toBeLessThan(rows.length - 4);
  });

  it("keeps clipboard-fallback join-code details and remediation readable in a narrow result modal", async () => {
    const joinCode = `qjq1:${"a".repeat(180)}`;
    const executeFlow = vi.fn(async () => actionOutcome("warning", "Join code created, clipboard copy failed", {
      summary: "Copy the join code shown below before closing this result.",
      details: [
        { label: "Gateway", value: "verify-gateway" },
        { label: "Expires", value: "2026-08-31T12:00:00.000Z" },
        { label: "Join code", value: joinCode, tone: "warning" },
      ],
      sideEffects: [{ label: "Clipboard", value: "Copy failed", tone: "warning" }],
      remediation: ["Clipboard unavailable", "Copy the displayed join code manually."],
    }));
    const ui = render(<WorkstationApp
      snapshot={snapshot(true)}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={executeFlow}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={70}
      terminalHeight={24}
    />);
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("j"); await delay(); await delay();
    const frame = ui.lastFrame() || "";
    expect(frame).toContain("Join code created, clipboard copy failed");
    expect(frame).toContain("qjq1:");
    expect(frame).toContain("↑↓ scroll");
    ui.stdin.write("\u001b[F"); await delay(); await delay();
    expect(ui.lastFrame()).toContain("Copy the displayed join code manually.");
  });
});
