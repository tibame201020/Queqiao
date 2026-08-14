export type WorkerHttpTransportDescriptor = {
  type: "http";
  endpoint: string;
};

export type WorkerTransportDescriptor = WorkerHttpTransportDescriptor;

export type WorkerTransportRequest =
  | { operation: "hello" }
  | { operation: "list-workspaces" }
  | { operation: "workspace-info"; workspaceId: string; tool: "workspace_info" | "open_workspace" }
  | { operation: "invoke-tool"; toolName: string; input: unknown }
  | { operation: "legacy-read-file"; input: { workspaceId: string; path: string; offset: number; limit: number } };

export interface WorkerTransport {
  execute<T>(request: WorkerTransportRequest, signal?: AbortSignal): Promise<T>;
}
