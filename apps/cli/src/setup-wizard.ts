import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { hostname as systemHostname, networkInterfaces as systemNetworkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { cancel, intro, isCancel, outro } from "@clack/prompts";
import { readRuntimeConfig, readRuntimeConfigForRepair } from "@queqiao/config";
import {
  resolveNamedRoleConfigRoot,
  resolveRuntimeLayoutForNamedRole,
  type RuntimeRole,
} from "@queqiao/platform-paths";
import { changeWorkerMembershipProtocols, describeGatewayProtocolOffer, inspectWorkerMembershipProtocols, reconcileWorkerMembershipProtocols, setupGateway as setupGatewayPrimitive, setupWorker as setupWorkerPrimitive, type WorkerSetupOptions } from "./enrollment-cli.js";
import { accessConfigurationToWorkspacePolicy } from "./access-configuration.js";
import { collectAccessConfiguration, type AccessConfigurationPrompts } from "./access-configuration-flow.js";
import { createAccessConfigurationPrompts } from "./access-configuration-prompts.js";
import { AccessProfileStore, resolveAccessProfileFile } from "./access-profile-store.js";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";
import { workspacePath } from "./workspace-path-prompt.js";
import { suggestedWorkspaceId, workspaceConfigFromAnswers, type WorkspaceProfile } from "./workspace-cli.js";
import { createQueqiaoTheme } from "./tui-theme.js";
import { queqiaoMultiselect } from "./tui-multiselect.js";

const CREATE_NEW = "__create__";

export type RoleSetupPrompts = AccessConfigurationPrompts & {
  protocols?: (message: string, choices: Array<{ value: string; label: string; description?: string; disabled?: boolean }>, initialValues: string[]) => Promise<string[]>;
};

type SetupGatewayFn = typeof setupGatewayPrimitive;
type SetupWorkerFn = typeof setupWorkerPrimitive;

export type WorkerSessionHostCandidate = {
  value: string;
  label: string;
  description: string;
};

type RoleSetupDependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactive?: boolean;
  prompts?: RoleSetupPrompts;
  setupGateway?: SetupGatewayFn;
  setupWorker?: SetupWorkerFn;
  inspectWorkerProtocols?: typeof inspectWorkerMembershipProtocols;
  reconcileWorkerProtocols?: typeof reconcileWorkerMembershipProtocols;
  changeWorkerProtocols?: typeof changeWorkerMembershipProtocols;
  portAvailable?: (port: number) => Promise<boolean>;
  workerSessionHostCandidates?: () => WorkerSessionHostCandidate[];
};

const CUSTOM_WORKER_SESSION_HOST = "__custom_worker_session_host__";

function workerSessionInterfaceRank(name: string): number {
  if (/vethernet|wsl|docker|hyper-v|vmware|virtualbox|loopback/i.test(name)) return 80;
  if (/wi-?fi|wireless|wlan/i.test(name)) return 10;
  if (/ethernet|\beth\d*\b/i.test(name)) return 20;
  if (/tailscale/i.test(name)) return 30;
  if (/vpn|wireguard|zerotier/i.test(name)) return 40;
  return 50;
}

function usableWorkerSessionAddress(entry: NetworkInterfaceInfo): boolean {
  const family = String(entry.family);
  if (entry.internal || (family !== "IPv4" && family !== "4")) return false;
  if (entry.address.startsWith("169.254.") || entry.address === "0.0.0.0") return false;
  return true;
}

export function discoverWorkerSessionHostCandidates(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = systemNetworkInterfaces(),
  hostName: string = systemHostname(),
): WorkerSessionHostCandidate[] {
  const candidates: Array<WorkerSessionHostCandidate & { rank: number; interfaceName: string }> = [];
  const seen = new Set<string>();
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!usableWorkerSessionAddress(entry) || seen.has(entry.address)) continue;
      seen.add(entry.address);
      const rank = workerSessionInterfaceRank(interfaceName);
      const virtual = rank >= 80;
      candidates.push({
        value: entry.address,
        label: entry.address,
        description: `${interfaceName} · detected${virtual ? " · virtual interface" : ""}`,
        rank,
        interfaceName,
      });
    }
  }
  candidates.sort((left, right) => left.rank - right.rank || left.interfaceName.localeCompare(right.interfaceName) || left.value.localeCompare(right.value));
  const result: WorkerSessionHostCandidate[] = candidates.map(({ rank: _rank, interfaceName: _interfaceName, ...candidate }) => candidate);
  const normalizedHostname = hostName.trim();
  if (normalizedHostname && !seen.has(normalizedHostname)) {
    result.push({
      value: normalizedHostname,
      label: normalizedHostname,
      description: "Hostname · detected · requires name resolution from the Worker",
    });
  }
  return result;
}

function hint(label: string, description: string): string {
  return `${label} ${createQueqiaoTheme().muted(description)}`;
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

  const configuration = await collectAccessConfiguration(prompts, profileStore);
  const policy = accessConfigurationToWorkspacePolicy(configuration);
  return {
    ...workspaceConfigFromAnswers({ root, displayName, profile: policy.profile as WorkspaceProfile }),
    ...policy,
  };
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
        if (runtime.gateway.workerSessionListen) reservations.push({ port: runtime.gateway.workerSessionListen.port, owner: `Gateway ${instanceName} Worker session` });
      }
      if (role === "worker" && runtime.worker) {
        reservations.push({ port: runtime.worker.listen.port, owner: `Worker ${instanceName}` });
      }
    }
  }
  return reservations;
}

function defaultPrompts(role: RuntimeRole, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): RoleSetupPrompts {
  const access = createAccessConfigurationPrompts({
    cancelMessage: `${role === "gateway" ? "Gateway" : "Worker"} setup cancelled`,
    env,
    platform,
  });
  return {
    ...access,
    protocols: async (message, choices, initialValues) => {
      const value = await queqiaoMultiselect({ message, choices, initialValues, required: true, validate: (selected) => selected?.length ? undefined : "Please select at least one protocol.", summary: (selected) => selected.join(", ") });
      if (isCancel(value)) { cancel("Worker setup cancelled"); throw new Error("Worker setup cancelled"); }
      return value.map(String);
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
    throw new Error("--name is not supported for setup. Choose the instance in the setup flow.");
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

  if (!injectedPrompts) intro(`${roleLabel} Setup`);
  const selected = await prompts.choose(roleLabel, [
    ...existing.map((name) => ({ value: name, label: name })),
    { value: CREATE_NEW, label: `New ${roleLabel}` },
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

  let setupArgs = stripOption(stripOption(stripOption(stripOption(stripOption(stripOption(stripOption(args, "public-base-url"), "port"), "management-port"), "worker-session-mode"), "worker-session-host"), "worker-session-port"), "environment-id");
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

    const currentRemote = current?.gateway?.workerSessionListen?.host === "0.0.0.0";
    const localExposure = { value: "local", label: "This machine only", description: "Keep the gRPC Worker-session listener on loopback. Worker protocols are selected per membership." };
    const remoteExposure = { value: "remote", label: "Network-accessible", description: "Expose a TLS gRPC Worker-session listener for remote Workers. Worker protocols are selected per membership." };
    const workerConnectivity = (await prompts.choose("Worker session exposure", currentRemote
      ? [remoteExposure, localExposure]
      : [localExposure, remoteExposure])) || (currentRemote ? "remote" : "local");

    setupArgs = [
      ...setupArgs,
      "--public-base-url", publicBaseUrl,
      "--port", String(gatewayPort),
      "--management-port", String(managementPort),
      "--worker-session-mode", workerConnectivity,
    ];
    if (workerConnectivity === "remote") {
      const detectedHosts = (dependencies.workerSessionHostCandidates ?? discoverWorkerSessionHostCandidates)();
      const currentWorkerSessionHost = current?.gateway?.workerSessionAdvertiseHost?.trim();
      const hostChoices: WorkerSessionHostCandidate[] = [
        ...(currentWorkerSessionHost ? [{ value: currentWorkerSessionHost, label: currentWorkerSessionHost, description: "Current configuration" }] : []),
        ...detectedHosts.filter((candidate) => candidate.value !== currentWorkerSessionHost),
      ];
      const selectedWorkerSessionHost = await prompts.choose(
        hint("Worker session host", "Address remote Workers use to reach this Gateway."),
        [
          ...hostChoices,
          { value: CUSTOM_WORKER_SESSION_HOST, label: "Custom DNS name or IP", description: "Enter another reachable address" },
        ],
      );
      const workerSessionHost = selectedWorkerSessionHost === CUSTOM_WORKER_SESSION_HOST
        ? (await prompts.text(
          hint("Custom Worker session host", "DNS name or IP address reachable from remote Workers."),
          currentWorkerSessionHost,
          (value) => {
            const host = value.trim();
            if (!host) return "Worker session host is required";
            return host.includes("://") || host.includes("/") || /\s/.test(host) ? "Enter a DNS name or IP address without a scheme or path" : undefined;
          },
        )).trim()
        : selectedWorkerSessionHost.trim();
      if (!workerSessionHost) throw new Error("Worker session host is required");
      const currentWorkerSessionPort = current?.gateway?.workerSessionListen?.port;
      const workerSessionPortText = await prompts.text(
        hint("Worker session port", "TLS gRPC port for remote Worker sessions."),
        String(currentWorkerSessionPort ?? gatewayPort - 2),
        (value) => {
          const error = validatePort(value, "Worker session port");
          if (error) return error;
          const port = Number(value);
          return port === gatewayPort || port === managementPort ? "Worker session port must differ from Gateway and Management ports" : undefined;
        },
      );
      const workerSessionPort = Number(workerSessionPortText);
      const workerSessionPortOwner = reservedBy(workerSessionPort);
      if (workerSessionPortOwner) throw new Error(`Worker session port ${workerSessionPort} is reserved by ${workerSessionPortOwner}`);
      if (currentWorkerSessionPort !== workerSessionPort && !await portAvailable(workerSessionPort)) throw new Error(`Worker session port ${workerSessionPort} is already in use`);
      setupArgs.push("--worker-session-host", workerSessionHost, "--worker-session-port", workerSessionPortText);
    }
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
    setupArgs = [...setupArgs, "--port", workerPortText, ...(creating ? ["--environment-id", name] : [])];
    const setupOptions: WorkerSetupOptions = {};
    const configuredWorkspaces = current?.workspaces || [];
    if (creating || !configuredWorkspaces.length) {
      setupOptions.initialWorkspace = await collectInitialWorkspace(prompts, Boolean(injectedPrompts), accessProfileStore);
    }
    const primitive = dependencies.setupWorker ?? setupWorkerPrimitive;
    result = await primitive(layout.configFile, setupArgs, layout.secretsDir, undefined, setupOptions);
    if (!creating && current?.worker?.memberships?.length) {
      for (const membership of current.worker.memberships) {
        await (dependencies.reconcileWorkerProtocols ?? reconcileWorkerMembershipProtocols)(layout.configFile, membership.gateway);
        if (currentWorkerPort !== workerPort) continue;
        const state = await (dependencies.inspectWorkerProtocols ?? inspectWorkerMembershipProtocols)(layout.configFile, membership.gateway);
        const choices = state.offers.map((offer) => ({
          value: offer.type,
          label: offer.type === "grpc" ? "gRPC" : "HTTP",
          description: describeGatewayProtocolOffer(offer),
          disabled: !offer.capable,
        }));
        const protocolPrompt = prompts.protocols;
        if (!protocolPrompt) continue;
        const selectedProtocols = await protocolPrompt(`Protocols - ${new URL(membership.gateway).host}`, choices, state.enabled);
        const before = [...state.enabled].sort().join(",");
        const after = [...selectedProtocols].sort().join(",");
        if (before !== after) await (dependencies.changeWorkerProtocols ?? changeWorkerMembershipProtocols)(layout.configFile, membership.gateway, selectedProtocols);
      }
    }
  }

  if (!injectedPrompts) outro(`${roleLabel} ${creating ? "created" : "updated"}: ${name}`);
  return { ...(typeof result === "object" && result ? result : { result }), name, mode: creating ? "create" : "edit" };
}
