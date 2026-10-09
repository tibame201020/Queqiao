import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

const commandExecutableSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/);
const commandCwdSchema = z.string().min(1).max(256)
  .refine((value) => value === "." || (
    !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((segment) => segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment))
  ), "Exact process cwd must be a workspace-relative literal without traversal");
const exactCommandSchema = z.object({
  executable: commandExecutableSchema,
  args: z.array(z.string().max(4096)).max(32),
  cwd: commandCwdSchema,
  mode: z.enum(["sync", "async", "job"]),
  maxTimeoutMs: z.number().int().min(1000).max(600_000),
});
const commandRulesSchema = z.object({
  allow: z.array(z.string().min(1).max(128)).default([]),
  // Omitted = legacy behavior. Present, including [] = require exact matching.
  exact: z.array(exactCommandSchema).max(32).optional(),
}).superRefine((policy, context) => {
  for (const [index, invocation] of (policy.exact ?? []).entries()) {
    if (!policy.allow.some((allowed) => allowed.toLowerCase() === invocation.executable.toLowerCase())) {
      context.addIssue({ code: "custom", path: ["exact", index, "executable"],
        message: "Exact executable must appear in the workspace command allowlist" });
    }
  }
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

const extensionExecutableSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/);
const extensionHttpOriginSchema = z.string().min(1).max(2048).transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "Outbound HTTP origin must use http or https" });
      return z.NEVER;
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      ctx.addIssue({ code: "custom", message: "Outbound HTTP grant must be an exact origin without credentials, path, query, or fragment" });
      return z.NEVER;
    }
    return url.origin;
  } catch {
    ctx.addIssue({ code: "custom", message: "Outbound HTTP origin must be a valid URL origin" });
    return z.NEVER;
  }
});

export const extensionRuntimePolicySchema = z.object({
  processes: z.object({ allow: z.array(extensionExecutableSchema).max(64).default([]) }).default({ allow: [] }),
  outboundHttp: z.object({ allowOrigins: z.array(extensionHttpOriginSchema).max(64).default([]) }).default({ allowOrigins: [] }),
});
export type ExtensionRuntimePolicy = z.infer<typeof extensionRuntimePolicySchema>;

export function extensionRuntimePolicyFor(manifest: { runtime?: ExtensionRuntimePolicy }): ExtensionRuntimePolicy {
  return extensionRuntimePolicySchema.parse(manifest.runtime ?? {});
}

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
  runtime: extensionRuntimePolicySchema.optional(),
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

export const extensionPackageMetadataSchema = z.object({
  apiVersion: z.literal(1),
  module: z.string().min(1).max(4096),
  manifest: extensionManifestSchema,
});

export const extensionSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-module"), module: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal("local"), package: z.string().min(1).max(214), version: semanticVersionSchema, root: z.string().min(1).max(4096), module: z.string().min(1).max(4096) }),
  z.object({
    kind: z.literal("npm"),
    package: z.string().min(1).max(214),
    requested: z.string().min(1).max(256),
    version: semanticVersionSchema,
    module: z.string().min(1).max(4096),
    installDirectory: z.string().min(1).max(4096),
  }),
]);

export const installedExtensionSchema = z.object({
  trusted: z.literal(true),
  source: extensionSourceSchema,
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

export function effectiveGatewayWorkerSessionPort(gateway: { listen: { port: number }; workerSessionListen?: { port: number } | undefined }): number {
  const port = gateway.workerSessionListen?.port ?? gateway.listen.port - 2;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Worker session port must be between 1 and 65535");
  return port;
}

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;
export type ExtensionHost = z.infer<typeof extensionHostSchema>;
export type ExtensionActivation = z.infer<typeof extensionActivationSchema>;
export type ExtensionContribution = z.infer<typeof extensionContributionSchema>;
export type ExtensionManifestConfig = z.infer<typeof extensionManifestSchema>;
export type ExtensionPackageMetadata = z.infer<typeof extensionPackageMetadataSchema>;
export type ExtensionSource = z.infer<typeof extensionSourceSchema>;
export type InstalledExtensionConfig = z.infer<typeof installedExtensionSchema>;

const runtimeConfigBaseSchema = z.object({
  version: z.literal(QUEQIAO_CONFIG_VERSION),
  gateway: z.object({
    publicBaseUrl: z.url(),
    listen: z.object({ host: z.literal("127.0.0.1").default("127.0.0.1"), port: z.number().int().min(1).max(65535).default(7575) }),
    managementListen: z.object({ host: z.literal("127.0.0.1").default("127.0.0.1"), port: z.number().int().min(1).max(65535).default(7574) }).default({ host: "127.0.0.1", port: 7574 }),
    workerSessionListen: z.object({ host: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"), port: z.number().int().min(1).max(65535) }).optional(),
    workerSessionAdvertiseHost: z.string().min(1).max(253).optional(),
    workerSessionTls: z.object({ certFile: z.string().min(1), keyFile: z.string().min(1) }).optional(),
    livenessIntervalMs: z.number().int().min(5_000).max(3_600_000).default(30_000),
    trustProxyHops: z.number().int().min(0).max(16).default(1),
    stateDirectory: z.string().min(1), approvalSecretFile: z.string().min(1), jwtSigningSecretFile: z.string().min(1),
    allowedRedirectOrigins: z.array(z.url()).default(["https://chatgpt.com", "http://127.0.0.1", "http://localhost"]),
    runtimeProviders: z.object({
      githubActions: z.object({
        owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
        repo: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
        workflowId: z.string().min(1).max(255),
        ref: z.string().min(1).max(255).default("main"),
        tokenFile: z.string().min(1).optional(),
        auth: z.literal("gh-cli").optional(),
        audience: z.string().min(1).max(2048).optional(),
        // Gate C test-only MCP controls; disabled by default on every Gateway.
        mcpPocEnabled: z.boolean().optional(),
        // Task API preview: explicit SHA is mandatory, cannot coexist with POC tools.
        shortTasksPreview: z.object({
          enabled: z.literal(true),
          sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
        }).optional(),
      }).superRefine((provider, ctx) => {
        if (provider.mcpPocEnabled && provider.shortTasksPreview?.enabled) {
          ctx.addIssue({ code: "custom", message: "POC and short-task Preview MCP controls are mutually exclusive" });
        }
      }).optional(),
    }).default({}),
  }).optional(),
  worker: z.object({
    workerId: workerIdSchema.optional(),
    environmentId: environmentIdSchema,
    listen: z.object({ host: z.literal("127.0.0.1").default("127.0.0.1"), port: z.number().int().min(1).max(65535).default(7576) }),
    // Local control credential used only by CLI/Workstation -> local Worker control APIs.
    tokenFile: z.string().min(1),
    memberships: z.array(z.object({
      gateway: z.url().transform((value) => new URL(value).href),
      credentialRef: z.object({ kind: z.literal("secret-file"), path: z.string().min(1).max(4096) }),
      protocols: z.object({
        grpc: z.object({
          target: z.string().min(3).max(512),
          security: z.enum(["tls", "loopback"]).default("tls"),
          caCertificateFile: z.string().min(1).optional(),
        }).superRefine((grpc, ctx) => {
          if (grpc.security === "tls" && !grpc.caCertificateFile) ctx.addIssue({ code: "custom", path: ["caCertificateFile"], message: "TLS gRPC membership requires a CA certificate file" });
        }).optional(),
        websocket: z.object({
          url: z.url().superRefine((value, ctx) => {
            const url = new URL(value);
            if (url.protocol !== "ws:" && url.protocol !== "wss:") ctx.addIssue({ code: "custom", message: "WebSocket membership URL must use ws or wss" });
          }),
        }).optional(),
      }).catchall(z.unknown()).default({}),
    })).default([]),
    // Legacy single-Gateway reverse-session state. Readable during migration only.
    reverseSession: z.object({
      target: z.string().min(3).max(512),
      caCertificateFile: z.string().min(1),
    }).optional(),
  }).optional(),
  extensions: z.array(installedExtensionSchema).default([]),
  workspaces: z.array(workspaceConfigSchema).default([]),
});

export const runtimeConfigRepairSchema = runtimeConfigBaseSchema.superRefine((config, ctx) => {
  const githubActions = config.gateway?.runtimeProviders.githubActions;
  if (githubActions && !githubActions.tokenFile && githubActions.auth !== "gh-cli") {
    ctx.addIssue({ code: "custom", path: ["gateway", "runtimeProviders", "githubActions", "tokenFile"], message: "tokenFile is required unless auth is gh-cli" });
  }
  if (githubActions?.auth === "gh-cli" && !githubActions.mcpPocEnabled && !githubActions.shortTasksPreview?.enabled) {
    ctx.addIssue({ code: "custom", path: ["gateway", "runtimeProviders", "githubActions", "auth"], message: "gh-cli authentication requires isolated POC or short-task Preview" });
  }
  if (config.gateway?.workerSessionListen?.host === "0.0.0.0") {
    if (!config.gateway.workerSessionAdvertiseHost) ctx.addIssue({ code: "custom", path: ["gateway", "workerSessionAdvertiseHost"], message: "Remote Worker session listener requires an advertised host" });
    if (!config.gateway.workerSessionTls) ctx.addIssue({ code: "custom", path: ["gateway", "workerSessionTls"], message: "Remote Worker session listener requires TLS" });
  }
  if (config.worker) {
    const gateways = new Set<string>();
    for (const [index, membership] of config.worker.memberships.entries()) {
      if (gateways.has(membership.gateway)) ctx.addIssue({ code: "custom", path: ["worker", "memberships", index, "gateway"], message: "Worker Gateway membership URL must be unique" });
      gateways.add(membership.gateway);
      if (path.resolve(membership.credentialRef.path) === path.resolve(config.worker.tokenFile)) {
        ctx.addIssue({ code: "custom", path: ["worker", "memberships", index, "credentialRef", "path"], message: "Gateway membership credential must be separate from the Worker local control credential" });
      }
    }
  }
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

export const runtimeConfigSchema = runtimeConfigRepairSchema.superRefine((config, ctx) => {
  if (config.gateway) {
    try {
      const workerSessionPort = effectiveGatewayWorkerSessionPort(config.gateway);
      if (workerSessionPort === config.gateway.listen.port) ctx.addIssue({ code: "custom", path: ["gateway", "workerSessionListen", "port"], message: "Worker session port must be different from Gateway port" });
      if (workerSessionPort === config.gateway.managementListen.port) ctx.addIssue({ code: "custom", path: ["gateway", "workerSessionListen", "port"], message: "Worker session port must be different from Management port" });
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["gateway", "workerSessionListen", "port"], message: error instanceof Error ? error.message : "Worker session port is invalid" });
    }
  }
  if (config.worker && config.workspaces.length < 1) {
    ctx.addIssue({ code: "custom", path: ["workspaces"], message: "Worker must have at least one Workspace" });
  }
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type RepairRuntimeConfig = z.infer<typeof runtimeConfigRepairSchema>;
export async function readRuntimeConfig(file: string): Promise<RuntimeConfig> { return runtimeConfigSchema.parse(parse(await readFile(file, "utf8"))); }
export async function readRuntimeConfigForRepair(file: string): Promise<RepairRuntimeConfig> { return runtimeConfigRepairSchema.parse(parse(await readFile(file, "utf8"))); }
export function serializeRuntimeConfig(value: unknown): string { return stringify(runtimeConfigSchema.parse(value), { lineWidth: 0 }); }