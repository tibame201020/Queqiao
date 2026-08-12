import { z } from "zod";

export type ToolRisk = "read" | "write" | "execute";
export type ToolCapability = "workspace:read" | "workspace:write" | "workspace:exec";

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
};

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

export type ToolCall<TContext> = {
  toolName: string;
  input: unknown;
  context: TContext;
};

export type BeforeToolCallHook<TContext> = (
  call: ToolCall<TContext>,
) => Promise<{ block: true; reason: string } | void> | { block: true; reason: string } | void;

export type AfterToolCallHook<TContext> = (
  call: ToolCall<TContext> & { result: unknown },
) => Promise<unknown | void> | unknown | void;

export type ExtensionManifest = {
  id: string;
  version: string;
  displayName: string;
  supportedEnvironments: readonly ("gateway" | "windows" | "linux" | "darwin")[];
};

export type ExtensionApi<TContext> = {
  registerTool(definition: ToolDefinition<TContext>): void;
  onBeforeToolCall(hook: BeforeToolCallHook<TContext>): void;
  onAfterToolCall(hook: AfterToolCallHook<TContext>): void;
};

export type QueqiaoExtension<TContext> = {
  manifest: ExtensionManifest;
  activate(api: ExtensionApi<TContext>): void;
};

const extensionIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const toolNamePattern = /^[a-z][a-z0-9_]{0,63}$/;
const extensionManifestSchema = z.object({
  id: z.string().regex(extensionIdPattern),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  displayName: z.string().min(1).max(128),
  supportedEnvironments: z.array(z.enum(["gateway", "windows", "linux", "darwin"])).min(1),
});

export class ToolRuntime<TContext> {
  private readonly tools = new Map<string, ToolDefinition<TContext>>();
  private readonly extensionIds = new Set<string>();
  private readonly beforeHooks: BeforeToolCallHook<TContext>[] = [];
  private readonly afterHooks: AfterToolCallHook<TContext>[] = [];
  private sealed = false;

  registerExtension(extension: QueqiaoExtension<TContext>): void {
    if (this.sealed) throw new Error("Tool runtime is sealed");
    const manifest = extensionManifestSchema.safeParse(extension.manifest);
    if (!manifest.success) throw new Error(`Invalid extension manifest: ${extension.manifest.id}`);
    if (this.extensionIds.has(extension.manifest.id)) throw new Error(`Extension is already registered: ${extension.manifest.id}`);

    const ownedTools: string[] = [];
    const ownedBeforeHooks: BeforeToolCallHook<TContext>[] = [];
    const ownedAfterHooks: AfterToolCallHook<TContext>[] = [];
    const api: ExtensionApi<TContext> = {
      registerTool: (definition) => {
        if (!toolNamePattern.test(definition.name)) throw new Error(`Invalid public tool name: ${definition.name}`);
        if (this.tools.has(definition.name)) throw new Error(`Tool is already registered: ${definition.name}`);
        this.tools.set(definition.name, Object.freeze({ ...definition }));
        ownedTools.push(definition.name);
      },
      onBeforeToolCall: (hook) => ownedBeforeHooks.push(hook),
      onAfterToolCall: (hook) => ownedAfterHooks.push(hook),
    };

    try {
      extension.activate(api);
      this.beforeHooks.push(...ownedBeforeHooks);
      this.afterHooks.push(...ownedAfterHooks);
      this.extensionIds.add(extension.manifest.id);
    } catch (error) {
      for (const name of ownedTools) this.tools.delete(name);
      throw error;
    }
  }

  seal(): this {
    this.sealed = true;
    return this;
  }

  definitions(): readonly ToolDefinition<TContext>[] {
    return [...this.tools.values()];
  }

  async execute(toolName: string, input: unknown, context: TContext): Promise<unknown> {
    const definition = this.tools.get(toolName);
    if (!definition) throw new Error(`Tool not found: ${toolName}`);
    const parsed = definition.inputSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid tool arguments");
    const call: ToolCall<TContext> = { toolName, input: parsed.data, context };
    for (const hook of this.beforeHooks) {
      const decision = await hook(call);
      if (decision?.block) throw new Error(decision.reason);
    }
    let result = await definition.execute(call.input, context);
    for (const hook of this.afterHooks) result = (await hook({ ...call, result })) ?? result;
    return result;
  }
}
