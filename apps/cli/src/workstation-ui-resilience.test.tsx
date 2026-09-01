import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { ACCESS_TOOL_OPTIONS, DEFAULT_ACCESS_TOOLS } from "./access-configuration.js";
import type { WorkstationSnapshot } from "./workstation.js";
import { WorkstationApp, type WorkstationPromptDriver } from "./workstation-ui.js";

const delay = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for Workstation resilience condition");
}

function snapshot(overrides: Partial<WorkstationSnapshot> = {}): WorkstationSnapshot {
  return {
    gateways: [{ name: "stable", configured: true, running: true, managed: true, publicUrl: "https://example.test/stable/", servicePort: 8075, managementPort: 8074 }],
    workers: [{ name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: 1 }],
    workspaces: [{ workerName: "wins-worker", id: "queqiao", displayName: "Queqiao", root: "C:\\codes\\Queqiao", profile: "coding" }],
    profiles: [{ name: "Reader", builtin: true, tools: ["read_file"], allowedExecutables: [] }],
    extensions: [],
    gatewayCount: 1,
    runningGatewayCount: 1,
    workerCount: 1,
    runningWorkerCount: 1,
    workspaceCount: 1,
    profileCount: 1,
    customProfileCount: 0,
    extensionCount: 0,
    attachmentCount: 0,
    gettingStarted: [],
    ...overrides,
  };
}

function props(overrides: Partial<React.ComponentProps<typeof WorkstationApp>> = {}): React.ComponentProps<typeof WorkstationApp> {
  return {
    snapshot: snapshot(),
    executeDirect: async () => ({ title: "ok", body: "ok" }),
    executeFlow: async () => ({ title: "ok", body: "ok" }),
    onExit: () => undefined,
    refreshIntervalMs: 0,
    terminalWidth: 100,
    terminalHeight: 20,
    ...overrides,
  };
}

describe("Workstation viewport resilience", { timeout: 15_000 }, () => {
  it("auto-scrolls a long Inventory so the selected entity stays visible", async () => {
    const gateways = Array.from({ length: 24 }, (_, index) => ({
      name: `gateway-${String(index).padStart(2, "0")}`,
      configured: true,
      running: index % 2 === 0,
      managed: true,
      publicUrl: `https://example.test/gateway-${index}/`,
      servicePort: 8000 + index,
      managementPort: 7000 + index,
    }));
    const ui = render(<WorkstationApp {...props({ snapshot: snapshot({ gateways, gatewayCount: gateways.length, runningGatewayCount: gateways.filter((entry) => entry.running).length }) })} />);
    for (let index = 0; index < 23; index += 1) {
      ui.stdin.write("j");
      await delay(3);
    }
    await waitFor(() => (ui.lastFrame() || "").includes("gateway-23"));
    expect(ui.lastFrame()).toContain("▌ ○ gateway-23");
    expect(ui.lastFrame()).not.toContain("▌ ● gateway-00");
  });

  it("auto-scrolls a long single-layer Inspector action list while keeping the selected action visible", async () => {
    const workers = Array.from({ length: 18 }, (_, index) => ({ name: `worker-${String(index).padStart(2, "0")}`, configured: true, running: true, managed: true, endpoint: `http://127.0.0.1:${9000 + index}/`, workspaceCount: 0 }));
    const extension = { id: "dev.queqiao.long", displayName: "Long Extension", version: "1.0.0", package: "@example/long", workers: workers.map((worker) => ({ name: worker.name, attached: false })) };
    const ui = render(<WorkstationApp {...props({ snapshot: snapshot({ workers, workerCount: workers.length, runningWorkerCount: workers.length, extensions: [extension], extensionCount: 1 }) })} />);
    ui.stdin.write("5"); await delay();
    ui.stdin.write("\r"); await delay();
    for (let index = 0; index < 17; index += 1) {
      ui.stdin.write("\u001b[B");
      await delay(3);
    }
    await waitFor(() => (ui.lastFrame() || "").includes("worker-17"));
    expect(ui.lastFrame()).toContain("› Attach · worker-17");
  });

  it("auto-scrolls long form choice lists and keeps the current choice visible", async () => {
    const choices = Array.from({ length: 20 }, (_, index) => ({ value: `option-${index}`, label: `Option ${String(index).padStart(2, "0")}`, description: `Description ${index}` }));
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => ({ title: "chosen", body: await prompts.choose("Choose an option", choices) }));
    const ui = render(<WorkstationApp {...props({ executeFlow })} />);
    ui.stdin.write("n"); await delay();
    for (let index = 0; index < 19; index += 1) {
      ui.stdin.write("j");
      await delay(3);
    }
    await waitFor(() => (ui.lastFrame() || "").includes("Option 19"));
    expect(ui.lastFrame()).toContain("› Option 19");
    expect(ui.lastFrame()).not.toContain("› Option 00");
  });

  it("scrolls long Detailed Info content with arrow keys while base Inspector arrows stay reserved for actions", async () => {
    const workspaces = Array.from({ length: 18 }, (_, index) => ({ workerName: "wins-worker", id: `workspace-${index}`, displayName: `Workspace ${String(index).padStart(2, "0")}`, root: `C:\\codes\\workspace-${index}`, profile: "coding" }));
    const ui = render(<WorkstationApp {...props({ snapshot: snapshot({ workspaces, workspaceCount: workspaces.length, workers: [{ name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: workspaces.length }] }) })} />);
    ui.stdin.write("2"); await delay();
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("› [s] Stop");
    ui.stdin.write("i"); await delay();
    ui.stdin.write("\u001b[C"); await delay();
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Workspaces]");
    for (let index = 0; index < 5; index += 1) {
      ui.stdin.write("\u001b[B");
      await delay(3);
    }
    ui.stdin.write("\u001b[F"); await delay();
    await waitFor(() => (ui.lastFrame() || "").includes("Workspace 17"));
    expect(ui.lastFrame()).toContain("Workspace 17");
  });

  it("auto-scrolls long multi-select forms while preserving selected state", async () => {
    const choices = Array.from({ length: 20 }, (_, index) => ({ value: `tool-${index}`, label: `Tool ${String(index).padStart(2, "0")}`, description: `Capability ${index}` }));
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => ({ title: "selected", body: (await prompts.multi("Tools", choices)).join(",") }));
    const ui = render(<WorkstationApp {...props({ executeFlow })} />);
    ui.stdin.write("n"); await delay();
    for (let index = 0; index < 19; index += 1) {
      ui.stdin.write("j");
      await delay(3);
    }
    await waitFor(() => (ui.lastFrame() || "").includes("Tool 19"));
    expect(ui.lastFrame()).toContain("› [ ] Tool 19");
    ui.stdin.write(" "); await delay();
    expect(ui.lastFrame()).toContain("› [x] Tool 19");
  });

  it("keeps the focused Workspace Tools option visible when real tool descriptions wrap", async () => {
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => ({
      title: "selected",
      body: (await prompts.multi("Tools", ACCESS_TOOL_OPTIONS, [...DEFAULT_ACCESS_TOOLS])).join(","),
    }));
    const ui = render(<WorkstationApp {...props({ executeFlow, terminalWidth: 100, terminalHeight: 28 })} />);
    ui.stdin.write("3"); await delay();
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("e"); await delay();
    expect(ui.lastFrame()).toContain("ACTION · Edit Workspace");
    expect(ui.lastFrame()).toMatch(/Target\s+Queqiao/);
    expect(ui.lastFrame()).toMatch(/Purpose\s+Edit Workspace identity or copied access policy\./);
    expect(ui.lastFrame()).not.toContain("FORM");
    const last = ACCESS_TOOL_OPTIONS.at(-1)!;
    for (let index = 1; index < ACCESS_TOOL_OPTIONS.length; index += 1) {
      ui.stdin.write("j");
      await delay(5);
    }
    await waitFor(() => (ui.lastFrame() || "").includes(last.label));
    const focusedLabel = `› [${DEFAULT_ACCESS_TOOLS.includes(last.value) ? "x" : " "}] ${last.label}`;
    expect(ui.lastFrame()).toContain(focusedLabel);

    ui.rerender(<WorkstationApp {...props({ executeFlow, terminalWidth: 70, terminalHeight: 24 })} />);
    await waitFor(() => (ui.lastFrame() || "").includes(focusedLabel));
    expect(ui.lastFrame()).toContain(focusedLabel);
  });

  it("keeps multi-select help chrome on its own row above the form bottom border", async () => {
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => ({
      title: "selected",
      body: (await prompts.multi("Tools", ACCESS_TOOL_OPTIONS, [...DEFAULT_ACCESS_TOOLS])).join(","),
    }));
    const ui = render(<WorkstationApp {...props({ executeFlow, terminalWidth: 140, terminalHeight: 28 })} />);
    ui.stdin.write("3"); await delay();
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("e"); await delay();
    for (let index = 0; index < Math.min(5, ACCESS_TOOL_OPTIONS.length - 1); index += 1) {
      ui.stdin.write("j");
      await delay(5);
    }
    const lines = (ui.lastFrame() || "").split("\n");
    const helpIndex = lines.findIndex((line) => line.includes("Space toggle") && line.includes("Enter apply") && line.includes("Esc cancel"));
    expect(helpIndex).toBeGreaterThanOrEqual(0);
    expect(lines[helpIndex]).toContain("║");
    expect(lines[helpIndex + 1]).toContain("╚");
    expect(lines[helpIndex + 1]).toContain("╝");
    expect(lines[helpIndex + 1]).not.toContain("└");
    const inspectorBottomIndex = lines.findIndex((line, index) => index > helpIndex + 1 && line.includes("└") && line.includes("┘"));
    expect(inspectorBottomIndex).toBeGreaterThan(helpIndex + 1);
    const actionFooterIndex = lines.findIndex((line) => line.includes("Action form") && line.includes("inside modal"));
    const navigationFooterIndex = lines.findIndex((line) => line.includes("Enter apply/select") && line.includes("Esc cancel"));
    expect(actionFooterIndex).toBeGreaterThan(inspectorBottomIndex);
    expect(navigationFooterIndex).toBe(actionFooterIndex + 1);
  });

  it("pauses an active form when the terminal becomes too small and ignores invisible input", async () => {
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => ({ title: "value", body: await prompts.text("Value") }));
    const normal = props({ executeFlow, terminalWidth: 100, terminalHeight: 28 });
    const ui = render(<WorkstationApp {...normal} />);
    ui.stdin.write("n"); await delay();
    expect(ui.lastFrame()).toContain("Value");

    ui.rerender(<WorkstationApp {...normal} terminalWidth={50} terminalHeight={16} />);
    await delay();
    expect(ui.lastFrame()).toContain("Form paused");
    ui.stdin.write("x"); await delay();

    ui.rerender(<WorkstationApp {...normal} />);
    await delay();
    expect(ui.lastFrame()).toContain("Value");
    expect(ui.lastFrame()).not.toContain("> x");
    ui.stdin.write("x"); await delay();
    expect(ui.lastFrame()).toContain("> x");
  });

  it("keeps last-good data visible and surfaces refresh failures without unhandled blank states", async () => {
    const refresh = vi.fn(async () => { throw new Error("refresh unavailable"); });
    const ui = render(<WorkstationApp {...props({ refresh, refreshIntervalMs: 20 })} />);
    await waitFor(() => refresh.mock.calls.length >= 2);
    await delay();
    expect(ui.lastFrame()).toContain("stable");
    expect(ui.lastFrame()).toContain("Refresh failed");
    expect(ui.lastFrame()).toContain("last-good data shown");
    expect(ui.lastFrame()).not.toContain("No Gateways configured");
  });
});
