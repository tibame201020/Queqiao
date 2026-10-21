import { execFile as execFileCallback } from "node:child_process";
import { realpathSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { restartManagedRuntimeTargets, snapshotManagedRuntimes, type ManagedRuntimeTarget } from "./restart-cli.js";
import { updateNpmExtensions } from "./extension-cli.js";

const execFileAsync = promisify(execFileCallback);
const CORE_PACKAGE = "@tibame201020/queqiao";

type NpmRunner = (args: readonly string[]) => Promise<void>;
type ExtensionUpdate = typeof updateNpmExtensions;
type RestartSummary = Awaited<ReturnType<typeof restartManagedRuntimeTargets>>;
type SnapshotSummary = Awaited<ReturnType<typeof snapshotManagedRuntimes>>;
type CoreInstallation = { prefix: string; packageFile: string };
type Dependencies = {
  npmRunner?: NpmRunner;
  installation?: CoreInstallation;
  readVersion?: (packageFile: string) => string;
  snapshotManagedRuntimes?: () => Promise<SnapshotSummary>;
  restartManagedRuntimeTargets?: (targets: readonly ManagedRuntimeTarget[]) => Promise<RestartSummary>;
  updateNpmExtensions?: ExtensionUpdate;
};
export type UpdateOptions = { extensions?: boolean; extension?: string; all?: boolean };

// Derive prefix from the *executed CLI*, not npm config get prefix: WSL may have
// ~/.local/bin first in PATH while npm -g resolves to /usr/local.
export function resolveCoreInstallation(entry: string, platform: NodeJS.Platform = process.platform): CoreInstallation {
  const p = platform === "win32" ? path.win32 : path.posix;
  const realEntry = p.resolve(entry);
  const packageDir = p.dirname(p.dirname(realEntry));
  const scopeDir = p.dirname(packageDir);
  const nodeModules = p.dirname(scopeDir);
  if (p.basename(packageDir) !== "queqiao" || p.basename(scopeDir) !== "@tibame201020" || p.basename(nodeModules) !== "node_modules") {
    throw new Error("Cannot resolve the running Queqiao npm installation; update using its explicit npm --prefix instead");
  }
  const parent = p.dirname(nodeModules);
  return { prefix: p.basename(parent) === "lib" ? p.dirname(parent) : parent, packageFile: p.join(packageDir, "package.json") };
}
function installedVersion(packageFile: string): string {
  const metadata = JSON.parse(readFileSync(packageFile, "utf8")) as { name?: string; version?: string };
  if (metadata.name !== CORE_PACKAGE || !metadata.version) throw new Error("Running Queqiao package metadata is invalid");
  return metadata.version;
}
async function defaultNpmRunner(args: readonly string[]): Promise<void> {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
    await execFileAsync(comspec, ["/d", "/s", "/c", "npm.cmd", ...args], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return;
  }
  await execFileAsync("npm", [...args], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}
export async function updateQueqiao(hubLayout: RuntimeLayout | string, options: UpdateOptions = {}, dependencies: Dependencies = {}) {
  if (options.extension && options.extensions) throw new Error("Choose either --extension <id|source> or --extensions, not both");
  if (options.extension && options.all) throw new Error("--extension cannot be combined with --all");
  if (options.extensions && options.all) throw new Error("--extensions cannot be combined with --all");
  const npmRunner = dependencies.npmRunner || defaultNpmRunner;
  const snapshot = dependencies.snapshotManagedRuntimes || (() => snapshotManagedRuntimes());
  const restartTargets = dependencies.restartManagedRuntimeTargets || ((targets: readonly ManagedRuntimeTarget[]) => restartManagedRuntimeTargets(targets));
  const updateExtensions = dependencies.updateNpmExtensions || updateNpmExtensions;
  const extensionOnly = Boolean(options.extensions || options.extension);
  const updateCore = options.all || !extensionOnly;
  const updateExtensionPackages = options.all || extensionOnly;
  const before = updateCore ? await snapshot() : undefined;
  let extensions: Awaited<ReturnType<typeof updateNpmExtensions>> | undefined;
  if (updateExtensionPackages) extensions = await updateExtensions(hubLayout, { ...(options.extension ? { extension: options.extension } : {}) });
  if (!updateCore || !before) return { core: { changed: false }, extensions, restartedCount: 0, restarted: [], skipped: [] };
  const installation = dependencies.installation || resolveCoreInstallation(realpathSync(process.argv[1]!));
  const readVersion = dependencies.readVersion || installedVersion;
  const previousVersion = readVersion(installation.packageFile);
  await npmRunner(["install", "-g", "--prefix", installation.prefix, CORE_PACKAGE]);
  const version = readVersion(installation.packageFile);
  if (!version) throw new Error("Queqiao update did not produce an executable package at the invoking CLI location");
  const restarted = await restartTargets(before.targets);
  return {
    core: { changed: version !== previousVersion, package: CORE_PACKAGE, previousVersion, version, prefix: installation.prefix },
    ...(extensions ? { extensions } : {}),
    ...restarted,
    skipped: [...before.skipped, ...restarted.skipped],
  };
}
export const updateCliInternals = { CORE_PACKAGE };
