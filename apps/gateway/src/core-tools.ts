import { CORE_PUBLIC_TOOL_CONTRACTS } from "@queqiao/core-manifest";
import type { ProcessExecutionMode } from "@queqiao/contracts";
import type { QueqiaoExtension } from "@queqiao/tool-runtime";
import type { WorkerRegistry, WorkerRoutingReceipt } from "./worker-registry.js";

import type { PublicOperationsProjection } from "@queqiao/operations";

export type GatewayToolContext = {
  workers: WorkerRegistry;
  oauthScopes: ReadonlySet<string>;
  deployment: PublicOperationsProjection;
  signal?: AbortSignal;
};

const ROUTED_TOOL_VALUE = Symbol("queqiao-routed-tool-value");
export type RoutedToolValue<T = unknown> = {
  readonly [ROUTED_TOOL_VALUE]: true;
  value: T;
  routing: WorkerRoutingReceipt;
};

function routedToolValue<T>(value: T, routing: WorkerRoutingReceipt): RoutedToolValue<T> {
  return { [ROUTED_TOOL_VALUE]: true, value, routing };
}

export function unwrapRoutedToolValue(value: unknown): { value: unknown; routing?: WorkerRoutingReceipt } {
  if (value && typeof value === "object" && (value as Partial<RoutedToolValue>)[ROUTED_TOOL_VALUE] === true) {
    const routed = value as RoutedToolValue;
    return { value: routed.value, routing: routed.routing };
  }
  return { value };
}

function requireHandshake(context: GatewayToolContext): void {
  if (!context.oauthScopes.has("queqiao:access")) throw new Error("Missing OAuth scope: queqiao:access");
}

async function selectWorkspace(context: GatewayToolContext, workspaceId?: string): Promise<string> {
  return workspaceId || (await context.workers.implicitRoute()).workspaceId;
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
        const { workspaceId, transport } = input as { workspaceId?: string; transport?: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "workspace_info");
        const routed = await context.workers.workspaceInfo(selected, "workspace_info", transport);
        return routedToolValue({ ...routed.value, oauthScopes: [...context.oauthScopes] }, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.read_file,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, offset, limit, transport } = input as { workspaceId?: string; path: string; offset: number; limit: number; transport?: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "read_file");
        const routed = await context.workers.readFile({ workspaceId: selected, path, offset, limit, ...(transport ? { transport } : {}) });
        const read = routed.value;
        return routedToolValue(`Workspace: ${selected}\nPath: ${read.path}\nLines: ${read.startLine}-${read.endLine} of ${read.totalLines}\n\n${read.text}`, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.list_directory,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, depth, limit, cursor, includeHidden, transport } = input as { workspaceId?: string; path: string; depth: number; limit: number; cursor?: string; includeHidden: boolean; transport?: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "list_directory");
        const routed = await context.workers.listDirectory({ workspaceId: selected, path, depth, limit, ...(cursor ? { cursor } : {}), includeHidden, ...(transport ? { transport } : {}) });
        return routedToolValue({ workspaceId: selected, ...routed.value }, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.search_text,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, transport, ...search } = input as { workspaceId?: string; transport?: string; query: string; path: string; globs: string[]; maxResults: number; caseSensitive: boolean; timeoutMs: number };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "search_text");
        const routed = await context.workers.searchText({ workspaceId: selected, ...search, ...(transport ? { transport } : {}) }, context.signal);
        return routedToolValue({ workspaceId: selected, ...routed.value }, routed.routing);
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
        const { workspaceId, transport } = input as { workspaceId: string; transport?: string };
        await context.workers.requireTool(workspaceId, "open_workspace");
        const routed = await context.workers.workspaceInfo(workspaceId, "open_workspace", transport);
        return routedToolValue(routed.value, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.write_file,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, content, transport } = input as { workspaceId?: string; transport?: string; path: string; content: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "write_file");
        const routed = await context.workers.writeFile({ workspaceId: selected, path, content, ...(transport ? { transport } : {}) });
        return routedToolValue({ workspaceId: selected, ...routed.value }, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.edit_file,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, path, oldText, newText, transport } = input as { workspaceId?: string; transport?: string; path: string; oldText: string; newText: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "edit_file");
        const routed = await context.workers.editFile({ workspaceId: selected, path, oldText, newText, ...(transport ? { transport } : {}) });
        return routedToolValue({ workspaceId: selected, ...routed.value }, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.run,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, executable, args, cwd, timeoutMs, mode, transport } = input as { workspaceId?: string; executable: string; args: string[]; cwd: string; timeoutMs: number; mode: ProcessExecutionMode; transport?: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "run");
        const routed = await context.workers.run({ workspaceId: selected, executable, args, cwd, timeoutMs, mode, ...(transport ? { transport } : {}) }, context.signal);
        return routedToolValue({ workspaceId: selected, executable, ...routed.value }, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.extension,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, transport, ...request } = input as { workspaceId?: string; transport?: string; [key: string]: unknown };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "extension");
        const routed = await context.workers.invokeTool("extension", { ...request, workspaceId: selected, ...(transport ? { transport } : {}) }, context.signal);
        return routedToolValue(routed.value, routed.routing);
      },
    });

    api.registerTool({
      ...CORE_PUBLIC_TOOL_CONTRACTS.shell,
      async execute(input, context) {
        requireHandshake(context);
        const { workspaceId, shell, command, cwd, timeoutMs, mode, transport } = input as { workspaceId?: string; shell: "default" | "bash" | "powershell" | "cmd" | "git-bash"; command: string; cwd: string; timeoutMs: number; mode: ProcessExecutionMode; transport?: string };
        const selected = await selectWorkspace(context, workspaceId);
        await context.workers.requireTool(selected, "shell");
        const routed = await context.workers.shell({ workspaceId: selected, shell, command, cwd, timeoutMs, mode, ...(transport ? { transport } : {}) }, context.signal);
        return routedToolValue({ workspaceId: selected, ...routed.value }, routed.routing);
      },
    });
  },
};
