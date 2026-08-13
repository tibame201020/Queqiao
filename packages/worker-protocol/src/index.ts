import { z } from "zod";
import {
  asyncProcessResultSchema,
  environmentIdSchema,
  processExecutionModeSchema,
  syncProcessResultSchema,
} from "@queqiao/contracts";

export const QUEQIAO_WORKER_PROTOCOL_VERSION = "2.0" as const;
export const QUEQIAO_WORKER_HTTP_API_PREFIX = "/v1" as const;
export const QUEQIAO_WORKER_CAPABILITIES = ["workspace-routing", "tool-invocation", "async-process-v1"] as const;

export const workerPlatformSchema = z.enum(["windows", "linux", "darwin"]);
export const workerHelloSchema = z.object({
  protocolVersion: z.literal(QUEQIAO_WORKER_PROTOCOL_VERSION),
  environmentId: environmentIdSchema,
  instanceId: z.uuid(),
  platform: workerPlatformSchema,
  capabilities: z.array(z.string().min(1).max(128)).max(128),
});

export const workerToolInvocationResponseSchema = z.object({ result: z.unknown() });
export const workerProcessExecutionModeSchema = processExecutionModeSchema;
export const workerSyncProcessResultSchema = syncProcessResultSchema;
export const workerAsyncProcessResultSchema = asyncProcessResultSchema;
export const workerRunResultSchema = z.union([workerSyncProcessResultSchema, workerAsyncProcessResultSchema]);
export const workerShellResultSchema = z.union([
  workerSyncProcessResultSchema.extend({ shell: z.string().min(1) }),
  workerAsyncProcessResultSchema.extend({ shell: z.string().min(1) }),
]);

export type WorkerHello = z.infer<typeof workerHelloSchema>;
export type WorkerProcessExecutionMode = z.infer<typeof workerProcessExecutionModeSchema>;
export type WorkerRunResult = z.infer<typeof workerRunResultSchema>;
export type WorkerShellResult = z.infer<typeof workerShellResultSchema>;
export type WorkerToolInvocationResponse<T = unknown> = { result: T };
