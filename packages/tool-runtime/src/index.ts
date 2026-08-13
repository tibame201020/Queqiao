import { z } from "zod";
import {
  extensionIdSchema,
  semanticVersionSchema,
  toolNameSchema,
  type ToolAnnotations,
  type ToolCapability,
  type ToolRisk,
} from "@queqiao/contracts";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContribution, ExtensionManifestConfig, InstalledExtensionConfig } from "@queqiao/config";

export type { ToolAnnotations, ToolCapability, ToolRisk } from "@queqiao/contracts";

export type ToolDefinition<TContext> = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  requiredCapabilities: readonly ToolCapability[];
  risk: ToolRisk;
  annotations: ToolAnnotations;
  execute(input: unknown, context: TContext): Promise<unknown>;
};

export type ToolCall<TContext> = { toolName: string; input: unknown; context: TContext };
export type ToolAuthorityGuard<TContext> = (call: ToolCall<TContext> & { contract: ToolDefinition<TContext> }) => Promise<void> | void;
export type BeforeToolCallHook<TContext> = (call: ToolCall<TContext>) => Promise<{ block: true; reason: string } | void> | { block: true; reason: string } | void;
export type AfterToolCallHook<TContext> = (call: ToolCall<TContext> & { result: unknown }) => Promise<unknown | void> | unknown | void;
export type WrapToolCallHook<TContext> = (call: ToolCall<TContext>, next: () => Promise<unknown>) => Promise<unknown>;

export type ExtensionModuleManifest = { id: string; version: string; displayName: string; supportedEnvironments?: readonly ("gateway" | "windows" | "linux" | "darwin")[] };
export type ExtensionApi<TContext> = {
  registerTool(definition: ToolDefinition<TContext>): void;
  extendTool(toolName: string, stage: "before", hook: BeforeToolCallHook<TContext>): void;
  extendTool(toolName: string, stage: "after", hook: AfterToolCallHook<TContext>): void;
  extendTool(toolName: string, stage: "wrap", hook: WrapToolCallHook<TContext>): void;
  replaceTool(toolName: string, definition: ToolDefinition<TContext>): void;
};
export type QueqiaoExtension<TContext> = { manifest: ExtensionModuleManifest; activate(api: ExtensionApi<TContext>): void };

export type CompositionExtension = Pick<ExtensionManifestConfig, "id" | "ordering" | "contributions">;
export type ResolvedToolComposition = {
  tool: string;
  registeredBy?: string;
  replacementBy?: string;
  extenders: readonly { extensionId: string; stage: "before" | "after" | "wrap" }[];
};
export type ExtensionCompositionPlan = {
  order: readonly string[];
  tools: ReadonlyMap<string, ResolvedToolComposition>;
};

export type ExtensionCompositionErrorCode =
  | "duplicate_extension"
  | "self_cycle"
  | "missing_dependency"
  | "dependency_cycle"
  | "registration_collision"
  | "unknown_tool_target"
  | "multiple_replacements";

export class ExtensionCompositionError extends Error {
  constructor(
    readonly code: ExtensionCompositionErrorCode,
    message: string,
    readonly details: { tool?: string; extensionIds?: readonly string[] } = {},
  ) { super(message); this.name = "ExtensionCompositionError"; }
}

export function resolveExtensionComposition(manifests: readonly CompositionExtension[], coreTools: readonly string[] = []): ExtensionCompositionPlan {
  const byId = new Map<string, CompositionExtension>();
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) throw new ExtensionCompositionError("duplicate_extension", `Duplicate extension id: ${manifest.id}`, { extensionIds: [manifest.id] });
    byId.set(manifest.id, manifest);
  }

  const edges = new Map<string, Set<string>>([...byId.keys()].map((id) => [id, new Set<string>()]));
  const indegree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
  const addEdge = (from: string, to: string) => {
    if (from === to) throw new ExtensionCompositionError("self_cycle", `Extension ordering self-cycle: ${from}`, { extensionIds: [from] });
    const targets = edges.get(from);
    if (!targets || !indegree.has(to)) return;
    if (!targets.has(to)) { targets.add(to); indegree.set(to, (indegree.get(to) ?? 0) + 1); }
  };

  for (const manifest of byId.values()) {
    for (const required of manifest.ordering.requires) {
      if (!byId.has(required)) throw new ExtensionCompositionError("missing_dependency", `Missing required extension ${required} for ${manifest.id}`, { extensionIds: [manifest.id, required] });
      addEdge(required, manifest.id);
    }
    for (const before of manifest.ordering.before) if (byId.has(before)) addEdge(manifest.id, before);
    for (const after of manifest.ordering.after) if (byId.has(after)) addEdge(after, manifest.id);
  }

  const ready = [...byId.keys()].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const target of [...(edges.get(id) ?? [])].sort()) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) { ready.push(target); ready.sort(); }
    }
  }
  if (order.length !== byId.size) {
    const blocked = [...byId.keys()].filter((id) => !order.includes(id)).sort();
    throw new ExtensionCompositionError("dependency_cycle", `Extension dependency cycle: ${blocked.join(", ")}`, { extensionIds: blocked });
  }

  const tools = new Map<string, { tool: string; registeredBy?: string; replacementBy?: string; extenders: { extensionId: string; stage: "before" | "after" | "wrap" }[] }>();
  for (const tool of coreTools) tools.set(tool, { tool, extenders: [] });
  const position = new Map(order.map((id, index) => [id, index]));
  for (const id of order) {
    const manifest = byId.get(id)!;
    for (const contribution of manifest.contributions) {
      if (contribution.operation === "register") {
        if (tools.has(contribution.tool)) throw new ExtensionCompositionError("registration_collision", `Tool registration collision: ${contribution.tool}`, { tool: contribution.tool, extensionIds: [id] });
        tools.set(contribution.tool, { tool: contribution.tool, registeredBy: id, extenders: [] });
      }
    }
  }
  for (const id of order) {
    const manifest = byId.get(id)!;
    for (const contribution of manifest.contributions) {
      if (contribution.operation === "register") continue;
      const tool = tools.get(contribution.tool);
      if (!tool) throw new ExtensionCompositionError("unknown_tool_target", `${contribution.operation} targets unknown tool: ${contribution.tool}`, { tool: contribution.tool, extensionIds: [id] });
      if (contribution.operation === "replace") {
        if (tool.replacementBy) throw new ExtensionCompositionError("multiple_replacements", `Multiple replacements for ${contribution.tool}: ${tool.replacementBy}, ${id}`, { tool: contribution.tool, extensionIds: [tool.replacementBy, id] });
        tool.replacementBy = id;
      } else {
        tool.extenders.push({ extensionId: id, stage: contribution.stage });
      }
    }
  }
  for (const tool of tools.values()) tool.extenders.sort((a, b) => (position.get(a.extensionId)! - position.get(b.extensionId)!) || a.stage.localeCompare(b.stage));
  return { order: Object.freeze([...order]), tools };
}

const moduleManifestSchema = z.object({ id: extensionIdSchema, version: semanticVersionSchema, displayName: z.string().min(1).max(128) });
export type RuntimeExtension<TContext> = { config: ExtensionManifestConfig; module: QueqiaoExtension<TContext> };
export type ExtensionHostTarget = { kind: "gateway" } | { kind: "worker"; environmentId: string };
export type ExtensionModuleImporter = (specifier: string) => Promise<unknown>;

function hostMatches(extension: InstalledExtensionConfig, target: ExtensionHostTarget): boolean {
  const host = extension.manifest.host;
  return host.kind === target.kind && (host.kind !== "worker" || (target.kind === "worker" && (!host.environmentId || host.environmentId === target.environmentId)));
}

export function extensionActiveForWorkspace(extension: InstalledExtensionConfig, workspaceId: string): boolean {
  return extension.enabled && (extension.activation.kind === "global" || extension.activation.workspaceIds.some((configuredId) => configuredId === workspaceId));
}

function moduleSpecifier(module: string, configDirectory: string): string {
  if (module.startsWith("file:")) return module;
  if (isAbsolute(module)) return pathToFileURL(module).href;
  if (module.startsWith("./") || module.startsWith("../") || module.startsWith(".\\") || module.startsWith("..\\")) {
    return pathToFileURL(resolvePath(configDirectory, module)).href;
  }
  return module;
}

function extensionExport<TContext>(loaded: unknown): QueqiaoExtension<TContext> {
  if (!loaded || typeof loaded !== "object") throw new Error("Extension module must export an object");
  const record = loaded as Record<string, unknown>;
  const candidate = (record["default"] ?? record["queqiaoExtension"]) as QueqiaoExtension<TContext> | undefined;
  if (!candidate || typeof candidate !== "object" || typeof candidate.activate !== "function") throw new Error("Extension module must export default or queqiaoExtension");
  moduleManifestSchema.parse(candidate.manifest);
  return candidate;
}

/** Explicit trusted-module loader. It never scans Workspace or repository content. */
export class ExtensionHost<TContext> {
  private loaded: ReadonlyMap<string, RuntimeExtension<TContext>> = new Map();

  constructor(
    private readonly configured: readonly InstalledExtensionConfig[],
    private readonly target: ExtensionHostTarget,
    private readonly configDirectory: string,
    private readonly importer: ExtensionModuleImporter = (specifier) => import(specifier),
    private readonly coreToolNames: readonly string[] = [],
  ) {}

  async load(): Promise<void> {
    const selected = this.configured.filter((extension) => extension.enabled && hostMatches(extension, this.target));
    resolveExtensionComposition(selected.map((extension) => extension.manifest), this.coreToolNames);
    const staged = new Map<string, RuntimeExtension<TContext>>();
    for (const extension of selected) {
      const loaded = await this.importer(moduleSpecifier(extension.source.module, this.configDirectory));
      const module = extensionExport<TContext>(loaded);
      if (module.manifest.id !== extension.manifest.id || module.manifest.version !== extension.manifest.version) {
        throw new Error(`Extension module identity/version mismatch: ${extension.manifest.id}`);
      }
      staged.set(extension.manifest.id, { config: extension.manifest, module });
    }
    this.loaded = staged;
  }

  loadedIds(): readonly string[] { return Object.freeze([...this.loaded.keys()].sort()); }

  /** Deployment-level public declarations intentionally ignore Workspace selection. */
  publicManifests(): readonly ExtensionManifestConfig[] {
    return Object.freeze([...this.loaded.values()]
      .map((entry) => entry.config)
      .filter((manifest) => manifest.contributions.some((contribution) => contribution.operation === "register" && contribution.visibility === "public"))
      .sort((a, b) => a.id.localeCompare(b.id)));
  }

  activeIds(workspaceId: string): readonly string[] {
    const configuredById = new Map(this.configured.map((entry) => [entry.manifest.id, entry]));
    return Object.freeze([...this.loaded.keys()].filter((id) => {
      const extension = configuredById.get(id);
      return extension ? extensionActiveForWorkspace(extension, workspaceId) : false;
    }).sort());
  }

  runtimeForWorkspace(workspaceId: string, coreTools: readonly ToolDefinition<TContext>[] = [], authority?: ToolAuthorityGuard<TContext>): ToolRuntime<TContext> {
    const active = new Set(this.activeIds(workspaceId));
    const entries = [...this.loaded.values()].filter((entry) => active.has(entry.config.id));
    return new ToolRuntime<TContext>(coreTools, authority).compose(entries);
  }
}

type RuntimeTool<TContext> = {
  base?: ToolDefinition<TContext>;
  replacement?: ToolDefinition<TContext>;
  before: BeforeToolCallHook<TContext>[];
  after: AfterToolCallHook<TContext>[];
  wraps: WrapToolCallHook<TContext>[];
};

function contributionMatches(contributions: readonly ExtensionContribution[], operation: ExtensionContribution["operation"], tool: string, stage?: "before" | "after" | "wrap"): boolean {
  return contributions.some((entry) => entry.operation === operation && entry.tool === tool && (operation !== "extend" || (entry.operation === "extend" && entry.stage === stage)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "$schema").sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameCapabilities(left: readonly ToolCapability[], right: readonly ToolCapability[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function assertRegisteredContract<TContext>(definition: ToolDefinition<TContext>, declaration: Extract<ExtensionContribution, { operation: "register" }>): void {
  if (definition.title !== declaration.title || definition.description !== declaration.description) throw new Error(`Registered tool metadata mismatch: ${definition.name}`);
  if (!sameCapabilities(definition.requiredCapabilities, declaration.requiredCapabilities) || definition.risk !== declaration.risk) throw new Error(`Registered tool authority metadata mismatch: ${definition.name}`);
  if (stableJson(definition.annotations) !== stableJson(declaration.annotations)) throw new Error(`Registered tool annotations mismatch: ${definition.name}`);
  if (stableJson(z.toJSONSchema(definition.inputSchema, { io: "input" })) !== stableJson(declaration.inputSchema)) throw new Error(`Registered tool input schema mismatch: ${definition.name}`);
}

function assertReplacementContract<TContext>(base: ToolDefinition<TContext>, replacement: ToolDefinition<TContext>): void {
  if (replacement.name !== base.name || replacement.title !== base.title || replacement.description !== base.description) throw new Error(`Replacement contract metadata mismatch: ${base.name}`);
  if (!sameCapabilities(replacement.requiredCapabilities, base.requiredCapabilities) || replacement.risk !== base.risk) throw new Error(`Replacement contract authority mismatch: ${base.name}`);
  if (stableJson(replacement.annotations) !== stableJson(base.annotations)) throw new Error(`Replacement contract annotations mismatch: ${base.name}`);
  if (stableJson(z.toJSONSchema(replacement.inputSchema, { io: "input" })) !== stableJson(z.toJSONSchema(base.inputSchema, { io: "input" }))) throw new Error(`Replacement contract input schema mismatch: ${base.name}`);
}

export class ToolRuntime<TContext> {
  private readonly tools = new Map<string, RuntimeTool<TContext>>();
  private sealed = false;

  constructor(coreTools: readonly ToolDefinition<TContext>[] = [], private readonly authority?: ToolAuthorityGuard<TContext>) {
    for (const definition of coreTools) this.addCoreTool(definition);
  }

  private addCoreTool(definition: ToolDefinition<TContext>): void {
    if (!toolNameSchema.safeParse(definition.name).success) throw new Error(`Invalid tool name: ${definition.name}`);
    if (this.tools.has(definition.name)) throw new Error(`Tool is already registered: ${definition.name}`);
    this.tools.set(definition.name, { base: Object.freeze({ ...definition }), before: [], after: [], wraps: [] });
  }

  /** Core bootstrap compatibility path. Configured extensions must use compose(). */
  registerExtension(extension: QueqiaoExtension<TContext>): void {
    if (this.sealed) throw new Error("Tool runtime is sealed");
    moduleManifestSchema.parse(extension.manifest);
    const owned: string[] = [];
    const api: ExtensionApi<TContext> = {
      registerTool: (definition) => { this.addCoreTool(definition); owned.push(definition.name); },
      extendTool: (() => { throw new Error("Configured extension composition is required for extendTool"); }) as ExtensionApi<TContext>["extendTool"],
      replaceTool: () => { throw new Error("Configured extension composition is required for replaceTool"); },
    };
    try { extension.activate(api); }
    catch (error) { for (const name of owned) this.tools.delete(name); throw error; }
  }

  seal(): this { this.sealed = true; return this; }

  compose(extensions: readonly RuntimeExtension<TContext>[]): this {
    if (this.sealed) throw new Error("Tool runtime is sealed");
    const plan = resolveExtensionComposition(extensions.map((entry) => entry.config), [...this.tools.keys()]);
    const byId = new Map(extensions.map((entry) => [entry.config.id, entry]));
    const snapshot = new Map([...this.tools].map(([name, tool]) => [name, { ...tool, before: [...tool.before], after: [...tool.after], wraps: [...tool.wraps] }]));
    try {
      for (const id of plan.order) this.activateExtension(byId.get(id)!);
      this.sealed = true;
      return this;
    } catch (error) {
      this.tools.clear();
      for (const [name, tool] of snapshot) this.tools.set(name, tool);
      throw error;
    }
  }

  private activateExtension(entry: RuntimeExtension<TContext>): void {
    const parsed = moduleManifestSchema.parse(entry.module.manifest);
    if (parsed.id !== entry.config.id || parsed.version !== entry.config.version) throw new Error(`Extension module identity/version mismatch: ${entry.config.id}`);
    const declared = entry.config.contributions;
    const api: ExtensionApi<TContext> = {
      registerTool: (definition) => {
        const declaration = declared.find((candidate): candidate is Extract<ExtensionContribution, { operation: "register" }> => candidate.operation === "register" && candidate.tool === definition.name);
        if (!declaration) throw new Error(`Undeclared register contribution: ${definition.name}`);
        assertRegisteredContract(definition, declaration);
        if (this.tools.has(definition.name)) throw new Error(`Tool is already registered: ${definition.name}`);
        this.tools.set(definition.name, { base: Object.freeze({ ...definition }), before: [], after: [], wraps: [] });
      },
      extendTool: ((toolName: string, stage: "before" | "after" | "wrap", hook: BeforeToolCallHook<TContext> | AfterToolCallHook<TContext> | WrapToolCallHook<TContext>) => {
        const declaration = declared.find((candidate): candidate is Extract<ExtensionContribution, { operation: "extend" }> => candidate.operation === "extend" && candidate.tool === toolName && candidate.stage === stage);
        if (!declaration) throw new Error(`Undeclared ${stage} extension: ${toolName}`);
        const tool = this.tools.get(toolName); if (!tool?.base) throw new Error(`Tool not found: ${toolName}`);
        if (declaration.requiredCapabilities.some((capability) => !tool.base!.requiredCapabilities.includes(capability))) throw new Error(`Extension capability exceeds target contract: ${toolName}`);
        if (stage === "before") tool.before.push(hook as BeforeToolCallHook<TContext>);
        else if (stage === "after") tool.after.push(hook as AfterToolCallHook<TContext>);
        else tool.wraps.push(hook as WrapToolCallHook<TContext>);
      }) as ExtensionApi<TContext>["extendTool"],
      replaceTool: (toolName, definition) => {
        const declaration = declared.find((candidate): candidate is Extract<ExtensionContribution, { operation: "replace" }> => candidate.operation === "replace" && candidate.tool === toolName);
        if (!declaration) throw new Error(`Undeclared replacement: ${toolName}`);
        const tool = this.tools.get(toolName); if (!tool?.base) throw new Error(`Tool not found: ${toolName}`);
        if (!sameCapabilities(declaration.requiredCapabilities, tool.base.requiredCapabilities)) throw new Error(`Replacement declaration authority mismatch: ${toolName}`);
        if (tool.replacement) throw new Error(`Tool already has a replacement: ${toolName}`);
        assertReplacementContract(tool.base, definition);
        tool.replacement = Object.freeze({ ...definition });
      },
    };
    entry.module.activate(api);
  }

  /** Definitions always expose the original registered contract, never replacement metadata. */
  definitions(): readonly ToolDefinition<TContext>[] {
    return [...this.tools.values()].flatMap((tool) => tool.base ? [tool.base] : []);
  }

  async execute(toolName: string, input: unknown, context: TContext): Promise<unknown> {
    const runtime = this.tools.get(toolName);
    const contract = runtime?.base;
    if (!runtime || !contract) throw new Error(`Tool not found: ${toolName}`);
    const parsed = contract.inputSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid tool arguments");
    const call: ToolCall<TContext> = { toolName, input: parsed.data, context };
    await this.authority?.({ ...call, contract });
    for (const hook of runtime.before) { const decision = await hook(call); if (decision?.block) throw new Error(decision.reason); }
    const implementation = runtime.replacement ?? contract;
    let invoke = () => implementation.execute(call.input, context);
    for (const wrap of [...runtime.wraps].reverse()) { const next = invoke; invoke = () => wrap(call, next); }
    let result = await invoke();
    for (const hook of runtime.after) result = (await hook({ ...call, result })) ?? result;
    return result;
  }
}
