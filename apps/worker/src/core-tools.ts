import { z } from "zod";
import { MAX_TEXT_MUTATION_BYTES } from "@queqiao/protocol";
import { MAX_PROCESS_TIMEOUT_MS, type ProcessRunner } from "@queqiao/process-runtime";
import { ToolRuntime, type QueqiaoExtension } from "@queqiao/tool-runtime";
import { workspaceAllowsTool, type WorkspaceCatalog } from "./workspace-catalog.js";

export type WorkerToolContext = { catalog: WorkspaceCatalog; processes: ProcessRunner; signal?: AbortSignal };

const workerCoreTools: QueqiaoExtension<WorkerToolContext> = {
  manifest: {
    id: "dev.queqiao.worker-core",
    version: "1.0.0",
    displayName: "Queqiao Worker Core Tools",
    supportedEnvironments: ["windows", "linux", "darwin"],
  },
  activate(api) {
    api.registerTool({
      name: "list_directory",
      title: "List directory",
      description: "List bounded workspace-relative directory entries without following symbolic links.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).max(64),
        path: z.string().min(1).max(4096).default("."),
        depth: z.number().int().min(1).max(5).default(1),
        limit: z.number().int().min(1).max(1000).default(500),
        cursor: z.string().max(128).optional(),
        includeHidden: z.boolean().default(false),
      }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        const { workspaceId, path, depth, limit, cursor, includeHidden } = input as { workspaceId: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean };
        const workspace = context.catalog.get(workspaceId);
        if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
        if (!workspaceAllowsTool(workspace.config, "list_directory")) throw new WorkerToolError(403, "tool_denied", "list_directory is denied by workspace policy");
        return workspace.reader.listDirectory(path, depth, limit, cursor, includeHidden);
      },
    });

    api.registerTool({
      name: "search_text",
      title: "Search text",
      description: "Search for a literal string in bounded UTF-8 workspace files without invoking a shell.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).max(64),
        query: z.string().min(1).max(4096),
        path: z.string().min(1).max(4096).default("."),
        globs: z.array(z.string().min(1).max(256)).max(32).default([]),
        maxResults: z.number().int().min(1).max(500).default(100),
        caseSensitive: z.boolean().default(false),
        timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
      }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        const { workspaceId, ...search } = input as { workspaceId: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number };
        const workspace = context.catalog.get(workspaceId);
        if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
        if (!workspaceAllowsTool(workspace.config, "search_text")) throw new WorkerToolError(403, "tool_denied", "search_text is denied by workspace policy");
        return workspace.reader.searchText({ ...search, ...(context.signal ? { signal: context.signal } : {}) });
      },
    });

    api.registerTool({
      name: "read_file",
      title: "Read text file",
      description: "Read bounded UTF-8 text from an authorized workspace.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).max(64),
        path: z.string().min(1).max(4096),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(5000).default(500),
      }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        const { workspaceId, path, offset, limit } = input as { workspaceId: string; path: string; offset: number; limit: number };
        const workspace = context.catalog.get(workspaceId);
        if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
        if (!workspaceAllowsTool(workspace.config, "read_file")) throw new WorkerToolError(403, "tool_denied", "read_file is denied by workspace policy");
        return workspace.reader.read(path, offset, limit);
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
        const { workspaceId, path, content } = input as { workspaceId: string; path: string; content: string };
        const workspace = context.catalog.get(workspaceId);
        if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
        if (!workspaceAllowsTool(workspace.config, "write_file")) throw new WorkerToolError(403, "tool_denied", "write_file is denied by workspace policy or profile");
        return workspace.reader.write(path, content);
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
        const { workspaceId, path, oldText, newText } = input as { workspaceId: string; path: string; oldText: string; newText: string };
        const workspace = context.catalog.get(workspaceId);
        if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
        if (!workspaceAllowsTool(workspace.config, "edit_file")) throw new WorkerToolError(403, "tool_denied", "edit_file is denied by workspace policy or profile");
        return workspace.reader.edit(path, oldText, newText);
      },
    });

    api.registerTool({
      name: "run",
      title: "Run command",
      description: "Run one allowlisted executable without a shell in an authorized coding workspace.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).max(64),
        executable: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/),
        args: z.array(z.string().max(8192)).max(256).default([]),
        cwd: z.string().min(1).max(4096).default("."),
        timeoutMs: z.number().int().min(100).max(MAX_PROCESS_TIMEOUT_MS).default(30_000),
      }),
      requiredCapabilities: ["workspace:exec"],
      risk: "execute",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async execute(input, context) {
        const { workspaceId, executable, args, cwd, timeoutMs } = input as { workspaceId: string; executable: string; args: string[]; cwd: string; timeoutMs: number };
        const workspace = context.catalog.get(workspaceId);
        if (!workspace) throw new WorkerToolError(404, "workspace_not_found", `Workspace is not available: ${workspaceId}`);
        if (!workspaceAllowsTool(workspace.config, "run")) throw new WorkerToolError(403, "tool_denied", "run is denied by workspace policy or profile");
        const normalizedExecutable = executable.toLowerCase();
        if (!workspace.config.commands.allow.some((allowed) => allowed.toLowerCase() === normalizedExecutable)) throw new WorkerToolError(403, "command_denied", `${executable} is not allowed by workspace command policy`);
        const absoluteCwd = await workspace.reader.resolveDirectory(cwd);
        return context.processes.run({ executable, args, cwd: absoluteCwd, timeoutMs, ...(context.signal ? { signal: context.signal } : {}) });
      },
    });
  },
};

export class WorkerToolError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function createWorkerToolRuntime(): ToolRuntime<WorkerToolContext> {
  const runtime = new ToolRuntime<WorkerToolContext>();
  runtime.registerExtension(workerCoreTools);
  return runtime.seal();
}
