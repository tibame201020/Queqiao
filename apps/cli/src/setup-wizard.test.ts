import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { listNamedRoleInstances, runRoleSetupWizard, type RoleSetupPrompts } from "./setup-wizard.js";

function prompts(answers: Array<string>): RoleSetupPrompts {
  return {
    choose: async () => answers.shift() || "",
    multi: async () => (answers.shift() || "").split(",").map((value) => value.trim()).filter(Boolean),
    commandText: async () => answers.shift() || "",
    text: async (_message, initialValue) => answers.shift() || initialValue || "",
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

  it("always offers built-in Reader and Editor profiles before Custom", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    const workspaceRoot = path.join(root, "project");
    await mkdir(workspaceRoot);
    const accessChoices: string[][] = [];
    const answers = ["__create__", "windows", "7576", workspaceRoot, "Project", "builtin:reader"];
    const testPrompts: RoleSetupPrompts = {
      choose: async (message, options) => {
        if (message === "Access profile") accessChoices.push(options.map((option) => option.label));
        return answers.shift() || "";
      },
      multi: async () => { throw new Error("Reader must not prompt for tools"); },
      commandText: async () => { throw new Error("Reader must not prompt for commands"); },
      text: async (_message, initialValue) => answers.shift() || initialValue || "",
    };

    await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: testPrompts,
      portAvailable: async () => true,
      setupWorker: async () => ({ mode: "create" } as any),
    });

    expect(accessChoices).toEqual([["Reader", "Editor", "Custom"]]);
  });

  it("edits an existing Gateway selected by the first prompt", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    await createNamedConfig("gateway", "stable", env);
    const calls: string[] = [];

    const result = await runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["stable", "https://gateway.example/stable/", "7575", "7574"]),
      portAvailable: async () => true,
      setupGateway: async (_config, _args, _state, _secrets, _prompt) => { calls.push("stable"); return { mode: "edit" }; },
    });

    expect(calls).toEqual(["stable"]);
    expect(result).toMatchObject({ name: "stable", mode: "edit" });
  });

  it("creates a new Worker only after Create new is selected and a valid name is entered", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    const calls: string[] = [];

    const workspaceRoot = path.join(root, "project");
    await mkdir(workspaceRoot);
    let setupOptions: any;
    const result = await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["__create__", "windows", "7576", workspaceRoot, "Project", "__custom_access__", "read_file,search_text", "no"]),
      portAvailable: async () => true,
      setupWorker: async (_config, _args, _secrets, _prompt, options) => { calls.push("windows"); setupOptions = options; return { mode: "create" }; },
    });

    expect(calls).toEqual(["windows"]);
    expect(setupOptions).toMatchObject({ initialWorkspace: { id: "project", displayName: "Project", profile: "coding" } });
    expect(result).toMatchObject({ name: "windows", mode: "create" });
  });

  it("collects run command allowlist only when run is selected", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    const workspaceRoot = path.join(root, "project");
    await mkdir(workspaceRoot);
    let setupOptions: any;

    await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["__create__", "windows", "7576", workspaceRoot, "Project", "__custom_access__", "read_file,run", "git, NPM, git", "no"]),
      portAvailable: async () => true,
      setupWorker: async (_config, _args, _secrets, _prompt, options) => { setupOptions = options; return { mode: "create" }; },
    });

    expect(setupOptions.initialWorkspace).toMatchObject({
      profile: "coding",
      tools: { allow: ["read_file", "run"], deny: [], explicit: [] },
      commands: { allow: ["git", "npm"] },
    });
  });

  it("saves a custom access configuration and reuses it for another Worker", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    const firstWorkspace = path.join(root, "first");
    const secondWorkspace = path.join(root, "second");
    await mkdir(firstWorkspace);
    await mkdir(secondWorkspace);
    let firstOptions: any;
    let secondOptions: any;

    await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["__create__", "windows", "7576", firstWorkspace, "First", "__custom_access__", "read_file,run", "git,npm", "yes", "development"]),
      portAvailable: async () => true,
      setupWorker: async (_config, _args, _secrets, _prompt, options) => { firstOptions = options; return { mode: "create" }; },
    });

    await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["__create__", "linux", "7577", secondWorkspace, "Second", "profile:0"]),
      portAvailable: async () => true,
      setupWorker: async (_config, _args, _secrets, _prompt, options) => { secondOptions = options; return { mode: "create" }; },
    });

    expect(firstOptions.initialWorkspace).toMatchObject({
      tools: { allow: ["read_file", "run"] },
      commands: { allow: ["git", "npm"] },
    });
    expect(secondOptions.initialWorkspace).toMatchObject({
      tools: { allow: ["read_file", "run"] },
      commands: { allow: ["git", "npm"] },
    });
  });

  it("repairs an existing incomplete Worker by collecting its first authorized Workspace", async () => {
    const root = await mkdirFixture();
    const env = fixtureEnv(root);
    const layout = resolveRuntimeLayoutForNamedRole("worker", "wins-worker", env, process.platform);
    await mkdir(path.dirname(layout.configFile), { recursive: true });
    await writeFile(layout.configFile, `version: 1\nworker:\n  workerId: 11111111-1111-4111-8111-111111111111\n  environmentId: windows\n  listen:\n    host: 127.0.0.1\n    port: 8076\n  tokenFile: ${JSON.stringify(path.join(root, "worker.secret"))}\nworkspaces: []\n`, "utf8");
    const workspaceRoot = path.join(root, "codes");
    await mkdir(workspaceRoot);
    let setupOptions: any;
    const result = await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["wins-worker", "8076", workspaceRoot, "Codes", "__custom_access__", "read_file,search_text", "no"]),
      portAvailable: async () => true,
      setupWorker: async (_config, _args, _secrets, _prompt, options) => { setupOptions = options; return { mode: "edit", workerId: "11111111-1111-4111-8111-111111111111" }; },
    });
    expect(setupOptions).toMatchObject({ initialWorkspace: { id: "codes", displayName: "Codes", profile: "coding" } });
    expect(result).toMatchObject({ name: "wins-worker", mode: "edit", workerId: "11111111-1111-4111-8111-111111111111" });
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
