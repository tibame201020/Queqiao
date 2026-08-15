import { WorkerClient, type WorkerClientConfig } from "./worker-client.js";
import { QueqiaoError } from "./errors.js";

export type WorkspaceRoute = { environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] }; online: true };
export type EnvironmentState = { environmentId: string; online: boolean; defaultWorkspaceId?: string; workspaces: WorkspaceRoute[] };

export class WorkerRegistry {
  private readonly workers: WorkerClient[];
  constructor(configs: readonly WorkerClientConfig[]) { this.workers = configs.map((config) => new WorkerClient(config)); }
  configuredEnvironmentIds(): string[] { return this.workers.map((worker) => worker.environmentId); }

  async listEnvironments(): Promise<EnvironmentState[]> {
    return Promise.all(this.workers.map(async (worker) => {
      try {
        const state = await worker.listWorkspaces();
        if (state.environmentId !== worker.environmentId) throw new Error("Worker identity mismatch");
        return { environmentId: worker.environmentId, online: true, defaultWorkspaceId: state.defaultWorkspaceId, workspaces: state.workspaces.map((workspace) => ({ ...workspace, online: true as const })) };
      } catch { return { environmentId: worker.environmentId, online: false, workspaces: [] }; }
    }));
  }

  async listWorkspaces() {
    const environments = await this.listEnvironments();
    return { environments, workspaces: environments.flatMap((environment) => environment.workspaces) };
  }

  async defaultRoute(): Promise<{ worker: WorkerClient; workspaceId: string }> {
    for (const worker of this.workers) {
      try { const state = await worker.listWorkspaces(); if (state.environmentId === worker.environmentId) return { worker, workspaceId: state.defaultWorkspaceId }; } catch { /* try next */ }
    }
    throw new QueqiaoError("worker_unavailable", "No Queqiao Worker is online", "gateway", true);
  }

  async route(workspaceId: string): Promise<WorkerClient> {
    const matches: WorkerClient[] = [];
    for (const worker of this.workers) {
      try { const state = await worker.listWorkspaces(); if (state.environmentId === worker.environmentId && state.workspaces.some((workspace) => workspace.workspaceId === workspaceId)) matches.push(worker); } catch { /* offline */ }
    }
    if (!matches.length) throw new QueqiaoError("workspace_not_found", `Workspace is not available: ${workspaceId}`);
    if (matches.length > 1) throw new QueqiaoError("workspace_ambiguous", `Workspace ID is ambiguous across environments: ${workspaceId}`);
    return matches[0]!;
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
    const state = await this.listWorkspaces();
    const matches = state.workspaces.filter((entry) => entry.workspaceId === workspaceId);
    if (!matches.length) throw new QueqiaoError("workspace_not_found", `Workspace is not available: ${workspaceId}`);
    if (matches.length > 1) throw new QueqiaoError("workspace_ambiguous", `Workspace ID is ambiguous across environments: ${workspaceId}`);
    return matches[0]!;
  }

  async invokeTool<T>(toolName: string, input: unknown, signal?: AbortSignal): Promise<T> {
    const workspaceId = input && typeof input === "object" && typeof (input as { workspaceId?: unknown }).workspaceId === "string" ? (input as { workspaceId: string }).workspaceId : undefined;
    if (!workspaceId) throw new QueqiaoError("invalid_request", "workspaceId is required for Worker-hosted extension tools");
    const worker = await this.route(workspaceId);
    return worker.invokeTool<T>(toolName, input, signal);
  }
  workspaceInfo(workspaceId: string, tool: "workspace_info" | "open_workspace" = "open_workspace") { return this.route(workspaceId).then((worker) => worker.workspaceInfo(workspaceId, tool)); }
  async readFile(input: { workspaceId: string; path: string; offset: number; limit: number }) { const worker = await this.route(input.workspaceId); return worker.readFile(input); }
  async listDirectory(input: { workspaceId: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean }) { const worker = await this.route(input.workspaceId); return worker.listDirectory(input); }
  async searchText(input: { workspaceId: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number }, signal?: AbortSignal) { const worker = await this.route(input.workspaceId); return worker.searchText(input, signal); }
  async writeFile(input: { workspaceId: string; path: string; content: string }) { const worker = await this.route(input.workspaceId); return worker.writeFile(input); }
  async editFile(input: { workspaceId: string; path: string; oldText: string; newText: string }) { const worker = await this.route(input.workspaceId); return worker.editFile(input); }
  async run(input: { workspaceId: string; executable: string; args: string[]; cwd: string; timeoutMs: number; mode: "sync" | "async" }, signal?: AbortSignal) { const worker = await this.route(input.workspaceId); return worker.run(input, signal); }
  async shell(input: { workspaceId: string; shell: "default" | "bash" | "powershell" | "cmd" | "git-bash"; command: string; cwd: string; timeoutMs: number; mode: "sync" | "async" }, signal?: AbortSignal) { const worker = await this.route(input.workspaceId); return worker.shell(input, signal); }
}
