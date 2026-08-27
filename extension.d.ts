import type { ZodObject } from "zod";

export type ToolCapability = "workspace:read" | "workspace:write" | "workspace:exec";
export type ToolRisk = "read" | "write" | "execute";
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
  inputSchema: ZodObject;
  requiredCapabilities: readonly ToolCapability[];
  risk: ToolRisk;
  annotations: ToolAnnotations;
  execute(input: unknown, context: TContext): Promise<unknown>;
};

export type ToolCall<TContext> = { toolName: string; input: unknown; context: TContext };
export type BeforeToolCallHook<TContext> = (call: ToolCall<TContext>) => Promise<{ block: true; reason: string } | void> | { block: true; reason: string } | void;
export type AfterToolCallHook<TContext> = (call: ToolCall<TContext> & { result: unknown }) => Promise<unknown | void> | unknown | void;
export type WrapToolCallHook<TContext> = (call: ToolCall<TContext>, next: () => Promise<unknown>) => Promise<unknown>;

export type ExtensionApi<TContext> = {
  registerTool(definition: ToolDefinition<TContext>): void;
  extendTool(toolName: string, stage: "before", hook: BeforeToolCallHook<TContext>): void;
  extendTool(toolName: string, stage: "after", hook: AfterToolCallHook<TContext>): void;
  extendTool(toolName: string, stage: "wrap", hook: WrapToolCallHook<TContext>): void;
  replaceTool(toolName: string, definition: ToolDefinition<TContext>): void;
};

export type ExtensionModuleManifest = {
  id: string;
  version: string;
  displayName: string;
  supportedEnvironments?: readonly ("gateway" | "windows" | "linux" | "darwin")[];
};

export type QueqiaoExtension<TContext> = {
  manifest: ExtensionModuleManifest;
  activate(api: ExtensionApi<TContext>): void;
  dispose?(): void | Promise<void>;
};

export type ExtensionHost = { kind: "gateway" } | { kind: "worker"; environmentId?: string };
export type ExtensionActivation = { kind: "global" } | { kind: "workspaces"; workspaceIds: string[] };
export type JsonSchemaObject = Record<string, unknown>;
export type ExtensionRegisterContribution = {
  operation: "register";
  tool: string;
  visibility: "public" | "internal";
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  requiredCapabilities: ToolCapability[];
  risk: ToolRisk;
  annotations: ToolAnnotations;
};
export type ExtensionContribution = ExtensionRegisterContribution | {
  operation: "extend";
  tool: string;
  stage: "before" | "after" | "wrap";
  requiredCapabilities: ToolCapability[];
} | {
  operation: "replace";
  tool: string;
  preservesContract: true;
  requiredCapabilities: ToolCapability[];
};
export type ExtensionManifestConfig = {
  id: string;
  version: string;
  displayName: string;
  host: ExtensionHost;
  ordering: { requires: string[]; before: string[]; after: string[] };
  contributions: ExtensionContribution[];
};
export type ExtensionPackageMetadata = {
  apiVersion: 1;
  module: string;
  manifest: ExtensionManifestConfig;
};

export declare const QUEQIAO_EXTENSION_API_VERSION: 1;
export declare function defineExtension<TContext>(extension: QueqiaoExtension<TContext>): QueqiaoExtension<TContext>;
export declare function defineExtensionManifest(manifest: ExtensionManifestConfig): ExtensionManifestConfig;
