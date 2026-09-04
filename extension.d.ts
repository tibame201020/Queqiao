import type { ZodObject } from "zod";

export type ToolCapability = "workspace:read" | "workspace:write" | "workspace:exec";
export type WorkerExtensionProcessMode = "sync" | "async";
export type WorkerExtensionCapabilities = {
  listDirectory(path: string, depth: number, limit: number, cursor: string | undefined, includeHidden: boolean): Promise<unknown>;
  searchText(input: { query: string; path?: string; globs?: string[]; maxResults?: number; caseSensitive?: boolean; timeoutMs?: number }): Promise<unknown>;
  readFile(path: string, offset: number, limit: number): Promise<unknown>;
  writeFile(path: string, content: string): Promise<unknown>;
  editFile(path: string, oldText: string, newText: string): Promise<unknown>;
  resolveExecutionDirectory(path: string): Promise<string>;
  assertExecutionPathContained(absolutePath: string): Promise<string>;
  relativeExecutionPath(absolutePath: string): Promise<string>;
  resolveNewDirectoryTarget(path: string): Promise<string>;
  run(input: { executable: string; args: readonly string[]; cwd: string; timeoutMs: number; mode: WorkerExtensionProcessMode }): Promise<unknown>;
};
export type WorkerExtensionProcessStreamEvent = { type: "stdout" | "stderr"; data: string };
export type WorkerExtensionManagedProcessClose = {
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
};
export type WorkerExtensionStdioSession = {
  pid: number;
  write(data: string): Promise<void>;
  next(): Promise<WorkerExtensionProcessStreamEvent>;
  close(): Promise<void>;
  readonly closed: Promise<WorkerExtensionManagedProcessClose>;
};
export type WorkerExtensionHttpResponse = { status: number; headers: Record<string, string>; body: string };
export type WorkerExtensionFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type WorkerExtensionRuntime = {
  stdio: {
    open(input: { executable: string; args?: readonly string[]; cwd?: string; timeoutMs?: number }): Promise<WorkerExtensionStdioSession>;
  };
  http: {
    request(input: {
      url: string;
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
      headers?: Readonly<Record<string, string>>;
      body?: string;
      timeoutMs?: number;
    }): Promise<WorkerExtensionHttpResponse>;
    fetch: WorkerExtensionFetch;
  };
};
export type WorkerExtensionContext = { workspaceId: string; capabilities: WorkerExtensionCapabilities; runtime: WorkerExtensionRuntime; signal?: AbortSignal };
export type ToolRisk = "read" | "write" | "execute";
export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
};

export type ToolDefinition<TContext> = {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodObject;
  requiredCapabilities: readonly ToolCapability[];
  risk: ToolRisk;
  annotations: ToolAnnotations;
  execute(input: unknown, context: TContext): Promise<unknown>;
};

export type ToolCall<TContext> = { toolName: string; input: unknown; context: TContext };
export type BeforeToolCallHook<TContext> = (call: ToolCall<TContext>) => Promise<{ block: true; reason: string } | void> | { block: true; reason: string } | void;
export type AfterToolCallHook<TContext> = (call: ToolCall<TContext> & { result: unknown }) => Promise<unknown | void> | unknown | void;
export type WrapToolCallHook<TContext> = (call: ToolCall<TContext>, next: () => Promise<unknown>) => Promise<unknown>;

export type ExtensionApi<TContext> = {
  registerTool(definition: ToolDefinition<TContext>): void;
  extendTool(toolName: string, stage: "before", hook: BeforeToolCallHook<TContext>): void;
  extendTool(toolName: string, stage: "after", hook: AfterToolCallHook<TContext>): void;
  extendTool(toolName: string, stage: "wrap", hook: WrapToolCallHook<TContext>): void;
  replaceTool(toolName: string, definition: ToolDefinition<TContext>): void;
};

export type ExtensionModuleManifest = {
  id: string;
  version: string;
  displayName: string;
  supportedEnvironments?: readonly ("gateway" | "windows" | "linux" | "darwin")[];
};

export type QueqiaoExtension<TContext> = {
  manifest: ExtensionModuleManifest;
  activate(api: ExtensionApi<TContext>): void;
  dispose?(): void | Promise<void>;
};

export type ExtensionHost = { kind: "gateway" } | { kind: "worker"; environmentId?: string };
export type ExtensionActivation = { kind: "global" } | { kind: "workspaces"; workspaceIds: string[] };
export type JsonSchemaObject = Record<string, unknown>;
export type ExtensionRegisterContribution = {
  operation: "register";
  tool: string;
  visibility: "public" | "internal";
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  requiredCapabilities: ToolCapability[];
  risk: ToolRisk;
  annotations: ToolAnnotations;
};
export type ExtensionContribution = ExtensionRegisterContribution | {
  operation: "extend";
  tool: string;
  stage: "before" | "after" | "wrap";
  requiredCapabilities: ToolCapability[];
} | {
  operation: "replace";
  tool: string;
  preservesContract: true;
  requiredCapabilities: ToolCapability[];
};
export type ExtensionRuntimePolicy = {
  processes: { allow: string[] };
  outboundHttp: { allowOrigins: string[] };
};
export type ExtensionManifestConfig = {
  id: string;
  version: string;
  displayName: string;
  host: ExtensionHost;
  ordering: { requires: string[]; before: string[]; after: string[] };
  contributions: ExtensionContribution[];
  runtime?: ExtensionRuntimePolicy;
};
export type ExtensionPackageMetadata = {
  apiVersion: 1;
  module: string;
  manifest: ExtensionManifestConfig;
};

export declare const QUEQIAO_EXTENSION_API_VERSION: 1;
export declare function defineExtension<TContext>(extension: QueqiaoExtension<TContext>): QueqiaoExtension<TContext>;
export declare function defineExtensionManifest(manifest: ExtensionManifestConfig): ExtensionManifestConfig;
