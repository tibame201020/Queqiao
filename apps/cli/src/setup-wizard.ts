import { access, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";
import { readRuntimeConfig } from "@queqiao/config";
import {
  resolveNamedRoleConfigRoot,
  resolveRuntimeLayoutForNamedRole,
  type RuntimeRole,
} from "@queqiao/platform-paths";
import { setupGateway as setupGatewayPrimitive, setupWorker as setupWorkerPrimitive } from "./enrollment-cli.js";

const CREATE_NEW = "__create__";
const DIM = "\x1b[2m";
const RESET_DIM = "\x1b[22m";

export type RoleSetupPrompts = {
  choose: (message: string, options: Array<{ value: string; label: string }>) => Promise<string>;
  text: (
    message: string,
    initialValue?: string,
    validate?: (value: string) => string | undefined,
  ) => Promise<string>;
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
  portAvailable?: (port: number) => Promise<boolean>;
};

function hint(label: string, description: string): string {
  return `${label} ${DIM}${description}${RESET_DIM}`;
}

function validateName(value: string): string | undefined {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.trim().toLowerCase())
    ? undefined
    : "Name must match /^[a-z0-9][a-z0-9_-]{0,63}$/";
}

function validatePort(value: string, label: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? undefined
    : `${label} must be an integer from 1 to 65535`;
}

async function defaultPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

type PortReservation = { port: number; owner: string };

async function configuredPortReservations(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  selectedRole: RuntimeRole,
  selectedName: string,
): Promise<PortReservation[]> {
  const reservations: PortReservation[] = [];
  for (const role of ["gateway", "worker"] as const) {
    for (const instanceName of await listNamedRoleInstances(role, env, platform)) {
      if (role === selectedRole && instanceName === selectedName) continue;
      const layout = resolveRuntimeLayoutForNamedRole(role, instanceName, env, platform);
      let runtime;
      try {
        runtime = await readRuntimeConfig(layout.configFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (role === "gateway" && runtime.gateway) {
        reservations.push({ port: runtime.gateway.listen.port, owner: `Gateway ${instanceName}` });
        reservations.push({ port: runtime.gateway.managementListen.port, owner: `Gateway ${instanceName}` });
      }
      if (role === "worker" && runtime.worker) {
        reservations.push({ port: runtime.worker.listen.port, owner: `Worker ${instanceName}` });
      }
    }
  }
  return reservations;
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

function stripOption(args: string[], name: string): string[] {
  const flag = `--${name}`;
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      index += 1;
      continue;
    }
    result.push(args[index]!);
  }
  return result;
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
  const portAvailable = dependencies.portAvailable ?? defaultPortAvailable;
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
  let current: Awaited<ReturnType<typeof readRuntimeConfig>> | undefined;
  try {
    current = await readRuntimeConfig(layout.configFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const reservedPorts = await configuredPortReservations(env, platform, role, name);
  const reservedBy = (port: number) => reservedPorts.find((entry) => entry.port === port)?.owner;

  let setupArgs = stripOption(stripOption(stripOption(stripOption(args, "public-base-url"), "port"), "management-port"), "environment-id");
  let result: unknown;

  if (role === "gateway") {
    const publicBaseUrl = await prompts.text("Public Gateway URL", current?.gateway?.publicBaseUrl);
    if (!publicBaseUrl.trim()) throw new Error("Public Gateway URL is required");
    try {
      const parsed = new URL(publicBaseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Public Gateway URL must use http or https");
    } catch (error) {
      if (error instanceof Error && error.message === "Public Gateway URL must use http or https") throw error;
      throw new Error("Enter a valid Public Gateway URL");
    }

    const currentGatewayPort = current?.gateway?.listen.port;
    const gatewayPortText = await prompts.text(
      hint("Gateway port", "Local port behind the public Gateway URL."),
      String(currentGatewayPort ?? 7575),
      (value) => validatePort(value, "Gateway port"),
    );
    const gatewayPort = Number(gatewayPortText);
    const gatewayPortOwner = reservedBy(gatewayPort);
    if (gatewayPortOwner) throw new Error(`Gateway port ${gatewayPort} is reserved by ${gatewayPortOwner}`);
    if (currentGatewayPort !== gatewayPort && !await portAvailable(gatewayPort)) {
      throw new Error(`Gateway port ${gatewayPort} is already in use`);
    }

    const currentManagementPort = current?.gateway?.managementListen.port;
    const managementPortText = await prompts.text(
      hint("Management port", "Local-only port for Gateway management."),
      String(currentManagementPort ?? 7574),
      (value) => {
        const error = validatePort(value, "Management port");
        if (error) return error;
        return Number(value) === gatewayPort ? "Gateway port and Management port must be different" : undefined;
      },
    );
    const managementPort = Number(managementPortText);
    const managementPortOwner = reservedBy(managementPort);
    if (managementPortOwner) throw new Error(`Management port ${managementPort} is reserved by ${managementPortOwner}`);
    if (currentManagementPort !== managementPort && !await portAvailable(managementPort)) {
      throw new Error(`Management port ${managementPort} is already in use`);
    }

    setupArgs = [
      ...setupArgs,
      "--public-base-url", publicBaseUrl,
      "--port", String(gatewayPort),
      "--management-port", String(managementPort),
    ];
    const primitive = dependencies.setupGateway ?? setupGatewayPrimitive;
    result = await primitive(layout.configFile, setupArgs, layout.gatewayStateDir, layout.secretsDir);
  } else {
    const currentWorkerPort = current?.worker?.listen.port;
    const workerPortText = await prompts.text(
      hint("Worker port", "Local port used by the Worker runtime."),
      String(currentWorkerPort ?? 7576),
      (value) => validatePort(value, "Worker port"),
    );
    const workerPort = Number(workerPortText);
    const workerPortOwner = reservedBy(workerPort);
    if (workerPortOwner) throw new Error(`Worker port ${workerPort} is reserved by ${workerPortOwner}`);
    if (currentWorkerPort !== workerPort && !await portAvailable(workerPort)) {
      throw new Error(`Worker port ${workerPort} is already in use`);
    }
    setupArgs = [...setupArgs, "--port", workerPortText];
    const primitive = dependencies.setupWorker ?? setupWorkerPrimitive;
    result = await primitive(layout.configFile, setupArgs, layout.secretsDir);
  }

  if (!injectedPrompts) outro(`${roleLabel} ${creating ? "created" : "updated"}: ${name}`);
  return { ...(typeof result === "object" && result ? result : { result }), name, mode: creating ? "create" : "edit" };
}
