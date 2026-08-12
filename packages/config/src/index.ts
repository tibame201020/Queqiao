import { z } from "zod";
import {
  approvalMethodSchema,
  environmentIdSchema,
  permissionProfileSchema,
  publicToolNameSchema,
  workspaceIdSchema,
} from "@queqiao/protocol";

export const QUEQIAO_CONFIG_VERSION = 1 as const;

const toolRulesSchema = z.object({
  allow: z.array(publicToolNameSchema).default([]),
  deny: z.array(publicToolNameSchema).default([]),
});

const commandRulesSchema = z.object({
  allow: z.array(z.string().min(1).max(128)).default([]),
});

export const stepUpRuleSchema = z.object({
  tools: z.array(publicToolNameSchema).min(1),
  methods: z.array(approvalMethodSchema).min(1),
  ttlSeconds: z.number().int().min(10).max(600).default(60),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

export const workspaceConfigSchema = z.object({
  id: workspaceIdSchema,
  displayName: z.string().min(1).max(128),
  root: z.string().min(1),
  profile: permissionProfileSchema,
  tools: toolRulesSchema.default({ allow: [], deny: [] }),
  commands: commandRulesSchema.default({ allow: [] }),
  stepUp: z.array(stepUpRuleSchema).default([]),
});

export const workerConfigSchema = z.object({
  version: z.literal(QUEQIAO_CONFIG_VERSION),
  environmentId: environmentIdSchema,
  gatewayUrl: z.url(),
  credentialsFile: z.string().min(1),
  workspaces: z.array(workspaceConfigSchema),
});

export const gatewayConfigSchema = z.object({
  version: z.literal(QUEQIAO_CONFIG_VERSION),
  publicBaseUrl: z.url(),
  listen: z.object({
    host: z.string().min(1).default("127.0.0.1"),
    port: z.number().int().min(1).max(65535),
  }),
  stateDirectory: z.string().min(1),
});

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;
