import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { actionOutcome } from "./workstation-action-outcome.js";
import { WorkstationApp } from "./workstation-ui.js";
import type { WorkstationSnapshot } from "./workstation.js";
import type { WorkstationInspectorDetail } from "./workstation-inspector.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, 35));

const snapshot = (): WorkstationSnapshot => ({
  gateways: [{ name: "verify-gateway", configured: true, running: false, managed: false, publicUrl: "https://example.test/verify/", servicePort: 5564, managementPort: 5565 }],
  workers: [{ name: "verify-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:5566/", workspaceCount: 1 }],
  workspaces: [{ workerName: "verify-worker", id: "verify", displayName: "Verification Workspace", root: "C:\\verify", profile: "coding" }],
  profiles: [{ name: "Reader", builtin: true, tools: ["read_file", "list_directory"], allowedExecutables: [] }],
  extensions: [],
  gatewayCount: 1,
  runningGatewayCount: 0,
  workerCount: 1,
  runningWorkerCount: 1,
  workspaceCount: 1,
  profileCount: 1,
  customProfileCount: 0,
  extensionCount: 0,
  attachmentCount: 0,
  gettingStarted: [],
});

const gatewayDetail: WorkstationInspectorDetail = {
  kind: "gateway",
  key: "gateway:verify-gateway",
  runtime: { state: "ready", active: false, managed: false, health: { reachable: false, healthy: false, identityMatches: false } },
  workers: { state: "ready", items: [{ workerId: "worker-1", environmentId: "windows", endpoint: "http://127.0.0.1:5566/" }] },
};

async function focusInspector(ui: ReturnType<typeof render>) {
  ui.stdin.write("\t"); await delay();
  ui.stdin.write("\t"); await delay();
}

describe("Workstation single-layer Inspector interaction", () => {
  it("keeps compact Info and selectable Actions in one Inspector layer and Enter executes the selected action", async () => {
    const executeFlow = vi.fn(async () => actionOutcome("success", "Gateway configured"));
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={executeFlow}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={140}
      terminalHeight={35}
    />);
    await focusInspector(ui);

    const first = ui.lastFrame() || "";
    expect(first).toContain("INSPECTOR");
    expect(first).toContain("Actions");
    expect(first).toContain("› [s] Start");
    expect(first).not.toContain("CONTEXT ACTIONS");
    expect(first).not.toContain("press ? to open");

    ui.stdin.write("\u001b[B"); await delay();
    expect(ui.lastFrame()).toContain("› [e] Configure");
    ui.stdin.write("\r"); await delay(); await delay();
    expect(executeFlow).toHaveBeenCalledWith({ type: "setup-role", role: "gateway", name: "verify-gateway" }, expect.anything());
    expect(ui.lastFrame()).toContain("Gateway configured");
  });

  it("opens Detailed Info as a root modal with contextual tabs and left/right changes tabs", async () => {
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={async () => actionOutcome("success", "ok")}
      loadInspectorDetail={async () => gatewayDetail}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={140}
      terminalHeight={35}
    />);
    await focusInspector(ui);
    await delay();
    ui.stdin.write("i"); await delay();

    const status = ui.lastFrame() || "";
    expect(status).toContain("DETAIL · verify-gateway");
    expect(status).toContain("Status");
    expect(status).toContain("Info");
    expect(status).toContain("Workers");
    expect(status).toContain("[Status]");
    expect(status).toContain("CONTROL");
    expect(status).toContain("INVENTORY");

    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Info]");
    ui.stdin.write("\u001b[C"); await delay();
    const workers = ui.lastFrame() || "";
    expect(workers).toContain("[Workers]");
    expect(workers).toContain("windows");
    expect(workers).toContain("127.0.0.1:5566");
  });

  it("preserves Inspector action selection across Detailed Info and closes it with Esc/i", async () => {
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={async () => actionOutcome("success", "ok")}
      loadInspectorDetail={async () => gatewayDetail}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={100}
      terminalHeight={28}
    />);
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("\u001b[B"); await delay();
    expect(ui.lastFrame()).toContain("› [e] Configure");
    ui.stdin.write("i"); await delay();
    expect(ui.lastFrame()).toContain("DETAIL · verify-gateway");
    ui.stdin.write("\u001b"); await delay();
    expect(ui.lastFrame()).not.toContain("DETAIL · verify-gateway");
    expect(ui.lastFrame()).toContain("› [e] Configure");
  });

  it("uses ? for a keyboard Help modal instead of an Actions palette", async () => {
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={async () => actionOutcome("success", "ok")}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={100}
      terminalHeight={28}
    />);
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("?"); await delay();
    const frame = ui.lastFrame() || "";
    expect(frame).toContain("HELP · Keyboard reference");
    expect(frame).toContain("Inspector");
    expect(frame).toContain("↑↓ select action");
    expect(frame).toContain("Enter run selected action");
    expect(frame).not.toContain("CONTEXT ACTIONS");
  });
});
