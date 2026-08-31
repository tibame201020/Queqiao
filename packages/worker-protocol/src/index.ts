import { z } from "zod";
import {
  asyncProcessResultSchema,
  environmentIdSchema,
  processExecutionModeSchema,
  syncProcessResultSchema,
  workerIdSchema,
} from "@queqiao/contracts";

export const QUEQIAO_WORKER_PROTOCOL_VERSION = "3.0" as const;
export const QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION = "2.0" as const;
export const QUEQIAO_WORKER_HTTP_API_PREFIX = "/v1" as const;

// Protocol 2.0 represented mandatory functionality as a capability list.
// Protocol 3.0 owns mandatory functionality in the protocol version itself;
// capabilities are reserved for optional Worker-native operations.
export const QUEQIAO_WORKER_LEGACY_CAPABILITIES = ["workspace-routing", "tool-invocation", "async-process-v1"] as const;
export const QUEQIAO_WORKER_OPTIONAL_CAPABILITIES = [] as const;
// Compatibility export retained during the rolling-upgrade window. New code must
// use QUEQIAO_WORKER_LEGACY_CAPABILITIES or QUEQIAO_WORKER_OPTIONAL_CAPABILITIES explicitly.
export const QUEQIAO_WORKER_CAPABILITIES = QUEQIAO_WORKER_LEGACY_CAPABILITIES;

export const workerPlatformSchema = z.enum(["windows", "linux", "darwin"]);
const workerHelloBaseSchema = z.object({
  environmentId: environmentIdSchema,
  instanceId: z.uuid(),
  platform: workerPlatformSchema,
  capabilities: z.array(z.string().min(1).max(128)).max(128),
});

export const workerHelloV2Schema = workerHelloBaseSchema.extend({
  protocolVersion: z.literal(QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION),
});

export const workerHelloV3Schema = workerHelloBaseSchema.extend({
  protocolVersion: z.literal(QUEQIAO_WORKER_PROTOCOL_VERSION),
  workerId: workerIdSchema,
});

export const workerHelloSchema = z.discriminatedUnion("protocolVersion", [workerHelloV2Schema, workerHelloV3Schema]);

export const workerToolInvocationResponseSchema = z.object({ result: z.unknown() });
export const workerProcessExecutionModeSchema = processExecutionModeSchema;
export const workerSyncProcessResultSchema = syncProcessResultSchema;
export const workerAsyncProcessResultSchema = asyncProcessResultSchema;
export const workerRunResultSchema = z.union([workerSyncProcessResultSchema, workerAsyncProcessResultSchema]);
export const workerShellResultSchema = z.union([
  workerSyncProcessResultSchema.extend({ shell: z.string().min(1) }),
  workerAsyncProcessResultSchema.extend({ shell: z.string().min(1) }),
]);

export type WorkerHelloV2 = z.infer<typeof workerHelloV2Schema>;
export type WorkerHelloV3 = z.infer<typeof workerHelloV3Schema>;
export type WorkerHello = z.infer<typeof workerHelloSchema>;
export type WorkerProcessExecutionMode = z.infer<typeof workerProcessExecutionModeSchema>;
export type WorkerRunResult = z.infer<typeof workerRunResultSchema>;
export type WorkerShellResult = z.infer<typeof workerShellResultSchema>;
export type WorkerToolInvocationResponse<T = unknown> = { result: T };

export const workerProtocolRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("health") }).strict(),
  z.object({ operation: z.literal("hello") }).strict(),
  z.object({ operation: z.literal("list-workspaces") }).strict(),
  z.object({
    operation: z.literal("workspace-info"),
    workspaceId: z.string().min(1).max(64),
    tool: z.enum(["workspace_info", "open_workspace"]),
  }).strict(),
  z.object({
    operation: z.literal("invoke-tool"),
    toolName: z.string().min(1).max(128),
    input: z.unknown(),
  }).strict(),
]);

const workerSessionRequestIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const workerSessionErrorSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(4096),
  status: z.number().int().min(400).max(599).optional(),
  retryable: z.boolean().optional(),
}).strict();

export const workerSessionConnectFrameSchema = z.object({
  kind: z.literal("connect"),
  hello: workerHelloV3Schema,
}).strict();
export const workerSessionReadyFrameSchema = z.object({
  kind: z.literal("ready"),
  sessionId: z.uuid(),
}).strict();
export const workerSessionRequestFrameSchema = z.object({
  kind: z.literal("request"),
  requestId: workerSessionRequestIdSchema,
  request: workerProtocolRequestSchema,
}).strict();
export const workerSessionResponseFrameSchema = z.object({
  kind: z.literal("response"),
  requestId: workerSessionRequestIdSchema,
  result: z.unknown(),
}).strict();
export const workerSessionErrorFrameSchema = z.object({
  kind: z.literal("error"),
  requestId: workerSessionRequestIdSchema,
  error: workerSessionErrorSchema,
}).strict();
export const workerSessionCancelFrameSchema = z.object({
  kind: z.literal("cancel"),
  requestId: workerSessionRequestIdSchema,
}).strict();
export const workerSessionFrameSchema = z.discriminatedUnion("kind", [
  workerSessionConnectFrameSchema,
  workerSessionReadyFrameSchema,
  workerSessionRequestFrameSchema,
  workerSessionResponseFrameSchema,
  workerSessionErrorFrameSchema,
  workerSessionCancelFrameSchema,
]);

export const MAX_WORKER_SESSION_FRAME_BYTES = 8 * 1024 * 1024;
export const QUEQIAO_WORKER_GRPC_SERVICE_NAME = "queqiao.worker.transport.v1.WorkerSession" as const;
export const QUEQIAO_WORKER_GRPC_CONNECT_PATH = `/${QUEQIAO_WORKER_GRPC_SERVICE_NAME}/Connect` as const;

export function encodeWorkerSessionFrame(raw: unknown): Buffer {
  const frame = workerSessionFrameSchema.parse(raw);
  const encoded = Buffer.from(JSON.stringify(frame), "utf8");
  if (encoded.byteLength > MAX_WORKER_SESSION_FRAME_BYTES) throw new Error(`Worker session frame is too large: ${encoded.byteLength} bytes`);
  return encoded;
}

export function decodeWorkerSessionFrame(raw: Uint8Array): WorkerSessionFrame {
  if (raw.byteLength > MAX_WORKER_SESSION_FRAME_BYTES) throw new Error(`Worker session frame is too large: ${raw.byteLength} bytes`);
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(raw).toString("utf8")); }
  catch { throw new Error("Worker session frame is not valid JSON"); }
  return workerSessionFrameSchema.parse(parsed);
}

export const workerGrpcConnectMethodDefinition = Object.freeze({
  path: QUEQIAO_WORKER_GRPC_CONNECT_PATH,
  requestStream: true,
  responseStream: true,
  requestSerialize: encodeWorkerSessionFrame,
  requestDeserialize: decodeWorkerSessionFrame,
  responseSerialize: encodeWorkerSessionFrame,
  responseDeserialize: decodeWorkerSessionFrame,
  originalName: "connect",
});

export const workerGrpcServiceDefinition = Object.freeze({ connect: workerGrpcConnectMethodDefinition });

export type WorkerProtocolRequest = z.infer<typeof workerProtocolRequestSchema>;
export type WorkerSessionFrame = z.infer<typeof workerSessionFrameSchema>;
export type WorkerSessionConnectFrame = z.infer<typeof workerSessionConnectFrameSchema>;
export type WorkerSessionReadyFrame = z.infer<typeof workerSessionReadyFrameSchema>;
export type WorkerSessionRequestFrame = z.infer<typeof workerSessionRequestFrameSchema>;
export type WorkerSessionResponseFrame = z.infer<typeof workerSessionResponseFrameSchema>;
export type WorkerSessionErrorFrame = z.infer<typeof workerSessionErrorFrameSchema>;
export type WorkerSessionCancelFrame = z.infer<typeof workerSessionCancelFrameSchema>;
