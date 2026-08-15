import type { WorkerEndpointConfig } from "./config.js";
import { WorkerHttpError } from "./errors.js";
import { HttpWorkerTransport } from "./http-worker-transport.js";
import type { WorkerTransport, WorkerTransportDescriptor } from "./worker-transport.js";
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

export type MembershipWorkerClientConfig = {
  workerId: string;
  environmentId: string;
  transport: WorkerTransportDescriptor;
  token: string;
};

export type WorkerClientConfig = WorkerEndpointConfig | MembershipWorkerClientConfig;

function isMembershipConfig(config: WorkerClientConfig): config is MembershipWorkerClientConfig {
  return "workerId" in config;
}

function createDefaultTransport(config: WorkerClientConfig): WorkerTransport {
  const descriptor: WorkerTransportDescriptor = isMembershipConfig(config)
    ? config.transport
    : { type: "http", endpoint: config.url.href };
  if (descriptor.type !== "http") throw new Error(`Unsupported Worker transport: ${(descriptor as { type: string }).type}`);
  return new HttpWorkerTransport({ descriptor, token: config.token });
}

export class WorkerClient {
  readonly environmentId: string;
  readonly workerId: string | undefined;
  private handshakePromise: Promise<WorkerHello> | undefined;

  constructor(
    private readonly config: WorkerClientConfig,
    private readonly transport: WorkerTransport = createDefaultTransport(config),
  ) {
    this.environmentId = config.environmentId;
    this.workerId = isMembershipConfig(config) ? config.workerId : undefined;
  }

  handshake(force = false): Promise<WorkerHello> {
    if (force) this.handshakePromise = undefined;
    this.handshakePromise ??= this.transport.execute<unknown>({ operation: "hello" }).then((value) => {
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

      return hello;
    }).catch((error) => { this.handshakePromise = undefined; throw error; });
    return this.handshakePromise;
  }

  async listWorkspaces() {
    await this.handshake();
    return this.transport.execute<{ environmentId: string; defaultWorkspaceId: string; workspaces: Array<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] } }> }>({ operation: "list-workspaces" });
  }

  async workspaceInfo(workspaceId: string, tool: "workspace_info" | "open_workspace" = "open_workspace") {
    await this.handshake();
    return this.transport.execute<{ environmentId: string; workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: { allow: string[]; deny: string[]; explicit: string[] }; commands: { allow: string[] } }>({ operation: "workspace-info", workspaceId, tool });
  }

  async invokeTool<T>(toolName: string, input: unknown, signal?: AbortSignal) {
    await this.handshake();
    return this.transport.execute<WorkerToolInvocationResponse<T>>({ operation: "invoke-tool", toolName, input }, signal).then(({ result }) => result);
  }

  async readFile(input: { workspaceId: string; path: string; offset: number; limit: number }) {
    try {
      return await this.invokeTool<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>("read_file", input);
    } catch (error) {
      if (!(error instanceof WorkerHttpError) || error.status !== 404) throw error;
      return this.transport.execute<{ path: string; startLine: number; endLine: number; totalLines: number; text: string }>({ operation: "legacy-read-file", input });
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
