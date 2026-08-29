import { rm, rmdir } from "node:fs/promises";
import { cancel, confirm, intro, isCancel, outro } from "@clack/prompts";
import { resolveRuntimeLayoutForNamedRole, type RuntimeLayout, type RuntimeRole } from "@queqiao/platform-paths";
import { runtimeStatus } from "./service-lifecycle.js";
import { queqiaoSelect } from "./tui-select.js";
import { listNamedRoleInstances } from "./setup-wizard.js";

export type RoleRemovePrompts = {
  choose: (message: string, options: Array<{ value: string; label: string }>) => Promise<string>;
  confirm: (message: string) => Promise<boolean>;
};

type StatusResult = { active: boolean; managed: boolean };
type Dependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactive?: boolean;
  prompts?: RoleRemovePrompts;
  status?: (configFile: string, layout: RuntimeLayout, role: RuntimeRole, name: string) => Promise<StatusResult>;
};

function defaultPrompts(role: RuntimeRole): RoleRemovePrompts {
  const label = role === "gateway" ? "Gateway" : "Worker";
  return {
    choose: async (message, options) => {
      const value = await queqiaoSelect({ message, choices: options });
      if (isCancel(value)) {
        cancel(`${label} remove cancelled`);
        throw new Error(`${label} remove cancelled`);
      }
      return String(value);
    },
    confirm: async (message) => {
      const value = await confirm({ message, initialValue: false });
      if (isCancel(value)) {
        cancel(`${label} remove cancelled`);
        throw new Error(`${label} remove cancelled`);
      }
      return Boolean(value);
    },
  };
}

async function removeLayout(layout: RuntimeLayout): Promise<void> {
  const directories = [...new Set([layout.configDir, layout.dataDir, layout.stateDir, layout.runtimeDir])];
  for (const directory of directories) await rm(directory, { recursive: true, force: true });

  const configParent = layout.configDir.replace(/[\\/]config$/, "");
  const dataParent = layout.dataDir.replace(/[\\/]data$/, "");
  const stateParent = layout.stateDir.replace(/[\\/]state$/, "");
  if (configParent === dataParent && configParent === stateParent && configParent !== layout.configDir) {
    await rmdir(configParent).catch((error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    });
  }
}

export async function removeRoleInstance(role: RuntimeRole, args: string[], dependencies: Dependencies = {}): Promise<unknown> {
  if (args.includes("--name")) {
    throw new Error("--name is not supported for remove. Choose the instance in the remove flow.");
  }
  const injected = dependencies.prompts;
  const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive && !injected) throw new Error(`${role === "gateway" ? "Gateway" : "Worker"} remove requires an interactive terminal.`);

  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const names = await listNamedRoleInstances(role, env, platform);
  const label = role === "gateway" ? "Gateway" : "Worker";
  if (!names.length) throw new Error(`No ${label} instances are configured.`);

  const prompts = injected ?? defaultPrompts(role);
  if (!injected) intro(`Remove ${label}`);
  const name = await prompts.choose(`Select ${label}`, names.map((value) => ({ value, label: value })));
  if (!names.includes(name)) throw new Error(`Unknown ${label}: ${name}`);
  const layout = resolveRuntimeLayoutForNamedRole(role, name, env, platform);
  const status = dependencies.status
    ? await dependencies.status(layout.configFile, layout, role, name)
    : await runtimeStatus(layout.configFile, layout, role, name);
  if (status.active || status.managed) throw new Error(`Stop ${label} ${name} before removing it.`);

  const approved = await prompts.confirm(`Remove ${label} ${name} and all of its Queqiao-owned local state?`);
  if (!approved) return { removed: false, role, name, cancelled: true };
  await removeLayout(layout);
  if (!injected) outro(`${label} removed: ${name}`);
  return { removed: true, role, name };
}

export const roleRemoveInternals = { removeLayout };
