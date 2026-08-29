import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { removeRoleInstance } from "./role-remove.js";

describe("role instance remove", () => {
  it("removes only the selected stopped Gateway instance", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-remove-role-")));
    const env = process.platform === "win32"
      ? { ...process.env, LOCALAPPDATA: root, USERPROFILE: root }
      : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
    for (const name of ["stable", "shadow"]) {
      const layout = resolveRuntimeLayoutForNamedRole("gateway", name, env, process.platform);
      await mkdir(path.dirname(layout.configFile), { recursive: true });
      await writeFile(layout.configFile, "version: 1\nworkspaces: []\n", "utf8");
    }
    const stable = resolveRuntimeLayoutForNamedRole("gateway", "stable", env, process.platform);
    const shadow = resolveRuntimeLayoutForNamedRole("gateway", "shadow", env, process.platform);

    let promptMessage = "";
    const result = await removeRoleInstance("gateway", ["gateway", "remove"], {
      env,
      platform: process.platform,
      prompts: { choose: async (message) => { promptMessage = message; return "stable"; }, confirm: async () => true },
      status: async () => ({ active: false, managed: false }),
    });
    expect(promptMessage).toBe("Gateway");

    await expect(import("node:fs/promises").then(({ access }) => access(stable.configFile))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(import("node:fs/promises").then(({ access }) => access(shadow.configFile))).resolves.toBeUndefined();
    expect(result).toMatchObject({ removed: true, role: "gateway", name: "stable" });
  });

  it("refuses to remove a running instance", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-remove-running-")));
    const env = process.platform === "win32" ? { ...process.env, LOCALAPPDATA: root, USERPROFILE: root } : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
    const layout = resolveRuntimeLayoutForNamedRole("worker", "windows", env, process.platform);
    await mkdir(path.dirname(layout.configFile), { recursive: true });
    await writeFile(layout.configFile, "version: 1\nworkspaces: []\n", "utf8");

    await expect(removeRoleInstance("worker", ["worker", "remove"], {
      env,
      platform: process.platform,
      prompts: { choose: async () => "windows", confirm: async () => true },
      status: async () => ({ active: true, managed: true }),
    })).rejects.toThrow(/stop.*Worker.*before removing/i);
  });

  it("rejects --name so remove follows the same interactive instance-selection model as setup", async () => {
    await expect(removeRoleInstance("gateway", ["gateway", "remove", "--name", "stable"], {
      prompts: { choose: async () => "stable", confirm: async () => true },
    })).rejects.toThrow(/--name is not supported for remove/i);
  });
});
