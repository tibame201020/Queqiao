import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExtensionHubRoot, resolveRuntimeLayout, resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { uninstallQueqiao } from "./uninstall-cli.js";

async function isolatedEnv(prefix: string): Promise<NodeJS.ProcessEnv> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), prefix)));
  return process.platform === "win32"
    ? { ...process.env, LOCALAPPDATA: path.join(root, "local"), USERPROFILE: root, TEMP: path.join(root, "temp") }
    : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
}

describe("Queqiao uninstall", () => {
  it("lists local cleanup targets with their actual paths, cleans selected state, then asks separately about npm uninstall", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-uninstall-")));
    const env = process.platform === "win32"
      ? { ...process.env, LOCALAPPDATA: path.join(root, "local"), USERPROFILE: root, TEMP: path.join(root, "temp") }
      : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
    const gateway = resolveRuntimeLayoutForNamedRole("gateway", "stable", env, process.platform);
    const worker = resolveRuntimeLayoutForNamedRole("worker", "windows", env, process.platform);
    for (const layout of [gateway, worker]) {
      await mkdir(path.dirname(layout.configFile), { recursive: true });
      await writeFile(layout.configFile, "version: 1\nworkspaces: []\n", "utf8");
    }
    const legacyGlobal = resolveRuntimeLayout(env, process.platform);
    const hubRoot = resolveExtensionHubRoot(env, process.platform);
    await mkdir(hubRoot, { recursive: true });
    await writeFile(path.join(hubRoot, "marker"), "owned", "utf8");
    await mkdir(legacyGlobal.configDir, { recursive: true });
    await mkdir(legacyGlobal.stateDir, { recursive: true });
    await writeFile(path.join(legacyGlobal.configDir, "legacy-marker"), "legacy", "utf8");
    await writeFile(path.join(legacyGlobal.stateDir, "legacy-marker"), "legacy", "utf8");

    const seenChoices: Array<{ value: string; label: string; description?: string }> = [];
    const confirmations: string[] = [];
    const stopped: string[] = [];
    const npmCalls: string[][] = [];
    const result = await uninstallQueqiao(["uninstall"], {
      env,
      platform: process.platform,
      selectTargets: async (choices) => {
        seenChoices.push(...choices);
        return ["gateway:stable", "extension-hub"];
      },
      confirmCleanup: async (message) => { confirmations.push(message); return true; },
      confirmPackageUninstall: async (message) => { confirmations.push(message); return true; },
      status: async () => ({ active: true, managed: true }),
      stop: async (_layout, role, name) => { stopped.push(`${role}:${name}`); return { stopped: true }; },
      runNpm: async (args) => { npmCalls.push([...args]); },
    });

    expect(seenChoices.map((choice) => choice.value)).toEqual([
      "gateway:stable",
      "worker:windows",
      "extension-hub",
    ]);
    const gatewayChoice = seenChoices.find((choice) => choice.value === "gateway:stable");
    expect(gatewayChoice?.label).toBe("Gateway: stable (running)");
    expect(gatewayChoice?.description).toContain(`Persistent: ${path.dirname(gateway.configDir)}`);
    expect(gatewayChoice?.description).toContain(`Runtime:    ${gateway.runtimeDir}`);
    const workerChoice = seenChoices.find((choice) => choice.value === "worker:windows");
    expect(workerChoice?.label).toBe("Worker: windows (running)");
    const hubChoice = seenChoices.find((choice) => choice.value === "extension-hub");
    expect(hubChoice?.label).toBe("Extension Hub");
    expect(hubChoice?.description).toBe(`Path: ${hubRoot}`);
    expect(seenChoices.some((choice) => choice.value === "package")).toBe(false);
    expect(confirmations[0]).toMatch(/remove the selected local Queqiao data/i);
    expect(confirmations[1]).toMatch(/uninstall.*@tibame201020\/queqiao.*global npm/i);
    expect(stopped).toEqual(["gateway:stable"]);
    expect(npmCalls).toEqual([["uninstall", "--global", "@tibame201020/queqiao"]]);
    await expect(access(gateway.configFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(worker.configFile)).resolves.toBeUndefined();
    await expect(access(path.join(hubRoot, "marker"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(legacyGlobal.configDir, "legacy-marker"))).resolves.toBeUndefined();
    await expect(access(path.join(legacyGlobal.stateDir, "legacy-marker"))).resolves.toBeUndefined();
    expect(result).toMatchObject({ uninstalled: true, cleaned: true, package: "@tibame201020/queqiao" });
  });

  it("can clean selected local state while keeping the global npm package", async () => {
    const npmCalls: string[][] = [];
    const env = await isolatedEnv("queqiao-uninstall-keep-package-");
    const result = await uninstallQueqiao(["uninstall"], {
      env,
      platform: process.platform,
      selectTargets: async () => ["extension-hub"],
      confirmCleanup: async () => true,
      confirmPackageUninstall: async () => false,
      runNpm: async (args) => { npmCalls.push(args); },
    });
    expect(result).toMatchObject({ cleaned: true, uninstalled: false });
    expect(npmCalls).toEqual([]);
  });

  it("does not perform cleanup when no local cleanup targets are selected, but still offers package uninstall", async () => {
    const npmCalls: string[][] = [];
    const env = await isolatedEnv("queqiao-uninstall-no-cleanup-");
    const result = await uninstallQueqiao(["uninstall"], {
      env,
      platform: process.platform,
      selectTargets: async () => [],
      confirmCleanup: async () => { throw new Error("cleanup confirmation must not be shown"); },
      confirmPackageUninstall: async () => true,
      runNpm: async (args) => { npmCalls.push(args); },
    });
    expect(result).toMatchObject({ cleaned: false, uninstalled: true });
    expect(npmCalls).toEqual([["uninstall", "--global", "@tibame201020/queqiao"]]);
  });

  it("requires cleanup confirmation before deleting selected paths", async () => {
    const npmCalls: string[][] = [];
    const env = await isolatedEnv("queqiao-uninstall-confirm-");
    const result = await uninstallQueqiao(["uninstall"], {
      env,
      platform: process.platform,
      selectTargets: async () => ["extension-hub"],
      confirmCleanup: async () => false,
      confirmPackageUninstall: async () => false,
      runNpm: async (args) => { npmCalls.push(args); },
    });
    expect(result).toMatchObject({ cleaned: false, uninstalled: false });
    expect(npmCalls).toEqual([]);
  });

  it("rejects the removed --yes bypass", async () => {
    await expect(uninstallQueqiao(["uninstall", "--yes"], {
      selectTargets: async () => { throw new Error("must not prompt"); },
    })).rejects.toThrow(/--yes.*not supported/i);
  });

  it("refuses selected cleanup while an unmanaged selected runtime is still active", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-uninstall-unmanaged-")));
    const env = process.platform === "win32" ? { ...process.env, LOCALAPPDATA: root, USERPROFILE: root } : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
    const gateway = resolveRuntimeLayoutForNamedRole("gateway", "stable", env, process.platform);
    await mkdir(path.dirname(gateway.configFile), { recursive: true });
    await writeFile(gateway.configFile, "version: 1\nworkspaces: []\n", "utf8");

    await expect(uninstallQueqiao(["uninstall"], {
      env,
      platform: process.platform,
      selectTargets: async () => ["gateway:stable"],
      confirmCleanup: async () => true,
      confirmPackageUninstall: async () => false,
      status: async () => ({ active: true, managed: false }),
      runNpm: async () => { throw new Error("must not run"); },
    })).rejects.toThrow(/unmanaged.*runtime/i);
    await expect(access(gateway.configFile)).resolves.toBeUndefined();
  });
});