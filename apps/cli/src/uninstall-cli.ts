import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { cancel, confirm, intro, isCancel, multiselect, outro } from "@clack/prompts";
import { resolveRuntimeLayout, resolveRuntimeLayoutForNamedRole, type RuntimeLayout, type RuntimeRole } from "@queqiao/platform-paths";
import { roleRemoveInternals } from "./role-remove.js";
import { listNamedRoleInstances } from "./setup-wizard.js";
import { runtimeStatus, stopRuntime } from "./service-lifecycle.js";

const PACKAGE_NAME = "@tibame201020/queqiao";
const execFileAsync = promisify(execFile);

type StatusResult = { active: boolean; managed: boolean };
type CleanupChoice = { value: string; label: string };
type Dependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactive?: boolean;
  selectTargets?: (choices: CleanupChoice[]) => Promise<string[]>;
  confirm?: (message: string) => Promise<boolean>;
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

function sharedOwnedRoots(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const layout = resolveRuntimeLayout(env, platform);
  return [...new Set([layout.configDir, layout.dataDir, layout.stateDir])];
}

async function defaultSelectTargets(choices: CleanupChoice[]): Promise<string[]> {
  const value = await multiselect({
    message: "Select Queqiao items to remove",
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

  const choices: CleanupChoice[] = [
    ...instances.map(({ role, name, status }) => ({
      value: `${role}:${name}`,
      label: `${role === "gateway" ? "Gateway" : "Worker"}: ${name}${status.active ? status.managed ? " (running)" : " (running unmanaged)" : ""}`,
    })),
    { value: "shared", label: "Shared Queqiao data / Extension Hub" },
    { value: "package", label: "Global npm package" },
  ];

  if (!injected) intro("Uninstall Queqiao");
  const selected = await (dependencies.selectTargets ?? defaultSelectTargets)(choices);
  const valid = new Set(choices.map((choice) => choice.value));
  for (const value of selected) if (!valid.has(value)) throw new Error(`Unknown uninstall target: ${value}`);
  if (!selected.length) {
    if (!injected) outro("Nothing selected; Queqiao was not changed");
    return { uninstalled: false, cancelled: true, package: PACKAGE_NAME, selected: [] };
  }

  const selectedSet = new Set(selected);
  const selectedInstances = instances.filter(({ role, name }) => selectedSet.has(`${role}:${name}`));
  const unmanaged = selectedInstances.filter((instance) => instance.status.active && !instance.status.managed);
  if (unmanaged.length) {
    const names = unmanaged.map(({ role, name }) => `${role}:${name}`).join(", ");
    throw new Error(`Cannot remove while an unmanaged Queqiao runtime is active: ${names}. Stop it first.`);
  }

  const selectedLabels = choices.filter((choice) => selectedSet.has(choice.value)).map((choice) => choice.label);
  const approve = dependencies.confirm ?? defaultConfirm;
  const confirmed = await approve(`Remove the selected Queqiao items?\n${selectedLabels.map((label) => `  - ${label}`).join("\n")}`);
  if (!confirmed) return { uninstalled: false, cancelled: true, package: PACKAGE_NAME, selected };

  for (const instance of selectedInstances) {
    if (instance.status.active && instance.status.managed) {
      if (dependencies.stop) await dependencies.stop(instance.layout, instance.role, instance.name);
      else await stopRuntime(instance.layout, instance.role, instance.name);
    }
    await roleRemoveInternals.removeLayout(instance.layout);
  }

  if (selectedSet.has("shared")) {
    for (const root of sharedOwnedRoots(env, platform)) await rm(root, { recursive: true, force: true });
    const remainingInstances = instances.filter(({ role, name }) => !selectedSet.has(`${role}:${name}`));
    if (!remainingInstances.length) {
      await rm(resolveRuntimeLayout(env, platform).runtimeDir, { recursive: true, force: true });
    }
  }

  if (selectedSet.has("package")) {
    if (dependencies.runNpm) await dependencies.runNpm(["uninstall", "--global", PACKAGE_NAME]);
    else await defaultRunNpm(["uninstall", "--global", PACKAGE_NAME], platform);
  }

  if (!injected) outro(selectedSet.has("package") ? "Queqiao uninstalled" : "Selected Queqiao items removed");
  return {
    uninstalled: selectedSet.has("package"),
    cleaned: true,
    package: PACKAGE_NAME,
    selected,
  };
}

export const uninstallInternals = { standardEnvironment, sharedOwnedRoots };
