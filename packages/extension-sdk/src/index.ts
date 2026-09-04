import type { ExtensionManifestConfig } from "@queqiao/config";
import type { QueqiaoExtension } from "@queqiao/tool-runtime";

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
  };
};

export type WorkerExtensionContext = { workspaceId: string; capabilities: WorkerExtensionCapabilities; runtime: WorkerExtensionRuntime; signal?: AbortSignal };

export const QUEQIAO_EXTENSION_API_VERSION = 1 as const;

export function defineExtension<TContext>(extension: QueqiaoExtension<TContext>): QueqiaoExtension<TContext> {
  return extension;
}

export function defineExtensionManifest(manifest: ExtensionManifestConfig): ExtensionManifestConfig {
  return manifest;
}
