import { execFile } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { resolveExtensionHubRoot, resolveRuntimeLayout, resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { CLI_LEAF_CONTRACTS } from "./command-surface.js";
import { removeRoleInstance } from "./role-remove.js";
import { runRoleSetupWizard, type RoleSetupPrompts } from "./setup-wizard.js";
import { uninstallQueqiao } from "./uninstall-cli.js";

const execFileAsync = promisify(execFile);
const GATEWAY = "accept-gateway";
const WORKER = "accept-worker";
const EXTENSION_ID = "dev.queqiao.acceptance";

const ACCEPTANCE_COVERAGE: Readonly<Record<string, string>> = {
  "version": "packaged-version",
  "completion": "packaged-shell-completion",
  "gateway list": "packaged-process-state",
  "gateway setup": "interactive-setup",
  "gateway remove": "interactive-destructive",
  "gateway serve": "packaged-managed-runtime",
  "gateway stop": "packaged-managed-runtime",
  "gateway status": "packaged-process-state",
  "gateway info": "packaged-process-connector-info",
  "gateway join-token": "packaged-live-enrollment",
  "gateway workers list": "packaged-live-enrollment",
  "gateway workers update": "packaged-live-enrollment",
  "gateway workers remove": "packaged-live-enrollment",
  "worker list": "packaged-process-state",
  "worker setup": "interactive-setup",
  "worker remove": "interactive-destructive",
  "worker port": "packaged-process-config",
  "worker serve": "packaged-managed-runtime",
  "worker stop": "packaged-managed-runtime",
  "worker status": "packaged-process-state",
  "worker join": "packaged-live-enrollment",
  "worker workspace add": "packaged-process-workspace",
  "worker workspace list": "packaged-process-workspace",
  "worker workspace remove": "packaged-process-workspace",
  "worker workspace profile set": "packaged-process-workspace",
  "worker workspace tool allow": "packaged-process-workspace",
  "worker workspace tool deny": "packaged-process-workspace",
  "worker workspace command allow": "packaged-process-workspace",
  "worker workspace command deny": "packaged-process-workspace",
  "worker workspace permissions show": "packaged-process-workspace",
  "extension install": "packaged-process-extension",
  "extension attach": "packaged-process-extension",
  "extension detach": "packaged-process-extension",
  "extension uninstall": "packaged-process-extension",
  "extension list": "packaged-process-extension",
  "extension show": "packaged-process-extension",
  "doctor": "packaged-process-diagnostics",
  "doctor extension": "packaged-process-diagnostics",
  "doctor manifest show": "packaged-process-diagnostics",
  "doctor tool explain": "packaged-process-diagnostics",
  "doctor paths": "packaged-process-diagnostics",
  "uninstall": "interactive-destructive",
  "migrate from-repo": "packaged-process-migration",
  "migrate runtime-v1": "packaged-process-migration",
};

type CliResult = { stdout: string; stderr: string };
type PromptQueues = { choices: string[]; texts: string[] };

function prompts(queues: PromptQueues): RoleSetupPrompts {
  return {
    choose: async () => {
      const value = queues.choices.shift();
      if (value === undefined) throw new Error("Unexpected acceptance choose prompt");
      return value;
    },
    multi: async () => { throw new Error("Unexpected acceptance multi prompt"); },
    commandText: async () => { throw new Error("Unexpected acceptance command prompt"); },
    text: async (_message, initialValue, validate) => {
      const value = queues.texts.shift() ?? initialValue ?? "";
      const error = validate?.(value);
      if (error) throw new Error(error);
      return value;
    },
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate acceptance port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function parseJson<T = any>(result: CliResult): T {
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as T;
}

async function fakeLocalExtension(root: string): Promise<string> {
  const extension = path.join(root, "mock-extension");
  await mkdir(path.join(extension, "dist"), { recursive: true });
  await writeFile(path.join(extension, "dist", "index.js"), `export default {
  manifest: { id: "${EXTENSION_ID}", version: "1.0.0", displayName: "Acceptance Extension" },
  activate() {},
};
`, "utf8");
  await writeFile(path.join(extension, "package.json"), JSON.stringify({
    name: "queqiao-acceptance-extension",
    version: "1.0.0",
    type: "module",
    queqiao: {
      apiVersion: 1,
      module: "./dist/index.js",
      manifest: {
        id: EXTENSION_ID,
        version: "1.0.0",
        displayName: "Acceptance Extension",
        host: { kind: "worker" },
        ordering: { requires: [], before: [], after: [] },
        contributions: [],
      },
    },
  }, null, 2), "utf8");
  return extension;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.sequential("isolated packaged CLI acceptance", () => {
  let root = "";
  let env: NodeJS.ProcessEnv;
  let gatewayPort = 0;
  let managementPort = 0;
  let workerPort = 0;
  let packageOutdir = "";
  let cliEntry = "";
  let extensionRoot = "";

  const repositoryRoot = path.resolve(process.cwd());

  async function runCli(args: string[]): Promise<CliResult> {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
      cwd: repositoryRoot,
      env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout, stderr };
  }

  async function waitForJson<T>(args: string[], predicate: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        const result = await runCli(args);
        if (!result.stderr) {
          const value = JSON.parse(result.stdout) as T;
          if (predicate(value)) return value;
        }
      } catch (error) {
        last = error;
      }
      await delay(100);
    }
    throw last instanceof Error ? last : new Error(`Timed out waiting for CLI state: ${args.join(" ")}`);
  }

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "queqiao-cli-acceptance-"));
    env = {
      ...process.env,
      LOCALAPPDATA: path.join(root, "local-app-data"),
      USERPROFILE: path.join(root, "home"),
      HOME: path.join(root, "home"),
      TEMP: path.join(root, "temp"),
      NO_COLOR: "1",
    };
    await Promise.all([
      mkdir(env.LOCALAPPDATA!, { recursive: true }),
      mkdir(env.USERPROFILE!, { recursive: true }),
      mkdir(env.TEMP!, { recursive: true }),
    ]);
    packageOutdir = path.join(root, "package");
    await execFileAsync(process.execPath, [path.join(repositoryRoot, "scripts", "build-package.mjs")], {
      cwd: repositoryRoot,
      env: { ...process.env, QUEQIAO_BUILD_OUTDIR: packageOutdir },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    cliEntry = path.join(packageOutdir, "queqiao.js");
    await expect(readFile(cliEntry, "utf8")).resolves.toContain("#!/usr/bin/env node");
    await expect(readFile(path.join(packageOutdir, "queqiao-gateway.js"), "utf8")).resolves.toContain("#!/usr/bin/env node");
    await expect(readFile(path.join(packageOutdir, "queqiao-worker.js"), "utf8")).resolves.toContain("#!/usr/bin/env node");
    gatewayPort = await freePort();
    managementPort = await freePort();
    workerPort = await freePort();
  }, 30_000);

  afterAll(async () => {
    if (cliEntry) {
      await runCli(["gateway", "stop", "--gateway", GATEWAY, "--json"]).catch(() => undefined);
      await runCli(["worker", "stop", "--worker", WORKER, "--json"]).catch(() => undefined);
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("requires every public CLI leaf to name an acceptance scenario", () => {
    expect(Object.keys(ACCEPTANCE_COVERAGE).sort()).toEqual(CLI_LEAF_CONTRACTS.map((entry) => entry.route).sort());
  });

  it("reports the packaged CLI version through command, flags, and JSON", async () => {
    const packageVersion = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version as string;
    expect((await runCli(["version"])).stdout.trim()).toBe(packageVersion);
    expect((await runCli(["--version"])).stdout.trim()).toBe(packageVersion);
    expect((await runCli(["-v"])).stdout.trim()).toBe(packageVersion);
    expect(parseJson<any>(await runCli(["version", "--json"]))).toEqual({ schemaVersion: "1.0", version: packageVersion });
    expect(parseJson<any>(await runCli(["--version", "--json"]))).toEqual({ schemaVersion: "1.0", version: packageVersion });
  });

  it("prints shell completion scripts from the packaged CLI", async () => {
    const bash = (await runCli(["completion", "bash"])).stdout;
    const zsh = (await runCli(["completion", "zsh"])).stdout;
    const powershell = (await runCli(["completion", "powershell"])).stdout;
    expect(bash).toContain("complete -o default -F _queqiao_completion queqiao");
    expect(bash).toContain("gateway info");
    expect(zsh).toContain("compdef _queqiao_completion queqiao");
    expect(powershell).toContain("Register-ArgumentCompleter -Native -CommandName queqiao,queqiao.cmd");
  });
  it("creates isolated Gateway and Worker instances through the real setup wizards and packaged read paths", async () => {
    const workspaceRoot = path.join(root, "workspace-one");
    await mkdir(workspaceRoot, { recursive: true });

    await runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      interactive: true,
      prompts: prompts({
        choices: ["__create__"],
        texts: [GATEWAY, `http://127.0.0.1:${gatewayPort}/`, String(gatewayPort), String(managementPort)],
      }),
      portAvailable: async () => true,
    });

    await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      interactive: true,
      prompts: prompts({
        choices: ["__create__", "builtin:reader"],
        texts: [WORKER, String(workerPort), workspaceRoot, "Acceptance Workspace"],
      }),
      portAvailable: async () => true,
    });

    const gateways = parseJson<any>(await runCli(["gateway", "list", "--json"]));
    const workers = parseJson<any>(await runCli(["worker", "list", "--json"]));
    expect(gateways.instances).toEqual([expect.objectContaining({ name: GATEWAY, running: false })]);
    expect(workers.instances).toEqual([expect.objectContaining({ name: WORKER, running: false, workspaceCount: 1 })]);
    expect(parseJson<any>(await runCli(["gateway", "status", "--gateway", GATEWAY, "--json"]))).toMatchObject({ active: false, managed: false });
    const gatewayInfo = parseJson<any>(await runCli(["gateway", "info", "--gateway", GATEWAY, "--json"]));
    expect(gatewayInfo).toMatchObject({ gateway: GATEWAY, mcpUrl: `http://127.0.0.1:${gatewayPort}/mcp`, approvalSecretAvailable: true });
    expect(gatewayInfo).not.toHaveProperty("approvalSecret");
    expect(parseJson<any>(await runCli(["gateway", "info", "--gateway", GATEWAY, "--detail", "--json"]))).toEqual(expect.objectContaining({ gateway: GATEWAY, approvalSecret: expect.any(String), servicePort: gatewayPort, managementPort }));
    expect(parseJson<any>(await runCli(["worker", "status", "--worker", WORKER, "--json"]))).toMatchObject({ active: false, managed: false });

    const replacementPort = await freePort();
    expect(parseJson<any>(await runCli(["worker", "port", "--worker", WORKER, "--port", String(replacementPort), "--json"]))).toMatchObject({ changed: true, port: replacementPort });
    workerPort = replacementPort;
  }, 30_000);

  it("runs workspace, local Extension Hub, and diagnostics commands through packaged public CLI processes", async () => {
    const workerLayout = resolveRuntimeLayoutForNamedRole("worker", WORKER, env, process.platform);
    const initial = await readRuntimeConfig(workerLayout.configFile);
    const firstWorkspace = initial.workspaces[0]!.id;
    const secondRoot = path.join(root, "workspace-two");
    await mkdir(secondRoot, { recursive: true });

    const added = parseJson<any>(await runCli(["worker", "workspace", "add", "--worker", WORKER, "--root", secondRoot, "--display-name", "Second Workspace", "--profile", "coding", "--json"]));
    const secondWorkspace = added.workspace.id as string;
    expect(secondWorkspace).not.toBe(firstWorkspace);
    expect(parseJson<any>(await runCli(["worker", "workspace", "list", "--worker", WORKER, "--json"])).workspaces).toHaveLength(2);
    expect(parseJson<any>(await runCli(["worker", "workspace", "profile", "set", "--worker", WORKER, "--workspace", firstWorkspace, "--profile", "editor", "--json"]))).toMatchObject({ changed: true, workspaceId: firstWorkspace });
    expect(parseJson<any>(await runCli(["worker", "workspace", "tool", "allow", "--worker", WORKER, "--workspace", firstWorkspace, "--tool", "write_file", "--json"]))).toMatchObject({ decision: "allow", tool: "write_file" });
    expect(parseJson<any>(await runCli(["worker", "workspace", "tool", "deny", "--worker", WORKER, "--workspace", firstWorkspace, "--tool", "write_file", "--json"]))).toMatchObject({ decision: "deny", tool: "write_file" });
    expect(parseJson<any>(await runCli(["worker", "workspace", "command", "allow", "--worker", WORKER, "--workspace", firstWorkspace, "--command", "git", "--json"]))).toMatchObject({ decision: "allow", command: "git" });
    expect(parseJson<any>(await runCli(["worker", "workspace", "command", "deny", "--worker", WORKER, "--workspace", firstWorkspace, "--command", "git", "--json"]))).toMatchObject({ decision: "deny", command: "git" });
    expect(parseJson<any>(await runCli(["worker", "workspace", "permissions", "show", "--worker", WORKER, "--workspace", firstWorkspace, "--json"])).workspaces).toHaveLength(1);

    extensionRoot = await fakeLocalExtension(root);
    expect(parseJson<any>(await runCli(["extension", "install", extensionRoot, "--json"]))).toMatchObject({ changed: true, id: EXTENSION_ID, source: "local", connectorManifestImpact: "none" });
    expect(parseJson<any>(await runCli(["extension", "list", "--json"])).extensions).toHaveLength(1);
    expect(parseJson<any>(await runCli(["extension", "show", EXTENSION_ID, "--json"]))).toMatchObject({ id: EXTENSION_ID });
    expect(parseJson<any>(await runCli(["extension", "attach", EXTENSION_ID, "--worker", WORKER, "--json"]))).toMatchObject({ changed: true, attached: EXTENSION_ID });
    expect(parseJson<any>(await runCli(["extension", "attach", EXTENSION_ID, "--worker", WORKER, "--json"]))).toMatchObject({ changed: false, attached: EXTENSION_ID });
    expect(parseJson<any>(await runCli(["doctor", "extension", "--json"]))).toMatchObject({ ok: true, extensionCount: 1, workerCount: 1 });
    expect(parseJson<any>(await runCli(["doctor", "manifest", "show", "--gateway", GATEWAY, "--json"]))).toMatchObject({ ok: true });
    expect(parseJson<any>(await runCli(["doctor", "tool", "explain", "read_file", "--gateway", GATEWAY, "--json"]))).toMatchObject({ name: "read_file", registeredBy: "core" });
    expect(parseJson<any>(await runCli(["doctor", "paths", "--json"]))).toMatchObject({ mode: "named-roles" });
    expect(parseJson<any>(await runCli(["worker", "workspace", "remove", "--worker", WORKER, "--id", secondWorkspace, "--json"]))).toMatchObject({ changed: true, removed: secondWorkspace });
  }, 60_000);

  it("starts packaged managed runtimes, joins them over HTTP, exercises membership, then stops them", async () => {
    const gatewayLayout = resolveRuntimeLayoutForNamedRole("gateway", GATEWAY, env, process.platform);
    const workerLayout = resolveRuntimeLayoutForNamedRole("worker", WORKER, env, process.platform);
    const gatewayConfig = await readRuntimeConfig(gatewayLayout.configFile);
    const workerConfig = await readRuntimeConfig(workerLayout.configFile);
    if (!gatewayConfig.gateway || !workerConfig.worker) throw new Error("Acceptance runtime config missing");

    await writeFile(gatewayLayout.configFile, serializeRuntimeConfig({
      ...gatewayConfig,
      gateway: { ...gatewayConfig.gateway, livenessIntervalMs: 5_000 },
    }), "utf8");

    let workerStarted = false;
    let gatewayStarted = false;
    try {
      const workerStart = parseJson<any>(await runCli(["worker", "serve", "--bg", "--worker", WORKER, "--json"]));
      expect(workerStart).toMatchObject({ started: true, role: "worker", name: WORKER });
      expect(workerStart.pid).toEqual(expect.any(Number));
      workerStarted = true;
      const runningWorker = await waitForJson<any>(["worker", "status", "--worker", WORKER, "--json"], (value) => value.active === true && value.managed === true);
      expect(runningWorker.pid).toBe(workerStart.pid);

      const gatewayStart = parseJson<any>(await runCli(["gateway", "serve", "--bg", "--gateway", GATEWAY, "--json"]));
      expect(gatewayStart).toMatchObject({ started: true, role: "gateway", name: GATEWAY });
      expect(gatewayStart.pid).toEqual(expect.any(Number));
      gatewayStarted = true;
      const preJoinGateway = await waitForJson<any>(["gateway", "status", "--gateway", GATEWAY, "--json"], (value) => value.managed === true && value.health?.reachable === true);
      expect(preJoinGateway.active).toBe(true);
      expect(preJoinGateway.health?.healthy).toBe(false);
      expect(preJoinGateway.pid).toBe(gatewayStart.pid);

      const joinToken = await waitForJson<any>(["gateway", "join-token", "--gateway", GATEWAY, "--expires", "60", "--json"], (value) => typeof value.joinCode === "string");
      expect(joinToken.joinCode).toMatch(/^qjq1:/);
      expect(parseJson<any>(await runCli(["worker", "join", "--worker", WORKER, "--join-code", joinToken.joinCode, "--json"]))).toMatchObject({ joined: true, workerId: workerConfig.worker.workerId, environmentId: workerConfig.worker.environmentId });

      expect(parseJson<any>(await runCli(["gateway", "workers", "list", "--gateway", GATEWAY, "--json"])).workers).toHaveLength(1);
      const endpoint = `http://127.0.0.1:${workerPort}/`;
      expect(parseJson<any>(await runCli(["gateway", "workers", "update", "--gateway", GATEWAY, "--worker-id", workerConfig.worker.workerId, "--endpoint", endpoint, "--json"]))).toMatchObject({ updated: true, workerId: workerConfig.worker.workerId });

      const runningGateway = await waitForJson<any>(["gateway", "status", "--gateway", GATEWAY, "--json"], (value) => value.active === true && value.managed === true && value.health?.healthy === true, 12_000);
      expect(runningGateway.pid).toBe(gatewayStart.pid);
      const doctor = parseJson<any>(await runCli(["doctor", "--json"]));
      expect(doctor.gateways).toEqual([expect.objectContaining({ name: GATEWAY, ok: true })]);
      expect(doctor.workers).toEqual([expect.objectContaining({ name: WORKER, ok: true })]);

      expect(parseJson<any>(await runCli(["gateway", "workers", "remove", "--gateway", GATEWAY, "--worker-id", workerConfig.worker.workerId, "--json"]))).toMatchObject({ removed: true, workerId: workerConfig.worker.workerId });
      expect(parseJson<any>(await runCli(["gateway", "workers", "list", "--gateway", GATEWAY, "--json"])).workers).toHaveLength(0);

      expect(parseJson<any>(await runCli(["gateway", "stop", "--gateway", GATEWAY, "--json"]))).toMatchObject({ stopped: true, role: "gateway", name: GATEWAY });
      gatewayStarted = false;
      expect(parseJson<any>(await runCli(["worker", "stop", "--worker", WORKER, "--json"]))).toMatchObject({ stopped: true, role: "worker", name: WORKER });
      workerStarted = false;
      await waitForJson<any>(["gateway", "status", "--gateway", GATEWAY, "--json"], (value) => value.active === false && value.managed === false);
      await waitForJson<any>(["worker", "status", "--worker", WORKER, "--json"], (value) => value.active === false && value.managed === false);

      expect(parseJson<any>(await runCli(["extension", "detach", EXTENSION_ID, "--worker", WORKER, "--json"]))).toMatchObject({ changed: true, detached: EXTENSION_ID });
      expect(parseJson<any>(await runCli(["extension", "uninstall", EXTENSION_ID, "--json"]))).toMatchObject({ changed: true, removed: EXTENSION_ID, packageCleanup: "preserved" });
      await expect(readFile(path.join(extensionRoot, "package.json"), "utf8")).resolves.toContain("queqiao-acceptance-extension");
    } finally {
      if (gatewayStarted) await runCli(["gateway", "stop", "--gateway", GATEWAY, "--json"]).catch(() => undefined);
      if (workerStarted) await runCli(["worker", "stop", "--worker", WORKER, "--json"]).catch(() => undefined);
    }
  }, 90_000);

  it("runs both migration dry-runs through the packaged CLI in an isolated default layout", async () => {
    const legacyRepo = path.join(root, "legacy-repo");
    await mkdir(path.join(legacyRepo, ".queqiao"), { recursive: true });
    await writeFile(path.join(legacyRepo, ".env"), "", "utf8");
    await writeFile(path.join(legacyRepo, ".queqiao", "workspaces.json"), "[]\n", "utf8");
    await writeFile(path.join(legacyRepo, ".queqiao", "workers.json"), "[]\n", "utf8");
    expect(parseJson<any>(await runCli(["migrate", "from-repo", "--repo", legacyRepo, "--json"]))).toMatchObject({ mode: "dry-run", repository: legacyRepo });

    const defaultLayout = resolveRuntimeLayout(env, process.platform);
    await mkdir(defaultLayout.configDir, { recursive: true });
    await writeFile(path.join(defaultLayout.configDir, "runtime.env"), "", "utf8");
    await writeFile(path.join(defaultLayout.configDir, "workspaces.json"), "[]\n", "utf8");
    expect(parseJson<any>(await runCli(["migrate", "runtime-v1", "--json"]))).toMatchObject({ mode: "dry-run", target: defaultLayout.configFile });
  }, 30_000);

  it("removes isolated roles and Extension Hub through destructive interactive flows without touching global npm", async () => {
    const destructivePrompts = { choose: async (_message: string, options: Array<{ value: string }>) => options[0]!.value, confirm: async () => true };
    expect(await removeRoleInstance("gateway", ["gateway", "remove", "--gateway", GATEWAY], { env, platform: process.platform, interactive: true, prompts: destructivePrompts, status: async () => ({ active: false, managed: false }) })).toMatchObject({ removed: true, role: "gateway", name: GATEWAY });
    expect(await removeRoleInstance("worker", ["worker", "remove", "--worker", WORKER], { env, platform: process.platform, interactive: true, prompts: destructivePrompts, status: async () => ({ active: false, managed: false }) })).toMatchObject({ removed: true, role: "worker", name: WORKER });

    let npmCalled = false;
    const uninstall = await uninstallQueqiao(["uninstall"], {
      env,
      platform: process.platform,
      interactive: true,
      selectTargets: async (choices) => choices.some((choice) => choice.value === "extension-hub") ? ["extension-hub"] : [],
      confirmCleanup: async () => true,
      confirmPackageUninstall: async () => false,
      runNpm: async () => { npmCalled = true; },
    });
    expect(uninstall).toMatchObject({ cleaned: true, uninstalled: false, selected: ["extension-hub"] });
    expect(npmCalled).toBe(false);
    await expect(readFile(path.join(resolveExtensionHubRoot(env, process.platform), "hub.json"), "utf8")).rejects.toThrow();
  }, 30_000);
});
