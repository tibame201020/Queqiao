import type { WorkerEndpointConfig } from "./config.js";
import { QUEQIAO_WORKER_CAPABILITIES, QUEQIAO_WORKER_HTTP_API_PREFIX, workerHelloSchema, workerRunResultSchema, workerShellResultSchema, type WorkerHello, type WorkerRunResult, type WorkerShellResult, type WorkerToolInvocationResponse } from "@queqiao/worker-protocol";

class WorkerHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class WorkerClient {
  readonly environmentId: string;
  private handshakePromise: Promise<WorkerHello> | undefined;
  constructor(private readonly config: WorkerEndpointConfig) { this.environmentId = config.environmentId; }
  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const timeout = AbortSignal.timeout(125_000);
    const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
    const response = await fetch(new URL(pathname, this.config.url), { ...init, signal, headers: { "content-type": "application/json", "x-queqiao-worker-token": this.config.token, ...init.headers } });
    const data = await response.json() as T & { message?: string };
    if (!response.ok) throw new WorkerHttpError(response.status, data.message || `Worker returned HTTP ${response.status}`);
    return data;
  }
  handshake(): Promise<WorkerHello> {
    this.handshakePromise ??= this.request<unknown>(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/hello`).then((value) => {
      const hello = workerHelloSchema.parse(value);
      if (hello.environmentId !== this.environmentId) throw new Error("Worker identity mismatch");
      for (const capability of QUEQIAO_WORKER_CAPABILITIES) if (!hello.capabilities.includes(capability)) throw new Error(`Worker capability missing: ${capability}`);
      return hello;
    }).catch((error) => { this.handshakePromise = undefined; throw error; });
    return this.handshakePromise;
  }
  async listWorkspaces() { await this.handshake(); return this.request<{ environmentId: string; defaultWorkspaceId: string; workspaces: Array<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] } }> }>(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces`); }
  async workspaceInfo(workspaceId: string, tool: "workspace_info" | "open_workspace" = "open_workspace") { await this.handshake(); return this.request<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] } }>(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces/${encodeURIComponent(workspaceId)}?tool=${tool}`); }
  async invokeTool<T>(toolName: string, input: unknown, signal?: AbortSignal) { await this.handshake(); return this.request<WorkerToolInvocationResponse<T>>(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/tools/${encodeURIComponent(toolName)}`, { method: "POST", body: JSON.stringify(input), ...(signal ? { signal } : {}) }).then(({ result }) => result); }
  async readFile(input: { workspaceId: string; path: string; offset: number; limit: number }) {
    try {
      return await this.invokeTool<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>("read_file", input);
    } catch (error) {
      if (!(error instanceof WorkerHttpError) || error.status !== 404) throw error;
      return this.request<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>(`${QUEQIAO_WORKER_HTTP_API_PREFIX}/read-file`, { method: "POST", body: JSON.stringify(input) });
    }
  }
  listDirectory(input: { workspaceId: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean }) { return this.invokeTool<{ path: string; entries: Array<{ path: string; name: string; type: "file" | "directory" | "symlink" | "other"; size?: number }>; nextCursor: string | null; truncated: boolean }>("list_directory", input); }
  searchText(input: { workspaceId: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number }, signal?: AbortSignal) { return this.invokeTool<{ query: string; path: string; matches: Array<{ path: string; line: number; column: number; preview: string }>; filesScanned: number; filesSkipped: number; truncated: boolean; timedOut: boolean; durationMs: number }>("search_text", input, signal); }
  writeFile(input: { workspaceId: string; path: string; content: string }) { return this.invokeTool<{ path: string; bytes: number }>("write_file", input); }
  editFile(input: { workspaceId: string; path: string; oldText: string; newText: string }) { return this.invokeTool<{ path: string; bytes: number; replacements: number }>("edit_file", input); }
  async run(input: { workspaceId: string; executable: string; args: string[]; cwd: string; timeoutMs: number; mode: "sync" | "async" }, signal?: AbortSignal): Promise<WorkerRunResult> { return workerRunResultSchema.parse(await this.invokeTool<unknown>("run", input, signal)); }
  async shell(input: { workspaceId: string; shell: "default" | "bash" | "powershell" | "cmd" | "git-bash"; command: string; cwd: string; timeoutMs: number; mode: "sync" | "async" }, signal?: AbortSignal): Promise<WorkerShellResult> { return workerShellResultSchema.parse(await this.invokeTool<unknown>("shell", input, signal)); }
}
