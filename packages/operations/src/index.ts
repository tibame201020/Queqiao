import { createHash } from "node:crypto";
import { z } from "zod";
import type { InstalledExtensionConfig, ExtensionContribution } from "@queqiao/config";
import type { ToolAnnotations, ToolCapability, ToolRisk } from "@queqiao/contracts";
import { ExtensionCompositionError, resolveExtensionComposition } from "@queqiao/tool-runtime";

export type RuntimeToolContract = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  requiredCapabilities: readonly ToolCapability[];
  risk: ToolRisk;
  annotations: ToolAnnotations;
};

export type PublicToolManifestContract = {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations: ToolAnnotations;
};

export type DeploymentManifest = {
  coreManifestRevision: number;
  tools: readonly PublicToolManifestContract[];
};

export type CompositionFailureDiagnostic = {
  code: string;
  message: string;
  tool?: string;
  extensionIds: readonly string[];
};

export type ExtensionDiagnostic = {
  id: string;
  version: string;
  host: { kind: "gateway" } | { kind: "worker"; environmentId?: string };
  activation: { kind: "global" } | { kind: "workspaces"; workspaceIds: readonly string[] };
  loadState: "loaded" | "not_loaded" | "not_observed";
};

export type ToolCompositionDiagnostic = {
  name: string;
  visibility: "public" | "internal";
  registeredBy: "core" | string;
  replacementBy?: string;
  extenders: readonly { extensionId: string; stage: "before" | "after" | "wrap" }[];
  requiredCapabilities: readonly ToolCapability[];
  risk: ToolRisk;
};

export type OperationsDiagnostics = {
  ok: boolean;
  coreManifestRevision: number;
  deploymentManifestFingerprint: string | null;
  workerProtocolVersion: string;
  supportedMcpProtocolVersions: readonly string[];
  extensions: readonly ExtensionDiagnostic[];
  tools: readonly ToolCompositionDiagnostic[];
  compositionFailure?: CompositionFailureDiagnostic;
};

export type PublicOperationsProjection = {
  coreManifestRevision: number;
  deploymentManifestFingerprint: string | null;
  publicToolCount: number;
  workerProtocolVersion: string;
  supportedMcpProtocolVersions: readonly string[];
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "$schema")
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function runtimePublicContract(tool: RuntimeToolContract): PublicToolManifestContract {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: normalize(z.toJSONSchema(tool.inputSchema, { io: "input" })),
    annotations: tool.annotations,
  };
}

function extensionPublicContract(contribution: Extract<ExtensionContribution, { operation: "register" }>): PublicToolManifestContract {
  return {
    name: contribution.tool,
    title: contribution.title,
    description: contribution.description,
    inputSchema: normalize(contribution.inputSchema),
    ...(contribution.outputSchema ? { outputSchema: normalize(contribution.outputSchema) } : {}),
    annotations: contribution.annotations,
  };
}

export function buildDeploymentManifest(input: {
  coreManifestRevision: number;
  coreTools: readonly RuntimeToolContract[];
  extensions: readonly InstalledExtensionConfig[];
}): DeploymentManifest {
  resolveExtensionComposition(input.extensions.map((extension) => extension.manifest), input.coreTools.map((tool) => tool.name));
  const tools: PublicToolManifestContract[] = input.coreTools.map(runtimePublicContract);
  for (const extension of input.extensions) {
    for (const contribution of extension.manifest.contributions) {
      if (contribution.operation === "register" && contribution.visibility === "public") tools.push(extensionPublicContract(contribution));
    }
  }
  tools.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({ coreManifestRevision: input.coreManifestRevision, tools: Object.freeze(tools) });
}

export function deploymentManifestFingerprint(manifest: DeploymentManifest): string {
  return `sha256:${createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex")}`;
}

function compositionFailure(error: unknown): CompositionFailureDiagnostic {
  if (error instanceof ExtensionCompositionError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details.tool ? { tool: error.details.tool } : {}),
      extensionIds: Object.freeze([...(error.details.extensionIds ?? [])].sort()),
    };
  }
  return { code: "composition_error", message: error instanceof Error ? error.message : "Unknown composition error", extensionIds: [] };
}

function extensionDiagnostics(extensions: readonly InstalledExtensionConfig[], loadedExtensionIds?: readonly string[]): readonly ExtensionDiagnostic[] {
  const loaded = loadedExtensionIds ? new Set(loadedExtensionIds) : undefined;
  return Object.freeze([...extensions].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id)).map((extension) => ({
    id: extension.manifest.id,
    version: extension.manifest.version,
    host: extension.manifest.host.kind === "gateway"
      ? { kind: "gateway" as const }
      : { kind: "worker" as const, ...(extension.manifest.host.environmentId ? { environmentId: extension.manifest.host.environmentId } : {}) },
    activation: extension.activation.kind === "global"
      ? { kind: "global" as const }
      : { kind: "workspaces" as const, workspaceIds: Object.freeze([...extension.activation.workspaceIds].sort()) },
    loadState: !loaded ? "not_observed" as const : loaded.has(extension.manifest.id) ? "loaded" as const : "not_loaded" as const,
  })));
}

function toolDiagnostics(coreTools: readonly RuntimeToolContract[], extensions: readonly InstalledExtensionConfig[]): readonly ToolCompositionDiagnostic[] {
  const plan = resolveExtensionComposition(extensions.map((extension) => extension.manifest), coreTools.map((tool) => tool.name));
  const core = new Map(coreTools.map((tool) => [tool.name, tool]));
  const contributions = new Map<string, { extensionId: string; contribution: Extract<ExtensionContribution, { operation: "register" }> }>();
  for (const extension of extensions) {
    for (const contribution of extension.manifest.contributions) if (contribution.operation === "register") contributions.set(contribution.tool, { extensionId: extension.manifest.id, contribution });
  }
  return Object.freeze([...plan.tools.values()].map((entry) => {
    const coreTool = core.get(entry.tool);
    const registered = contributions.get(entry.tool);
    if (!coreTool && !registered) throw new Error(`Composition plan has no contract for ${entry.tool}`);
    return {
      name: entry.tool,
      visibility: coreTool ? "public" as const : registered!.contribution.visibility,
      registeredBy: coreTool ? "core" as const : registered!.extensionId,
      ...(entry.replacementBy ? { replacementBy: entry.replacementBy } : {}),
      extenders: Object.freeze(entry.extenders.map((extender) => ({ ...extender }))),
      requiredCapabilities: Object.freeze([...(coreTool?.requiredCapabilities ?? registered!.contribution.requiredCapabilities)]),
      risk: coreTool?.risk ?? registered!.contribution.risk,
    };
  }).sort((left, right) => left.name.localeCompare(right.name)));
}

export function buildOperationsDiagnostics(input: {
  coreManifestRevision: number;
  workerProtocolVersion: string;
  supportedMcpProtocolVersions: readonly string[];
  coreTools: readonly RuntimeToolContract[];
  extensions: readonly InstalledExtensionConfig[];
  loadedExtensionIds?: readonly string[];
}): OperationsDiagnostics {
  const extensions = extensionDiagnostics(input.extensions, input.loadedExtensionIds);
  try {
    const manifest = buildDeploymentManifest(input);
    return Object.freeze({
      ok: true,
      coreManifestRevision: input.coreManifestRevision,
      deploymentManifestFingerprint: deploymentManifestFingerprint(manifest),
      workerProtocolVersion: input.workerProtocolVersion,
      supportedMcpProtocolVersions: Object.freeze([...input.supportedMcpProtocolVersions]),
      extensions,
      tools: toolDiagnostics(input.coreTools, input.extensions),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      coreManifestRevision: input.coreManifestRevision,
      deploymentManifestFingerprint: null,
      workerProtocolVersion: input.workerProtocolVersion,
      supportedMcpProtocolVersions: Object.freeze([...input.supportedMcpProtocolVersions]),
      extensions,
      tools: [],
      compositionFailure: compositionFailure(error),
    });
  }
}

export function publicOperationsProjection(diagnostics: OperationsDiagnostics): PublicOperationsProjection {
  return Object.freeze({
    coreManifestRevision: diagnostics.coreManifestRevision,
    deploymentManifestFingerprint: diagnostics.deploymentManifestFingerprint,
    publicToolCount: diagnostics.tools.filter((tool) => tool.visibility === "public").length,
    workerProtocolVersion: diagnostics.workerProtocolVersion,
    supportedMcpProtocolVersions: Object.freeze([...diagnostics.supportedMcpProtocolVersions]),
  });
}

export function explainTool(diagnostics: OperationsDiagnostics, toolName: string): ToolCompositionDiagnostic | undefined {
  return diagnostics.tools.find((tool) => tool.name === toolName);
}
