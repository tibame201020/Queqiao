import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  extensionManifestSchema,
  readRuntimeConfig,
  readRuntimeConfigForRepair,
  runtimeConfigSchema,
  type InstalledExtensionConfig,
  type RuntimeConfig,
} from "@queqiao/config";
import {
  resolveNamedRoleConfigRoot,
  resolveRuntimeLayoutForNamedRole,
  secureRuntimeDirectory,
  secureRuntimeFile,
  type RuntimeLayout,
} from "@queqiao/platform-paths";
import { AtomicConfigStore } from "./atomic-config-store.js";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_VERSION = /^[a-z0-9][a-z0-9._-]*$/i;

type NpmRunner = (args: readonly string[], cwd: string) => Promise<void>;

type InstalledPackageJson = {
  name?: unknown;
  version?: unknown;
  queqiao?: unknown;
};

const hubSourceSchema = z.object({
  kind: z.literal("npm"),
  package: z.string().min(1).max(214),
  requested: z.string().min(1).max(256),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  module: z.string().min(1).max(4096),
  installDirectory: z.string().min(1).max(4096),
});

const hubExtensionSchema = z.object({
  trusted: z.literal(true),
  source: hubSourceSchema,
  manifest: extensionManifestSchema,
});

const extensionHubSchema = z.object({
  version: z.literal(1),
  extensions: z.array(hubExtensionSchema).default([]),
}).superRefine((hub, ctx) => {
  const ids = new Set<string>();
  for (const [index, extension] of hub.extensions.entries()) {
    if (ids.has(extension.manifest.id)) ctx.addIssue({ code: "custom", path: ["extensions", index, "manifest", "id"], message: "Extension Hub ids must be unique" });
    ids.add(extension.manifest.id);
  }
});

type HubExtension = z.infer<typeof hubExtensionSchema>;
type ExtensionHub = z.infer<typeof extensionHubSchema>;
type HubLocation = RuntimeLayout | string;
export type ExtensionWorkerTarget = { name: string; layout: RuntimeLayout; config: RuntimeConfig };
type WorkerDiscovery = () => Promise<ExtensionWorkerTarget[]>;

function packageNameFromSpec(spec: string): string {
  if (!spec || /\s/.test(spec)) throw new Error("npm extension spec must not contain whitespace");
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash <= 1) throw new Error("Invalid scoped npm package name");
    const versionAt = spec.indexOf("@", slash);
    const name = versionAt < 0 ? spec : spec.slice(0, versionAt);
    const version = versionAt < 0 ? undefined : spec.slice(versionAt + 1);
    if (!PACKAGE_NAME.test(name) || (version !== undefined && !PACKAGE_VERSION.test(version))) throw new Error("Only npm registry package names with an optional exact version or tag are supported");
    return name;
  }
  const versionAt = spec.indexOf("@");
  const name = versionAt < 0 ? spec : spec.slice(0, versionAt);
  const version = versionAt < 0 ? undefined : spec.slice(versionAt + 1);
  if (!PACKAGE_NAME.test(name) || (version !== undefined && !PACKAGE_VERSION.test(version))) throw new Error("Only npm registry package names with an optional exact version or tag are supported");
  return name;
}

export function parseExtensionSource(source: string): { requested: string; packageName: string } {
  if (!source.startsWith("npm:")) throw new Error("Extension source must use npm:<package> syntax");
  const requested = source.slice(4);
  return { requested, packageName: packageNameFromSpec(requested) };
}

async function defaultNpmRunner(args: readonly string[], cwd: string): Promise<void> {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
    await execFileAsync(comspec, ["/d", "/s", "/c", "npm.cmd", ...args], { cwd, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return;
  }
  await execFileAsync("npm", [...args], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}

function packageDirectory(installDirectory: string, packageName: string): string {
  return path.join(installDirectory, "node_modules", ...packageName.split("/"));
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeInstallDirectoryName(id: string, version: string): string {
  return `${id.replace(/[^a-z0-9._-]/gi, "-")}-${version}-${randomUUID().slice(0, 8)}`;
}

function hubRoot(location: HubLocation): string { return typeof location === "string" ? location : path.join(location.dataDir, "extensions"); }
function packagesRoot(location: HubLocation): string { return path.join(hubRoot(location), "packages"); }
function hubFile(location: HubLocation): string { return path.join(hubRoot(location), "hub.json"); }

async function readHub(location: HubLocation): Promise<ExtensionHub> {
  try {
    return extensionHubSchema.parse(JSON.parse(await readFile(hubFile(location), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, extensions: [] };
    throw error;
  }
}

async function updateHub(location: HubLocation, mutator: (current: ExtensionHub) => ExtensionHub): Promise<ExtensionHub> {
  const root = hubRoot(location);
  await secureRuntimeDirectory(root);
  const file = hubFile(location);
  const lockFile = `${file}.lock`;
  let lock;
  try {
    lock = await open(lockFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Extension Hub is locked by another Queqiao CLI process: ${file}`);
    throw error;
  }
  try {
    const next = extensionHubSchema.parse(mutator(await readHub(location)));
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await secureRuntimeFile(temporary);
    await rename(temporary, file);
    await secureRuntimeFile(file);
    return next;
  } finally {
    await lock.close();
    await rm(lockFile, { force: true });
  }
}

function workerConfigRoot(): string {
  return resolveNamedRoleConfigRoot("worker");
}

async function discoverWorkers(): Promise<ExtensionWorkerTarget[]> {
  let entries;
  try { entries = await readdir(workerConfigRoot(), { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const workers: ExtensionWorkerTarget[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name)) continue;
    const layout = resolveRuntimeLayoutForNamedRole("worker", entry.name);
    try {
      const config = await readRuntimeConfigForRepair(layout.configFile);
      if (config.worker) workers.push({ name: entry.name, layout, config });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Could not read Worker ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return workers;
}

function attachedConfig(extension: HubExtension): InstalledExtensionConfig {
  return {
    trusted: true,
    source: extension.source,
    activation: { kind: "global" },
    manifest: extension.manifest,
  };
}

function isHubOwnedAttachment(entry: InstalledExtensionConfig, extension: HubExtension): boolean {
  return entry.manifest.id === extension.manifest.id
    && entry.source.kind === "npm"
    && entry.source.module === extension.source.module
    && entry.source.installDirectory === extension.source.installDirectory;
}
function assertWorkerCompatible(config: RuntimeConfig, extension: HubExtension, workerName: string): void {
  if (!config.worker) throw new Error(`Worker runtime config is required: ${workerName}`);
  if (!config.workspaces.length) {
    throw new Error(`Worker ${workerName} is not fully configured; run queqiao worker setup and authorize at least one Workspace first`);
  }
  const host = extension.manifest.host;
  if (host.kind !== "worker") throw new Error(`Extension ${extension.manifest.id} is not Worker-hosted`);
  if (host.environmentId && host.environmentId !== config.worker.environmentId) {
    throw new Error(`Extension ${extension.manifest.id} requires Worker environment ${host.environmentId}; ${workerName} is ${config.worker.environmentId}`);
  }
}

async function attachHubEntryToWorker(extension: HubExtension, workerName: string, workerLayout: RuntimeLayout): Promise<{ changed: boolean; worker: string; attached: string }> {
  const store = new AtomicConfigStore<RuntimeConfig>(workerLayout.configFile, (value) => runtimeConfigSchema.parse(value));
  const current = await store.read();
  assertWorkerCompatible(current, extension, workerName);
  const existing = current.extensions.find((entry) => entry.manifest.id === extension.manifest.id);
  if (existing) {
    if (existing.manifest.version === extension.manifest.version && existing.source.module === extension.source.module) return { changed: false, worker: workerName, attached: extension.manifest.id };
    throw new Error(`Worker ${workerName} has a stale attachment for ${extension.manifest.id}; detach it before attaching the Hub version`);
  }
  await store.update((config) => ({ ...config, extensions: [...config.extensions, attachedConfig(extension)] }));
  return { changed: true, worker: workerName, attached: extension.manifest.id };
}

export async function attachExtension(hubLayout: HubLocation, id: string, workerName: string, workerLayout: RuntimeLayout = resolveRuntimeLayoutForNamedRole("worker", workerName)): Promise<unknown> {
  const hub = await readHub(hubLayout);
  const extension = hub.extensions.find((entry) => entry.manifest.id === id);
  if (!extension) throw new Error(`Extension is not installed in the Hub: ${id}`);
  return attachHubEntryToWorker(extension, workerName, workerLayout);
}

export async function detachExtension(id: string, workerName: string, workerLayout: RuntimeLayout = resolveRuntimeLayoutForNamedRole("worker", workerName)): Promise<unknown> {
  const store = new AtomicConfigStore<RuntimeConfig>(workerLayout.configFile, (value) => runtimeConfigSchema.parse(value));
  let changed = false;
  await store.update((config) => {
    const extensions = config.extensions.filter((entry) => entry.manifest.id !== id);
    changed = extensions.length !== config.extensions.length;
    return changed ? { ...config, extensions } : config;
  });
  return { changed, worker: workerName, detached: id };
}

export async function installNpmExtension(
  hubLayout: HubLocation,
  source: string,
  options: { workerName?: string; attachAll?: boolean } = {},
  npmRunner: NpmRunner = defaultNpmRunner,
  workerDiscovery: WorkerDiscovery = discoverWorkers,
): Promise<unknown> {
  if (options.workerName && options.attachAll) throw new Error("Choose either --worker <name> or --attach-all, not both");
  const { requested, packageName } = parseExtensionSource(source);
  const packageStore = packagesRoot(hubLayout);
  await secureRuntimeDirectory(packageStore);
  const staging = path.join(packageStore, `.staging-${randomUUID()}`);
  await secureRuntimeDirectory(staging);
  const stagingPackageJson = path.join(staging, "package.json");
  await writeFile(stagingPackageJson, `${JSON.stringify({ name: "queqiao-extension-install", private: true, version: "0.0.0" }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await secureRuntimeFile(stagingPackageJson);

  let finalDirectory: string | undefined;
  try {
    await npmRunner(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", requested], staging);
    const packageRoot = packageDirectory(staging, packageName);
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as InstalledPackageJson;
    if (packageJson.name !== packageName || typeof packageJson.version !== "string") throw new Error("Installed npm package identity is invalid");
    const metadata = z.object({ apiVersion: z.literal(1), module: z.string().min(1).max(4096), manifest: extensionManifestSchema }).parse(packageJson.queqiao);
    if (metadata.manifest.version !== packageJson.version) throw new Error("Queqiao extension manifest version must match npm package version");
    if (metadata.manifest.host.kind !== "worker") throw new Error("Extension Hub v1 accepts Worker-hosted extensions only");
    if (!metadata.module.startsWith("./") && !metadata.module.startsWith(".\\")) throw new Error("queqiao.module must be a package-relative path beginning with ./");
    const moduleCandidate = path.resolve(packageRoot, metadata.module);
    const realPackageRoot = await realpath(packageRoot);
    const realModule = await realpath(moduleCandidate);
    if (!contained(realPackageRoot, realModule)) throw new Error("queqiao.module escapes the installed npm package");
    if (!(await stat(realModule)).isFile()) throw new Error("queqiao.module must resolve to a file");

    const currentHub = await readHub(hubLayout);
    if (currentHub.extensions.some((entry) => entry.manifest.id === metadata.manifest.id)) throw new Error(`Extension is already installed in the Hub: ${metadata.manifest.id}`);

    const relativeModule = path.relative(realPackageRoot, realModule);
    if (relativeModule.startsWith(`..${path.sep}`) || relativeModule === ".." || path.isAbsolute(relativeModule)) {
      throw new Error("queqiao.module escapes the installed npm package");
    }

    finalDirectory = path.join(packageStore, safeInstallDirectoryName(metadata.manifest.id, metadata.manifest.version));
    await rename(staging, finalDirectory);
    const finalPackageRoot = packageDirectory(finalDirectory, packageName);
    const extension: HubExtension = {
      trusted: true,
      source: {
        kind: "npm",
        package: packageName,
        requested,
        version: packageJson.version,
        module: path.join(finalPackageRoot, relativeModule),
        installDirectory: finalDirectory,
      },
      manifest: metadata.manifest,
    };

    await updateHub(hubLayout, (hub) => ({ ...hub, extensions: [...hub.extensions, extension] }));

    const attachments: unknown[] = [];
    try {
      if (options.workerName) attachments.push(await attachHubEntryToWorker(extension, options.workerName, resolveRuntimeLayoutForNamedRole("worker", options.workerName)));
      if (options.attachAll) {
        for (const worker of await workerDiscovery()) {
          if (extension.manifest.host.kind === "worker" && extension.manifest.host.environmentId && extension.manifest.host.environmentId !== worker.config.worker?.environmentId) continue;
          attachments.push(await attachHubEntryToWorker(extension, worker.name, worker.layout));
        }
      }
    } catch (error) {
      for (const attachment of attachments.slice().reverse()) {
        const worker = (attachment as { worker?: string }).worker;
        if (worker) await detachExtension(extension.manifest.id, worker).catch(() => undefined);
      }
      await updateHub(hubLayout, (hub) => ({ ...hub, extensions: hub.extensions.filter((entry) => entry.manifest.id !== extension.manifest.id) })).catch(() => undefined);
      await rm(finalDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    return {
      changed: true,
      id: extension.manifest.id,
      version: extension.manifest.version,
      package: packageName,
      hub: hubRoot(hubLayout),
      attachments,
      proxyAvailable: true,
      connectorManifestImpact: "none",
    };
  } catch (error) {
    if (!finalDirectory) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function uninstallExtension(hubLayout: HubLocation, id: string, force = false, workerDiscovery: WorkerDiscovery = discoverWorkers): Promise<unknown> {
  const hub = await readHub(hubLayout);
  const extension = hub.extensions.find((entry) => entry.manifest.id === id);
  if (!extension) throw new Error(`Extension is not installed in the Hub: ${id}`);
  const workers = await workerDiscovery();
  const attachedWorkers = workers.filter((worker) => worker.config.extensions.some((entry) => isHubOwnedAttachment(entry, extension)));
  const attachedWorkerNames = attachedWorkers.map((worker) => worker.name);
  if (attachedWorkerNames.length && !force) throw new Error(`Cannot uninstall ${id}; attached Workers: ${attachedWorkerNames.join(", ")}. Detach first or use --force.`);
  const extensionsRoot = path.resolve(packagesRoot(hubLayout));
  const installDirectory = path.resolve(extension.source.installDirectory);
  if (!contained(extensionsRoot, installDirectory) || installDirectory === extensionsRoot) throw new Error("Refusing to remove extension package outside the managed Extension Hub package directory");

  if (force) for (const worker of attachedWorkers) await detachExtension(id, worker.name, worker.layout);
  await updateHub(hubLayout, (current) => ({ ...current, extensions: current.extensions.filter((entry) => entry.manifest.id !== id) }));
  let packageCleanup: "removed" | "orphaned" = "removed";
  try { await rm(installDirectory, { recursive: true, force: true }); }
  catch { packageCleanup = "orphaned"; }
  return { changed: true, removed: id, detachedWorkers: force ? attachedWorkerNames : [], packageCleanup };
}

export async function listExtensions(hubLayout: HubLocation): Promise<unknown> {
  const hub = await readHub(hubLayout);
  const workers = await discoverWorkers();
  return {
    hub: hubRoot(hubLayout),
    extensions: hub.extensions.map((extension) => ({
      id: extension.manifest.id,
      displayName: extension.manifest.displayName,
      version: extension.manifest.version,
      package: extension.source.package,
      workers: workers.map((worker) => ({ name: worker.name, attached: worker.config.extensions.some((entry) => isHubOwnedAttachment(entry, extension)) })),
    })),
  };
}

export async function showExtension(hubLayout: HubLocation, id: string): Promise<unknown> {
  const hub = await readHub(hubLayout);
  const extension = hub.extensions.find((entry) => entry.manifest.id === id);
  if (!extension) throw new Error(`Extension is not installed in the Hub: ${id}`);
  const workers = await discoverWorkers();
  return {
    id: extension.manifest.id,
    displayName: extension.manifest.displayName,
    version: extension.manifest.version,
    source: extension.source,
    host: extension.manifest.host,
    contributions: extension.manifest.contributions,
    workers: workers.map((worker) => ({
      name: worker.name,
      environmentId: worker.config.worker?.environmentId,
      attached: worker.config.extensions.some((entry) => isHubOwnedAttachment(entry, extension)),
    })),
  };
}

export async function doctorExtensionHub(hubLayout: HubLocation): Promise<unknown> {
  const hub = await readHub(hubLayout);
  const workers = await discoverWorkers();
  const issues: string[] = [];
  for (const extension of hub.extensions) {
    await access(extension.source.module).catch(() => issues.push(`${extension.manifest.id}: module is missing`));
    await access(extension.source.installDirectory).catch(() => issues.push(`${extension.manifest.id}: install directory is missing`));
  }
  const hubIds = new Set(hub.extensions.map((entry) => entry.manifest.id));
  for (const worker of workers) {
    for (const extension of worker.config.extensions) {
      if (extension.source.kind === "npm" && !hubIds.has(extension.manifest.id)) issues.push(`${worker.name}: attached extension is missing from Hub: ${extension.manifest.id}`);
    }
  }
  return { ok: issues.length === 0, hub: hubRoot(hubLayout), extensionCount: hub.extensions.length, workerCount: workers.length, issues };
}
