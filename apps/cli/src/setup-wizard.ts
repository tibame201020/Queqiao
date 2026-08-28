import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";
import {
  resolveNamedRoleConfigRoot,
  resolveRuntimeLayoutForNamedRole,
  type RuntimeRole,
} from "@queqiao/platform-paths";
import { setupGateway as setupGatewayPrimitive, setupWorker as setupWorkerPrimitive, type GatewaySetupPrompt, type WorkerSetupPrompt } from "./enrollment-cli.js";

const CREATE_NEW = "__create__";

export type RoleSetupPrompts = {
  choose: (message: string, options: Array<{ value: string; label: string }>) => Promise<string>;
  text: (message: string, initialValue?: string, validate?: (value: string) => string | undefined) => Promise<string>;
};

type SetupGatewayFn = typeof setupGatewayPrimitive;
type SetupWorkerFn = typeof setupWorkerPrimitive;

type RoleSetupDependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactive?: boolean;
  prompts?: RoleSetupPrompts;
  setupGateway?: SetupGatewayFn;
  setupWorker?: SetupWorkerFn;
};

function validateName(value: string): string | undefined {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.trim().toLowerCase())
    ? undefined
    : "Name must match /^[a-z0-9][a-z0-9_-]{0,63}$/";
}

function defaultPrompts(role: RuntimeRole): RoleSetupPrompts {
  return {
    choose: async (message, options) => {
      const value = await select({ message, options });
      if (isCancel(value)) {
        cancel(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
        throw new Error(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
      }
      return String(value);
    },
    text: async (message, initialValue, validate) => {
      const value = await text({
        message,
        ...(initialValue ? { placeholder: initialValue, defaultValue: initialValue } : {}),
        ...(validate ? { validate: (candidate: string | undefined) => validate(candidate || initialValue || "") } : {}),
      });
      if (isCancel(value)) {
        cancel(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
        throw new Error(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
      }
      return String(value || initialValue || "").trim();
    },
  };
}

export async function listNamedRoleInstances(
  role: RuntimeRole,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const root = resolveNamedRoleConfigRoot(role, env, platform);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const layout = resolveRuntimeLayoutForNamedRole(role, entry.name, env, platform);
    try {
      await access(layout.configFile);
      names.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return names.sort((left, right) => left.localeCompare(right));
}

export async function runRoleSetupWizard(
  role: RuntimeRole,
  args: string[],
  dependencies: RoleSetupDependencies = {},
): Promise<unknown> {
  if (args.includes("--name")) {
    throw new Error("--name is not supported for setup. Choose an existing instance or Create new in the setup wizard.");
  }

  const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const injectedPrompts = dependencies.prompts;
  if (!interactive && !injectedPrompts) {
    throw new Error(`${role === "gateway" ? "Gateway" : "Worker"} setup requires an interactive terminal.`);
  }

  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const existing = await listNamedRoleInstances(role, env, platform);
  const prompts = injectedPrompts ?? defaultPrompts(role);
  const roleLabel = role === "gateway" ? "Gateway" : "Worker";

  if (!injectedPrompts) intro(`${roleLabel} setup`);
  const selected = await prompts.choose(`Select ${roleLabel}`, [
    ...existing.map((name) => ({ value: name, label: `Edit ${name}` })),
    { value: CREATE_NEW, label: `Create new ${roleLabel}` },
  ]);

  const creating = selected === CREATE_NEW;
  let name = selected;
  if (creating) {
    name = (await prompts.text(`${roleLabel} name`, undefined, validateName)).trim().toLowerCase();
    const nameError = validateName(name);
    if (nameError) throw new Error(nameError);
    if (existing.includes(name)) throw new Error(`${roleLabel} already exists: ${name}`);
  }

  const layout = resolveRuntimeLayoutForNamedRole(role, name, env, platform);
  const setupArgs = args.filter((arg, index) => arg !== "--name" && args[index - 1] !== "--name");
  let result: unknown;

  if (role === "gateway") {
    const primitive = dependencies.setupGateway ?? setupGatewayPrimitive;
    const gatewayPrompt: GatewaySetupPrompt = async (_field, message, initialValue) => prompts.text(message, initialValue);
    result = await primitive(layout.configFile, setupArgs, layout.gatewayStateDir, layout.secretsDir, gatewayPrompt);
  } else {
    const primitive = dependencies.setupWorker ?? setupWorkerPrimitive;
    const workerPrompt: WorkerSetupPrompt = async (_field, message, initialValue) => prompts.text(message, initialValue);
    result = await primitive(layout.configFile, setupArgs, layout.secretsDir, workerPrompt);
  }

  if (!injectedPrompts) outro(`${roleLabel} ${creating ? "created" : "updated"}: ${name}`);
  return { ...(typeof result === "object" && result ? result : { result }), name, mode: creating ? "create" : "edit" };
}
