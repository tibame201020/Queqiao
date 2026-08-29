import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runRoleSetupWizard, type RoleSetupPrompts } from "../../apps/cli/src/setup-wizard.js";

const [root, gatewayPortText, managementPortText, workerPortText] = process.argv.slice(2);
if (!root || !gatewayPortText || !managementPortText || !workerPortText) {
  throw new Error("Usage: prepare_fixture.ts <root> <gateway-port> <management-port> <worker-port>");
}

const gatewayPort = Number(gatewayPortText);
const managementPort = Number(managementPortText);
const workerPort = Number(workerPortText);
const gatewayName = "demo-gateway";
const workerName = "demo-worker";
const workspaceRoot = path.join(root, "workspace");
const extensionRoot = path.join(root, "mock-extension");

function prompts(choices: string[], texts: string[]): RoleSetupPrompts {
  return {
    choose: async () => {
      const value = choices.shift();
      if (value === undefined) throw new Error("Unexpected fixture choice prompt");
      return value;
    },
    multi: async () => { throw new Error("Unexpected fixture multiselect prompt"); },
    commandText: async () => { throw new Error("Unexpected fixture command prompt"); },
    text: async (_message, initialValue, validate) => {
      const value = texts.shift() ?? initialValue ?? "";
      const error = validate?.(value);
      if (error) throw new Error(error);
      return value;
    },
  };
}

await mkdir(workspaceRoot, { recursive: true });
await writeFile(path.join(workspaceRoot, "hello.txt"), "hello from Queqiao demo\n", "utf8");

await runRoleSetupWizard("gateway", ["gateway", "setup"], {
  env: process.env,
  platform: process.platform,
  interactive: true,
  prompts: prompts(["__create__"], [
    gatewayName,
    `http://127.0.0.1:${gatewayPort}/`,
    String(gatewayPort),
    String(managementPort),
  ]),
  portAvailable: async () => true,
});

await runRoleSetupWizard("worker", ["worker", "setup"], {
  env: process.env,
  platform: process.platform,
  interactive: true,
  prompts: prompts(["__create__", "builtin:reader"], [
    workerName,
    String(workerPort),
    workspaceRoot,
    "Demo Workspace",
  ]),
  portAvailable: async () => true,
});

await mkdir(path.join(extensionRoot, "dist"), { recursive: true });
await writeFile(path.join(extensionRoot, "dist", "index.js"), `export default {
  manifest: { id: "dev.queqiao.demo", version: "1.0.0", displayName: "Demo Extension" },
  activate() {},
};
`, "utf8");
await writeFile(path.join(extensionRoot, "package.json"), JSON.stringify({
  name: "queqiao-demo-extension",
  version: "1.0.0",
  type: "module",
  queqiao: {
    apiVersion: 1,
    module: "./dist/index.js",
    manifest: {
      id: "dev.queqiao.demo",
      version: "1.0.0",
      displayName: "Demo Extension",
      host: { kind: "worker" },
      ordering: { requires: [], before: [], after: [] },
      contributions: [],
    },
  },
}, null, 2), "utf8");

process.stdout.write(JSON.stringify({
  gatewayName,
  workerName,
  workspaceRoot,
  extensionRoot,
  gatewayPort,
  managementPort,
  workerPort,
}));
