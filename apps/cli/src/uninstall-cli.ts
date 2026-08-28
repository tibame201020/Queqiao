import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cancel, confirm, intro, isCancel, multiselect, outro } from "@clack/prompts";
import { resolveExtensionHubRoot, resolveRuntimeLayoutForNamedRole, type RuntimeLayout, type RuntimeRole } from "@queqiao/platform-paths";
import { roleRemoveInternals } from "./role-remove.js";
import { listNamedRoleInstances } from "./setup-wizard.js";
import { runtimeStatus, stopRuntime } from "./service-lifecycle.js";

const PACKAGE_NAME = "@tibame201020/queqiao";
const execFileAsync = promisify(execFile);

type StatusResult = { active: boolean; managed: boolean };
type CleanupChoice = { value: string; label: string; hint?: string };
type Dependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactive?: boolean;
  selectTargets?: (choices: CleanupChoice[]) => Promise<string[]>;
  confirmCleanup?: (message: string) => Promise<boolean>;
  confirmPackageUninstall?: (message: string) => Promise<boolean>;
  status?: (configFile: string, layout: RuntimeLayout, role: RuntimeRole, name: string) => Promise<StatusResult>;
  stop?: (layout: RuntimeLayout, role: RuntimeRole, name: string) => Promise<unknown>;
  runNpm?: (args: string[]) => Promise<void>;
};

function standardEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  delete clean.QUEQIAO_CONFIG_DIR;
  delete clean.QUEQIAO_DATA_DIR;
  delete clean.QUEQIAO_STATE_HOME;
  delete clean.QUEQIAO_RUNTIME_DIR;
  return clean;
}

function extensionHubOwnedRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return resolveExtensionHubRoot(env, platform);
}

function roleOwnedPaths(layout: RuntimeLayout): string[] {
  const stateRoot = path.dirname(layout.configDir);
  return [...new Set([stateRoot, layout.runtimeDir])];
}

function displayRoleChoiceLabel(baseLabel: string, paths: string[]): string {
  const [persistent, runtime] = paths;
  return [
    baseLabel,
    persistent ? `  Persistent: ${persistent}` : undefined,
    runtime ? `  Runtime:    ${runtime}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function displayExtensionHubChoiceLabel(root: string): string {
  return `Extension Hub\n  Path: ${root}`;
}

async function defaultSelectTargets(choices: CleanupChoice[]): Promise<string[]> {
  const value = await multiselect({
    message: "Select local Queqiao data to remove",
    options: choices,
    initialValues: choices.map((choice) => choice.value),
    required: false,
  });
  if (isCancel(value)) {
    cancel("Queqiao uninstall cancelled");
    throw new Error("Queqiao uninstall cancelled");
  }
  return value.map(String);
}

async function defaultConfirm(message: string): Promise<boolean> {
  const value = await confirm({ message, initialValue: false });
  if (isCancel(value)) {
    cancel("Queqiao uninstall cancelled");
    throw new Error("Queqiao uninstall cancelled");
  }
  return Boolean(value);
}

async function defaultRunNpm(args: string[], platform: NodeJS.Platform): Promise<void> {
  const executable = platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(executable, args, { windowsHide: true });
}

export async function uninstallQueqiao(args: string[], dependencies: Dependencies = {}): Promise<unknown> {
  if (args.includes("--yes")) throw new Error("--yes is not supported. Queqiao uninstall always requires interactive selection and confirmation.");

  const injected = Boolean(dependencies.selectTargets);
  const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive && !injected) throw new Error("Queqiao uninstall requires an interactive terminal.");

  const env = standardEnvironment(dependencies.env ?? process.env);
  const platform = dependencies.platform ?? process.platform;
  const instances: Array<{ role: RuntimeRole; name: string; layout: RuntimeLayout; status: StatusResult }> = [];
  for (const role of ["gateway", "worker"] as const) {
    for (const name of await listNamedRoleInstances(role, env, platform)) {
      const layout = resolveRuntimeLayoutForNamedRole(role, name, env, platform);
      const status = dependencies.status
        ? await dependencies.status(layout.configFile, layout, role, name)
        : await runtimeStatus(layout.configFile, layout, role, name);
      instances.push({ role, name, layout, status });
    }
  }

  const extensionHubRoot = extensionHubOwnedRoot(env, platform);
  const choices: CleanupChoice[] = [
    ...instances.map(({ role, name, layout, status }) => ({
      value: `${role}:${name}`,
      label: displayRoleChoiceLabel(
        `${role === "gateway" ? "Gateway" : "Worker"}: ${name}${status.active ? status.managed ? " (running)" : " (running unmanaged)" : ""}`,
        roleOwnedPaths(layout),
      ),
    })),
    {
      value: "extension-hub",
      label: displayExtensionHubChoiceLabel(extensionHubRoot),
    },
  ];

  if (!injected) intro("Uninstall Queqiao");
  const selected = await (dependencies.selectTargets ?? defaultSelectTargets)(choices);
  const valid = new Set(choices.map((choice) => choice.value));
  for (const value of selected) if (!valid.has(value)) throw new Error(`Unknown uninstall target: ${value}`);

  const selectedSet = new Set(selected);
  let cleaned = false;

  if (selected.length) {
    const selectedInstances = instances.filter(({ role, name }) => selectedSet.has(`${role}:${name}`));
    const unmanaged = selectedInstances.filter((instance) => instance.status.active && !instance.status.managed);
    if (unmanaged.length) {
      const names = unmanaged.map(({ role, name }) => `${role}:${name}`).join(", ");
      throw new Error(`Cannot remove while an unmanaged Queqiao runtime is active: ${names}. Stop it first.`);
    }

    const selectedLines = choices
      .filter((choice) => selectedSet.has(choice.value))
      .map((choice) => `  - ${choice.label.replaceAll("\n", "\n    ")}`);
    const approveCleanup = dependencies.confirmCleanup ?? defaultConfirm;
    const confirmed = await approveCleanup(`Remove the selected local Queqiao data?\n${selectedLines.join("\n")}`);
    if (!confirmed) {
      if (!injected) outro("Queqiao uninstall cancelled");
      return { cleaned: false, uninstalled: false, cancelled: true, package: PACKAGE_NAME, selected };
    }

    for (const instance of selectedInstances) {
      if (instance.status.active && instance.status.managed) {
        if (dependencies.stop) await dependencies.stop(instance.layout, instance.role, instance.name);
        else await stopRuntime(instance.layout, instance.role, instance.name);
      }
      await roleRemoveInternals.removeLayout(instance.layout);
    }

    if (selectedSet.has("extension-hub")) {
      await rm(extensionHubRoot, { recursive: true, force: true });
    }
    cleaned = true;
  }

  const approvePackage = dependencies.confirmPackageUninstall ?? defaultConfirm;
  const uninstallPackage = await approvePackage(`Uninstall ${PACKAGE_NAME} from global npm?`);
  if (uninstallPackage) {
    if (dependencies.runNpm) await dependencies.runNpm(["uninstall", "--global", PACKAGE_NAME]);
    else await defaultRunNpm(["uninstall", "--global", PACKAGE_NAME], platform);
  }

  if (!injected) {
    if (uninstallPackage) outro(cleaned ? "Local Queqiao data removed; global package uninstalled" : "Global Queqiao package uninstalled");
    else outro(cleaned ? "Selected local Queqiao data removed; global package kept" : "Nothing changed");
  }

  return {
    cleaned,
    uninstalled: uninstallPackage,
    package: PACKAGE_NAME,
    selected,
  };
}

export const uninstallInternals = { standardEnvironment, extensionHubOwnedRoot, roleOwnedPaths };
