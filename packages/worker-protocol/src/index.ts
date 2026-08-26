import { z } from "zod";
import {
  asyncProcessResultSchema,
  environmentIdSchema,
  permissionProfileSchema,
  processExecutionModeSchema,
  syncProcessResultSchema,
  toolNameSchema,
  workspaceIdSchema,
  workerIdSchema,
} from "@queqiao/contracts";

export const QUEQIAO_WORKER_PROTOCOL_VERSION = "3.0" as const;
export const QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION = "2.0" as const;
export const QUEQIAO_WORKER_HTTP_API_PREFIX = "/v1" as const;

// Protocol 2.0 represented mandatory functionality as a capability list.
// Protocol 3.0 owns mandatory functionality in the protocol version itself;
// capabilities are reserved for optional Worker-native operations.
export const QUEQIAO_WORKER_LEGACY_CAPABILITIES = ["workspace-routing", "tool-invocation", "async-process-v1"] as const;
export const QUEQIAO_WORKER_WORKSPACE_ADMIN_CAPABILITY = "workspace-admin-v1" as const;
export const QUEQIAO_WORKER_OPTIONAL_CAPABILITIES = [QUEQIAO_WORKER_WORKSPACE_ADMIN_CAPABILITY] as const;
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

const workerWorkspaceAddSchema = z.object({
  kind: z.literal("workspace.add"),
  workspace: z.object({
    id: workspaceIdSchema,
    displayName: z.string().min(1).max(128),
    root: z.string().min(1).max(4096),
    profile: permissionProfileSchema,
  }),
});
const workerWorkspaceRemoveSchema = z.object({ kind: z.literal("workspace.remove"), workspaceId: workspaceIdSchema });
const workerWorkspaceProfileSchema = z.object({ kind: z.literal("profile.set"), workspaceId: workspaceIdSchema, profile: permissionProfileSchema });
const workerWorkspaceToolSchema = z.object({ kind: z.literal("tool.decide"), workspaceId: workspaceIdSchema, tool: toolNameSchema, decision: z.enum(["allow", "deny", "inherit"]) });
const workerWorkspaceCommandSchema = z.object({ kind: z.literal("command.decide"), workspaceId: workspaceIdSchema, command: z.string().min(1).max(128), decision: z.enum(["allow", "deny"]) });
export const workerWorkspaceMutationSchema = z.discriminatedUnion("kind", [workerWorkspaceAddSchema, workerWorkspaceRemoveSchema, workerWorkspaceProfileSchema, workerWorkspaceToolSchema, workerWorkspaceCommandSchema]);
export const workerWorkspaceMutationResultSchema = z.object({ changed: z.literal(true), workspaceId: workspaceIdSchema });

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
export type WorkerWorkspaceMutation = z.infer<typeof workerWorkspaceMutationSchema>;
export type WorkerWorkspaceMutationResult = z.infer<typeof workerWorkspaceMutationResultSchema>;
export type WorkerProcessExecutionMode = z.infer<typeof workerProcessExecutionModeSchema>;
export type WorkerRunResult = z.infer<typeof workerRunResultSchema>;
export type WorkerShellResult = z.infer<typeof workerShellResultSchema>;
export type WorkerToolInvocationResponse<T = unknown> = { result: T };
