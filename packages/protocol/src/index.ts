import { z } from "zod";

export * from "./v0-tools.js";

export const QUEQIAO_PROTOCOL_VERSION = "1.0" as const;
export const QUEQIAO_WORKER_CAPABILITIES = ["workspace-routing", "tool-invocation"] as const;
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
]);

export const workerHelloSchema = z.object({
  protocolVersion: z.literal(QUEQIAO_PROTOCOL_VERSION),
  environmentId: environmentIdSchema,
  instanceId: z.uuid(),
  platform: z.enum(["windows", "linux", "darwin"]),
  capabilities: z.array(z.string().min(1).max(128)).max(128),
});

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
export type PublicToolName = z.infer<typeof publicToolNameSchema>;
export type WorkerHello = z.infer<typeof workerHelloSchema>;
export type WorkspaceDescriptor = z.infer<typeof workspaceDescriptorSchema>;
