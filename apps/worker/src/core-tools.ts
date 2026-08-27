import { z } from "zod";
import { processExecutionModeSchema, type ProcessExecutionMode } from "@queqiao/contracts";
import { MAX_TEXT_MUTATION_BYTES } from "@queqiao/contracts";
import { MAX_PROCESS_TIMEOUT_MS } from "@queqiao/process-runtime";
import { CORE_PUBLIC_TOOL_CONTRACTS } from "@queqiao/core-manifest";
import { ExtensionHost, ToolRuntime, type QueqiaoExtension, type RuntimeExtension, type ToolAuthorityGuard } from "@queqiao/tool-runtime";
import { WorkerCoreCapabilities, type NativeShellName } from "./core-capabilities.js";
import { WorkerToolError } from "./tool-errors.js";

export { WorkerToolError } from "./tool-errors.js";

export type WorkerToolContext = {
  workspaceId: string;
  capabilities: WorkerCoreCapabilities;
  extensionHost?: ExtensionHost<WorkerToolContext>;
  invokeExtensionTool?: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
  signal?: AbortSignal;
};

type ExtensionProxyInput = {
  workspaceId: string;
  operation: "list" | "search" | "describe" | "call";
  extensionId?: string;
  capability?: string;
  query?: string;
  arguments: Record<string, unknown>;
  limit: number;
};

function extensionRegistrations(context: WorkerToolContext) {
  const manifests = context.extensionHost?.activeManifests(context.workspaceId) ?? [];
  return manifests.flatMap((manifest) => manifest.contributions
    .filter((contribution) => contribution.operation === "register")
    .map((contribution) => ({ extension: manifest, contribution })));
}

function requireProxyTarget(input: ExtensionProxyInput) {
  if (!input.extensionId) throw new WorkerToolError(400, "invalid_request", "extensionId is required");
  if (!input.capability) throw new WorkerToolError(400, "invalid_request", "capability is required");
  return { extensionId: input.extensionId, capability: input.capability };
}

const workerCoreTools: QueqiaoExtension<WorkerToolContext> = {
  manifest: {
    id: "dev.queqiao.worker-core",
    version: "1.0.0",
    displayName: "Queqiao Worker Core Tools",
    supportedEnvironments: ["windows", "linux", "darwin"],
  },
  activate(api) {
    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.extension,
      async execute(input, context) {
        const request = input as ExtensionProxyInput;
        const registrations = extensionRegistrations(context);
        if (request.operation === "list") {
          const capabilities = registrations.slice(0, request.limit).map(({ extension, contribution }) => ({
            extensionId: extension.id,
            extensionVersion: extension.version,
            extensionDisplayName: extension.displayName,
            capability: contribution.tool,
            title: contribution.title,
            description: contribution.description,
            visibility: contribution.visibility,
            risk: contribution.risk,
          }));
          return { workspaceId: context.workspaceId, capabilities, total: registrations.length, truncated: registrations.length > capabilities.length };
        }
        if (request.operation === "search") {
          if (!request.query) throw new WorkerToolError(400, "invalid_request", "query is required for extension search");
          const needle = request.query.toLowerCase();
          const matches = registrations.filter(({ extension, contribution }) => [extension.id, extension.displayName, contribution.tool, contribution.title, contribution.description]
            .some((value) => value.toLowerCase().includes(needle)));
          const selected = matches.slice(0, request.limit).map(({ extension, contribution }) => ({
            extensionId: extension.id,
            extensionVersion: extension.version,
            capability: contribution.tool,
            title: contribution.title,
            description: contribution.description,
            visibility: contribution.visibility,
            risk: contribution.risk,
          }));
          return { workspaceId: context.workspaceId, query: request.query, matches: selected, total: matches.length, truncated: matches.length > selected.length };
        }
        const target = requireProxyTarget(request);
        const registration = registrations.find(({ extension, contribution }) => extension.id === target.extensionId && contribution.tool === target.capability);
        if (!registration) throw new WorkerToolError(404, "tool_not_found", `Extension capability is not available: ${target.extensionId}/${target.capability}`);
        if (request.operation === "describe") {
          const { extension, contribution } = registration;
          return {
            workspaceId: context.workspaceId,
            extension: { id: extension.id, version: extension.version, displayName: extension.displayName, host: extension.host },
            capability: {
              name: contribution.tool,
              title: contribution.title,
              description: contribution.description,
              visibility: contribution.visibility,
              inputSchema: contribution.inputSchema,
              ...(contribution.outputSchema ? { outputSchema: contribution.outputSchema } : {}),
              requiredCapabilities: contribution.requiredCapabilities,
              risk: contribution.risk,
              annotations: contribution.annotations,
            },
          };
        }
        if (!context.invokeExtensionTool) throw new WorkerToolError(503, "tool_error", "Extension invocation runtime is unavailable");
        const result = await context.invokeExtensionTool(target.capability, request.arguments);
        return { workspaceId: context.workspaceId, extensionId: target.extensionId, capability: target.capability, result };
      },
    });
    api.registerTool({
      name: "list_directory",
      title: "List directory",
      description: "List bounded workspace-relative directory entries without following symbolic links.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64), path: z.string().min(1).max(4096).default("."), depth: z.number().int().min(1).max(5).default(1), limit: z.number().int().min(1).max(1000).default(500), cursor: z.string().max(128).optional(), includeHidden: z.boolean().default(false) }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        const { path, depth, limit, cursor, includeHidden } = input as { workspaceId: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean };
        return context.capabilities.listDirectory(path, depth, limit, cursor, includeHidden);
      },
    });

    api.registerTool({
      name: "search_text",
      title: "Search text",
      description: "Search for a literal string in bounded UTF-8 workspace files without invoking a shell.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64), query: z.string().min(1).max(4096), path: z.string().min(1).max(4096).default("."), globs: z.array(z.string().min(1).max(256)).max(32).default([]), maxResults: z.number().int().min(1).max(500).default(100), caseSensitive: z.boolean().default(false), timeoutMs: z.number().int().min(100).max(30_000).default(10_000) }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        const { workspaceId: _workspaceId, ...search } = input as { workspaceId: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number };
        return context.capabilities.searchText(search);
      },
    });

    api.registerTool({
      name: "read_file",
      title: "Read text file",
      description: "Read bounded UTF-8 text from an authorized workspace.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64), path: z.string().min(1).max(4096), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(5000).default(500) }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        const { path, offset, limit } = input as { workspaceId: string; path: string; offset: number; limit: number };
        return context.capabilities.readFile(path, offset, limit);
      },
    });

    api.registerTool({
      name: "write_file",
      title: "Write text file",
      description: "Atomically create or replace a UTF-8 text file in an authorized workspace.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64), path: z.string().min(1).max(4096), content: z.string().max(MAX_TEXT_MUTATION_BYTES) }),
      requiredCapabilities: ["workspace:write"],
      risk: "write",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        const { path, content } = input as { workspaceId: string; path: string; content: string };
        return context.capabilities.writeFile(path, content);
      },
    });

    api.registerTool({
      name: "edit_file",
      title: "Edit text file",
      description: "Atomically replace one unique exact text occurrence in an authorized workspace file.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64), path: z.string().min(1).max(4096), oldText: z.string().min(1).max(MAX_TEXT_MUTATION_BYTES), newText: z.string().max(MAX_TEXT_MUTATION_BYTES) }),
      requiredCapabilities: ["workspace:write"],
      risk: "write",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async execute(input, context) {
        const { path, oldText, newText } = input as { workspaceId: string; path: string; oldText: string; newText: string };
        return context.capabilities.editFile(path, oldText, newText);
      },
    });

    api.registerTool({
      name: "run",
      title: "Run command",
      description: "Run one allowlisted executable without a shell in an authorized coding workspace.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64), executable: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/), args: z.array(z.string().max(8192)).max(256).default([]), cwd: z.string().min(1).max(4096).default("."), timeoutMs: z.number().int().min(100).max(MAX_PROCESS_TIMEOUT_MS).default(30_000), mode: processExecutionModeSchema.default("sync") }),
      requiredCapabilities: ["workspace:exec"],
      risk: "execute",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async execute(input, context) {
        const { executable, args, cwd, timeoutMs, mode } = input as { workspaceId: string; executable: string; args: string[]; cwd: string; timeoutMs: number; mode: ProcessExecutionMode };
        return context.capabilities.run({ executable, args, cwd, timeoutMs, mode });
      },
    });

    api.registerTool({
      name: "shell",
      title: "Run native shell",
      description: "Run a command through the native environment shell in an explicitly authorized coding workspace.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64), shell: z.enum(["default", "bash", "powershell", "cmd", "git-bash"]).default("default"), command: z.string().min(1).max(32_768).refine((value) => !value.includes("\0"), "command must not contain NUL"), cwd: z.string().min(1).max(4096).default("."), timeoutMs: z.number().int().min(100).max(MAX_PROCESS_TIMEOUT_MS).default(30_000), mode: processExecutionModeSchema.default("sync") }),
      requiredCapabilities: ["workspace:exec"],
      risk: "execute",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      async execute(input, context) {
        const { shell, command, cwd, timeoutMs, mode } = input as { workspaceId: string; shell: NativeShellName; command: string; cwd: string; timeoutMs: number; mode: ProcessExecutionMode };
        return context.capabilities.shell({ shell, command, cwd, timeoutMs, mode });
      },
    });
  },
};

const workerAuthority: ToolAuthorityGuard<WorkerToolContext> = ({ toolName, input, context, contract }) => {
  const workspaceId = (input as { workspaceId?: unknown }).workspaceId;
  if (typeof workspaceId !== "string") throw new WorkerToolError(400, "invalid_request", "workspaceId is required");
  if (context.workspaceId !== workspaceId) throw new WorkerToolError(403, "workspace_mismatch", "Tool context is bound to a different Workspace");
  context.capabilities.assertInvocation(toolName, contract.requiredCapabilities, workspaceId);
};

const workerCoreDefinitions = (() => {
  const bootstrap = new ToolRuntime<WorkerToolContext>();
  bootstrap.registerExtension(workerCoreTools);
  return Object.freeze([...bootstrap.seal().definitions()]);
})();

export function getWorkerCoreToolDefinitions() { return workerCoreDefinitions; }

export function createWorkerToolRuntime(extensions: readonly RuntimeExtension<WorkerToolContext>[] = []): ToolRuntime<WorkerToolContext> {
  const runtime = new ToolRuntime<WorkerToolContext>(workerCoreDefinitions, workerAuthority);
  return extensions.length ? runtime.compose(extensions) : runtime.seal();
}
export function createWorkerToolRuntimeForWorkspace(host: ExtensionHost<WorkerToolContext>, workspaceId: string): ToolRuntime<WorkerToolContext> {
  return host.runtimeForWorkspace(workspaceId, workerCoreDefinitions, workerAuthority);
}
