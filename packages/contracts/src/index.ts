import { z } from "zod";

export const MAX_TEXT_MUTATION_BYTES = 64 * 1024;

export const identifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, "must be a stable lowercase identifier");

export const environmentIdSchema = identifierSchema.brand<"EnvironmentId">();
export const workspaceIdSchema = identifierSchema.brand<"WorkspaceId">();

export const permissionProfileSchema = z.enum(["read-only", "editor", "coding"]);
export const assuranceLevelSchema = z.enum(["authenticated", "user-present"]);
export const approvalMethodSchema = z.enum(["local", "one-time-code"]);

export const extensionIdSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/, "must be a reverse-domain extension identifier");
export const semanticVersionSchema = z
  .string()
  .max(128)
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "must be a semantic version");
export const toolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "must be a stable lowercase tool identifier");
export const toolRiskSchema = z.enum(["read", "write", "execute"]);
export const toolCapabilitySchema = z.enum(["workspace:read", "workspace:write", "workspace:exec"]);
export const toolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean(),
  destructiveHint: z.boolean(),
  openWorldHint: z.boolean(),
  idempotentHint: z.boolean().optional(),
});

export const processExecutionModeSchema = z.enum(["sync", "async"]);
export const syncProcessResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  aborted: z.boolean(),
  outputLimitExceeded: z.boolean(),
});
export const asyncProcessResultSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().datetime({ offset: true }),
  timeoutMs: z.number().int().positive(),
  stdout: z.literal("discarded"),
  stderr: z.literal("discarded"),
});
export const processExecutionResultSchema = z.union([syncProcessResultSchema, asyncProcessResultSchema]);

export const publicToolNameSchema = z.enum([
  "workspace_info",
  "list_environments",
  "list_workspaces",
  "open_workspace",
  "list_directory",
  "list_files",
  "read_file",
  "search_text",
  "write_file",
  "edit_file",
  "apply_patch",
  "run",
  "shell",
]);

export const workspaceDescriptorSchema = z.object({
  environmentId: environmentIdSchema,
  workspaceId: workspaceIdSchema,
  displayName: z.string().min(1).max(128),
  profile: permissionProfileSchema,
  online: z.boolean(),
});

export type EnvironmentId = z.infer<typeof environmentIdSchema>;
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;
export type AssuranceLevel = z.infer<typeof assuranceLevelSchema>;
export type ApprovalMethod = z.infer<typeof approvalMethodSchema>;
export type ExtensionId = z.infer<typeof extensionIdSchema>;
export type SemanticVersion = z.infer<typeof semanticVersionSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolRisk = z.infer<typeof toolRiskSchema>;
export type ToolCapability = z.infer<typeof toolCapabilitySchema>;
export type ToolAnnotations = z.infer<typeof toolAnnotationsSchema>;
export type ProcessExecutionMode = z.infer<typeof processExecutionModeSchema>;
export type SyncProcessResult = z.infer<typeof syncProcessResultSchema>;
export type AsyncProcessResultContract = z.infer<typeof asyncProcessResultSchema>;
export type ProcessExecutionResult = z.infer<typeof processExecutionResultSchema>;
export type PublicToolName = z.infer<typeof publicToolNameSchema>;
export type WorkspaceDescriptor = z.infer<typeof workspaceDescriptorSchema>;
