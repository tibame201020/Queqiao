import { readRuntimeConfigForRepair } from "@queqiao/config";
import { resolveRuntimeLayoutForNamedRole, type RuntimeRole } from "@queqiao/platform-paths";
import { cancel, isCancel } from "@clack/prompts";
import { listNamedRoleInstances } from "./setup-wizard.js";
import { runtimeStatus } from "./service-lifecycle.js";
import { queqiaoSelect } from "./tui-select.js";

export type RoleInstanceInventory = {
  name: string;
  configured: boolean;
  running: boolean;
  managed: boolean;
  publicUrl?: string;
  servicePort?: number;
  managementPort?: number;
  endpoint?: string;
  workspaceCount?: number;
};

type Dependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactive?: boolean;
  choose?: (message: string, options: Array<{ value: string; label: string }>) => Promise<string>;
};

function safeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

function hasExplicitLayout(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.QUEQIAO_CONFIG_DIR || env.QUEQIAO_DATA_DIR || env.QUEQIAO_STATE_HOME || env.QUEQIAO_RUNTIME_DIR);
}

export async function listRoleInstances(
  role: RuntimeRole,
  dependencies: Pick<Dependencies, "env" | "platform"> = {},
): Promise<RoleInstanceInventory[]> {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const result: RoleInstanceInventory[] = [];
  const names = hasExplicitLayout(env) ? ["default"] : await listNamedRoleInstances(role, env, platform);
  for (const name of names) {
    const layout = resolveRuntimeLayoutForNamedRole(role, name, env, platform);
    let config;
    try {
      config = await readRuntimeConfigForRepair(layout.configFile);
    } catch {
      result.push({ name, configured: false, running: false, managed: false });
      continue;
    }
    const status = await runtimeStatus(layout.configFile, layout, role, name);
    if (role === "gateway" && config.gateway) {
      result.push({
        name,
        configured: true,
        running: status.active,
        managed: status.managed,
        publicUrl: safeUrl(config.gateway.publicBaseUrl),
        servicePort: config.gateway.listen.port,
        managementPort: config.gateway.managementListen.port,
      });
    }
    if (role === "worker" && config.worker) {
      result.push({
        name,
        configured: true,
        running: status.active,
        managed: status.managed,
        endpoint: safeUrl(`http://${config.worker.listen.host}:${config.worker.listen.port}/`),
        workspaceCount: config.workspaces.length,
      });
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function resolveRoleInstance(
  role: RuntimeRole,
  args: readonly string[],
  dependencies: Dependencies = {},
): Promise<string> {
  const selector = role;
  const explicit = option(args, selector);
  const label = role === "gateway" ? "Gateway" : "Worker";
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const names = hasExplicitLayout(env) ? ["default"] : await listNamedRoleInstances(role, env, platform);
  if (explicit) {
    if (!names.includes(explicit)) throw new Error(`Unknown ${label}: ${explicit}. Run "queqiao ${role} list".`);
    return explicit;
  }

  const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.includes("--json"));
  if (!interactive) {
    const error = new Error(`--${selector} is required outside an interactive terminal. Run "queqiao ${role} list".`) as Error & { exitCode?: number };
    error.exitCode = 2;
    throw error;
  }
  if (!names.length) throw new Error(`No ${label} instances are configured. Run "queqiao ${role} setup".`);
  if (names.length === 1) return names[0]!;

  const instances = await listRoleInstances(role, dependencies);
  const choices = instances.map(({ name, running }) => ({ value: name, label: `${name}${running ? " (running)" : ""}` }));
  const selected = dependencies.choose
    ? await dependencies.choose(label, choices)
    : await queqiaoSelect({ message: label, choices });
  if (isCancel(selected)) {
    cancel(`${label} selection cancelled`);
    const error = new Error(`${label} selection cancelled`) as Error & { exitCode?: number };
    error.exitCode = 130;
    throw error;
  }
  return String(selected);
}

export function withRoleSelector(args: readonly string[], role: RuntimeRole, name: string): string[] {
  return args.includes(`--${role}`) ? [...args] : [...args, `--${role}`, name];
}

export function selectorRoleForCliArgs(args: readonly string[]): RuntimeRole | undefined {
  const [domain, action, resource] = args.filter((token) => token !== "--json");
  if (domain === "gateway" && !["list", "setup", "remove"].includes(action || "")) return "gateway";
  if (domain === "worker" && !["list", "setup", "remove"].includes(action || "")) return "worker";
  if (domain === "extension" && ["attach", "detach"].includes(action || "")) return "worker";
  if (domain === "doctor" && (action === "manifest" || (action === "tool" && resource === "explain"))) return "gateway";
  return undefined;
}

export const instanceSelectorInternals = { safeUrl, hasExplicitLayout };
