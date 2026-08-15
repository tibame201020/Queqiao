import { z } from "zod";
import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import {
  approvalMethodSchema,
  environmentIdSchema,
  extensionIdSchema,
  permissionProfileSchema,
  publicToolNameSchema,
  semanticVersionSchema,
  toolAnnotationsSchema,
  toolCapabilitySchema,
  toolNameSchema,
  toolRiskSchema,
  workspaceIdSchema,
  workerIdSchema,
} from "@queqiao/contracts";

export const QUEQIAO_CONFIG_VERSION = 1 as const;

const toolRulesSchema = z.object({
  allow: z.array(toolNameSchema).default([]),
  deny: z.array(toolNameSchema).default([]),
  explicit: z.array(toolNameSchema).default([]),
});

const commandRulesSchema = z.object({
  allow: z.array(z.string().min(1).max(128)).default([]),
});

export const stepUpRuleSchema = z.object({
  tools: z.array(toolNameSchema).min(1),
  methods: z.array(approvalMethodSchema).min(1),
  ttlSeconds: z.number().int().min(10).max(600).default(60),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

export const workspaceConfigSchema = z.object({
  id: workspaceIdSchema,
  displayName: z.string().min(1).max(128),
  root: z.string().min(1),
  profile: permissionProfileSchema.default("read-only"),
  tools: toolRulesSchema.default({ allow: [], deny: [], explicit: [] }),
  commands: commandRulesSchema.default({ allow: [] }),
  stepUp: z.array(stepUpRuleSchema).default([]),
});

export const extensionHostSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gateway") }),
  z.object({ kind: z.literal("worker"), environmentId: environmentIdSchema.optional() }),
]);

export const extensionActivationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("workspaces"), workspaceIds: z.array(workspaceIdSchema).min(1) }),
]);

export const extensionOrderingSchema = z.object({
  requires: z.array(extensionIdSchema).default([]),
  before: z.array(extensionIdSchema).default([]),
  after: z.array(extensionIdSchema).default([]),
});

const jsonSchemaObject = z.record(z.string(), z.json());

export const extensionRegisterDeclarationSchema = z.object({
  operation: z.literal("register"),
  tool: toolNameSchema,
  visibility: z.enum(["public", "internal"]),
  title: z.string().min(1).max(128),
  description: z.string().min(1).max(1024),
  inputSchema: jsonSchemaObject,
  outputSchema: jsonSchemaObject.optional(),
  requiredCapabilities: z.array(toolCapabilitySchema).default([]),
  risk: toolRiskSchema,
  annotations: toolAnnotationsSchema,
});

export const extensionExtendDeclarationSchema = z.object({
  operation: z.literal("extend"),
  tool: toolNameSchema,
  stage: z.enum(["before", "after", "wrap"]),
  requiredCapabilities: z.array(toolCapabilitySchema).default([]),
});

export const extensionReplaceDeclarationSchema = z.object({
  operation: z.literal("replace"),
  tool: toolNameSchema,
  preservesContract: z.literal(true),
  requiredCapabilities: z.array(toolCapabilitySchema).default([]),
});

export const extensionContributionSchema = z.discriminatedUnion("operation", [
  extensionRegisterDeclarationSchema,
  extensionExtendDeclarationSchema,
  extensionReplaceDeclarationSchema,
]);

export const extensionManifestSchema = z.object({
  id: extensionIdSchema,
  version: semanticVersionSchema,
  displayName: z.string().min(1).max(128),
  host: extensionHostSchema,
  ordering: extensionOrderingSchema.default({ requires: [], before: [], after: [] }),
  contributions: z.array(extensionContributionSchema).default([]),
}).superRefine((manifest, ctx) => {
  for (const relation of ["requires", "before", "after"] as const) {
    if (manifest.ordering[relation].includes(manifest.id)) {
      ctx.addIssue({ code: "custom", path: ["ordering", relation], message: `extension cannot ${relation} itself` });
    }
  }
  const registered = new Set<string>();
  for (const [index, contribution] of manifest.contributions.entries()) {
    if (contribution.operation === "register") {
      if (registered.has(contribution.tool)) ctx.addIssue({ code: "custom", path: ["contributions", index, "tool"], message: "tool is registered more than once by the same extension" });
      registered.add(contribution.tool);
    }
  }
});

export const installedExtensionSchema = z.object({
  enabled: z.boolean().default(true),
  trusted: z.literal(true),
  source: z.object({ kind: z.literal("local-module"), module: z.string().min(1).max(4096) }),
  activation: extensionActivationSchema.default({ kind: "global" }),
  manifest: extensionManifestSchema,
});

export const workerConfigSchema = z.object({
  version: z.literal(QUEQIAO_CONFIG_VERSION),
  workerId: workerIdSchema,
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
export type ExtensionHost = z.infer<typeof extensionHostSchema>;
export type ExtensionActivation = z.infer<typeof extensionActivationSchema>;
export type ExtensionContribution = z.infer<typeof extensionContributionSchema>;
export type ExtensionManifestConfig = z.infer<typeof extensionManifestSchema>;
export type InstalledExtensionConfig = z.infer<typeof installedExtensionSchema>;

export const runtimeConfigSchema = z.object({
  version: z.literal(QUEQIAO_CONFIG_VERSION),
  gateway: z.object({
    publicBaseUrl: z.url(),
    listen: z.object({ host: z.literal("127.0.0.1").default("127.0.0.1"), port: z.number().int().min(1).max(65535).default(7575) }),
    managementListen: z.object({ host: z.literal("127.0.0.1").default("127.0.0.1"), port: z.number().int().min(1).max(65535).default(7574) }).default({ host: "127.0.0.1", port: 7574 }),
    livenessIntervalMs: z.number().int().min(5_000).max(3_600_000).default(30_000),
    trustProxyHops: z.number().int().min(0).max(16).default(1),
    stateDirectory: z.string().min(1), approvalSecretFile: z.string().min(1), jwtSigningSecretFile: z.string().min(1),
    allowedRedirectOrigins: z.array(z.url()).default(["https://chatgpt.com", "http://127.0.0.1", "http://localhost"]),
  }).optional(),
  worker: z.object({
    workerId: workerIdSchema.optional(),
    environmentId: environmentIdSchema,
    listen: z.object({ host: z.literal("127.0.0.1").default("127.0.0.1"), port: z.number().int().min(1).max(65535).default(7576) }),
    tokenFile: z.string().min(1), defaultWorkspaceId: workspaceIdSchema,
  }).optional(),
  extensions: z.array(installedExtensionSchema).default([]),
  discovery: z.object({
    roots: z.array(z.string().min(1)).default([]),
    maxDepth: z.number().int().min(1).max(8).default(4),
    exclude: z.array(z.string().min(1).max(128)).default(["node_modules", ".cache", ".config", ".local", ".ssh", ".gnupg", ".aws", ".azure", ".npm", ".nvm"]),
  }).default({ roots: [], maxDepth: 4, exclude: ["node_modules", ".cache", ".config", ".local", ".ssh", ".gnupg", ".aws", ".azure", ".npm", ".nvm"] }),
  workspaces: z.array(workspaceConfigSchema).default([]),
}).superRefine((config, ctx) => {
  const workspaceIds = new Set<string>();
  for (const [index, workspace] of config.workspaces.entries()) {
    if (workspaceIds.has(workspace.id)) ctx.addIssue({ code: "custom", path: ["workspaces", index, "id"], message: "Workspace id must be unique" });
    workspaceIds.add(workspace.id);
  }
  const ids = new Set<string>();
  for (const [index, extension] of config.extensions.entries()) {
    const id = extension.manifest.id;
    if (ids.has(id)) ctx.addIssue({ code: "custom", path: ["extensions", index, "manifest", "id"], message: "extension id must be unique" });
    ids.add(id);
    if (extension.activation.kind === "workspaces") {
      for (const workspaceId of extension.activation.workspaceIds) {
        if (!config.workspaces.some((workspace) => workspace.id === workspaceId)) {
          ctx.addIssue({ code: "custom", path: ["extensions", index, "activation", "workspaceIds"], message: `unknown Workspace: ${workspaceId}` });
        }
      }
    }
  }
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export async function readRuntimeConfig(file: string): Promise<RuntimeConfig> { return runtimeConfigSchema.parse(parse(await readFile(file, "utf8"))); }
export function serializeRuntimeConfig(value: unknown): string { return stringify(runtimeConfigSchema.parse(value), { lineWidth: 0 }); }
