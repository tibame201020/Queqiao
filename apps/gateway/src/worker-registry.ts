import { WorkerClient, type WorkerClientConfig } from "./worker-client.js";
import { QueqiaoError } from "./errors.js";
import { isRegisteredWorkerTransportType, workerTransportProjection, type WorkerTransportTraits } from "./worker-transport.js";

export type WorkerTransportType = string;
export type WorkspaceTransportState = {
  type: WorkerTransportType;
  status: "healthy" | "unhealthy" | "unknown";
  mode: "direct" | "reverse";
  traits: WorkerTransportTraits;
};
export type WorkerRoutingReceipt = {
  environmentId: string;
  requestedTransport: WorkerTransportType | null;
  selectedTransport: WorkerTransportType;
  selectionReason: "explicit" | "health_preferred" | "configured_order";
};
export type WorkerRouteSelection = { client: WorkerClient; routing: WorkerRoutingReceipt };
export type RoutedWorkerResult<T> = { value: T; routing: WorkerRoutingReceipt };
export type WorkspaceRoutingState = { defaultTransport: WorkerTransportType; selectionReason: "health_preferred" | "configured_order" };
export type WorkspaceRoute = { environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] }; online: true; transports: WorkspaceTransportState[]; routing: WorkspaceRoutingState };
export type EnvironmentState = { environmentId: string; online: boolean; workspaces: WorkspaceRoute[] };
export type WorkerLivenessState = { environmentId: string; reachable: boolean; checkedAt?: string; lastSuccessAt?: string };

type ReachabilityRecord = { reachable?: boolean; checkedAt?: string; lastSuccessAt?: string };
type WorkerRouteGroup = { environmentId: string; workerId?: string; clients: Map<WorkerTransportType, WorkerClient>; order: WorkerTransportType[] };

export class WorkerRegistry {
  private readonly routes: WorkerRouteGroup[] = [];
  private readonly reachability = new Map<string, ReachabilityRecord>();

  constructor(configs: readonly WorkerClientConfig[]) {
    const byEnvironment = new Map<string, WorkerRouteGroup>();
    for (const config of configs) {
      let route = byEnvironment.get(config.environmentId);
      if (!route) {
        route = { environmentId: config.environmentId, ...(config.workerId ? { workerId: config.workerId } : {}), clients: new Map(), order: [] };
        byEnvironment.set(config.environmentId, route);
        this.routes.push(route);
      }
      if (route.workerId && config.workerId && route.workerId !== config.workerId) throw new Error(`Conflicting workerId for environment: ${config.environmentId}`);
      if (route.clients.has(config.transport.type)) throw new Error(`Duplicate Worker transport ${config.transport.type} for environment: ${config.environmentId}`);
      const type = config.transport.type;
      const client = new WorkerClient(config, config.runtimeTransport, (reachable) => this.recordReachability(config.environmentId, type, reachable));
      route.clients.set(type, client);
      route.order.push(type);
      this.reachability.set(this.transportKey(config.environmentId, type), {});
    }
  }

  private transportKey(environmentId: string, type: WorkerTransportType): string { return `${environmentId}:${type}`; }

  private recordReachability(environmentId: string, type: WorkerTransportType, reachable: boolean): void {
    const now = new Date().toISOString();
    const key = this.transportKey(environmentId, type);
    const previous = this.reachability.get(key);
    this.reachability.set(key, { reachable, checkedAt: now, ...(reachable ? { lastSuccessAt: now } : previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}) });
  }

  private transportRank(route: WorkerRouteGroup, type: WorkerTransportType): number {
    const state = this.reachability.get(this.transportKey(route.environmentId, type))?.reachable;
    return state === true ? 0 : state === undefined ? 1 : 2;
  }

  private orderedTypes(route: WorkerRouteGroup): WorkerTransportType[] {
    return [...route.order].sort((a, b) => this.transportRank(route, a) - this.transportRank(route, b));
  }

  private transportStates(route: WorkerRouteGroup): WorkspaceTransportState[] {
    return route.order.map((type) => {
      const client = route.clients.get(type)!;
      const reachable = this.reachability.get(this.transportKey(route.environmentId, type))?.reachable;
      return {
        type,
        status: reachable === true ? "healthy" : reachable === false ? "unhealthy" : "unknown",
        ...workerTransportProjection(client.transportDescriptor),
      };
    });
  }

  private candidates(route: WorkerRouteGroup, preferred?: WorkerTransportType): WorkerClient[] {
    if (preferred) {
      if (!isRegisteredWorkerTransportType(preferred)) throw new QueqiaoError("transport_unknown", `Worker transport is not supported by this Gateway: ${preferred}`);
      const client = route.clients.get(preferred);
      if (!client) throw new QueqiaoError("transport_not_enabled", `Worker transport is not enabled for ${route.environmentId}: ${preferred}`);
      return [client];
    }
    return this.orderedTypes(route).map((type) => route.clients.get(type)!);
  }

  private selectRoute(route: WorkerRouteGroup, preferred?: WorkerTransportType): WorkerRouteSelection {
    if (preferred) {
      if (!isRegisteredWorkerTransportType(preferred)) throw new QueqiaoError("transport_unknown", `Worker transport is not supported by this Gateway: ${preferred}`);
      const client = route.clients.get(preferred);
      if (!client) throw new QueqiaoError("transport_not_enabled", `Worker transport is not enabled for ${route.environmentId}: ${preferred}`);
      return {
        client,
        routing: { environmentId: route.environmentId, requestedTransport: preferred, selectedTransport: preferred, selectionReason: "explicit" },
      };
    }

    const ordered = this.orderedTypes(route);
    const selectedTransport = ordered[0];
    if (!selectedTransport) throw new QueqiaoError("worker_unavailable", `Worker has no enabled transport: ${route.environmentId}`, "gateway", true);
    const selectedRank = this.transportRank(route, selectedTransport);
    const allTied = route.order.every((type) => this.transportRank(route, type) === selectedRank);
    return {
      client: route.clients.get(selectedTransport)!,
      routing: {
        environmentId: route.environmentId,
        requestedTransport: null,
        selectedTransport,
        selectionReason: allTied ? "configured_order" : "health_preferred",
      },
    };
  }

  private routingState(route: WorkerRouteGroup): WorkspaceRoutingState {
    const { routing } = this.selectRoute(route);
    return { defaultTransport: routing.selectedTransport, selectionReason: routing.selectionReason as WorkspaceRoutingState["selectionReason"] };
  }

  private async listRouteWorkspaces(route: WorkerRouteGroup, preferred?: WorkerTransportType) {
    let lastError: unknown;
    for (const client of this.candidates(route, preferred)) {
      try {
        const state = await client.listWorkspaces();
        if (state.environmentId !== route.environmentId) throw new Error("Worker identity mismatch");
        return state;
      } catch (error) {
        lastError = error;
        if (preferred) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Worker is unavailable: ${route.environmentId}`);
  }

  configuredEnvironmentIds(): string[] { return this.routes.map((route) => route.environmentId); }

  livenessSnapshot(): WorkerLivenessState[] {
    return this.routes.map((route) => {
      const records = route.order.map((type) => this.reachability.get(this.transportKey(route.environmentId, type)) ?? {});
      const reachable = records.some((record) => record.reachable === true);
      const checkedAt = records.map((record) => record.checkedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
      const lastSuccessAt = records.map((record) => record.lastSuccessAt).filter((value): value is string => Boolean(value)).sort().at(-1);
      return { environmentId: route.environmentId, reachable, ...(checkedAt ? { checkedAt } : {}), ...(lastSuccessAt ? { lastSuccessAt } : {}) };
    });
  }

  async probeLiveness(): Promise<WorkerLivenessState[]> {
    await Promise.all(this.routes.flatMap((route) => [...route.clients.values()].map((client) => client.probeLiveness())));
    return this.livenessSnapshot();
  }

  async listEnvironments(): Promise<EnvironmentState[]> {
    return Promise.all(this.routes.map(async (route) => {
      try {
        const state = await this.listRouteWorkspaces(route);
        const transports = this.transportStates(route);
        const routing = this.routingState(route);
        return { environmentId: route.environmentId, online: true, workspaces: state.workspaces.map((workspace) => ({ ...workspace, online: true as const, transports, routing })) };
      } catch { return { environmentId: route.environmentId, online: false, workspaces: [] }; }
    }));
  }

  async listWorkspaces() { const environments = await this.listEnvironments(); return { environments, workspaces: environments.flatMap((environment) => environment.workspaces) }; }

  async implicitRoute(): Promise<{ worker: WorkerClient; workspaceId: string }> {
    const matches: Array<{ worker: WorkerClient; workspaceId: string }> = [];
    for (const route of this.routes) {
      try {
        const state = await this.listRouteWorkspaces(route);
        const worker = this.candidates(route)[0]!;
        for (const workspace of state.workspaces) matches.push({ worker, workspaceId: workspace.workspaceId });
      } catch { /* advisory discovery */ }
    }
    if (!matches.length) throw new QueqiaoError("worker_unavailable", "No Queqiao Workspace is online", "gateway", true);
    if (matches.length > 1) throw new QueqiaoError("workspace_required", "workspaceId is required when more than one Workspace is available");
    return matches[0]!;
  }

  private async owner(workspaceId: string): Promise<WorkerRouteGroup> {
    const matches: WorkerRouteGroup[] = [];
    for (const route of this.routes) {
      try { const state = await this.listRouteWorkspaces(route); if (state.workspaces.some((workspace) => workspace.workspaceId === workspaceId)) matches.push(route); } catch { /* advisory discovery */ }
    }
    if (!matches.length) throw new QueqiaoError("workspace_not_found", `Workspace is not available: ${workspaceId}`);
    if (matches.length > 1) throw new QueqiaoError("workspace_ambiguous", `Workspace ID is ambiguous across environments: ${workspaceId}`);
    return matches[0]!;
  }

  async route(workspaceId: string, transport?: WorkerTransportType): Promise<WorkerRouteSelection> {
    const route = await this.owner(workspaceId);
    return this.selectRoute(route, transport);
  }

  private async executeRouted<T>(workspaceId: string, transport: WorkerTransportType | undefined, execute: (client: WorkerClient) => Promise<T>): Promise<RoutedWorkerResult<T>> {
    const selection = await this.route(workspaceId, transport);
    return { value: await execute(selection.client), routing: selection.routing };
  }

  async requireTool(workspaceId: string, tool: string): Promise<void> {
    const state = await this.listWorkspaces();
    const workspace = state.workspaces.find((entry) => entry.workspaceId === workspaceId);
    if (!workspace) throw new QueqiaoError("workspace_not_found", `Workspace is not available: ${workspaceId}`);
    if (workspace.tools.deny.includes(tool)) throw new QueqiaoError("tool_denied", `${tool} is denied by workspace policy`);
    if (tool === "shell" && !workspace.tools.explicit.includes("shell")) throw new QueqiaoError("tool_denied", "shell requires explicit workspace allow policy");
    if (workspace.tools.allow.length > 0 && !workspace.tools.allow.includes(tool)) throw new QueqiaoError("tool_denied", `${tool} is not allowed by workspace policy`);
  }

  async workspaceRoute(workspaceId: string): Promise<WorkspaceRoute> {
    const state = await this.listWorkspaces(); const matches = state.workspaces.filter((entry) => entry.workspaceId === workspaceId);
    if (!matches.length) throw new QueqiaoError("workspace_not_found", `Workspace is not available: ${workspaceId}`);
    if (matches.length > 1) throw new QueqiaoError("workspace_ambiguous", `Workspace ID is ambiguous across environments: ${workspaceId}`);
    return matches[0]!;
  }

  async invokeTool<T>(toolName: string, input: unknown, signal?: AbortSignal): Promise<RoutedWorkerResult<T>> {
    const candidate = input && typeof input === "object" ? input as { workspaceId?: unknown; transport?: unknown; [key: string]: unknown } : undefined;
    const workspaceId = typeof candidate?.workspaceId === "string" ? candidate.workspaceId : undefined;
    if (!workspaceId) throw new QueqiaoError("invalid_request", "workspaceId is required for Worker-hosted extension tools");
    const preferred = typeof candidate?.transport === "string" ? candidate.transport : undefined;
    const { transport: _transport, ...workerInput } = candidate!;
    return this.executeRouted(workspaceId, preferred, (worker) => worker.invokeTool<T>(toolName, workerInput, signal));
  }

  async workspaceInfo(workspaceId: string, tool: "workspace_info" | "open_workspace" = "open_workspace", transport?: WorkerTransportType): Promise<RoutedWorkerResult<Awaited<ReturnType<WorkerClient["workspaceInfo"]>> & { transports: WorkspaceTransportState[]; routing: WorkspaceRoutingState }>> {
    const route = await this.owner(workspaceId);
    const selection = this.selectRoute(route, transport);
    const info = await selection.client.workspaceInfo(workspaceId, tool);
    return { value: { ...info, transports: this.transportStates(route), routing: this.routingState(route) }, routing: selection.routing };
  }

  async readFile(input: { workspaceId: string; path: string; offset: number; limit: number; transport?: WorkerTransportType }) {
    const { transport, ...request } = input;
    return this.executeRouted(input.workspaceId, transport, (worker) => worker.readFile(request));
  }
  async listDirectory(input: { workspaceId: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean; transport?: WorkerTransportType }) {
    const { transport, ...request } = input;
    return this.executeRouted(input.workspaceId, transport, (worker) => worker.listDirectory(request));
  }
  async searchText(input: { workspaceId: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number; transport?: WorkerTransportType }, signal?: AbortSignal) {
    const { transport, ...request } = input;
    return this.executeRouted(input.workspaceId, transport, (worker) => worker.searchText(request, signal));
  }
  async writeFile(input: { workspaceId: string; path: string; content: string; transport?: WorkerTransportType }) {
    const { transport, ...request } = input;
    return this.executeRouted(input.workspaceId, transport, (worker) => worker.writeFile(request));
  }
  async editFile(input: { workspaceId: string; path: string; oldText: string; newText: string; transport?: WorkerTransportType }) {
    const { transport, ...request } = input;
    return this.executeRouted(input.workspaceId, transport, (worker) => worker.editFile(request));
  }
  async run(input: { workspaceId: string; executable: string; args: string[]; cwd: string; timeoutMs: number; mode: "sync" | "async"; transport?: WorkerTransportType }, signal?: AbortSignal) {
    const { transport, ...request } = input;
    return this.executeRouted(input.workspaceId, transport, (worker) => worker.run(request, signal));
  }
  async shell(input: { workspaceId: string; shell: "default" | "bash" | "powershell" | "cmd" | "git-bash"; command: string; cwd: string; timeoutMs: number; mode: "sync" | "async"; transport?: WorkerTransportType }, signal?: AbortSignal) {
    const { transport, ...request } = input;
    return this.executeRouted(input.workspaceId, transport, (worker) => worker.shell(request, signal));
  }
}
