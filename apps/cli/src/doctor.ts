import { readFile } from "node:fs/promises";
import path from "node:path";
import { listNamedRoleInstances } from "./setup-wizard.js";
import { readRuntimeConfig, type RuntimeConfig } from "@queqiao/config";
import {
  resolveExtensionHubRoot,
  resolveNamedRoleConfigRoot,
  resolveRuntimeLayout,
  resolveRuntimeLayoutForNamedRole,
  type RuntimeLayout,
  type RuntimeRole,
} from "@queqiao/platform-paths";
import {
  QUEQIAO_WORKER_HTTP_API_PREFIX,
  workerProcessCapacitySchema,
  workerProcessListSchema,
  type WorkerProcessCapacity,
  type WorkerTrackedProcess,
} from "@queqiao/worker-protocol";
import { doctorExtensionHub } from "./extension-cli.js";
import { runtimeStatus } from "./service-lifecycle.js";

export type GatewayDoctorResult = {
  ok: boolean;
  gateway: { reachable: boolean; status?: number; error?: string };
  environments: Array<{ environmentId: string; reachable: boolean; checkedAt?: string; lastSuccessAt?: string }>;
  workerDiagnostics: { supported: false; reason: string };
};

type RuntimeStatusResult = Awaited<ReturnType<typeof runtimeStatus>>;

export type WorkerProcessDoctorResult = {
  ok: boolean;
  reachable: boolean;
  capacity?: WorkerProcessCapacity;
  resources?: WorkerTrackedProcess[];
  saturated?: Array<"foreground" | "background">;
  error?: string;
};

type DoctorRoleResult = {
  name: string;
  role: RuntimeRole;
  ok: boolean;
  configFile: string;
  status?: RuntimeStatusResult;
  routing?: GatewayDoctorResult;
  processes?: WorkerProcessDoctorResult;
  error?: string;
};

export type QueqiaoDoctorResult = {
  ok: boolean;
  gateways: DoctorRoleResult[];
  workers: DoctorRoleResult[];
  extensions: unknown;
};

type DoctorDependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetchImpl?: typeof fetch;
  readConfig?: typeof readRuntimeConfig;
  roleNames?: (role: RuntimeRole) => Promise<string[]>;
  resolveNamedLayout?: typeof resolveRuntimeLayoutForNamedRole;
  status?: (configFile: string, layout: RuntimeLayout, role: RuntimeRole, name: string) => Promise<RuntimeStatusResult>;
  extensionDoctor?: (location: RuntimeLayout | string) => Promise<unknown>;
  workerDiagnostics?: (config: RuntimeConfig) => Promise<WorkerProcessDoctorResult>;
};

function hasExplicitLayout(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.QUEQIAO_CONFIG_DIR || env.QUEQIAO_DATA_DIR || env.QUEQIAO_STATE_HOME || env.QUEQIAO_RUNTIME_DIR);
}

async function defaultRoleNames(role: RuntimeRole, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string[]> {
  return listNamedRoleInstances(role, env, platform);
}

export async function doctorWorkerProcesses(config: RuntimeConfig, fetchImpl: typeof fetch = fetch): Promise<WorkerProcessDoctorResult> {
  if (!config.worker) return { ok: false, reachable: false, error: "Worker is not configured" };
  let reachable = false;
  try {
    const credential = (await readFile(path.resolve(config.worker.tokenFile), "utf8")).trim();
    if (!credential) throw new Error("Worker credential is empty");
    const base = `http://127.0.0.1:${config.worker.listen.port}${QUEQIAO_WORKER_HTTP_API_PREFIX}`;
    const request: RequestInit = {
      headers: { "x-queqiao-worker-token": credential },
      signal: AbortSignal.timeout(3000),
    };
    const [capacityResponse, listResponse] = await Promise.all([
      fetchImpl(`${base}/processes/capacity`, request),
      fetchImpl(`${base}/processes`, request),
    ]);
    reachable = true;
    if (!capacityResponse.ok) throw new Error(`Worker process capacity diagnostics failed (${capacityResponse.status})`);
    if (!listResponse.ok) throw new Error(`Worker process list diagnostics failed (${listResponse.status})`);
    const capacity = workerProcessCapacitySchema.parse(await capacityResponse.json());
    const list = workerProcessListSchema.parse(await listResponse.json());
    const saturated: Array<"foreground" | "background"> = [];
    if (capacity.foreground.active >= capacity.foreground.limit) saturated.push("foreground");
    if (capacity.background.active >= capacity.background.limit) saturated.push("background");
    return { ok: true, reachable: true, capacity, resources: list.resources, saturated };
  } catch (error) {
    return { ok: false, reachable, error: error instanceof Error ? error.message : "Unknown Worker process diagnostics error" };
  }
}

export async function doctorGateway(config: RuntimeConfig, fetchImpl: typeof fetch = fetch): Promise<GatewayDoctorResult> {
  const unsupported = { supported: false as const, reason: "No Worker-native doctor capability is advertised" };
  if (!config.gateway) return { ok: false, gateway: { reachable: false, error: "Gateway is not configured" }, environments: [], workerDiagnostics: unsupported };
  try {
    const response = await fetchImpl(`http://127.0.0.1:${config.gateway.listen.port}/health`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json() as { ok?: boolean; environments?: Array<{ environmentId: string; reachable: boolean; checkedAt?: string; lastSuccessAt?: string }> };
    const environments = Array.isArray(health.environments) ? health.environments : [];
    return { ok: response.ok && health.ok === true, gateway: { reachable: response.ok, status: response.status }, environments, workerDiagnostics: unsupported };
  } catch (error) {
    return { ok: false, gateway: { reachable: false, error: error instanceof Error ? error.message : "Unknown error" }, environments: [], workerDiagnostics: unsupported };
  }
}

export async function doctorQueqiao(hubLocation: RuntimeLayout | string = resolveExtensionHubRoot(), dependencies: DoctorDependencies = {}): Promise<QueqiaoDoctorResult> {
  const env = dependencies.env || process.env;
  const platform = dependencies.platform || process.platform;
  const readConfig = dependencies.readConfig || readRuntimeConfig;
  const resolveNamedLayout = dependencies.resolveNamedLayout || ((role, name) => resolveRuntimeLayoutForNamedRole(role, name, env, platform));
  const status = dependencies.status || ((configFile, layout, role, name) => runtimeStatus(configFile, layout, role, name, { fetchImpl: dependencies.fetchImpl || fetch }));
  const extensionDoctor = dependencies.extensionDoctor || doctorExtensionHub;
  const workerDiagnostics = dependencies.workerDiagnostics || ((config: RuntimeConfig) => doctorWorkerProcesses(config, dependencies.fetchImpl || fetch));
  const roleNames = dependencies.roleNames || ((role) => defaultRoleNames(role, env, platform));

  async function inspectRole(role: RuntimeRole, name: string, layout: RuntimeLayout, config: RuntimeConfig): Promise<DoctorRoleResult> {
    if (role === "gateway" && !config.gateway) return { name, role, ok: false, configFile: layout.configFile, error: "Gateway config is missing" };
    if (role === "worker" && !config.worker) return { name, role, ok: false, configFile: layout.configFile, error: "Worker config is missing" };
    const runtime = await status(layout.configFile, layout, role, name);
    if (role === "gateway") {
      const routing = await doctorGateway(config, dependencies.fetchImpl || fetch);
      return { name, role, ok: runtime.active && routing.ok, configFile: layout.configFile, status: runtime, routing };
    }
    const processes = runtime.active ? await workerDiagnostics(config) : undefined;
    return { name, role, ok: runtime.active && Boolean(processes?.ok), configFile: layout.configFile, status: runtime, ...(processes ? { processes } : {}) };
  }

  const gateways: DoctorRoleResult[] = [];
  const workers: DoctorRoleResult[] = [];
  if (hasExplicitLayout(env)) {
    const layout = resolveRuntimeLayout(env, platform);
    try {
      const config = await readConfig(layout.configFile);
      if (config.gateway) gateways.push(await inspectRole("gateway", "default", layout, config));
      if (config.worker) workers.push(await inspectRole("worker", "default", layout, config));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      gateways.push({ name: "default", role: "gateway", ok: false, configFile: layout.configFile, error: message });
    }
  } else {
    for (const role of ["gateway", "worker"] as const) {
      const target = role === "gateway" ? gateways : workers;
      for (const name of await roleNames(role)) {
        const layout = resolveNamedLayout(role, name, env, platform);
        try {
          const config = await readConfig(layout.configFile);
          target.push(await inspectRole(role, name, layout, config));
        } catch (error) {
          target.push({ name, role, ok: false, configFile: layout.configFile, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  let extensions: unknown;
  let extensionsOk = false;
  try {
    extensions = await extensionDoctor(hubLocation);
    extensionsOk = Boolean((extensions as { ok?: unknown }).ok);
  } catch (error) {
    extensions = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const roleCount = gateways.length + workers.length;
  return {
    ok: roleCount > 0 && gateways.every((entry) => entry.ok) && workers.every((entry) => entry.ok) && extensionsOk,
    gateways,
    workers,
    extensions,
  };
}

export function doctorPaths(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): unknown {
  if (hasExplicitLayout(env)) return { mode: "explicit-layout", layout: resolveRuntimeLayout(env, platform) };
  return {
    mode: "named-roles",
    gateways: resolveNamedRoleConfigRoot("gateway", env, platform),
    workers: resolveNamedRoleConfigRoot("worker", env, platform),
    extensionHub: resolveExtensionHubRoot(env, platform),
  };
}
