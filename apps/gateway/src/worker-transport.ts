import type { WorkerProtocolRequest } from "@queqiao/worker-protocol";

export type WorkerHttpTransportDescriptor = {
  type: "http";
  endpoint: string;
};

export type WorkerGrpcReverseTransportDescriptor = {
  type: "grpc";
  mode: "reverse";
};

export type WorkerTransportDescriptor = WorkerHttpTransportDescriptor | WorkerGrpcReverseTransportDescriptor;

export type WorkerTransportRequest =
  | WorkerProtocolRequest
  | { operation: "legacy-read-file"; input: { workspaceId: string; path: string; offset: number; limit: number } };

export interface WorkerTransport {
  revision?(): string | undefined;
  execute<T>(request: WorkerTransportRequest, signal?: AbortSignal): Promise<T>;
}
