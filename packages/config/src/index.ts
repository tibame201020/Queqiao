import { z } from "zod";
import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
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
  profile: permissionProfileSchema.default("read-only"),
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

const environmentSchema = z.object({ environmentId: environmentIdSchema, url: z.url(), tokenFile: z.string().min(1) });
export const runtimeConfigSchema = z.object({
  version: z.literal(QUEQIAO_CONFIG_VERSION),
  gateway: z.object({
    publicBaseUrl: z.url(),
    listen: z.object({ host: z.string().min(1).default("0.0.0.0"), port: z.number().int().min(1).max(65535).default(7575) }),
    trustProxyHops: z.number().int().min(0).max(16).default(1),
    stateDirectory: z.string().min(1), approvalSecretFile: z.string().min(1), jwtSigningSecretFile: z.string().min(1),
    allowedRedirectOrigins: z.array(z.url()).default(["https://chatgpt.com", "http://127.0.0.1", "http://localhost"]),
  }).optional(),
  worker: z.object({
    environmentId: environmentIdSchema,
    listen: z.object({ host: z.literal("127.0.0.1").default("127.0.0.1"), port: z.number().int().min(1).max(65535).default(7576) }),
    tokenFile: z.string().min(1), defaultWorkspaceId: workspaceIdSchema,
  }).optional(),
  environments: z.array(environmentSchema).default([]),
  workspaces: z.array(workspaceConfigSchema).default([]),
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export async function readRuntimeConfig(file: string): Promise<RuntimeConfig> { return runtimeConfigSchema.parse(parse(await readFile(file, "utf8"))); }
export function serializeRuntimeConfig(value: unknown): string { return stringify(runtimeConfigSchema.parse(value), { lineWidth: 0 }); }
