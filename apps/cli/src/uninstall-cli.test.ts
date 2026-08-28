import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayout, resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { uninstallQueqiao } from "./uninstall-cli.js";

describe("Queqiao uninstall", () => {
  it("shows selectable ownership units before confirmation, then removes only selected targets", async () => {
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
    const hub = resolveRuntimeLayout(env, process.platform);
    await mkdir(path.join(hub.dataDir, "extensions"), { recursive: true });
    await writeFile(path.join(hub.dataDir, "extensions", "marker"), "owned", "utf8");

    const seenChoices: Array<{ value: string; label: string }> = [];
    const stopped: string[] = [];
    const npmCalls: string[][] = [];
    const result = await uninstallQueqiao(["uninstall"], {
      env,
      platform: process.platform,
      selectTargets: async (choices) => {
        seenChoices.push(...choices);
        return ["gateway:stable", "shared", "package"];
      },
      confirm: async () => true,
      status: async () => ({ active: true, managed: true }),
      stop: async (_layout, role, name) => { stopped.push(`${role}:${name}`); return { stopped: true }; },
      runNpm: async (args) => { npmCalls.push([...args]); },
    });

    expect(seenChoices.map((choice) => choice.value)).toEqual([
      "gateway:stable",
      "worker:windows",
      "shared",
      "package",
    ]);
    expect(stopped).toEqual(["gateway:stable"]);
    expect(npmCalls).toEqual([["uninstall", "--global", "@tibame201020/queqiao"]]);
    await expect(access(gateway.configFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(worker.configFile)).resolves.toBeUndefined();
    await expect(access(path.join(hub.dataDir, "extensions", "marker"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(result).toMatchObject({ uninstalled: true, package: "@tibame201020/queqiao" });
  });

  it("cancels without side effects when no cleanup targets are selected", async () => {
    const npmCalls: string[][] = [];
    const result = await uninstallQueqiao(["uninstall"], {
      selectTargets: async () => [],
      confirm: async () => { throw new Error("confirmation must not be shown"); },
      runNpm: async (args) => { npmCalls.push(args); },
    });
    expect(result).toMatchObject({ uninstalled: false, cancelled: true });
    expect(npmCalls).toEqual([]);
  });

  it("requires the final confirmation after target selection", async () => {
    const npmCalls: string[][] = [];
    const result = await uninstallQueqiao(["uninstall"], {
      selectTargets: async () => ["package"],
      confirm: async () => false,
      runNpm: async (args) => { npmCalls.push(args); },
    });
    expect(result).toMatchObject({ uninstalled: false, cancelled: true });
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
      confirm: async () => true,
      status: async () => ({ active: true, managed: false }),
      runNpm: async () => { throw new Error("must not run"); },
    })).rejects.toThrow(/unmanaged.*runtime/i);
    await expect(access(gateway.configFile)).resolves.toBeUndefined();
  });
});