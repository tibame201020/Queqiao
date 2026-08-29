import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";
import { readRuntimeConfig, readRuntimeConfigForRepair } from "@queqiao/config";
import {
  resolveNamedRoleConfigRoot,
  resolveRuntimeLayoutForNamedRole,
  type RuntimeRole,
} from "@queqiao/platform-paths";
import { setupGateway as setupGatewayPrimitive, setupWorker as setupWorkerPrimitive, type WorkerSetupOptions } from "./enrollment-cli.js";
import { ACCESS_TOOL_OPTIONS, BUILTIN_ACCESS_PROFILES, DEFAULT_ACCESS_TOOLS, accessConfigurationToWorkspacePolicy, formatBuiltinAccessProfileLabel, normalizeAllowedExecutables, type AccessConfiguration, type AccessToolOption } from "./access-configuration.js";
import { accessToolMultiselect } from "./access-tool-prompt.js";
import { AccessProfileStore, resolveAccessProfileFile } from "./access-profile-store.js";
import { historyAwareTextInput, readAllowedExecutableHistory, recordAllowedExecutableHistory, resolveCommandHistoryFile } from "./command-history-input.js";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";
import { workspacePath } from "./workspace-path-prompt.js";
import { suggestedWorkspaceId, workspaceConfigFromAnswers, type WorkspaceProfile } from "./workspace-cli.js";

const CREATE_NEW = "__create__";
const CUSTOM_ACCESS = "__custom_access__";
const DIM = "\x1b[2m";
const RESET_DIM = "\x1b[22m";

export type RoleSetupPrompts = {
  choose: (message: string, options: Array<{ value: string; label: string }>) => Promise<string>;
  multi: (message: string, options: AccessToolOption[], initialValues: Array<AccessToolOption["value"]>) => Promise<string[]>;
  commandText: (message: string) => Promise<string>;
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

async function collectInitialWorkspace(prompts: RoleSetupPrompts, injected: boolean, profileStore: AccessProfileStore) {
  let rootInput: string;
  if (injected) {
    rootInput = await prompts.text(hint("Initial Workspace", "Directory this Worker is authorized to access."), process.cwd());
  } else {
    const selected = await workspacePath(process.cwd());
    if (isCancel(selected)) {
      cancel("Worker setup cancelled");
      throw new Error("Worker setup cancelled");
    }
    rootInput = String(selected || process.cwd());
  }
  const root = await resolveWorkspaceAuthorityRoot(rootInput);
  const suggestedName = path.basename(root) || suggestedWorkspaceId(root);
  const displayName = await prompts.text("Display name", suggestedName);

  const profiles = await profileStore.list();
  const selectedProfile = await prompts.choose("Access profile", [
    ...BUILTIN_ACCESS_PROFILES.map((profile) => ({ value: `builtin:${profile.id}`, label: formatBuiltinAccessProfileLabel(profile) })),
    ...profiles.map((profile, index) => ({ value: `profile:${index}`, label: profile.name })),
    { value: CUSTOM_ACCESS, label: "Custom" },
  ]);

  let configuration: AccessConfiguration;
  const builtin = BUILTIN_ACCESS_PROFILES.find((profile) => selectedProfile === `builtin:${profile.id}`);
  if (builtin) {
    configuration = {
      tools: [...builtin.configuration.tools],
      allowedExecutables: [...builtin.configuration.allowedExecutables],
    };
  } else {
    const profileIndex = selectedProfile.startsWith("profile:") ? Number(selectedProfile.slice("profile:".length)) : -1;
    const profile = Number.isInteger(profileIndex) ? profiles[profileIndex] : undefined;
    if (profile) {
      configuration = { tools: profile.tools, allowedExecutables: profile.allowedExecutables };
    } else {
      configuration = await collectCustomAccessConfiguration(prompts);
      await maybeSaveAccessProfile(prompts, profileStore, configuration);
    }
  }

  const policy = accessConfigurationToWorkspacePolicy(configuration);
  return {
    ...workspaceConfigFromAnswers({ root, displayName, profile: policy.profile as WorkspaceProfile }),
    ...policy,
  };
}

async function collectCustomAccessConfiguration(prompts: RoleSetupPrompts): Promise<AccessConfiguration> {
  const selectedTools = await prompts.multi(
    "Tools",
    ACCESS_TOOL_OPTIONS.map((option) => ({ ...option })),
    [...DEFAULT_ACCESS_TOOLS],
  );
  const allowedExecutables = selectedTools.includes("run")
    ? normalizeAllowedExecutables(await prompts.commandText("Allowed executables"))
    : [];
  return {
    tools: selectedTools as AccessConfiguration["tools"],
    allowedExecutables,
  };
}

async function maybeSaveAccessProfile(prompts: RoleSetupPrompts, profileStore: AccessProfileStore, configuration: AccessConfiguration): Promise<void> {
  const save = await prompts.choose("Save this access configuration as a profile?", [
    { value: "no", label: "No" },
    { value: "yes", label: "Yes" },
  ]);
  if (save !== "yes") return;
  const name = await prompts.text("Profile name");
  await profileStore.save({ name, tools: [...configuration.tools], allowedExecutables: [...configuration.allowedExecutables] });
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
        runtime = await readRuntimeConfigForRepair(layout.configFile);
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

function defaultPrompts(role: RuntimeRole, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): RoleSetupPrompts {
  const commandHistoryFile = resolveCommandHistoryFile(env, platform);
  return {
    choose: async (message, options) => {
      const value = await select({ message, options });
      if (isCancel(value)) {
        cancel(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
        throw new Error(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
      }
      return String(value);
    },
    multi: async (_message, options, initialValues) => {
      const value = await accessToolMultiselect(options, initialValues);
      if (isCancel(value)) {
        cancel(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
        throw new Error(`${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`);
      }
      return value.map(String);
    },
    commandText: async (message) => {
      const history = await readAllowedExecutableHistory(commandHistoryFile);
      const value = await historyAwareTextInput(message, history);
      if (value) await recordAllowedExecutableHistory(commandHistoryFile, value);
      return value;
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
  const prompts = injectedPrompts ?? defaultPrompts(role, env, platform);
  const accessProfileStore = new AccessProfileStore(resolveAccessProfileFile(env, platform));
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
  let current: Awaited<ReturnType<typeof readRuntimeConfigForRepair>> | undefined;
  try {
    current = await readRuntimeConfigForRepair(layout.configFile);
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
    const setupOptions: WorkerSetupOptions = {};
    const configuredWorkspaces = current?.workspaces || [];
    if (creating || !configuredWorkspaces.length) {
      setupOptions.initialWorkspace = await collectInitialWorkspace(prompts, Boolean(injectedPrompts), accessProfileStore);
    }
    const primitive = dependencies.setupWorker ?? setupWorkerPrimitive;
    result = await primitive(layout.configFile, setupArgs, layout.secretsDir, undefined, setupOptions);
  }

  if (!injectedPrompts) outro(`${roleLabel} ${creating ? "created" : "updated"}: ${name}`);
  return { ...(typeof result === "object" && result ? result : { result }), name, mode: creating ? "create" : "edit" };
}
