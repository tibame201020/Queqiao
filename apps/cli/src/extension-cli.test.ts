import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfig, runtimeConfigSchema, serializeRuntimeConfig } from "@queqiao/config";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { attachExtension, detachExtension, installExtension, installLocalExtension, installNpmExtension, parseExtensionSource, resolveInstalledExtensionId, uninstallExtension } from "./extension-cli.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

function layout(root: string): RuntimeLayout {
  const configDir = path.join(root, "config");
  const dataDir = path.join(root, "data");
  const stateDir = path.join(root, "state");
  return {
    configDir,
    dataDir,
    stateDir,
    runtimeDir: path.join(root, "runtime"),
    logDir: path.join(stateDir, "logs"),
    secretsDir: path.join(dataDir, "secrets"),
    configFile: path.join(configDir, "config.yaml"),
    gatewayStateDir: path.join(dataDir, "gateway"),
  };
}

async function workerConfig(target: RuntimeLayout) {
  await mkdir(target.configDir, { recursive: true });
  const config = runtimeConfigSchema.parse({
    version: 1,
    worker: { environmentId: process.platform === "win32" ? "windows" : "linux", listen: { host: "127.0.0.1", port: 7576 }, tokenFile: path.join(target.secretsDir, "worker-token") },
    extensions: [],
    workspaces: [{ id: "coding", displayName: "Coding", root: temporary!, profile: "coding" }],
  });
  await writeFile(target.configFile, serializeRuntimeConfig(config), "utf8");
}

async function fakePackage(cwd: string) {
  const root = path.join(cwd, "node_modules", "queqiao-mcp");
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.js"), "export default {};\n", "utf8");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "queqiao-mcp",
    version: "1.2.3",
    type: "module",
    queqiao: {
      apiVersion: 1,
      module: "./dist/index.js",
      manifest: {
        id: "dev.queqiao.mcp",
        version: "1.2.3",
        displayName: "Queqiao MCP",
        host: { kind: "worker" },
        ordering: { requires: [], before: [], after: [] },
        contributions: [{
          operation: "register",
          tool: "mcp_proxy",
          visibility: "internal",
          title: "MCP proxy",
          description: "Proxy a downstream MCP capability.",
          inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
          requiredCapabilities: ["workspace:read"],
          risk: "execute",
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        }],
      },
    },
  }, null, 2), "utf8");
}

describe("extension CLI", () => {
  it("parses registry-only npm extension sources", () => {
    expect(parseExtensionSource("npm:queqiao-mcp@1.2.3")).toEqual({ requested: "queqiao-mcp@1.2.3", packageName: "queqiao-mcp" });
    expect(parseExtensionSource("npm:@scope/queqiao-mcp@latest")).toEqual({ requested: "@scope/queqiao-mcp@latest", packageName: "@scope/queqiao-mcp" });
    expect(() => parseExtensionSource("npm:https://example.invalid/pkg.tgz")).toThrow(/registry package/);
  });

  it("installs to the Hub, attaches and detaches a Worker, then uninstalls without lifecycle scripts", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-cli-"));
    const hub = layout(path.join(temporary, "hub"));
    const worker = layout(path.join(temporary, "worker"));
    await workerConfig(worker);
    let observedArgs: readonly string[] = [];

    await installNpmExtension(hub, "npm:queqiao-mcp@1.2.3", {}, async (args, cwd) => { observedArgs = args; await fakePackage(cwd); });
    expect(observedArgs).toContain("--ignore-scripts");
    expect((await readRuntimeConfig(worker.configFile)).extensions).toHaveLength(0);

    const packageStore = path.join(hub.dataDir, "extensions", "packages");
    expect((await readdir(packageStore)).filter((entry) => !entry.startsWith(".staging-"))).toHaveLength(1);

    await attachExtension(hub, "dev.queqiao.mcp", "windows", worker);
    let config = await readRuntimeConfig(worker.configFile);
    expect(config.extensions).toHaveLength(1);
    expect(config.extensions[0]?.manifest.id).toBe("dev.queqiao.mcp");
    expect(config.extensions[0]).not.toHaveProperty("enabled");
    expect(config.extensions[0]?.source.kind).toBe("npm");
    if (config.extensions[0]?.source.kind !== "npm") throw new Error("expected npm source");
    await expect(access(config.extensions[0].source.module)).resolves.toBeUndefined();

    await detachExtension("dev.queqiao.mcp", "windows", worker);
    config = await readRuntimeConfig(worker.configFile);
    expect(config.extensions).toHaveLength(0);

    await uninstallExtension(hub, "dev.queqiao.mcp");
    expect((await readdir(packageStore)).filter((entry) => !entry.startsWith(".staging-"))).toHaveLength(0);
  });
  it("installs a prepared local package by path without copying or deleting the source", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-cli-local-"));
    const hub = layout(path.join(temporary, "hub"));
    const worker = layout(path.join(temporary, "worker"));
    await workerConfig(worker);
    const prepared = path.join(temporary, "prepared");
    await fakePackage(prepared);
    const localRoot = path.join(prepared, "node_modules", "queqiao-mcp");

    await installExtension(hub, localRoot);
    await expect(attachExtension(hub, "dev.queqiao.mcp", "windows", worker)).resolves.toMatchObject({ changed: true, worker: "windows", attached: "dev.queqiao.mcp" });
    await expect(attachExtension(hub, "dev.queqiao.mcp", "windows", worker)).resolves.toMatchObject({ changed: false, worker: "windows", attached: "dev.queqiao.mcp" });
    let config = await readRuntimeConfig(worker.configFile);
    expect(config.extensions[0]?.source.kind).toBe("local");
    if (config.extensions[0]?.source.kind !== "local") throw new Error("expected local source");
    expect(config.extensions[0].source.root).toBe(await realpath(localRoot));
    await expect(access(config.extensions[0].source.module)).resolves.toBeUndefined();

    await detachExtension("dev.queqiao.mcp", "windows", worker);
    await expect(uninstallExtension(hub, "dev.queqiao.mcp")).resolves.toMatchObject({ packageCleanup: "preserved" });
    await expect(access(path.join(localRoot, "package.json"))).resolves.toBeUndefined();
    config = await readRuntimeConfig(worker.configFile);
    expect(config.extensions).toHaveLength(0);
  });

  it("rejects an unbuilt local package without running package scripts", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-cli-unbuilt-"));
    const hub = layout(path.join(temporary, "hub"));
    const prepared = path.join(temporary, "prepared");
    await fakePackage(prepared);
    const localRoot = path.join(prepared, "node_modules", "queqiao-mcp");
    await rm(path.join(localRoot, "dist"), { recursive: true, force: true });
    await expect(installLocalExtension(hub, localRoot)).rejects.toThrow(/Build the extension first/);
  });

  it("does not claim or detach a foreign legacy attachment that only shares the Hub extension id", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-cli-foreign-"));
    const hub = layout(path.join(temporary, "hub"));
    const worker = layout(path.join(temporary, "worker"));
    await workerConfig(worker);
    await installNpmExtension(hub, "npm:queqiao-mcp@1.2.3", {}, async (_args, cwd) => { await fakePackage(cwd); });
    await attachExtension(hub, "dev.queqiao.mcp", "windows", worker);

    const attached = await readRuntimeConfig(worker.configFile);
    const entry = attached.extensions[0]!;
    await writeFile(worker.configFile, serializeRuntimeConfig({
      ...attached,
      extensions: [{ ...entry, source: { kind: "local-module" as const, module: "@legacy/queqiao-mcp" } }],
    }), "utf8");
    const discover = async () => [{ name: "windows", layout: worker, config: await readRuntimeConfig(worker.configFile) }];

    await expect(uninstallExtension(hub, "dev.queqiao.mcp", false, discover)).resolves.toMatchObject({ changed: true, detachedWorkers: [] });
    const after = await readRuntimeConfig(worker.configFile);
    expect(after.extensions).toHaveLength(1);
    expect(after.extensions[0]?.source).toEqual({ kind: "local-module", module: "@legacy/queqiao-mcp" });
  });

  it("resolves a missing extension id interactively from the Hub instead of treating options as ids", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-cli-select-"));
    const hub = layout(path.join(temporary, "hub"));

    const preparedOne = path.join(temporary, "prepared-one");
    await fakePackage(preparedOne);
    const localOne = path.join(preparedOne, "node_modules", "queqiao-mcp");
    await installExtension(hub, localOne);
    await expect(resolveInstalledExtensionId(hub, undefined, { interactive: true, choose: async () => { throw new Error("single extension should auto-select"); } })).resolves.toBe("dev.queqiao.mcp");

    const preparedTwo = path.join(temporary, "prepared-two");
    await fakePackage(preparedTwo);
    const localTwo = path.join(preparedTwo, "node_modules", "queqiao-mcp");
    const packageFile = path.join(localTwo, "package.json");
    const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
    packageJson.name = "queqiao-mcp-two";
    packageJson.queqiao.manifest.id = "dev.queqiao.mcp-two";
    packageJson.queqiao.manifest.displayName = "Queqiao MCP Two";
    await writeFile(packageFile, JSON.stringify(packageJson, null, 2), "utf8");
    await installExtension(hub, localTwo);

    let observedValues: string[] = [];
    await expect(resolveInstalledExtensionId(hub, undefined, {
      interactive: true,
      choose: async (_message, options) => {
        observedValues = options.map((entry) => entry.value);
        return "dev.queqiao.mcp-two";
      },
    })).resolves.toBe("dev.queqiao.mcp-two");
    expect(observedValues).toEqual(["dev.queqiao.mcp", "dev.queqiao.mcp-two"]);
    await expect(resolveInstalledExtensionId(hub, undefined, { interactive: false })).rejects.toMatchObject({ exitCode: 2 });
  });

  it("attaches all discovered compatible Workers and force-uninstalls by detaching them first", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-cli-all-"));
    const hub = layout(path.join(temporary, "hub"));
    const windows = layout(path.join(temporary, "windows"));
    const testWorker = layout(path.join(temporary, "windows-test"));
    await workerConfig(windows);
    await workerConfig(testWorker);
    const discover = async () => [
      { name: "windows", layout: windows, config: await readRuntimeConfig(windows.configFile) },
      { name: "windows-test", layout: testWorker, config: await readRuntimeConfig(testWorker.configFile) },
    ];

    await installNpmExtension(hub, "npm:queqiao-mcp@1.2.3", { attachAll: true }, async (_args, cwd) => { await fakePackage(cwd); }, discover);
    expect((await readRuntimeConfig(windows.configFile)).extensions.map((entry) => entry.manifest.id)).toEqual(["dev.queqiao.mcp"]);
    expect((await readRuntimeConfig(testWorker.configFile)).extensions.map((entry) => entry.manifest.id)).toEqual(["dev.queqiao.mcp"]);

    await expect(uninstallExtension(hub, "dev.queqiao.mcp", false, discover)).rejects.toThrow(/attached Workers: windows, windows-test/);
    await uninstallExtension(hub, "dev.queqiao.mcp", true, discover);
    expect((await readRuntimeConfig(windows.configFile)).extensions).toHaveLength(0);
    expect((await readRuntimeConfig(testWorker.configFile)).extensions).toHaveLength(0);
  });

});
