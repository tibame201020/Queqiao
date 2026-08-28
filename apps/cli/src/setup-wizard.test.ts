import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { listNamedRoleInstances, runRoleSetupWizard, type RoleSetupPrompts } from "./setup-wizard.js";

function prompts(answers: Array<string>): RoleSetupPrompts {
  return {
    choose: async () => answers.shift() || "",
    text: async () => answers.shift() || "",
  };
}

describe("role setup wizard", () => {
  it("lists existing named Gateway instances and Create new before configuring anything", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    await createNamedConfig("gateway", "stable", env);
    await createNamedConfig("gateway", "shadow", env);

    expect(await listNamedRoleInstances("gateway", env, process.platform)).toEqual(["shadow", "stable"]);
  });

  it("edits an existing Gateway selected by the first prompt", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    await createNamedConfig("gateway", "stable", env);
    const calls: string[] = [];

    const result = await runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["stable"]),
      setupGateway: async (_config, _args, _state, _secrets, _prompt) => { calls.push("stable"); return { mode: "edit" }; },
    });

    expect(calls).toEqual(["stable"]);
    expect(result).toMatchObject({ name: "stable", mode: "edit" });
  });

  it("creates a new Worker only after Create new is selected and a valid name is entered", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    const calls: string[] = [];

    const result = await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["__create__", "windows"]),
      setupWorker: async (_config, _args, _secrets, _prompt) => { calls.push("windows"); return { mode: "create" }; },
    });

    expect(calls).toEqual(["windows"]);
    expect(result).toMatchObject({ name: "windows", mode: "create" });
  });

  it("rejects --name so interactive setup has one consistent selection model", async () => {
    const root = await mkdirFixture();
    await expect(runRoleSetupWizard("gateway", ["gateway", "setup", "--name", "stable"], {
      env: fixtureEnv(root),
      platform: process.platform,
      prompts: prompts([]),
    })).rejects.toThrow(/--name is not supported for setup/i);
  });

  it("fails clearly instead of prompting in non-interactive mode", async () => {
    const root = await mkdirFixture();
    await expect(runRoleSetupWizard("worker", ["worker", "setup"], {
      env: fixtureEnv(root),
      platform: process.platform,
      interactive: false,
    })).rejects.toThrow(/interactive terminal/i);
  });
});

async function mkdirFixture(): Promise<string> {
  return import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-setup-wizard-")));
}

function fixtureEnv(root: string): NodeJS.ProcessEnv {
  if (process.platform === "win32") return { ...process.env, LOCALAPPDATA: root, USERPROFILE: root };
  return {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_RUNTIME_DIR: path.join(root, "runtime"),
  };
}

async function createNamedConfig(role: "gateway" | "worker", name: string, env: NodeJS.ProcessEnv): Promise<void> {
  const layout = resolveRuntimeLayoutForNamedRole(role, name, env, process.platform);
  await mkdir(path.dirname(layout.configFile), { recursive: true });
  await writeFile(layout.configFile, "version: 1\nworkspaces: []\n", "utf8");
}
