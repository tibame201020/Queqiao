import { execFile as execFileCallback } from "node:child_process";
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

type Dependencies = {
  npmRunner?: NpmRunner;
  snapshotManagedRuntimes?: () => Promise<SnapshotSummary>;
  restartManagedRuntimeTargets?: (targets: readonly ManagedRuntimeTarget[]) => Promise<RestartSummary>;
  updateNpmExtensions?: ExtensionUpdate;
};

export type UpdateOptions = { extensions?: boolean; extension?: string; all?: boolean };

async function defaultNpmRunner(args: readonly string[]): Promise<void> {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
    await execFileAsync(comspec, ["/d", "/s", "/c", "npm.cmd", ...args], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return;
  }
  await execFileAsync("npm", [...args], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}

export async function updateQueqiao(
  hubLayout: RuntimeLayout | string,
  options: UpdateOptions = {},
  dependencies: Dependencies = {},
) {
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

  await npmRunner(["install", "-g", CORE_PACKAGE]);
  const restarted = await restartTargets(before.targets);
  return {
    core: { changed: true, package: CORE_PACKAGE },
    ...(extensions ? { extensions } : {}),
    ...restarted,
    skipped: [...before.skipped, ...restarted.skipped],
  };
}

export const updateCliInternals = { CORE_PACKAGE };
