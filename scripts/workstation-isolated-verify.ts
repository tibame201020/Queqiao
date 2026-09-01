import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import React from "react";
import { render as renderInkForTest } from "ink-testing-library";
import { runRoleSetupWizard, type RoleSetupPrompts } from "../apps/cli/src/setup-wizard.js";
import { collectWorkstationSnapshot } from "../apps/cli/src/workstation.js";
import { loadWorkstationInspectorDetail } from "../apps/cli/src/workstation-inspector.js";
import { WorkstationApp } from "../apps/cli/src/workstation-ui.js";

const execFileAsync = promisify(execFile);
const VERIFY_GATEWAY = "verify-gateway";
const VERIFY_WORKER = "verify-worker";
const VERIFY_PROFILE = "verify-profile";
const VERIFY_EXTENSION_ID = "dev.queqiao.workstation-verify";

type CliResult = { stdout: string; stderr: string };
type PromptQueues = { choices: string[]; texts: string[] };

export type WorkstationVerificationSession = {
  root: string;
  env: NodeJS.ProcessEnv;
  packageOutdir: string;
  cliEntry: string;
  gatewayPort: number;
  managementPort: number;
  workerPort: number;
  extensionRoot: string;
  runCli(args: string[]): Promise<CliResult>;
  cleanup(): Promise<void>;
};

function prompts(queues: PromptQueues): RoleSetupPrompts {
  return {
    choose: async () => {
      const value = queues.choices.shift();
      if (value === undefined) throw new Error("Unexpected verification choose prompt");
      return value;
    },
    multi: async () => { throw new Error("Unexpected verification multi prompt"); },
    commandText: async () => { throw new Error("Unexpected verification command prompt"); },
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
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate verification port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function parseCliJson<T>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}

async function waitForCliJson<T>(runCli: (args: string[]) => Promise<CliResult>, args: string[], predicate: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    try {
      last = parseCliJson<T>(await runCli(args));
      if (predicate(last)) return last;
    } catch {
      // A just-started disposable runtime may not have committed health yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for verification command: ${args.join(" ")}${last ? ` · last=${JSON.stringify(last)}` : ""}`);
}

async function seedVerificationEnrollment(runCli: (args: string[]) => Promise<CliResult>): Promise<void> {
  let workerStarted = false;
  let gatewayStarted = false;
  try {
    const workerStart = parseCliJson<{ started?: boolean }>(await runCli(["worker", "serve", "--bg", "--worker", VERIFY_WORKER, "--json"]));
    workerStarted = workerStart.started === true;
    await waitForCliJson<{ active?: boolean; managed?: boolean }>(runCli, ["worker", "status", "--worker", VERIFY_WORKER, "--json"], (value) => value.active === true && value.managed === true);

    const gatewayStart = parseCliJson<{ started?: boolean }>(await runCli(["gateway", "serve", "--bg", "--gateway", VERIFY_GATEWAY, "--json"]));
    gatewayStarted = gatewayStart.started === true;
    await waitForCliJson<{ active?: boolean; managed?: boolean; health?: { reachable?: boolean } }>(runCli, ["gateway", "status", "--gateway", VERIFY_GATEWAY, "--json"], (value) => value.active === true && value.managed === true && value.health?.reachable === true);

    const token = await waitForCliJson<{ joinCode?: string }>(runCli, ["gateway", "join-token", "--gateway", VERIFY_GATEWAY, "--expires", "60", "--json"], (value) => typeof value.joinCode === "string" && value.joinCode.startsWith("qjq1:"));
    if (!token.joinCode) throw new Error("Disposable Gateway did not issue a join code");
    const joined = parseCliJson<{ joined?: boolean }>(await runCli(["worker", "join", "--worker", VERIFY_WORKER, "--join-code", token.joinCode, "--json"]));
    if (!joined.joined) throw new Error("Disposable Worker enrollment did not commit");
    await waitForCliJson<{ workers?: unknown[] }>(runCli, ["gateway", "workers", "list", "--gateway", VERIFY_GATEWAY, "--json"], (value) => Array.isArray(value.workers) && value.workers.length === 1);
  } finally {
    if (gatewayStarted) await runCli(["gateway", "stop", "--gateway", VERIFY_GATEWAY, "--json"]).catch(() => undefined);
    if (workerStarted) await runCli(["worker", "stop", "--worker", VERIFY_WORKER, "--json"]).catch(() => undefined);
  }
  await waitForCliJson<{ active?: boolean; managed?: boolean }>(runCli, ["gateway", "status", "--gateway", VERIFY_GATEWAY, "--json"], (value) => value.active === false && value.managed === false);
  await waitForCliJson<{ active?: boolean; managed?: boolean }>(runCli, ["worker", "status", "--worker", VERIFY_WORKER, "--json"], (value) => value.active === false && value.managed === false);
}

async function createLocalExtension(root: string): Promise<string> {
  const extension = path.join(root, "verification-extension");
  await mkdir(path.join(extension, "dist"), { recursive: true });
  await writeFile(path.join(extension, "dist", "index.js"), `export default {
  manifest: { id: "${VERIFY_EXTENSION_ID}", version: "1.0.0", displayName: "Workstation Verify Extension" },
  activate() {},
};
`, "utf8");
  await writeFile(path.join(extension, "package.json"), JSON.stringify({
    name: "queqiao-workstation-verify-extension",
    version: "1.0.0",
    type: "module",
    queqiao: {
      apiVersion: 1,
      module: "./dist/index.js",
      manifest: {
        id: VERIFY_EXTENSION_ID,
        version: "1.0.0",
        displayName: "Workstation Verify Extension",
        host: { kind: "worker" },
        ordering: { requires: [], before: [], after: [] },
        contributions: [],
      },
    },
  }, null, 2), "utf8");
  return extension;
}

export async function prepareWorkstationVerification(repositoryRoot = path.resolve(process.cwd())): Promise<WorkstationVerificationSession> {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workstation-verify-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOCALAPPDATA: path.join(root, "local-app-data"),
    USERPROFILE: path.join(root, "home"),
    HOME: path.join(root, "home"),
    TEMP: path.join(root, "temp"),
    XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
    XDG_DATA_HOME: path.join(root, "xdg", "data"),
    XDG_STATE_HOME: path.join(root, "xdg", "state"),
    XDG_RUNTIME_DIR: path.join(root, "xdg", "runtime"),
    QUEQIAO_WORKSTATION_VERIFY: "1",
  };
  delete env.NO_COLOR;

  const packageOutdir = path.join(root, "package");
  const cliEntry = path.join(packageOutdir, "queqiao.js");
  const workspaceOne = path.join(root, "workspaces", "one");
  const workspaceTwo = path.join(root, "workspaces", "two");
  await Promise.all([
    mkdir(env.LOCALAPPDATA!, { recursive: true }),
    mkdir(env.USERPROFILE!, { recursive: true }),
    mkdir(env.TEMP!, { recursive: true }),
    mkdir(workspaceOne, { recursive: true }),
    mkdir(workspaceTwo, { recursive: true }),
  ]);

  const [gatewayPort, managementPort, workerPort] = await Promise.all([freePort(), freePort(), freePort()]);

  await execFileAsync(process.execPath, [path.join(repositoryRoot, "scripts", "build-package.mjs")], {
    cwd: repositoryRoot,
    env: { ...process.env, QUEQIAO_BUILD_OUTDIR: packageOutdir },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  const runCli = async (args: string[]): Promise<CliResult> => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
      cwd: repositoryRoot,
      env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout, stderr };
  };

  try {
    await runRoleSetupWizard("gateway", ["gateway", "setup"], {
      env,
      platform: process.platform,
      interactive: true,
      prompts: prompts({
        choices: ["__create__"],
        texts: [VERIFY_GATEWAY, `http://127.0.0.1:${gatewayPort}/`, String(gatewayPort), String(managementPort)],
      }),
      portAvailable: async () => true,
    });

    await runRoleSetupWizard("worker", ["worker", "setup"], {
      env,
      platform: process.platform,
      interactive: true,
      prompts: prompts({
        choices: ["__create__", "builtin:reader"],
        texts: [VERIFY_WORKER, String(workerPort), workspaceOne, "Verification Workspace"],
      }),
      portAvailable: async () => true,
    });

    await runCli(["workspace", "add", "--worker", VERIFY_WORKER, "--root", workspaceTwo, "--display-name", "Disposable Workspace", "--access-profile", "Reader", "--json"]);
    await runCli(["workspace", "profiles", "create", "--name", VERIFY_PROFILE, "--tools", "read_file,write_file,edit_file", "--commands", "git,npm", "--json"]);
    const extensionRoot = await createLocalExtension(root);
    await runCli(["extension", "install", extensionRoot, "--worker", VERIFY_WORKER, "--json"]);
    await seedVerificationEnrollment(runCli);

    const cleanup = async () => {
      await runCli(["worker", "stop", "--worker", VERIFY_WORKER, "--json"]).catch(() => undefined);
      await runCli(["gateway", "stop", "--gateway", VERIFY_GATEWAY, "--json"]).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    };

    return { root, env, packageOutdir, cliEntry, gatewayPort, managementPort, workerPort, extensionRoot, runCli, cleanup };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function captureWorkstationVerificationFrames(session: WorkstationVerificationSession): Promise<Record<string, string>> {
  const keys = ["LOCALAPPDATA", "USERPROFILE", "HOME", "TEMP", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "QUEQIAO_WORKSTATION_VERIFY"] as const;
  let gatewayStarted = false;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    const value = session.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await session.runCli(["gateway", "serve", "--bg", "--gateway", VERIFY_GATEWAY, "--json"]);
    gatewayStarted = true;
    await waitForCliJson<{ active?: boolean; managed?: boolean; health?: { reachable?: boolean } }>(
      session.runCli,
      ["gateway", "status", "--gateway", VERIFY_GATEWAY, "--json"],
      (value) => value.active === true && value.managed === true && value.health?.reachable === true,
    );
    const snapshot = await collectWorkstationSnapshot();
    const frames: Record<string, string> = {};
    for (const [label, width, height] of [["wide", 140, 35], ["standard", 100, 28], ["narrow", 70, 24], ["too-small", 59, 24]] as const) {
      const ui = renderInkForTest(React.createElement(WorkstationApp, {
        snapshot,
        loadInspectorDetail: (target, currentSnapshot) => loadWorkstationInspectorDetail(currentSnapshot, target),
        executeDirect: async () => ({ title: "smoke", body: "smoke" }),
        executeFlow: async () => ({ title: "smoke", body: "smoke" }),
        onExit: () => undefined,
        refreshIntervalMs: 0,
        terminalWidth: width,
        terminalHeight: height,
        verificationEnvironment: true,
      }));
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const frame = ui.lastFrame() || "";
        if (!frame.includes("Loading runtime detail") && !frame.includes("Runtime detail has not been loaded")) break;
      }
      frames[label] = stripVTControlCharacters(ui.lastFrame() || "");
      ui.cleanup();
    }

    const detailUi = renderInkForTest(React.createElement(WorkstationApp, {
      snapshot,
      loadInspectorDetail: (target, currentSnapshot) => loadWorkstationInspectorDetail(currentSnapshot, target),
      executeDirect: async () => ({ title: "smoke", body: "smoke" }),
      executeFlow: async () => ({ title: "smoke", body: "smoke" }),
      onExit: () => undefined,
      refreshIntervalMs: 0,
      terminalWidth: 140,
      terminalHeight: 35,
      verificationEnvironment: true,
    }));
    detailUi.stdin.write("\t");
    detailUi.stdin.write("\t");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const frame = detailUi.lastFrame() || "";
      if (!frame.includes("Runtime detail has not been loaded") && !frame.includes("Loading runtime detail")) break;
    }
    detailUi.stdin.write("i");
    await new Promise((resolve) => setTimeout(resolve, 40));
    frames.detailStatus = stripVTControlCharacters(detailUi.lastFrame() || "");
    detailUi.stdin.write("\u001b[C");
    detailUi.stdin.write("\u001b[C");
    await new Promise((resolve) => setTimeout(resolve, 40));
    frames.detailWorkers = stripVTControlCharacters(detailUi.lastFrame() || "");
    detailUi.cleanup();

    const diagnosticsUi = renderInkForTest(React.createElement(WorkstationApp, {
      snapshot,
      loadInspectorDetail: (target, currentSnapshot) => loadWorkstationInspectorDetail(currentSnapshot, target),
      executeDirect: async () => ({ title: "smoke", body: "smoke" }),
      executeFlow: async () => ({ title: "smoke", body: "smoke" }),
      onExit: () => undefined,
      refreshIntervalMs: 0,
      terminalWidth: 100,
      terminalHeight: 28,
      verificationEnvironment: true,
    }));
    diagnosticsUi.stdin.write("6");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if ((diagnosticsUi.lastFrame() || "").includes("Core checks")) break;
    }
    diagnosticsUi.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 30));
    diagnosticsUi.stdin.write("i");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const diagnosticFrames: string[] = [stripVTControlCharacters(diagnosticsUi.lastFrame() || "")];
    for (let tab = 0; tab < 4; tab += 1) {
      diagnosticsUi.stdin.write("\u001b[C");
      await new Promise((resolve) => setTimeout(resolve, 30));
      diagnosticFrames.push(stripVTControlCharacters(diagnosticsUi.lastFrame() || ""));
    }
    frames.diagnostics = diagnosticFrames.join("\n--- tab ---\n");
    diagnosticsUi.cleanup();

    const settingsUi = renderInkForTest(React.createElement(WorkstationApp, {
      snapshot,
      executeDirect: async () => ({ title: "smoke", body: "smoke" }),
      executeFlow: async () => ({ title: "smoke", body: "smoke" }),
      onExit: () => undefined,
      refreshIntervalMs: 0,
      terminalWidth: 100,
      terminalHeight: 28,
      verificationEnvironment: true,
    }));
    settingsUi.stdin.write(",");
    await new Promise((resolve) => setTimeout(resolve, 40));
    frames.settings = stripVTControlCharacters(settingsUi.lastFrame() || "");
    settingsUi.cleanup();

    const modalUi = renderInkForTest(React.createElement(WorkstationApp, {
      snapshot,
      loadInspectorDetail: (target, currentSnapshot) => loadWorkstationInspectorDetail(currentSnapshot, target),
      executeDirect: async () => ({ title: "smoke", body: "smoke" }),
      executeFlow: async () => ({ title: "smoke", body: "smoke" }),
      onExit: () => undefined,
      refreshIntervalMs: 0,
      terminalWidth: 140,
      terminalHeight: 35,
      verificationEnvironment: true,
    }));
    modalUi.stdin.write("\t");
    modalUi.stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 40));
    modalUi.stdin.write("d");
    await new Promise((resolve) => setTimeout(resolve, 40));
    frames.modal = stripVTControlCharacters(modalUi.lastFrame() || "");
    modalUi.cleanup();
    return frames;
  } finally {
    if (gatewayStarted) await session.runCli(["gateway", "stop", "--gateway", VERIFY_GATEWAY, "--json"]).catch(() => undefined);
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function launch(): Promise<void> {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv.includes("--smoke")) {
    const vitestCli = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      vitestCli, "run",
      "apps/cli/src/workstation-isolated-verify.test.ts",
      "apps/cli/src/workstation-ui-v2.test.tsx",
    ], {
      cwd: repositoryRoot,
      env: { ...process.env, QUEQIAO_WORKSTATION_SMOKE_PRINT: "1" },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    return;
  }

  const session = await prepareWorkstationVerification(repositoryRoot);
  try {
    console.log("Workstation isolated verification environment prepared.");
    console.log(`  Gateway: ${VERIFY_GATEWAY} @ ${session.gatewayPort}`);
    console.log(`  Worker:  ${VERIFY_WORKER} @ ${session.workerPort}`);
    console.log("  Stable Queqiao runtime: untouched");
    console.log("  Repo dist/global CLI link: untouched");
    console.log("");

    const child = spawn(process.execPath, [session.cliEntry, "workstation"], {
      cwd: repositoryRoot,
      env: session.env,
      stdio: "inherit",
      windowsHide: false,
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    await session.cleanup();
  }
}

const directUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (directUrl === import.meta.url) await launch();
