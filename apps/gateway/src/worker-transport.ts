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

export type WorkerTransportTraits = {
  requestResponse: boolean;
  streaming: "none" | "server" | "bidirectional";
  connection: "stateless" | "persistent";
  topology: "direct" | "reverse" | "peer";
};

const REGISTERED_WORKER_TRANSPORT_TYPES = new Set<string>(["http", "grpc"]);

export function isRegisteredWorkerTransportType(type: string): boolean {
  return REGISTERED_WORKER_TRANSPORT_TYPES.has(type);
}

export function workerTransportProjection(descriptor: WorkerTransportDescriptor) {
  if (descriptor.type === "grpc") {
    return {
      mode: descriptor.mode,
      traits: { requestResponse: true, streaming: "bidirectional", connection: "persistent", topology: "reverse" } satisfies WorkerTransportTraits,
    };
  }
  return {
    mode: "direct" as const,
    traits: { requestResponse: true, streaming: "none", connection: "stateless", topology: "direct" } satisfies WorkerTransportTraits,
  };
}

export type WorkerTransportRequest =
  | WorkerProtocolRequest
  | { operation: "legacy-read-file"; input: { workspaceId: string; path: string; offset: number; limit: number } };

export interface WorkerTransport {
  revision?(): string | undefined;
  execute<T>(request: WorkerTransportRequest, signal?: AbortSignal): Promise<T>;
}
