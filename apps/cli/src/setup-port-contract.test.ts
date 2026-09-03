import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { runRoleSetupWizard, type RoleSetupPrompts } from "./setup-wizard.js";

function envFor(root: string): NodeJS.ProcessEnv {
  if (process.platform === "win32") return { ...process.env, LOCALAPPDATA: root, USERPROFILE: root };
  return { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
}

function scriptedPrompts(answers: string[], messages: string[]): RoleSetupPrompts {
  return {
    choose: async (message) => { messages.push(message); return answers.shift() || ""; },
    multi: async (message) => { messages.push(message); return (answers.shift() || "").split(",").map((value) => value.trim()).filter(Boolean); },
    commandText: async (message) => { messages.push(message); return answers.shift() || ""; },
    text: async (message, initialValue, validate) => {
      messages.push(`${message} [${initialValue || ""}]`);
      const value = answers.shift() || initialValue || "";
      const problem = validate ? await validate(value) : undefined;
      if (problem) throw new Error(problem);
      return value;
    },
  };
}

describe("interactive setup port contract", () => {
  it("prompts Gateway URL, Gateway port, then Management port with descriptive hints", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-gateway-port-contract-")));
    const env = envFor(root);
    const messages: string[] = [];
    let setupArgs: string[] = [];

    const result = await runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      prompts: scriptedPrompts(["__create__", "stable", "https://gateway.example/stable/", "7775", "7774", "local"], messages),
      portAvailable: async () => true,
      setupGateway: async (_config, args, _state, _secrets, prompt) => {
        setupArgs = [...args];
        const url = await prompt?.("public-base-url", "Public Gateway URL");
        return { setup: true, url };
      },
    });

    expect(messages[0]).toBe("Gateway");
    expect(messages[1]).toBe("Gateway name []");
    expect(messages[2]).toBe("Public Gateway URL []");
    expect(messages[3]).toMatch(/^Gateway port .*Local port behind the public Gateway URL\..* \[7575\]$/);
    expect(messages[4]).toMatch(/^Management port .*Local-only port for Gateway management\..* \[7574\]$/);
    expect(messages[5]).toBe("Worker session exposure");
    expect(setupArgs).toEqual(["gateway", "setup", "--public-base-url", "https://gateway.example/stable/", "--port", "7775", "--management-port", "7774", "--worker-session-mode", "local"]);
    expect(result).toMatchObject({ name: "stable", mode: "create" });
  });

  it("preserves existing Gateway ports as edit defaults", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-gateway-port-edit-")));
    const env = envFor(root);
    const layout = resolveRuntimeLayoutForNamedRole("gateway", "stable", env, process.platform);
    await mkdir(path.dirname(layout.configFile), { recursive: true });
    await writeFile(layout.configFile, "version: 1\ngateway:\n  publicBaseUrl: https://old.example/\n  listen: { host: 127.0.0.1, port: 7775 }\n  managementListen: { host: 127.0.0.1, port: 7774 }\n  trustProxyHops: 1\n  stateDirectory: C:/tmp\n  approvalSecretFile: C:/tmp/a\n  jwtSigningSecretFile: C:/tmp/b\nworkspaces: []\n", "utf8");
    const messages: string[] = [];

    await runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      prompts: scriptedPrompts(["stable", "https://old.example/", "7775", "7774", "local"], messages),
      portAvailable: async () => { throw new Error("unchanged ports should not be probed"); },
      setupGateway: async (_config, _args, _state, _secrets, prompt) => { await prompt?.("public-base-url", "Public Gateway URL", "https://old.example/"); return { setup: true }; },
    });

    expect(messages).toEqual([
      "Gateway",
      "Public Gateway URL [https://old.example/]",
      expect.stringMatching(/^Gateway port .*\[7775\]$/),
      expect.stringMatching(/^Management port .*\[7774\]$/),
      "Worker session exposure",
    ]);
  });

  it("rejects equal Gateway and Management ports", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-gateway-port-equal-")));
    await expect(runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env: envFor(root),
      platform: process.platform,
      prompts: scriptedPrompts(["__create__", "stable", "https://gateway.example/stable/", "7775", "7775"], []),
      portAvailable: async () => true,
      setupGateway: async (_config, _args, _state, _secrets, prompt) => { await prompt?.("public-base-url", "Public Gateway URL"); return { setup: true }; },
    })).rejects.toThrow(/must be different/i);
  });

  it("rejects a newly selected occupied Worker port and uses the current port as edit default", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-worker-port-contract-")));
    const env = envFor(root);
    const layout = resolveRuntimeLayoutForNamedRole("worker", "windows", env, process.platform);
    await mkdir(path.dirname(layout.configFile), { recursive: true });
    await writeFile(layout.configFile, "version: 1\nworker:\n  workerId: 11111111-1111-4111-8111-111111111111\n  environmentId: windows\n  listen: { host: 127.0.0.1, port: 7576 }\n  tokenFile: C:/tmp/token\nworkspaces: []\n", "utf8");
    const messages: string[] = [];

    await expect(runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: scriptedPrompts(["windows", "7676"], messages),
      portAvailable: async (port) => port !== 7676,
      setupWorker: async (_config, _args, _secrets, prompt) => { await prompt?.("port", "Worker port", "7576"); return { setup: true }; },
    })).rejects.toThrow(/7676.*already in use/i);

    expect(messages[1]).toMatch(/^Worker port .*Local port used by the Worker runtime\..* \[7576\]$/);
  });
});
