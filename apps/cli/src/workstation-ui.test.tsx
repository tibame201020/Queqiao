import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { WorkstationSnapshot } from "./workstation.js";
import { WorkstationApp, workstationAreas, workstationRenderOptions, workstationUiInternals, type WorkstationPromptDriver } from "./workstation-ui.js";
import { resolveWorkstationPalette } from "./workstation-theme.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
const nextEventLoopTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function waitForFrameText(ui: ReturnType<typeof render>, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((ui.lastFrame() || "").includes(text)) return;
    await nextEventLoopTurn();
  }
  throw new Error(`Workstation did not render expected text: ${text}`);
}

const snapshot = (overrides: Partial<WorkstationSnapshot> = {}): WorkstationSnapshot => ({
  gateways: [{ name: "stable", configured: true, running: true, managed: true, publicUrl: "https://example.test/stable/", servicePort: 8075, managementPort: 8074 }],
  workers: [{ name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: 1 }],
  workspaces: [{ workerName: "wins-worker", id: "queqiao", displayName: "Queqiao", root: "C:\\codes\\Queqiao", profile: "coding" }],
  profiles: [
    { name: "Reader", builtin: true, tools: ["read_file", "list_directory"], allowedExecutables: [] },
    { name: "coding-safe", builtin: false, tools: ["read_file", "edit_file", "run"], allowedExecutables: ["git", "npm"] },
  ],
  extensions: [{ id: "dev.queqiao.mcp", displayName: "MCP", version: "0.1.1", package: "@tibame201020/queqiao-mcp", workers: [{ name: "wins-worker", attached: true }] }],
  gatewayCount: 1, runningGatewayCount: 1, workerCount: 1, runningWorkerCount: 1, workspaceCount: 1,
  profileCount: 2, customProfileCount: 1, extensionCount: 1, attachmentCount: 1, gettingStarted: [],
  ...overrides,
});

function app(props: Partial<React.ComponentProps<typeof WorkstationApp>> = {}) {
  return render(<WorkstationApp snapshot={snapshot()} executeDirect={async () => ({ title: "ok", body: "ok" })} executeFlow={async () => ({ title: "ok", body: "ok" })} onExit={() => undefined} refreshIntervalMs={0} terminalWidth={100} terminalHeight={28} {...props} />);
}

describe("Workstation Ink control plane", () => {
  it("uses a semantic color system for focus, health, warning and destructive states", () => {
    const palette = resolveWorkstationPalette();
    expect(workstationUiInternals.runtimeColor(true)).toBe(palette.success);
    expect(workstationUiInternals.runtimeColor(false)).toBe(palette.muted);
    expect(workstationUiInternals.feedbackColor("success")).toBe(palette.success);
    expect(workstationUiInternals.feedbackColor("error")).toBe(palette.danger);
    expect(workstationUiInternals.actionColor({ key: "remove", label: "Remove Workspace" })).toBe(palette.danger);
    expect(workstationUiInternals.actionColor({ key: "lifecycle", label: "Stop" })).toBe(palette.warning);
    expect(workstationUiInternals.actionColor({ key: "configure", label: "Configure" })).toBeUndefined();
  });

  it("keeps the packaged alternate-screen contract and six domain shortcuts", () => {
    const ui = app();
    expect(workstationRenderOptions).toMatchObject({ alternateScreen: true, incrementalRendering: true });
    expect(workstationAreas).toHaveLength(6);
    expect(ui.lastFrame()).toContain("1 Gateway");
    expect(ui.lastFrame()).toContain("6 Health");
    expect(ui.lastFrame()).toContain("INVENTORY");
    expect(ui.lastFrame()).toContain("INSPECTOR");
  });

  it("executes runtime lifecycle actions from the Inspector and stays mounted", async () => {
    let actionStarted!: () => void;
    const started = new Promise<void>((resolve) => { actionStarted = resolve; });
    const executeDirect = vi.fn(async () => {
      actionStarted();
      return { title: "Gateway stable", body: '{"stopped":true}' };
    });
    const ui = app({
      executeDirect,
      refresh: async () => snapshot({ gateways: [{ name: "stable", configured: true, running: false, managed: false }], runningGatewayCount: 0 }),
    });
    ui.stdin.write("\t");
    await waitForFrameText(ui, "› [s] Stop");
    ui.stdin.write("s");
    await started;
    await waitForFrameText(ui, "✓ Gateway stable");
    expect(executeDirect).toHaveBeenCalledWith({ type: "role-stop", role: "gateway", name: "stable" });
    expect(ui.lastFrame()).toContain("Queqiao Workstation");
    expect(ui.lastFrame()).not.toContain('{"stopped":true}');
  });

  it("keeps multi-step form flows inside the Inspector prompt layer", async () => {
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => {
      const name = await prompts.text("Gateway name", "stable", (value) => value ? undefined : "required");
      const mode = await prompts.choose("Mode", [{ value: "edit", label: "Edit" }, { value: "new", label: "New" }]);
      const tools = await prompts.multi("Tools", [{ value: "read_file", label: "Read" }, { value: "run", label: "Run" }], ["read_file"]);
      const approved = await prompts.confirm("Apply changes?", false);
      return { title: "Gateway configured", body: `${name}:${mode}:${tools.join(",")}:${approved}` };
    });
    const ui = app({ executeFlow });
    ui.stdin.write("n"); await delay();
    expect(ui.lastFrame()).toContain("Gateway name");
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("Mode");
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("› [x] Read");
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("Apply changes?");
    ui.stdin.write("y"); await delay();
    expect(executeFlow).toHaveBeenCalledTimes(1);
    expect(ui.lastFrame()).toContain("✓ Gateway configured");
  });

  it("masks secret prompt values while still delivering the original value to the flow", async () => {
    const captured: string[] = [];
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => {
      const value = await prompts.secret("Join code", "", (candidate) => candidate ? undefined : "required");
      captured.push(value);
      return { title: "Secret accepted", body: "ok" };
    });
    const ui = app({ executeFlow });
    ui.stdin.write("n"); await delay();
    expect(ui.lastFrame()).toContain("Join code");
    const secret = "sensitive-code";
    ui.stdin.write(secret); await delay();
    const frame = ui.lastFrame() || "";
    expect(frame).not.toContain(secret);
    expect(frame).toContain("••••");
    ui.stdin.write("\r"); await delay();
    expect(captured).toEqual([secret]);
    expect(ui.lastFrame()).toContain("✓ Secret accepted");
    expect(ui.lastFrame()).not.toContain(secret);
  });

  it("keeps Access Profile authority summary and actions compact, with full policy in Detailed Info tabs", async () => {
    const ui = app();
    ui.stdin.write("4"); await delay();
    ui.stdin.write("j"); await delay();
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("coding-safe");
    expect(ui.lastFrame()).toContain("◇ Custom profile");
    expect(ui.lastFrame()).toMatch(/Tools\s+3/);
    expect(ui.lastFrame()).toMatch(/Executables\s+2/);
    expect(ui.lastFrame()).toContain("› [e] Edit Profile");
    expect(ui.lastFrame()).toContain("Rename Profile");
    expect(ui.lastFrame()).toContain("Delete Profile");
    ui.stdin.write("i"); await delay();
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Tools]");
    expect(ui.lastFrame()).toContain("• read_file");
    expect(ui.lastFrame()).toContain("• edit_file");
    expect(ui.lastFrame()).toContain("• run");
    ui.stdin.write("\u001b[C"); await delay();
    expect(ui.lastFrame()).toContain("[Commands]");
    expect(ui.lastFrame()).toContain("• git");
    expect(ui.lastFrame()).toContain("• npm");
  });

  it("executes Workspace edit without opening another submenu", async () => {
    const executeFlow = vi.fn(async () => ({ title: "Workspace updated", body: "changed" }));
    const ui = app({ executeFlow });
    ui.stdin.write("3"); await delay();
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("Root");
    expect(ui.lastFrame()).toContain("C:\\codes\\Queqiao");
    expect(ui.lastFrame() || "").toMatch(/Profile\s+coding/);
    ui.stdin.write("e"); await delay();
    expect(executeFlow).toHaveBeenCalledWith({ type: "workspace-edit", workerName: "wins-worker", workspaceId: "queqiao" }, expect.anything());
    expect(ui.lastFrame()).toContain("✓ Workspace updated");
  });

  it("toggles Extension attachment directly from its Inspector", async () => {
    const executeDirect = vi.fn(async () => ({ title: "Extension attachment", body: '{"attached":false}' }));
    const ui = app({ executeDirect });
    ui.stdin.write("5"); await delay();
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame() || "").toMatch(/Workers\s+1\/1 attached/);
    expect(ui.lastFrame()).toContain("› Detach · wins-worker");
    ui.stdin.write("\r"); await delay();
    expect(executeDirect).toHaveBeenCalledWith({ type: "extension-toggle", extensionId: "dev.queqiao.mcp", workerName: "wins-worker", attached: true });
  });

  it("renders contextual footer actions for the selected resource instead of generic navigation only", async () => {
    const ui = app();
    let footer = (ui.lastFrame() || "").split("\n").slice(-2).join("\n");
    expect(footer).toContain("[s] Stop");
    expect(footer).toContain("[j] Create join code");
    expect(footer).toContain("[?] Help");
    expect(footer).toContain("[,] Settings");

    ui.stdin.write("2"); await delay();
    footer = (ui.lastFrame() || "").split("\n").slice(-2).join("\n");
    expect(footer).toContain("[w] Add Workspace");
    expect(footer).toContain("[g] Join Gateway");

    ui.stdin.write("3"); await delay();
    footer = (ui.lastFrame() || "").split("\n").slice(-2).join("\n");
    expect(footer).toContain("[e] Edit Workspace");
    expect(footer).toContain("[d] Remove Workspace");
  });

  it("advertises direct Enter execution for no-shortcut actions in the single-layer Inspector", async () => {
    const extensionUi = app({ terminalWidth: 140, terminalHeight: 35 });
    extensionUi.stdin.write("5"); await delay();
    extensionUi.stdin.write("\r"); await delay();
    const extensionFooter = (extensionUi.lastFrame() || "").split("\n").slice(-2).join("\n");
    expect(extensionFooter).not.toContain("Enter Detach");
    expect(extensionFooter).toContain("[?] Help");
    expect(extensionFooter).toContain("[,] Settings");
    expect(extensionUi.lastFrame()).toContain("Enter run");

    const diagnosticsUi = app({ terminalWidth: 140, terminalHeight: 35 });
    diagnosticsUi.stdin.write("6"); await delay();
    diagnosticsUi.stdin.write("\r"); await delay();
    const diagnosticsFooter = (diagnosticsUi.lastFrame() || "").split("\n").slice(-2).join("\n");
    expect(diagnosticsFooter).not.toContain("Enter Run diagnostics");
    expect(diagnosticsFooter).toContain("[?] Help");
    expect(diagnosticsUi.lastFrame()).toContain("Enter run");
  });

  it("opens keyboard Help with ? and Esc returns to the same selected object", async () => {
    const ui = app();
    expect(ui.lastFrame()).toContain("stable");
    ui.stdin.write("?"); await delay();
    expect(ui.lastFrame()).toContain("HELP · Keyboard reference");
    expect(ui.lastFrame()).toContain("Enter run selected action");
    ui.stdin.write("\u001b"); await delay();
    expect(ui.lastFrame()).not.toContain("HELP · Keyboard reference");
    expect(ui.lastFrame()).toContain("stable");
    expect(ui.lastFrame()).toContain("Public URL");
  });

  it("exposes Gateway connector handoff actions directly in Inspector and dispatches shortcuts", async () => {
    const executeDirect = vi.fn(async (action) => ({ title: action.type === "gateway-copy-mcp-url" ? "MCP URL copied" : "Approval secret copied", body: "{}" }));
    const ui = app({ executeDirect });
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("Copy MCP URL");
    expect(ui.lastFrame()).toContain("Copy approval secret");
    ui.stdin.write("c"); await delay();
    expect(executeDirect).toHaveBeenCalledWith({ type: "gateway-copy-mcp-url", name: "stable" });
    expect(ui.lastFrame()).toContain("MCP URL copied");
    ui.stdin.write("i"); await delay();
    ui.stdin.write("p"); await delay();
    expect(executeDirect).toHaveBeenCalledWith({ type: "gateway-copy-approval-secret", name: "stable" });
    expect(ui.lastFrame()).toContain("Approval secret copied");
  });

  it("keeps standard-width form guidance compact enough to stay on one row", async () => {
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => ({ title: "value", body: await prompts.text("Value") }));
    const ui = app({ executeFlow, terminalWidth: 100, terminalHeight: 28 });
    ui.stdin.write("n"); await delay();
    expect(ui.lastFrame()).toContain("Type · Backspace · Enter apply · Esc cancel");
    expect(ui.lastFrame()).not.toContain("Backspace delete");
  });

  it("renders destructive confirmation as an explicit target/effect review and cancellation preserves context", async () => {
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => {
      const approved = await prompts.confirm("Remove Workspace Queqiao?", false, {
        tone: "destructive",
        title: "Remove Workspace",
        details: ["Workspace: Queqiao", "Worker: wins-worker", "Effect: remove this authorized root"],
      });
      return { title: approved ? "Workspace removed" : "Workspace removal cancelled", body: "{}" };
    });
    const ui = app({
      executeFlow,
      snapshot: snapshot({
        workers: [{ name: "wins-worker", configured: true, running: true, managed: true, endpoint: "http://127.0.0.1:8076/", workspaceCount: 2 }],
        workspaceCount: 2,
      }),
    });
    ui.stdin.write("3"); await delay();
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("d"); await delay();
    expect(ui.lastFrame()).toContain("ACTION · Remove Workspace");
    expect(ui.lastFrame()).toMatch(/Target\s+Queqiao/);
    expect(ui.lastFrame()).toMatch(/Purpose\s+Remove this authorized root from the Worker\./);
    expect(ui.lastFrame()).toContain("Worker: wins-worker");
    expect(ui.lastFrame()).toContain("Effect: remove this authorized root");
    expect(ui.lastFrame()).toContain("Yes");
    expect(ui.lastFrame()).toContain("No");
    expect(ui.lastFrame()).toContain("Default No");
    ui.stdin.write("\u001b"); await delay(); await delay();
    expect(ui.lastFrame()).toContain("○ Action cancelled");
    ui.stdin.write("i"); await delay();
    expect(ui.lastFrame()).toContain("INSPECTOR");
    expect(ui.lastFrame()).toContain("Actions");
    expect(ui.lastFrame()).toContain("Root");
    expect(ui.lastFrame()).toContain("C:\\codes\\Queqiao");
  });

  it("lets text prompts own q and quits only after the prompt completes", async () => {
    const onExit = vi.fn();
    const executeFlow = vi.fn(async (_action, prompts: WorkstationPromptDriver) => ({ title: "value", body: await prompts.text("Value") }));
    const ui = app({ executeFlow, onExit });
    ui.stdin.write("n"); await delay();
    expect(ui.lastFrame()).toContain("Value");
    ui.stdin.write("q"); await delay();
    expect(onExit).not.toHaveBeenCalled();
    expect(ui.lastFrame()).toContain("> q");
    ui.stdin.write("\r"); await delay();
    ui.stdin.write("q"); await delay();
    expect(onExit).not.toHaveBeenCalled();
    expect(ui.lastFrame()).toContain("✓ value");
    ui.stdin.write("i"); await delay();
    ui.stdin.write("q"); await delay();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});