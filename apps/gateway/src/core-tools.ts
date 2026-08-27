import { CORE_PUBLIC_TOOL_CONTRACTS } from "@queqiao/core-manifest";
import type { ProcessExecutionMode } from "@queqiao/contracts";
import type { QueqiaoExtension } from "@queqiao/tool-runtime";
import type { WorkerRegistry } from "./worker-registry.js";

import type { PublicOperationsProjection } from "@queqiao/operations";

export type GatewayToolContext = {
  workers: WorkerRegistry;
  oauthScopes: ReadonlySet<string>;
  deployment: PublicOperationsProjection;
  signal?: AbortSignal;
};

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
      ...CORE_PUBLIC_TOOL_CONTRACTS.workspace_info,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId } = input as { workspaceId?: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "workspace_info");
        return { ...(await context.workers.workspaceInfo(selected, "workspace_info")), oauthScopes: [...context.oauthScopes] };
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.read_file,
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
      ...CORE_PUBLIC_TOOL_CONTRACTS.list_directory,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, depth, limit, cursor, includeHidden } = input as { workspaceId?: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "list_directory");
        return { workspaceId: selected, ...(await context.workers.listDirectory({ workspaceId: selected, path, depth, limit, ...(cursor ? { cursor } : {}), includeHidden })) };
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.search_text,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, ...search } = input as { workspaceId?: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "search_text");
        return { workspaceId: selected, ...(await context.workers.searchText({ workspaceId: selected, ...search }, context.signal)) };
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.list_workspaces,
      async execute(_input, context) {
        requireHandshake(context);
        return { deployment: context.deployment, ...(await context.workers.listWorkspaces()) };
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.open_workspace,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId } = input as { workspaceId: string };
        await context.workers.requireTool(workspaceId, "open_workspace");
        return context.workers.workspaceInfo(workspaceId);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.write_file,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, content } = input as { workspaceId?: string; path: string; content: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "write_file");
        return { workspaceId: selected, ...(await context.workers.writeFile({ workspaceId: selected, path, content })) };
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.edit_file,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, oldText, newText } = input as { workspaceId?: string; path: string; oldText: string; newText: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "edit_file");
        return { workspaceId: selected, ...(await context.workers.editFile({ workspaceId: selected, path, oldText, newText })) };
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.run,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, executable, args, cwd, timeoutMs, mode } = input as { workspaceId?: string; executable: string; args: string[]; cwd: string; timeoutMs: number; mode: ProcessExecutionMode };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "run");
        return { workspaceId: selected, executable, ...(await context.workers.run({ workspaceId: selected, executable, args, cwd, timeoutMs, mode }, context.signal)) };
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.extension,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, ...request } = input as { workspaceId?: string; [key: string]: unknown };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "extension");
        return context.workers.invokeTool("extension", { ...request, workspaceId: selected }, context.signal);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.shell,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, shell, command, cwd, timeoutMs, mode } = input as { workspaceId?: string; shell: "default" | "bash" | "powershell" | "cmd" | "git-bash"; command: string; cwd: string; timeoutMs: number; mode: ProcessExecutionMode };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "shell");
        return { workspaceId: selected, ...(await context.workers.shell({ workspaceId: selected, shell, command, cwd, timeoutMs, mode }, context.signal)) };
      },
    });
  },
};
