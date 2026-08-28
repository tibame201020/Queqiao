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

function prompts(answers: string[]): RoleSetupPrompts {
  return {
    choose: async () => answers.shift() || "",
    text: async (_message, initialValue, validate) => {
      const value = answers.shift() || initialValue || "";
      const problem = validate?.(value);
      if (problem) throw new Error(problem);
      return value;
    },
  };
}

async function writeGateway(env: NodeJS.ProcessEnv, name: string, servicePort: number, managementPort: number): Promise<void> {
  const layout = resolveRuntimeLayoutForNamedRole("gateway", name, env, process.platform);
  await mkdir(path.dirname(layout.configFile), { recursive: true });
  await writeFile(layout.configFile, `version: 1\ngateway:\n  publicBaseUrl: https://example.invalid/${name}/\n  listen: { host: 127.0.0.1, port: ${servicePort} }\n  managementListen: { host: 127.0.0.1, port: ${managementPort} }\n  trustProxyHops: 1\n  stateDirectory: ${JSON.stringify(path.join(layout.dataDir, "gateway"))}\n  approvalSecretFile: ${JSON.stringify(path.join(layout.secretsDir, "approval.secret"))}\n  jwtSigningSecretFile: ${JSON.stringify(path.join(layout.secretsDir, "jwt.secret"))}\nworkspaces: []\n`, "utf8");
}

async function writeWorker(env: NodeJS.ProcessEnv, name: string, port: number): Promise<void> {
  const layout = resolveRuntimeLayoutForNamedRole("worker", name, env, process.platform);
  await mkdir(path.dirname(layout.configFile), { recursive: true });
  await writeFile(layout.configFile, `version: 1\nworker:\n  workerId: 11111111-1111-4111-8111-111111111111\n  environmentId: ${name}\n  listen: { host: 127.0.0.1, port: ${port} }\n  tokenFile: ${JSON.stringify(path.join(layout.secretsDir, "worker.secret"))}\nworkspaces: []\n`, "utf8");
}

describe("configured port reservation", () => {
  it("rejects a new Gateway port reserved by a stopped sibling Gateway", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-configured-port-")));
    const env = envFor(root);
    await writeGateway(env, "shadow", 7675, 7674);

    await expect(runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["__create__", "stable", "https://example.invalid/stable/", "7675"]),
      portAvailable: async () => true,
    })).rejects.toThrow(/7675.*reserved by Gateway shadow/i);
  });

  it("rejects a Worker port reserved by a configured Gateway management listener", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-configured-port-cross-role-")));
    const env = envFor(root);
    await writeGateway(env, "stable", 7775, 7774);

    await expect(runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["__create__", "windows", "7774"]),
      portAvailable: async () => true,
    })).rejects.toThrow(/7774.*reserved by Gateway stable/i);
  });

  it("ignores the selected instance's own existing ports during edit", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "queqiao-configured-port-self-")));
    const env = envFor(root);
    await writeGateway(env, "stable", 7775, 7774);
    await writeWorker(env, "windows", 7576);

    await expect(runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      prompts: prompts(["stable", "https://example.invalid/stable/", "7775", "7774"]),
      portAvailable: async () => { throw new Error("unchanged ports should not probe OS"); },
      setupGateway: async () => ({ setup: true }),
    })).resolves.toMatchObject({ name: "stable", mode: "edit" });
  });
});
