import type { WorkerEndpointConfig } from "./config.js";

class WorkerHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class WorkerClient {
  readonly environmentId: string;
  constructor(private readonly config: WorkerEndpointConfig) { this.environmentId = config.environmentId; }
  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const timeout = AbortSignal.timeout(125_000);
    const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
    const response = await fetch(new URL(pathname, this.config.url), { ...init, signal, headers: { "content-type": "application/json", "x-queqiao-worker-token": this.config.token, ...init.headers } });
    const data = await response.json() as T & { message?: string };
    if (!response.ok) throw new WorkerHttpError(response.status, data.message || `Worker returned HTTP ${response.status}`);
    return data;
  }
  listWorkspaces() { return this.request<{ environmentId: string; defaultWorkspaceId: string; workspaces: Array<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[] }; commands: { allow: string[] } }> }>("/v1/workspaces"); }
  workspaceInfo(workspaceId: string, tool: "workspace_info" | "open_workspace" = "open_workspace") { return this.request<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[] }; commands: { allow: string[] } }>(`/v1/workspaces/${encodeURIComponent(workspaceId)}?tool=${tool}`); }
  invokeTool<T>(toolName: string, input: unknown, signal?: AbortSignal) { return this.request<{ result: T }>(`/v1/tools/${encodeURIComponent(toolName)}`, { method: "POST", body: JSON.stringify(input), ...(signal ? { signal } : {}) }).then(({ result }) => result); }
  async readFile(input: { workspaceId: string; path: string; offset: number; limit: number }) {
    try {
      return await this.invokeTool<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>("read_file", input);
    } catch (error) {
      if (!(error instanceof WorkerHttpError) || error.status !== 404) throw error;
      return this.request<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>("/v1/read-file", { method: "POST", body: JSON.stringify(input) });
    }
  }
  listDirectory(input: { workspaceId: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean }) { return this.invokeTool<{ path: string; entries: Array<{ path: string; name: string; type: "file" | "directory" | "symlink" | "other"; size?: number }>; nextCursor: string | null; truncated: boolean }>("list_directory", input); }
  searchText(input: { workspaceId: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number }, signal?: AbortSignal) { return this.invokeTool<{ query: string; path: string; matches: Array<{ path: string; line: number; column: number; preview: string }>; filesScanned: number; filesSkipped: number; truncated: boolean; timedOut: boolean; durationMs: number }>("search_text", input, signal); }
  writeFile(input: { workspaceId: string; path: string; content: string }) { return this.invokeTool<{ path: string; bytes: number }>("write_file", input); }
  editFile(input: { workspaceId: string; path: string; oldText: string; newText: string }) { return this.invokeTool<{ path: string; bytes: number; replacements: number }>("edit_file", input); }
  run(input: { workspaceId: string; executable: string; args: string[]; cwd: string; timeoutMs: number }, signal?: AbortSignal) { return this.invokeTool<{ exitCode: number | null; signal: string | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean; aborted: boolean; outputLimitExceeded: boolean }>("run", input, signal); }
}
