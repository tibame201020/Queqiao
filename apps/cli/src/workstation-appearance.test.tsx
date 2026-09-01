import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionOutcome } from "./workstation-action-outcome.js";
import {
  DEFAULT_WORKSTATION_PALETTE,
  resolveWorkstationPalette,
  workstationColorChoices,
  workstationSemanticRoles,
} from "./workstation-theme.js";
import {
  loadWorkstationSettings,
  resolveWorkstationSettingsFile,
  saveWorkstationSettings,
} from "./workstation-settings.js";
import {
  workstationActionModalHeight,
  workstationDetailModalHeight,
  workstationModalMaxHeight,
} from "./workstation-modal-style.js";
import { workstationColorPickerColumns } from "./workstation-settings-ui.js";
import { WorkstationApp } from "./workstation-ui.js";
import type { WorkstationSnapshot } from "./workstation.js";

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const delay = () => new Promise((resolve) => setTimeout(resolve, 35));

function snapshot(): WorkstationSnapshot {
  return {
    gateways: [{ name: "verify-gateway", configured: true, running: false, managed: false, publicUrl: "https://example.test/", servicePort: 4100, managementPort: 4101 }],
    workers: [], workspaces: [], profiles: [], extensions: [],
    gatewayCount: 1, runningGatewayCount: 0, workerCount: 0, runningWorkerCount: 0,
    workspaceCount: 0, profileCount: 0, customProfileCount: 0, extensionCount: 0, attachmentCount: 0,
    gettingStarted: ["worker", "workspace"],
  };
}

describe("Workstation appearance", () => {
  it("uses six fixed semantic roles and a broad shared color vocabulary instead of theme presets", () => {
    const palette = resolveWorkstationPalette();
    expect(workstationSemanticRoles.map((role) => role.id)).toEqual(["accent", "success", "warning", "danger", "modal", "muted"]);
    expect(workstationSemanticRoles).toHaveLength(6);
    expect(workstationColorChoices.length).toBeGreaterThanOrEqual(20);
    expect(workstationColorChoices.length).toBeLessThanOrEqual(32);
    expect(workstationColorPickerColumns(96)).toBe(4);
    expect(workstationColorPickerColumns(88)).toBe(4);
    expect(workstationColorPickerColumns(66)).toBe(3);
    expect(workstationColorPickerColumns(56)).toBe(2);
    expect(palette.modal).not.toBe(palette.accent);
    for (const color of Object.values(palette)) expect(workstationColorChoices.some((choice) => choice.value === color)).toBe(true);
  });

  it("keeps floating modals while giving every action form a consistent useful height", () => {
    expect(workstationDetailModalHeight(35)).toBeLessThan(workstationModalMaxHeight(35));
    expect(workstationActionModalHeight(28, "text", "running")).toBe(18);
    expect(workstationActionModalHeight(28, "secret", "running")).toBe(18);
    expect(workstationActionModalHeight(28, "choose", "running")).toBe(18);
    expect(workstationActionModalHeight(28, "multi", "running")).toBe(18);
    expect(workstationActionModalHeight(28, "confirm", "running")).toBe(18);
  });

  it("persists semantic colors and migrates legacy palette settings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workstation-settings-"));
    tempRoots.push(root);
    const env = { USERPROFILE: root, LOCALAPPDATA: path.join(root, "local-app-data") } as NodeJS.ProcessEnv;
    const file = resolveWorkstationSettingsFile(env, "win32");
    expect(await loadWorkstationSettings(env, "win32")).toEqual({ version: 1, appearance: { colors: DEFAULT_WORKSTATION_PALETTE } });

    const changed = { ...DEFAULT_WORKSTATION_PALETTE, success: workstationColorChoices.find((choice) => choice.id === "yellow")!.value };
    await saveWorkstationSettings({ version: 1, appearance: { colors: changed } }, env, "win32");
    expect(await loadWorkstationSettings(env, "win32")).toEqual({ version: 1, appearance: { colors: changed } });

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "version: 1\nappearance:\n  palette: aurora\n", "utf8");
    expect(await loadWorkstationSettings(env, "win32")).toEqual({ version: 1, appearance: { colors: DEFAULT_WORKSTATION_PALETTE } });
  });

  it("opens a color picker for a semantic role, chooses from the expanded grid, then saves the assignment", async () => {
    const saveAppearance = vi.fn(async () => undefined);
    const ui = render(<WorkstationApp
      snapshot={snapshot()}
      executeDirect={async () => actionOutcome("success", "ok")}
      executeFlow={async () => actionOutcome("success", "ok")}
      onExit={() => undefined}
      refreshIntervalMs={0}
      terminalWidth={100}
      terminalHeight={28}
      initialAppearance={DEFAULT_WORKSTATION_PALETTE}
      saveAppearance={saveAppearance}
    />);
    ui.stdin.write(","); await delay();
    const settings = ui.lastFrame() || "";
    expect(settings).toContain("SETTINGS · Appearance");
    expect(settings).toContain("Semantic colors");
    expect(settings).toContain("Select / Focus");
    expect(settings).toContain("Active / Success");
    expect(settings).toContain("Danger / Error");
    expect(settings).toContain("Enter colors");
    expect(settings).not.toContain("Aurora");
    expect(settings).not.toContain("Theme palette");

    ui.stdin.write("\u001b[B"); await delay();
    ui.stdin.write("\r"); await delay();
    const picker = ui.lastFrame() || "";
    expect(picker).toContain("Choose color");
    expect(picker).toContain("Cyan");
    expect(picker).toContain("Lavender");
    expect(picker).toContain("Emerald");
    expect(picker).toContain("Warm Gray");

    ui.stdin.write("\u001b[C"); await delay();
    ui.stdin.write("\r"); await delay();
    expect(ui.lastFrame()).toContain("Semantic colors");
    ui.stdin.write("s"); await delay(); await delay();

    const expected = { ...DEFAULT_WORKSTATION_PALETTE, success: workstationColorChoices.find((choice) => choice.id === "emerald")!.value };
    expect(saveAppearance).toHaveBeenCalledWith(expected);
    expect(ui.lastFrame()).not.toContain("SETTINGS · Appearance");
    expect(ui.lastFrame()).toContain("Appearance colors saved");
  });
});
