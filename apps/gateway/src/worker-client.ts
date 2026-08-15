import { WorkerHttpError } from "./errors.js";
import { HttpWorkerTransport } from "./http-worker-transport.js";
import type { WorkerTransport, WorkerTransportDescriptor, WorkerTransportRequest } from "./worker-transport.js";
import {
  QUEQIAO_WORKER_LEGACY_CAPABILITIES,
  QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION,
  QUEQIAO_WORKER_PROTOCOL_VERSION,
  workerHelloSchema,
  workerRunResultSchema,
  workerShellResultSchema,
  type WorkerHello,
  type WorkerRunResult,
  type WorkerShellResult,
  type WorkerToolInvocationResponse,
} from "@queqiao/worker-protocol";

export type WorkerClientConfig = {
  workerId?: string;
  environmentId: string;
  transport: WorkerTransportDescriptor;
  token: string;
};

export type MembershipWorkerClientConfig = WorkerClientConfig & { workerId: string };

function createDefaultTransport(config: WorkerClientConfig): WorkerTransport {
  if (config.transport.type !== "http") throw new Error(`Unsupported Worker transport: ${(config.transport as { type: string }).type}`);
  return new HttpWorkerTransport({ descriptor: config.transport, token: config.token });
}

export class WorkerClient {
  readonly environmentId: string;
  readonly workerId: string | undefined;
  private handshakePromise: Promise<WorkerHello> | undefined;

  constructor(
    private readonly config: WorkerClientConfig,
    private readonly transport: WorkerTransport = createDefaultTransport(config),
    private readonly reportReachability: (reachable: boolean) => void = () => {},
  ) {
    this.environmentId = config.environmentId;
    this.workerId = config.workerId;
  }

  private async executeTracked<T>(request: WorkerTransportRequest, signal?: AbortSignal): Promise<T> {
    try {
      const result = await this.transport.execute<T>(request, signal);
      this.reportReachability(true);
      return result;
    } catch (error) {
      if (error instanceof WorkerHttpError) this.reportReachability(true);
      else this.reportReachability(false);
      throw error;
    }
  }

  handshake(force = false): Promise<WorkerHello> {
    if (force) this.handshakePromise = undefined;
    this.handshakePromise ??= this.executeTracked<unknown>({ operation: "hello" }).then((value) => {
      const hello = workerHelloSchema.parse(value);
      if (hello.environmentId !== this.environmentId) throw new Error("Worker environment identity mismatch");

      if (this.workerId) {
        if (hello.protocolVersion !== QUEQIAO_WORKER_PROTOCOL_VERSION) {
          throw new Error(`Worker Protocol ${QUEQIAO_WORKER_PROTOCOL_VERSION} is required for enrolled membership routing`);
        }
        if (hello.workerId !== this.workerId) throw new Error("Worker stable identity mismatch");
      } else if (hello.protocolVersion === QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION) {
        for (const capability of QUEQIAO_WORKER_LEGACY_CAPABILITIES) {
          if (!hello.capabilities.includes(capability)) throw new Error(`Worker capability missing: ${capability}`);
        }
      }

      this.reportReachability(true);
      return hello;
    }).catch((error) => {
      this.handshakePromise = undefined;
      this.reportReachability(false);
      throw error;
    });
    return this.handshakePromise;
  }

  async probeLiveness(timeoutMs = 3_000): Promise<boolean> {
    try {
      const health = await this.transport.execute<{ ok?: unknown }>({ operation: "health" }, AbortSignal.timeout(timeoutMs));
      if (health.ok !== true) throw new Error("Worker health probe did not report ok");
      await this.handshake(true);
      this.reportReachability(true);
      return true;
    } catch {
      this.handshakePromise = undefined;
      this.reportReachability(false);
      return false;
    }
  }

  async listWorkspaces() {
    await this.handshake();
    return this.executeTracked<{ environmentId: string; defaultWorkspaceId: string; workspaces: Array<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] } }> }>({ operation: "list-workspaces" });
  }

  async workspaceInfo(workspaceId: string, tool: "workspace_info" | "open_workspace" = "open_workspace") {
    await this.handshake();
    return this.executeTracked<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] } }>({ operation: "workspace-info", workspaceId, tool });
  }

  async invokeTool<T>(toolName: string, input: unknown, signal?: AbortSignal) {
    await this.handshake();
    return this.executeTracked<WorkerToolInvocationResponse<T>>({ operation: "invoke-tool", toolName, input }, signal).then(({ result }) => result);
  }

  async readFile(input: { workspaceId: string; path: string; offset: number; limit: number }) {
    try {
      return await this.invokeTool<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>("read_file", input);
    } catch (error) {
      if (!(error instanceof WorkerHttpError) || error.status !== 404) throw error;
      return this.executeTracked<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>({ operation: "legacy-read-file", input });
    }
  }

  listDirectory(input: { workspaceId: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean }) {
    return this.invokeTool<{ path: string; entries: Array<{ path: string; name: string; type: "file" | "directory" | "symlink" | "other"; size?: number }>; nextCursor: string | null; truncated: boolean }>("list_directory", input);
  }

  searchText(input: { workspaceId: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number }, signal?: AbortSignal) {
    return this.invokeTool<{ query: string; path: string; matches: Array<{ path: string; line: number; column: number; preview: string }>; filesScanned: number; filesSkipped: number; truncated: boolean; timedOut: boolean; durationMs: number }>("search_text", input, signal);
  }

  writeFile(input: { workspaceId: string; path: string; content: string }) {
    return this.invokeTool<{ path: string; bytes: number }>("write_file", input);
  }

  editFile(input: { workspaceId: string; path: string; oldText: string; newText: string }) {
    return this.invokeTool<{ path: string; bytes: number; replacements: number }>("edit_file", input);
  }

  async run(input: { workspaceId: string; executable: string; args: string[]; cwd: string; timeoutMs: number; mode: "sync" | "async" }, signal?: AbortSignal): Promise<WorkerRunResult> {
    return workerRunResultSchema.parse(await this.invokeTool<unknown>("run", input, signal));
  }

  async shell(input: { workspaceId: string; shell: "default" | "bash" | "powershell" | "cmd" | "git-bash"; command: string; cwd: string; timeoutMs: number; mode: "sync" | "async" }, signal?: AbortSignal): Promise<WorkerShellResult> {
    return workerShellResultSchema.parse(await this.invokeTool<unknown>("shell", input, signal));
  }
}
