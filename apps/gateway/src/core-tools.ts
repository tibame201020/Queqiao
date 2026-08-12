import { z } from "zod";
import { MAX_TEXT_MUTATION_BYTES } from "@queqiao/protocol";
import { MAX_PROCESS_TIMEOUT_MS } from "@queqiao/process-runtime";
import type { QueqiaoExtension } from "@queqiao/tool-runtime";
import type { WorkerRegistry } from "./worker-registry.js";

export type GatewayToolContext = {
  workers: WorkerRegistry;
  oauthScopes: ReadonlySet<string>;
  signal?: AbortSignal;
};

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

function requireHandshake(context: GatewayToolContext): void {
  if (!context.oauthScopes.has("queqiao:access")) throw new Error("Missing OAuth scope: queqiao:access");
}

async function selectWorkspace(context: GatewayToolContext, workspaceId?: string): Promise<string> {
  return workspaceId || (await context.workers.defaultRoute()).workspaceId;
}

export const coreWorkspaceTools: QueqiaoExtension<GatewayToolContext> = {
  manifest: {
    id: "dev.queqiao.core-workspace",
    version: "1.0.0",
    displayName: "Queqiao Core Workspace Tools",
    supportedEnvironments: ["gateway", "windows", "linux", "darwin"],
  },
  activate(api) {
    api.registerTool({
      name: "workspace_info",
      title: "Workspace information",
      description: "Show the workspace and native environment currently exposed through Queqiao.",
      inputSchema: z.object({}),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: readAnnotations,
      async execute(_input, context) {
        requireHandshake(context);
        const selected = await selectWorkspace(context);
        await context.workers.requireTool(selected, "workspace_info");
        return { ...(await context.workers.workspaceInfo(selected, "workspace_info")), oauthScopes: [...context.oauthScopes] };
      },
    });

    api.registerTool({
      name: "read_file",
      title: "Read text file",
      description: "Read UTF-8 text from a workspace-relative path in a configured workspace. Omit workspaceId to use the default workspace.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).optional(),
        path: z.string().min(1).max(4096),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(5000).default(500),
      }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: readAnnotations,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, offset, limit } = input as { workspaceId?: string; path: string; offset: number; limit: number };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "read_file");
        const read = await context.workers.readFile({ workspaceId: selected, path, offset, limit });
        return `Workspace: ${selected}\nPath: ${read.path}\nLines: ${read.startLine}-${read.endLine} of ${read.totalLines}\n\n${read.text}`;
      },
    });

    api.registerTool({
      name: "list_directory",
      title: "List directory",
      description: "List bounded workspace-relative directory entries. Omit workspaceId to use the default workspace.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).max(64).optional(),
        path: z.string().min(1).max(4096).default("."),
        depth: z.number().int().min(1).max(5).default(1),
        limit: z.number().int().min(1).max(1000).default(500),
        cursor: z.string().max(128).optional(),
        includeHidden: z.boolean().default(false),
      }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: readAnnotations,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, depth, limit, cursor, includeHidden } = input as { workspaceId?: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "list_directory");
        return { workspaceId: selected, ...(await context.workers.listDirectory({ workspaceId: selected, path, depth, limit, ...(cursor ? { cursor } : {}), includeHidden })) };
      },
    });

    api.registerTool({
      name: "search_text",
      title: "Search text",
      description: "Search for a literal string in bounded UTF-8 workspace files. Omit workspaceId to use the default workspace.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).max(64).optional(),
        query: z.string().min(1).max(4096),
        path: z.string().min(1).max(4096).default("."),
        globs: z.array(z.string().min(1).max(256)).max(32).default([]),
        maxResults: z.number().int().min(1).max(500).default(100),
        caseSensitive: z.boolean().default(false),
        timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
      }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: readAnnotations,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, ...search } = input as { workspaceId?: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "search_text");
        return { workspaceId: selected, ...(await context.workers.searchText({ workspaceId: selected, ...search }, context.signal)) };
      },
    });

    api.registerTool({
      name: "list_workspaces",
      title: "List configured workspaces",
      description: "List only explicitly configured workspaces across Queqiao environments, including environment availability.",
      inputSchema: z.object({}),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: readAnnotations,
      async execute(_input, context) {
        requireHandshake(context);
        return context.workers.listWorkspaces();
      },
    });

    api.registerTool({
      name: "open_workspace",
      title: "Open configured workspace",
      description: "Resolve a configured workspace ID in its native environment. Arbitrary filesystem paths are not accepted.",
      inputSchema: z.object({ workspaceId: z.string().min(1).max(64) }),
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: readAnnotations,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId } = input as { workspaceId: string };
        await context.workers.requireTool(workspaceId, "open_workspace");
        return context.workers.workspaceInfo(workspaceId);
      },
    });

    api.registerTool({
      name: "write_file",
      title: "Write text file",
      description: "Atomically create or replace a UTF-8 text file at a workspace-relative path.",
      inputSchema: z.object({ workspaceId: z.string().min(1).optional(), path: z.string().min(1).max(4096), content: z.string().max(MAX_TEXT_MUTATION_BYTES) }),
      requiredCapabilities: ["workspace:write"],
      risk: "write",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, content } = input as { workspaceId?: string; path: string; content: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "write_file");
        return { workspaceId: selected, ...(await context.workers.writeFile({ workspaceId: selected, path, content })) };
      },
    });

    api.registerTool({
      name: "edit_file",
      title: "Edit text file",
      description: "Atomically replace one unique exact text occurrence in a workspace file.",
      inputSchema: z.object({ workspaceId: z.string().min(1).optional(), path: z.string().min(1).max(4096), oldText: z.string().min(1).max(MAX_TEXT_MUTATION_BYTES), newText: z.string().max(MAX_TEXT_MUTATION_BYTES) }),
      requiredCapabilities: ["workspace:write"],
      risk: "write",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, oldText, newText } = input as { workspaceId?: string; path: string; oldText: string; newText: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "edit_file");
        return { workspaceId: selected, ...(await context.workers.editFile({ workspaceId: selected, path, oldText, newText })) };
      },
    });

    api.registerTool({
      name: "run",
      title: "Run command",
      description: "Run one locally allowlisted executable without a shell in a configured coding workspace.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).optional(),
        executable: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/),
        args: z.array(z.string().max(8192)).max(256).default([]),
        cwd: z.string().min(1).max(4096).default("."),
        timeoutMs: z.number().int().min(100).max(MAX_PROCESS_TIMEOUT_MS).default(30_000),
      }),
      requiredCapabilities: ["workspace:exec"],
      risk: "execute",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, executable, args, cwd, timeoutMs } = input as { workspaceId?: string; executable: string; args: string[]; cwd: string; timeoutMs: number };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "run");
        return { workspaceId: selected, executable, ...(await context.workers.run({ workspaceId: selected, executable, args, cwd, timeoutMs }, context.signal)) };
      },
    });

    api.registerTool({
      name: "shell",
      title: "Run native shell",
      description: "Run a command through the workspace environment's native shell. This high-risk tool must be explicitly enabled for a coding workspace.",
      inputSchema: z.object({
        workspaceId: z.string().min(1).optional(),
        shell: z.enum(["default", "bash", "powershell", "cmd", "git-bash"]).default("default"),
        command: z.string().min(1).max(32_768).refine((value) => !value.includes("\0"), "command must not contain NUL"),
        cwd: z.string().min(1).max(4096).default("."),
        timeoutMs: z.number().int().min(100).max(MAX_PROCESS_TIMEOUT_MS).default(30_000),
      }),
      requiredCapabilities: ["workspace:exec"],
      risk: "execute",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, shell, command, cwd, timeoutMs } = input as { workspaceId?: string; shell: "default" | "bash" | "powershell" | "cmd" | "git-bash"; command: string; cwd: string; timeoutMs: number };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "shell");
        return { workspaceId: selected, ...(await context.workers.shell({ workspaceId: selected, shell, command, cwd, timeoutMs }, context.signal)) };
      },
    });
  },
};
