import { readRuntimeConfigForRepair } from "@queqiao/config";
import { resolveRuntimeLayoutForNamedRole, type RuntimeRole } from "@queqiao/platform-paths";
import { listJoinedWorkers } from "./enrollment-cli.js";
import { runtimeStatus } from "./service-lifecycle.js";
import { doctorQueqiao, type QueqiaoDoctorResult } from "./doctor.js";
import { createWorkstationDiagnosticsViewModel, type WorkstationDiagnosticsViewModel } from "./workstation-diagnostics.js";
import type { WorkstationSnapshot } from "./workstation.js";

export type WorkstationInspectorTarget =
  | { kind: "gateway"; name: string }
  | { kind: "worker"; name: string }
  | { kind: "workspace"; workerName: string; workspaceId: string }
  | { kind: "profile"; name: string }
  | { kind: "extension"; extensionId: string }
  | { kind: "diagnostics" };

export type WorkstationRuntimeHealthViewModel = {
  reachable: boolean;
  healthy: boolean;
  identityMatches: boolean;
  status?: number;
  error?: string;
};

export type WorkstationRuntimeSection =
  | { state: "ready"; active: boolean; managed: boolean; pid?: number; health: WorkstationRuntimeHealthViewModel }
  | { state: "error"; message: string }
  | { state: "unavailable"; message: string };

export type WorkstationListSection<T> =
  | { state: "ready"; items: T[] }
  | { state: "error"; message: string }
  | { state: "unavailable"; message: string };

export type WorkstationGatewayMemberViewModel = {
  workerId: string;
  environmentId: string;
  endpoint?: string;
};

export type WorkstationGatewayRelationViewModel = {
  name: string;
  endpoint?: string;
};

export type WorkstationInspectorDetail =
  | {
      kind: "gateway";
      key: string;
      runtime: WorkstationRuntimeSection;
      workers: WorkstationListSection<WorkstationGatewayMemberViewModel>;
    }
  | {
      kind: "worker";
      key: string;
      runtime: WorkstationRuntimeSection;
      gateways: WorkstationListSection<WorkstationGatewayRelationViewModel>;
    }
  | {
      kind: "diagnostics";
      key: "diagnostics";
      diagnostics: WorkstationDiagnosticsViewModel;
    };

export type WorkstationGatewayInspectorViewModel = {
  kind: "gateway";
  key: string;
  title: string;
  running: boolean;
  managed: boolean;
  publicUrl?: string;
  servicePort?: number;
  managementPort?: number;
  workerSessionMode?: "local" | "remote";
  workerSessionTarget?: string;
  runtime: WorkstationRuntimeSection;
  workers: WorkstationListSection<WorkstationGatewayMemberViewModel>;
};

export type WorkstationWorkerInspectorViewModel = {
  kind: "worker";
  key: string;
  title: string;
  running: boolean;
  managed: boolean;
  endpoint?: string;
  reverseSessionTarget?: string;
  runtime: WorkstationRuntimeSection;
  workspaces: Array<{ id: string; displayName: string; root: string; profile: string }>;
  extensions: Array<{ extensionId: string; displayName: string; version: string }>;
  gateways: WorkstationListSection<WorkstationGatewayRelationViewModel>;
};

export type WorkstationWorkspaceInspectorViewModel = {
  kind: "workspace";
  key: string;
  title: string;
  workerName: string;
  workspaceId: string;
  root: string;
  profile: string;
  profileSemantics: "copy-on-apply";
};

export type WorkstationProfileInspectorViewModel = {
  kind: "profile";
  key: string;
  title: string;
  builtin: boolean;
  tools: string[];
  allowedExecutables: string[];
  templateSemantics: "detached";
};

export type WorkstationExtensionInspectorViewModel = {
  kind: "extension";
  key: string;
  title: string;
  extensionId: string;
  version: string;
  package: string;
  attachments: Array<{ workerName: string; attached: boolean }>;
};

export type WorkstationDiagnosticsInspectorViewModel = {
  kind: "diagnostics";
  key: "diagnostics";
  title: "System health";
  diagnostics?: WorkstationDiagnosticsViewModel;
};

export type WorkstationInspectorViewModel =
  | WorkstationGatewayInspectorViewModel
  | WorkstationWorkerInspectorViewModel
  | WorkstationWorkspaceInspectorViewModel
  | WorkstationProfileInspectorViewModel
  | WorkstationExtensionInspectorViewModel
  | WorkstationDiagnosticsInspectorViewModel;

type InspectorQueryDependencies = {
  runtimeStatus?: (role: RuntimeRole, name: string) => Promise<unknown>;
  gatewayMembers?: (gatewayName: string) => Promise<unknown>;
  workerIdentity?: (workerName: string) => Promise<{ workerId?: string; environmentId?: string }>;
  diagnostics?: () => Promise<QueqiaoDoctorResult>;
};

type RuntimeStatusCandidate = {
  active?: unknown;
  managed?: unknown;
  pid?: unknown;
  health?: {
    reachable?: unknown;
    healthy?: unknown;
    identityMatches?: unknown;
    status?: unknown;
    error?: unknown;
  };
};

export function inspectorTargetKey(target: WorkstationInspectorTarget): string {
  if (target.kind === "gateway") return `gateway:${target.name}`;
  if (target.kind === "worker") return `worker:${target.name}`;
  if (target.kind === "workspace") return `workspace:${target.workerName}:${target.workspaceId}`;
  if (target.kind === "profile") return `profile:${target.name}`;
  if (target.kind === "extension") return `extension:${target.extensionId}`;
  return "diagnostics";
}

export function inspectorTargetNeedsDetail(target: WorkstationInspectorTarget): target is Extract<WorkstationInspectorTarget, { kind: "gateway" | "worker" | "diagnostics" }> {
  return target.kind === "gateway" || target.kind === "worker" || target.kind === "diagnostics";
}

function unavailableRuntime(): WorkstationRuntimeSection {
  return { state: "unavailable", message: "Runtime detail has not been loaded." };
}

function unavailableRelationships(message: string): WorkstationListSection<never> {
  return { state: "unavailable", message };
}

function findGateway(snapshot: WorkstationSnapshot, name: string) {
  const gateway = snapshot.gateways.find((entry) => entry.name === name);
  if (!gateway) throw new Error(`Gateway ${name} is no longer available`);
  return gateway;
}

function findWorker(snapshot: WorkstationSnapshot, name: string) {
  const worker = snapshot.workers.find((entry) => entry.name === name);
  if (!worker) throw new Error(`Worker ${name} is no longer available`);
  return worker;
}

export function createWorkstationInspectorViewModel(
  snapshot: WorkstationSnapshot,
  target: WorkstationInspectorTarget,
  detail?: WorkstationInspectorDetail,
): WorkstationInspectorViewModel {
  const key = inspectorTargetKey(target);
  const matchingDetail = detail?.key === key ? detail : undefined;

  if (target.kind === "gateway") {
    const gateway = findGateway(snapshot, target.name);
    const dynamic = matchingDetail?.kind === "gateway" ? matchingDetail : undefined;
    return {
      kind: "gateway",
      key,
      title: gateway.name,
      running: gateway.running,
      managed: gateway.managed,
      ...(gateway.publicUrl ? { publicUrl: gateway.publicUrl } : {}),
      ...(gateway.servicePort ? { servicePort: gateway.servicePort } : {}),
      ...(gateway.managementPort ? { managementPort: gateway.managementPort } : {}),
      ...(gateway.workerSessionMode ? { workerSessionMode: gateway.workerSessionMode } : {}),
      ...(gateway.workerSessionTarget ? { workerSessionTarget: gateway.workerSessionTarget } : {}),
      runtime: dynamic?.runtime ?? unavailableRuntime(),
      workers: dynamic?.workers ?? unavailableRelationships("Worker membership has not been loaded."),
    };
  }

  if (target.kind === "worker") {
    const worker = findWorker(snapshot, target.name);
    const dynamic = matchingDetail?.kind === "worker" ? matchingDetail : undefined;
    return {
      kind: "worker",
      key,
      title: worker.name,
      running: worker.running,
      managed: worker.managed,
      ...(worker.endpoint ? { endpoint: worker.endpoint } : {}),
      ...(worker.reverseSessionTarget ? { reverseSessionTarget: worker.reverseSessionTarget } : {}),
      runtime: dynamic?.runtime ?? unavailableRuntime(),
      workspaces: snapshot.workspaces
        .filter((entry) => entry.workerName === worker.name)
        .map((entry) => ({ id: entry.id, displayName: entry.displayName, root: entry.root, profile: entry.profile })),
      extensions: snapshot.extensions
        .filter((extension) => extension.workers.some((entry) => entry.name === worker.name && entry.attached))
        .map((extension) => ({ extensionId: extension.id, displayName: extension.displayName, version: extension.version })),
      gateways: dynamic?.gateways ?? unavailableRelationships("Gateway enrollment has not been loaded."),
    };
  }

  if (target.kind === "workspace") {
    const workspace = snapshot.workspaces.find((entry) => entry.workerName === target.workerName && entry.id === target.workspaceId);
    if (!workspace) throw new Error(`Workspace ${target.workspaceId} is no longer available`);
    return {
      kind: "workspace",
      key,
      title: workspace.displayName,
      workerName: workspace.workerName,
      workspaceId: workspace.id,
      root: workspace.root,
      profile: workspace.profile,
      profileSemantics: "copy-on-apply",
    };
  }

  if (target.kind === "profile") {
    const profile = snapshot.profiles.find((entry) => entry.name === target.name);
    if (!profile) throw new Error(`Access Profile ${target.name} is no longer available`);
    return {
      kind: "profile",
      key,
      title: profile.name,
      builtin: profile.builtin,
      tools: [...profile.tools],
      allowedExecutables: [...profile.allowedExecutables],
      templateSemantics: "detached",
    };
  }

  if (target.kind === "extension") {
    const extension = snapshot.extensions.find((entry) => entry.id === target.extensionId);
    if (!extension) throw new Error(`Extension ${target.extensionId} is no longer available`);
    return {
      kind: "extension",
      key,
      title: extension.displayName,
      extensionId: extension.id,
      version: extension.version,
      package: extension.package,
      attachments: extension.workers.map((entry) => ({ workerName: entry.name, attached: entry.attached })),
    };
  }

  const diagnostics = matchingDetail?.kind === "diagnostics" ? matchingDetail.diagnostics : undefined;
  return { kind: "diagnostics", key: "diagnostics", title: "System health", ...(diagnostics ? { diagnostics } : {}) };
}

function normalizeRuntimeStatus(value: unknown): WorkstationRuntimeSection {
  if (!value || typeof value !== "object") throw new Error("Runtime status response is invalid");
  const candidate = value as RuntimeStatusCandidate;
  const health = candidate.health;
  if (
    typeof candidate.active !== "boolean"
    || typeof candidate.managed !== "boolean"
    || !health
    || typeof health.reachable !== "boolean"
    || typeof health.healthy !== "boolean"
    || typeof health.identityMatches !== "boolean"
  ) throw new Error("Runtime status response is invalid");
  return {
    state: "ready",
    active: candidate.active,
    managed: candidate.managed,
    ...(Number.isInteger(candidate.pid) && Number(candidate.pid) > 0 ? { pid: Number(candidate.pid) } : {}),
    health: {
      reachable: health.reachable,
      healthy: health.healthy,
      identityMatches: health.identityMatches,
      ...(Number.isInteger(health.status) ? { status: Number(health.status) } : {}),
      ...(typeof health.error === "string" && health.error ? { error: health.error } : {}),
    },
  };
}

function gatewayMemberInventory(value: unknown): WorkstationGatewayMemberViewModel[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { workers?: unknown };
  if (!Array.isArray(candidate.workers)) return [];
  return candidate.workers.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const worker = entry as { workerId?: unknown; environmentId?: unknown; transports?: Array<{ type?: unknown; endpoint?: unknown }>; transport?: { type?: unknown; endpoint?: unknown } };
    if (typeof worker.workerId !== "string" || typeof worker.environmentId !== "string") return [];
    const http = Array.isArray(worker.transports)
      ? worker.transports.find((transport) => transport?.type === "http" && typeof transport.endpoint === "string")
      : worker.transport?.type === "http" ? worker.transport : undefined;
    return [{
      workerId: worker.workerId,
      environmentId: worker.environmentId,
      ...(typeof http?.endpoint === "string" ? { endpoint: http.endpoint } : {}),
    }];
  });
}

async function defaultRuntimeStatus(role: RuntimeRole, name: string): Promise<unknown> {
  const layout = resolveRuntimeLayoutForNamedRole(role, name);
  return runtimeStatus(layout.configFile, layout, role, name);
}

async function defaultGatewayMembers(name: string): Promise<unknown> {
  const layout = resolveRuntimeLayoutForNamedRole("gateway", name);
  return listJoinedWorkers(layout.configFile);
}

async function defaultWorkerIdentity(name: string): Promise<{ workerId?: string; environmentId?: string }> {
  const layout = resolveRuntimeLayoutForNamedRole("worker", name);
  const config = await readRuntimeConfigForRepair(layout.configFile);
  if (!config.worker) return {};
  return {
    ...(typeof config.worker.workerId === "string" ? { workerId: config.worker.workerId } : {}),
    environmentId: config.worker.environmentId,
  };
}

async function loadRuntimeSection(
  role: RuntimeRole,
  name: string,
  query: (role: RuntimeRole, name: string) => Promise<unknown>,
): Promise<WorkstationRuntimeSection> {
  try {
    return normalizeRuntimeStatus(await query(role, name));
  } catch {
    return { state: "error", message: "Runtime status could not be loaded." };
  }
}

async function loadGatewayWorkers(
  name: string,
  query: (gatewayName: string) => Promise<unknown>,
): Promise<WorkstationListSection<WorkstationGatewayMemberViewModel>> {
  try {
    return { state: "ready", items: gatewayMemberInventory(await query(name)) };
  } catch {
    return { state: "error", message: "Gateway membership could not be loaded." };
  }
}

async function loadWorkerGateways(
  snapshot: WorkstationSnapshot,
  workerName: string,
  identityQuery: (workerName: string) => Promise<{ workerId?: string; environmentId?: string }>,
  membersQuery: (gatewayName: string) => Promise<unknown>,
): Promise<WorkstationListSection<WorkstationGatewayRelationViewModel>> {
  let identity: { workerId?: string; environmentId?: string };
  try {
    identity = await identityQuery(workerName);
  } catch {
    return { state: "error", message: "Worker identity could not be loaded." };
  }
  if (!identity.workerId || !identity.environmentId) {
    return { state: "unavailable", message: "Worker identity is unavailable; Gateway enrollment was not inferred." };
  }

  const runningGateways = snapshot.gateways.filter((gateway) => gateway.running);
  if (!runningGateways.length) {
    return { state: "unavailable", message: "No running local Gateway is available; enrollment was not inferred." };
  }

  try {
    const memberships = await Promise.all(runningGateways.map(async (gateway) => ({
      gateway,
      members: gatewayMemberInventory(await membersQuery(gateway.name)),
    })));
    const items = memberships.flatMap(({ gateway, members }) => {
      const matched = members.find((member) => member.workerId === identity.workerId && member.environmentId === identity.environmentId);
      return matched ? [{ name: gateway.name, ...(matched.endpoint ? { endpoint: matched.endpoint } : {}) }] : [];
    });
    return { state: "ready", items };
  } catch {
    return { state: "error", message: "Gateway enrollment could not be loaded." };
  }
}

export async function loadWorkstationInspectorDetail(
  snapshot: WorkstationSnapshot,
  target: WorkstationInspectorTarget,
  dependencies: InspectorQueryDependencies = {},
): Promise<WorkstationInspectorDetail> {
  const runtimeQuery = dependencies.runtimeStatus ?? defaultRuntimeStatus;
  const membersQuery = dependencies.gatewayMembers ?? defaultGatewayMembers;

  if (target.kind === "gateway") {
    const gateway = findGateway(snapshot, target.name);
    const runtime = await loadRuntimeSection("gateway", target.name, runtimeQuery);
    const workers = gateway.running
      ? await loadGatewayWorkers(target.name, membersQuery)
      : unavailableRelationships("Start the Gateway to inspect enrolled Workers.");
    return { kind: "gateway", key: inspectorTargetKey(target), runtime, workers };
  }

  if (target.kind === "worker") {
    findWorker(snapshot, target.name);
    const [runtime, gateways] = await Promise.all([
      loadRuntimeSection("worker", target.name, runtimeQuery),
      loadWorkerGateways(snapshot, target.name, dependencies.workerIdentity ?? defaultWorkerIdentity, membersQuery),
    ]);
    return { kind: "worker", key: inspectorTargetKey(target), runtime, gateways };
  }

  if (target.kind === "diagnostics") {
    const diagnostics = createWorkstationDiagnosticsViewModel(await (dependencies.diagnostics ?? doctorQueqiao)());
    return { kind: "diagnostics", key: "diagnostics", diagnostics };
  }

  throw new Error(`${target.kind} Inspector does not require lazy detail`);
}

export const workstationInspectorInternals = { normalizeRuntimeStatus, gatewayMemberInventory };
